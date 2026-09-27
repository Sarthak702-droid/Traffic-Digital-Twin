package store

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/db"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestReportEvidenceEventsAreAppendOnlyAndSurviveReconnect(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("report_evidence_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
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
	if err = db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	network, err := config.Load("../../../../packages/scenario-config/c1-c6.json")
	if err != nil {
		t.Fatal(err)
	}
	s := New(pool)
	if err = s.SaveConfig(ctx, network); err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateRun(WithActor(ctx, "report-test"), network.ID, "peak_surge", "recommend", 1101)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, "INSERT INTO run_evidence_events(id,run_id,kind,payload) VALUES($1,$2,'analysis',$3)", UUID(), run.ID, []byte(`{"outcome":"no_action"}`))
	if err != nil {
		t.Fatal("durable report evidence unavailable:", err)
	}
	if _, err = pool.Exec(ctx, "UPDATE run_evidence_events SET kind='failure' WHERE run_id=$1", run.ID); err == nil {
		t.Fatal("report evidence could be rewritten")
	}
	if err = s.SaveAnalysisEvidence(ctx, &pb.Analysis{RunId: run.ID.String(), Outcome: "no_action", OutcomeReason: "Current plan is best"}); err != nil {
		t.Fatal(err)
	}
	recID := UUID().String()
	if err = s.SaveAnalysisEvidence(ctx, &pb.Analysis{RunId: run.ID.String(), Outcome: "recommend", Recommendation: &pb.Recommendation{Id: recID, RunId: run.ID.String(), Status: "pending"}}); err != nil {
		t.Fatal(err)
	}
	observation := &pb.FinalizedObservation{ObservationId: "obs-1", CameraId: "CAM-01", WindowStartS: 0, WindowEndS: 5, AvailableAtSourceS: 5, ProcessedAtUtc: "2026-09-27T00:00:00Z", CrossingsVeh: 0, ObservationStatus: "valid", SourceIdentity: &pb.SourceIdentity{ClipSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", GeometrySha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", SourceSessionId: "source-1"}}
	if err = s.SaveObservationEvidence(ctx, run.ID, observation); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveObservationEvidence(ctx, run.ID, observation); err != nil {
		t.Fatal(err)
	}
	changed := *observation
	changed.CrossingsVeh = 1
	if err = s.SaveObservationEvidence(ctx, run.ID, &changed); err == nil {
		t.Fatal("changed duplicate observation was silently accepted")
	}
	var observed int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM run_evidence_events WHERE run_id=$1 AND kind='observation' AND payload->>'observation_id'='obs-1'", run.ID).Scan(&observed); err != nil || observed != 1 {
		t.Fatalf("duplicate observation persisted: %d %v", observed, err)
	}
	var recommendationCount int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM recommendations WHERE id=$1 AND run_id=$2", recID, run.ID).Scan(&recommendationCount); err != nil || recommendationCount != 1 {
		t.Fatalf("analysis recommendation not coupled: %d %v", recommendationCount, err)
	}
	pool.Close()
	pool, err = pgxpool.NewWithConfig(ctx, cfg.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	saved, err := New(pool).ListReportEvidence(ctx, run.ID)
	if err != nil || len(saved) != 4 || saved[1].Kind != "analysis" {
		t.Fatalf("analysis evidence not durable: %+v %v", saved, err)
	}
	var outcome string
	if err = pool.QueryRow(ctx, "SELECT payload->>'outcome' FROM run_evidence_events WHERE run_id=$1", run.ID).Scan(&outcome); err != nil || outcome != "no_action" {
		t.Fatalf("report evidence lost after restart: %s %v", outcome, err)
	}
}
