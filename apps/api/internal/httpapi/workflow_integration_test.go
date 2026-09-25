package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
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
		s.Handler().ServeHTTP(w, testRequest("POST", path, strings.NewReader(body)))
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
	w = post("/api/v1/scenarios/incident_c3/start", `{"schema_version":"1.0","seed":2202,"mode":"recommend","incident":{"kind":"capacity_reduction","capacity_ratio":0.5}}`)
	if w.Code != 200 || fake.last == nil || fake.last.IncidentKind != "capacity_reduction" || fake.last.IncidentCapacityRatio != 0.5 {
		t.Fatalf("incident override was not validated and forwarded: %d %s %#v", w.Code, w.Body.String(), fake.last)
	}
	if w = post("/api/v1/scenarios/incident_c3/start", `{"schema_version":"1.0","seed":2202,"mode":"recommend","incident":{"kind":"closure","capacity_ratio":0.5}}`); w.Code != 400 {
		t.Fatalf("invalid incident control accepted: %d", w.Code)
	}
	w = post("/api/v1/scenarios/reset", "{}")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var reset map[string]any
	json.Unmarshal(w.Body.Bytes(), &reset)
	if first["run_id"] == reset["run_id"] || reset["seed"] != float64(2202) || fake.last.IncidentCapacityRatio != 0.5 {
		t.Fatal("reset identity/seed")
	}
	var count int
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE event_type='scenario.started'").Scan(&count); e != nil || count != 3 {
		t.Fatal("missing start/reset audit", e, count)
	}
	// A manual timing protection must prevent the emergency command from
	// reaching Python, and the rejected command must remain inspectable.
	s.locks = map[string]bool{"C3-FROM-C6": true}
	w = post("/api/v1/scenarios/ambulance_corridor/start", `{"schema_version":"1.0","seed":3303,"mode":"recommend"}`)
	if w.Code != 409 || fake.last.ScenarioType != "incident_c3" {
		t.Fatalf("locked emergency was scheduled: %d %s", w.Code, w.Body.String())
	}
	if e = pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE event_type='emergency.rejected'").Scan(&count); e != nil || count != 1 {
		t.Fatal("missing rejected emergency audit", e, count)
	}
	w = post("/api/v1/scenarios/ambulance_corridor/start", `{"schema_version":"1.0","seed":3303,"mode":"manual"}`)
	if w.Code != 409 {
		t.Fatalf("manual-mode emergency was scheduled: %d %s", w.Code, w.Body.String())
	}
	s.locks = map[string]bool{}
	w = post("/api/v1/scenarios/ambulance_corridor/start", `{"schema_version":"1.0","seed":3303,"mode":"recommend"}`)
	if w.Code != 200 || fake.last.ScenarioType != "ambulance_corridor" {
		t.Fatalf("unlocked emergency did not start: %d %s", w.Code, w.Body.String())
	}
	// A video run binds one explicit source session per configured boundary.
	s.VisionProcessedDir = t.TempDir()
	selected := map[string]string{}
	for camera, boundary := range s.Network.CameraBoundaryLinks {
		session := "source-" + camera
		selected[camera] = session
		var row map[string]any
		if err := json.Unmarshal([]byte(observationFixture(session, 0, 5, 5, 0)), &row); err != nil {
			t.Fatal(err)
		}
		row["camera_id"] = camera
		row["boundary_link_id"] = boundary
		encoded, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		writeProcessedFixture(t, s.VisionProcessedDir, camera, session, []string{string(encoded)})
	}
	command, err := json.Marshal(map[string]any{"schema_version": "1.0", "seed": 4404, "mode": "recommend", "demand_source": "video_profile", "source_sessions": selected})
	if err != nil {
		t.Fatal(err)
	}
	w = post("/api/v1/scenarios/peak_surge/start", string(command))
	if w.Code != 200 {
		t.Fatalf("video run start: %d %s", w.Code, w.Body.String())
	}
	var videoRun struct {
		RunID          string `json:"run_id"`
		InputSessionID string `json:"input_session_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &videoRun); err != nil {
		t.Fatal(err)
	}
	var saved string
	if err := pool.QueryRow(ctx, "SELECT input_session_id FROM run_input_bindings WHERE run_id=$1", videoRun.RunID).Scan(&saved); err != nil || saved == "" || saved != videoRun.InputSessionID {
		t.Fatalf("video run binding not durable: %s %s %v", saved, videoRun.InputSessionID, err)
	}
	if s.state == nil || s.state.InputSessionId != saved {
		t.Fatalf("served state did not carry bound input epoch: %+v", s.state)
	}
	obs := httptest.NewRecorder()
	s.Handler().ServeHTTP(obs, testRequest("GET", "/api/v1/observations?camera_id=CAM-01&run_id="+videoRun.RunID, nil))
	if obs.Code != 200 || !strings.Contains(obs.Body.String(), `"input_session_id":"`+saved+`"`) || !strings.Contains(obs.Body.String(), `"source_session_id":"source-CAM-01"`) {
		t.Fatalf("run query did not preserve selected source: %d %s", obs.Code, obs.Body.String())
	}
	obs = httptest.NewRecorder()
	s.Handler().ServeHTTP(obs, testRequest("GET", "/api/v1/observations?camera_id=CAM-01&run_id="+videoRun.RunID+"&source_session_id=forged", nil))
	if obs.Code != 409 {
		t.Fatalf("run query accepted another source session: %d %s", obs.Code, obs.Body.String())
	}
	w = post("/api/v1/scenarios/reset", "{}")
	if w.Code != 200 {
		t.Fatalf("video run reset: %d %s", w.Code, w.Body.String())
	}
	var resetVideo struct {
		InputSessionID string `json:"input_session_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resetVideo); err != nil || resetVideo.InputSessionID == saved {
		t.Fatalf("reset reused authoritative input epoch: %s %s %v", saved, resetVideo.InputSessionID, err)
	}
	if s.state == nil || s.state.InputSessionId != resetVideo.InputSessionID {
		t.Fatalf("reset state did not change input epoch: %+v", s.state)
	}
	// Reusing a source-session string with changed clip bytes cannot alter a bound run.
	dir := filepath.Join(s.VisionProcessedDir, "CAM-01", "cache-key")
	rowPath := filepath.Join(dir, "observations.jsonl")
	var changed map[string]any
	data, err := os.ReadFile(rowPath)
	if err != nil {
		t.Fatal(err)
	}
	originalRow := append([]byte(nil), data...)
	if err := json.Unmarshal(data[:len(data)-1], &changed); err != nil {
		t.Fatal(err)
	}
	identity := changed["source_identity"].(map[string]any)
	identity["clip_sha256"] = strings.Repeat("f", 64)
	data, err = json.Marshal(changed)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	if err := os.WriteFile(rowPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(dir, "manifest.json")
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	originalManifest := append([]byte(nil), manifestBytes...)
	var manifest map[string]any
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["clip_sha256"] = strings.Repeat("f", 64)
	digest := sha256.Sum256(data)
	manifest["observations_sha256"] = hex.EncodeToString(digest[:])
	manifestBytes, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, manifestBytes, 0600); err != nil {
		t.Fatal(err)
	}
	obs = httptest.NewRecorder()
	s.Handler().ServeHTTP(obs, testRequest("GET", "/api/v1/observations?camera_id=CAM-01&run_id="+videoRun.RunID, nil))
	if obs.Code != 409 {
		t.Fatalf("bound run accepted changed source identity: %d %s", obs.Code, obs.Body.String())
	}
	if w = post("/api/v1/scenarios/reset", "{}"); w.Code != 409 {
		t.Fatalf("reset accepted changed source identity: %d %s", w.Code, w.Body.String())
	}
	if err := os.WriteFile(rowPath, originalRow, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, originalManifest, 0600); err != nil {
		t.Fatal(err)
	}
	// Stop the server to force the real gRPC failure path without data races.
	rpc.Stop()
	w = post("/api/v1/scenarios/reset", "{}")
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE event_type='scenario.started'").Scan(&count)
	if count != 6 {
		t.Fatal("failed reset recorded as successful")
	}
}
