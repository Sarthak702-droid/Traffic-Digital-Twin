package store

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/encoding/protojson"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/db"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestAcceptedPlanIntentStaysOpenUntilAppliedOutcome(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ctx = WithActor(ctx, "test-operator")
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skip("PostgreSQL unavailable:", err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("decision_outcome_%d", time.Now().UnixNano())
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
	s := New(pool)
	network, err := config.Load("../../../../packages/scenario-config/c1-c6.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SaveConfig(ctx, network); err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateRun(ctx, network.ID, "peak_surge", "recommend", 1101)
	if err != nil {
		t.Fatal(err)
	}
	commandID := "decision-outcome-1"
	actor := "test-operator"
	if _, err = pool.Exec(ctx, "INSERT INTO command_outcomes(id,actor,payload_hash,status,route) VALUES($1,$2,$3,'pending',$4)", commandID, actor, "hash", "/api/v1/recommendations/id/approve"); err != nil {
		t.Fatal(err)
	}
	rec := &pb.Recommendation{Id: UUID().String(), RunId: run.ID.String(), Status: "pending"}
	encoded, err := protojson.Marshal(rec)
	if err != nil {
		t.Fatal(err)
	}
	write := DecisionWrite{CommandID: commandID, Recommendation: encoded, Before: []byte("[]"), After: []byte("[]"), Action: "approve", Result: "validated_pending_application"}
	auditCtx := WithCommand(WithActor(ctx, actor), commandID)
	if err = s.SaveDecision(auditCtx, write); err != nil {
		t.Fatal(err)
	}
	rec.Status = "approved"
	write.Recommendation, _ = protojson.Marshal(rec)
	write.Result = "accepted_pending_safe_boundary"
	if err = s.SaveDecision(auditCtx, write); err != nil {
		t.Fatal(err)
	}
	var settled bool
	if err = pool.QueryRow(ctx, "SELECT settled FROM decision_intents WHERE command_id=$1", commandID).Scan(&settled); err != nil {
		t.Fatal(err)
	}
	if settled {
		t.Fatal("accepted scheduling prematurely settled the decision before virtual application")
	}
	write.Result = "virtual_plan_applied"
	write.PlanOutcome = []byte(`{"status":"applied","applied_at_simulation_s":42}`)
	if err = s.SaveDecision(auditCtx, write); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, "SELECT settled FROM decision_intents WHERE command_id=$1", commandID).Scan(&settled); err != nil || !settled {
		t.Fatalf("applied outcome did not settle the decision: settled=%v err=%v", settled, err)
	}
	var appliedAt string
	if err = pool.QueryRow(ctx, "SELECT after_values->'plan_outcome'->>'applied_at_simulation_s' FROM audit_events WHERE safety_result='virtual_plan_applied' AND recommendation_id=$1", rec.Id).Scan(&appliedAt); err != nil || appliedAt != "42" {
		t.Fatalf("applied tick missing from durable audit: value=%s err=%v", appliedAt, err)
	}
}
