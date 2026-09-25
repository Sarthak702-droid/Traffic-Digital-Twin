package store

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/db"
)

func TestRunInputBindingIsDurableAndDistinctPerRun(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("input_binding_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	s := New(pool)
	n, err := config.Load("../../../../packages/scenario-config/c1-c6.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SaveConfig(ctx, n); err != nil {
		t.Fatal(err)
	}
	input := RunInputBinding{InputSessionID: "epoch-1", ConfigHash: strings.Repeat("c", 64), SourceSessions: map[string]string{"CAM-01": "source-1"}, SourceIdentities: map[string]SourceBinding{"CAM-01": {
		ClipSHA256: strings.Repeat("a", 64), GeometrySHA256: strings.Repeat("b", 64), ModelSHA256: strings.Repeat("d", 64), ConfigHash: strings.Repeat("c", 64), ObservationsSHA256: strings.Repeat("e", 64), DetectorVersion: "itd-v1.2", TrackerVersion: "bytetrack", ObservationSchemaVersion: "camera-observation-v1",
	}}}
	run, err := s.CreateRunWithInput(WithActor(ctx, "alice"), n.ID, "peak_surge", "recommend", 11, "video_profile", input)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetRunInput(ctx, run.ID)
	if err != nil || got.InputSessionID != input.InputSessionID || got.SourceSessions["CAM-01"] != "source-1" {
		t.Fatalf("binding missing: %+v %v", got, err)
	}
	second := input
	second.InputSessionID = "epoch-2"
	run2, err := s.CreateRunWithInput(WithActor(ctx, "alice"), n.ID, "peak_surge", "recommend", 11, "video_profile", second)
	if err != nil {
		t.Fatal(err)
	}
	got2, err := s.GetRunInput(ctx, run2.ID)
	if err != nil || got2.InputSessionID == got.InputSessionID {
		t.Fatalf("reset reused input epoch: %+v %v", got2, err)
	}
	if _, err := pool.Exec(ctx, "UPDATE run_input_bindings SET input_session_id='forged' WHERE run_id=$1", run.ID); err == nil {
		t.Fatal("run binding was mutable")
	}
}
