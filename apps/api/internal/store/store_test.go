package store

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
	"time"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/store/queries"
	"traffic.local/twin/db"
)

func TestPostgresDurabilityAndAtomicAudit(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Skip("PostgreSQL not available:", e)
	}
	defer admin.Close()
	schema := fmt.Sprintf("epic1_test_%d", time.Now().UnixNano())
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	cfg, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	open := func() *Store {
		p, e := pgxpool.NewWithConfig(ctx, cfg.Copy())
		if e != nil {
			t.Fatal(e)
		}
		return New(p)
	}
	s := open()
	if e = db.Migrate(ctx, s.Pool); e != nil {
		t.Fatal(e)
	}
	if e = db.Migrate(ctx, s.Pool); e != nil {
		t.Fatal("migration not idempotent", e)
	}
	n, e := config.Load("../../../../packages/scenario-config/c1-c6.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.SaveConfig(ctx, n); e != nil {
		t.Fatal(e)
	}
	run, e := s.CreateRun(ctx, n.ID, "peak_surge", "recommend", 1101)
	if e != nil {
		t.Fatal(e)
	}
	s.Pool.Close()
	s = open()
	defer s.Pool.Close()
	saved, e := s.Q.GetRun(ctx, run.ID)
	if e != nil || saved.Seed != 1101 || saved.Status != "prepared" {
		t.Fatal("run did not survive reconnect", e)
	}
	events, e := s.Q.ListAudit(ctx, queries.ListAuditParams{Sequence: 0, Limit: 100})
	if e != nil || len(events) != 1 || events[0].RunID != run.ID {
		t.Fatalf("audit: %v %v", events, e)
	}
	if _, e = s.Pool.Exec(ctx, "UPDATE audit_events SET reason='rewritten'"); e == nil {
		t.Fatal("audit rewrite was allowed")
	}
	n.Name = "Changed without version bump"
	if e = s.SaveConfig(ctx, n); e == nil {
		t.Fatal("immutable config overwritten")
	}
	// Revised writer controls use real PostgreSQL, including every canonical mode.
	for _, mode := range []string{"observe", "manual", "recommend"} {
		if e := s.SaveControl(ctx, "mode", ControlWrite{RunID: run.ID.String(), Mode: mode}); e != nil {
			t.Fatal(e)
		}
		var savedMode string
		if e := s.Pool.QueryRow(ctx, "SELECT mode FROM scenario_runs WHERE id=$1", run.ID).Scan(&savedMode); e != nil || savedMode != mode {
			t.Fatalf("mode %s: %s %v", mode, savedMode, e)
		}
	}
	if e := s.SaveControl(ctx, "lock", ControlWrite{RunID: run.ID.String(), Target: "unknown", Locked: true}); e == nil {
		t.Fatal("unknown lock accepted")
	}
	target := n.Phases[0].ID
	if e := s.SaveControl(ctx, "lock", ControlWrite{RunID: run.ID.String(), Target: target, Locked: true}); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Pool.Exec(ctx, "ALTER TABLE audit_events ADD CONSTRAINT reject_unlock CHECK(event_type <> 'lock.released') NOT VALID"); e != nil {
		t.Fatal(e)
	}
	if e := s.SaveControl(ctx, "lock", ControlWrite{RunID: run.ID.String(), Target: target}); e == nil {
		t.Fatal("unlock succeeded without audit")
	}
	var locked bool
	if e := s.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM control_locks WHERE target=$1)", target).Scan(&locked); e != nil || !locked {
		t.Fatal("lock not retained on audit failure", e)
	}
	command := CommandWrite{ID: "test-command-123", Hash: strings.Repeat("a", 64)}
	assertCommand := func(op, expected string, v CommandWrite, actor string) {
		t.Helper()
		result, err := s.Command(WithActor(ctx, actor), op, v)
		if err != nil {
			t.Fatal(err)
		}
		if result.(map[string]any)["status"] != expected {
			t.Fatalf("%s: %v", op, result)
		}
	}
	assertCommand("command.reserve", "reserved", command, "operator")
	assertCommand("command.reserve", "pending", command, "operator")
	assertCommand("command.get", "conflict", command, "another-operator")
	changed := command
	changed.Hash = strings.Repeat("b", 64)
	assertCommand("command.reserve", "conflict", changed, "operator")
	command.HTTPStatus = 200
	command.Response = json.RawMessage(`{"confirmed":true}`)
	assertCommand("command.finish", "completed", command, "operator")
	assertCommand("command.reserve", "completed", command, "operator")

	// An interrupted scenario/replay reservation must become reviewable rather
	// than blocking every future browser mutation forever. It is never replayed.
	abandoned := CommandWrite{ID: "abandoned-replay-command", Hash: strings.Repeat("c", 64), Route: "/api/v1/replay/peak_surge"}
	assertCommand("command.reserve", "reserved", abandoned, "operator")
	if _, e = s.Pool.Exec(ctx, "UPDATE command_outcomes SET created_at=now()-interval '1 minute' WHERE id=$1", abandoned.ID); e != nil {
		t.Fatal(e)
	}
	result, e := s.Command(WithActor(ctx, "operator"), "command.get", CommandWrite{ID: abandoned.ID})
	if e != nil || result.(map[string]any)["status"] != "completed" || !strings.Contains(string(result.(map[string]any)["response"].(json.RawMessage)), "no retry was performed") {
		t.Fatalf("abandoned replay command was not settled for review: %v %v", result, e)
	}

	// A full-stack restart leaves the private simulator empty. Ending the stale
	// durable run must be atomic with explicit interruption audit evidence.
	if _, e = s.Activate(ctx, run.ID, "test activation"); e != nil {
		t.Fatal(e)
	}
	if e = s.EndInterruptedRun(WithActor(ctx, "system-recovery"), run.ID, "simulator state missing"); e != nil {
		t.Fatal(e)
	}
	saved, e = s.Q.GetRun(ctx, run.ID)
	if e != nil || saved.Status != "ended" || !saved.EndedAt.Valid {
		t.Fatalf("interrupted run was not ended: %+v %v", saved, e)
	}
	var interrupted int
	if e = s.Pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE run_id=$1 AND event_type='scenario.interrupted' AND actor='system-recovery'", run.ID).Scan(&interrupted); e != nil || interrupted != 1 {
		t.Fatalf("interruption audit missing: count=%d err=%v", interrupted, e)
	}
	// Force audit insertion failure and prove the run transaction rolls back.
	if _, e = s.Pool.Exec(ctx, "ALTER TABLE audit_events ADD CONSTRAINT test_reject CHECK(event_type <> 'run.prepared') NOT VALID"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.CreateRun(ctx, n.ID, "incident_c3", "recommend", 2202); e == nil {
		t.Fatal("expected audit failure")
	}
	runs, e := s.Q.ListRuns(ctx, 100)
	if e != nil || len(runs) != 1 {
		t.Fatal("run persisted without audit", e)
	}
}
