package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"net"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
	"traffic.local/twin/apps/api/internal/store"
	"traffic.local/twin/db"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestStartResetFailureAndAuditedLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	admin, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Skip("PostgreSQL not available:", e)
	}
	defer admin.Close()
	schema := fmt.Sprintf("workflow_test_%d", time.Now().UnixNano())
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	if e = db.Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	s := app(t)
	s.Store = store.New(pool)
	if e = s.Store.SaveConfig(ctx, s.Network); e != nil {
		t.Fatal(e)
	}
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	fake := &resetSimulation{}
	rpc := grpc.NewServer()
	pb.RegisterSimulationServer(rpc, fake)
	go rpc.Serve(listener)
	defer rpc.Stop()
	simCtx, simCancel := context.WithCancel(ctx)
	defer simCancel()
	s.ConnectSimulation(simCtx, listener.Addr().String())
	post := func(path, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", path, strings.NewReader(body)))
		return w
	}
	if w := post("/api/v1/scenarios/reset", "{}"); w.Code != 409 {
		t.Fatal(w.Code)
	}
	if w := post("/api/v1/scenarios/unknown/start", `{"schema_version":"1.0","seed":1,"mode":"recommend"}`); w.Code != 400 {
		t.Fatal(w.Code)
	}
	w := post("/api/v1/scenarios/peak_surge/start", `{"schema_version":"1.0","seed":1101,"mode":"recommend"}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var first map[string]any
	json.Unmarshal(w.Body.Bytes(), &first)
	w = post("/api/v1/scenarios/reset", "{}")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var reset map[string]any
	json.Unmarshal(w.Body.Bytes(), &reset)
	if first["run_id"] == reset["run_id"] || reset["seed"] != float64(1101) {
		t.Fatal("reset identity/seed")
	}
	var count int
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE event_type='scenario.started'").Scan(&count); e != nil || count != 2 {
		t.Fatal("missing start/reset audit", e, count)
	}
	// Stop the server to force the real gRPC failure path without data races.
	rpc.Stop()
	w = post("/api/v1/scenarios/reset", "{}")
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE event_type='scenario.started'").Scan(&count)
	if count != 2 {
		t.Fatal("failed reset recorded as successful")
	}
}
