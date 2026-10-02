package httpapi

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"traffic.local/twin/apps/api/internal/store"
	"traffic.local/twin/db"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

type changedSourceSimulation struct {
	pb.UnimplementedSimulationServer
	latest     *pb.TrafficState
	outcome    *pb.PlanOutcome
	applyCalls int
	lastPlan   *pb.PlanCommand
	lastLookup *pb.PlanCommand
}

func (f *changedSourceSimulation) GetState(context.Context, *pb.RunRequest) (*pb.TrafficState, error) {
	return proto.Clone(f.latest).(*pb.TrafficState), nil
}

func (f *changedSourceSimulation) ApplyPlan(_ context.Context, command *pb.PlanCommand) (*pb.ValidationResult, error) {
	f.applyCalls++
	f.lastPlan = proto.Clone(command).(*pb.PlanCommand)
	return &pb.ValidationResult{Valid: true}, nil
}

func (f *changedSourceSimulation) GetPlanOutcome(_ context.Context, command *pb.PlanCommand) (*pb.PlanOutcome, error) {
	f.lastLookup = proto.Clone(command).(*pb.PlanCommand)
	return proto.Clone(f.outcome).(*pb.PlanOutcome), nil
}

type dispatchIntelligence struct {
	pb.UnimplementedIntelligenceServer
	unavailable bool
}

func (f *dispatchIntelligence) Compare(_ context.Context, request *pb.CompareCommand) (*pb.ComparisonResult, error) {
	if f.unavailable {
		return nil, status.Error(codes.Unavailable, "compute lost")
	}
	return &pb.ComparisonResult{RunId: request.State.RunId}, nil
}

func TestApprovalRechecksLatestSimulatorEpochBeforeActuation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skip("PostgreSQL unavailable:", err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("decision_identity_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
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

	s := app(t)
	s.Store = store.New(pool)
	s.intelligence = pb.NewIntelligenceClient(nil)
	state := &pb.TrafficState{SchemaVersion: "1.1", RunId: "run-1", Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Source: "synthetic", SimulationTimeS: 10, InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", MetricsVersion: "metrics-1", ModelVersion: "aggregate-cell-v1", EngineKind: "aggregate"}
	state.Movements = []*pb.MovementState{{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6", DownstreamCapacityVeh: 30}}
	state.Links = []*pb.LinkAggregate{{LinkId: "C6-C3"}}
	changes := make([]*pb.TimingChange, 0, len(s.Network.Phases))
	for _, phase := range s.Network.Phases {
		changes = append(changes, &pb.TimingChange{NodeId: phase.Node, PhaseId: phase.ID, GreenS: 30})
	}
	state.ActivePlan = changes
	rec := &pb.Recommendation{Id: "rec-1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "predictor-1", MetricsVersion: "metrics-1", Status: "pending", Changes: changes}
	s.analysis = &pb.Analysis{RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "predictor-1", MetricsVersion: "metrics-1", Outcome: "recommend", Recommendation: rec}
	s.state = state
	s.recommendationTime = 10
	latest := proto.Clone(state).(*pb.TrafficState)
	latest.InputSessionId = "epoch-2"
	latest.SnapshotSequence = 10
	fake := &changedSourceSimulation{latest: latest}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	rpc := grpc.NewServer()
	pb.RegisterSimulationServer(rpc, fake)
	compute := &dispatchIntelligence{}
	pb.RegisterIntelligenceServer(rpc, compute)
	go rpc.Serve(listener)
	defer rpc.Stop()
	conn, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	s.intelligence = pb.NewIntelligenceClient(conn)
	s.sim = &simulationLink{client: pb.NewSimulationClient(conn), received: time.Now(), command: &pb.RunCommand{RunId: "run-1", Mode: "recommend"}}
	route := chi.NewRouteContext()
	route.URLParams.Add("id", "rec-1")
	route.URLParams.Add("action", "approve")
	request := httptest.NewRequest(http.MethodPost, "/api/v1/recommendations/rec-1/approve", strings.NewReader("{}"))
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, route))
	response := httptest.NewRecorder()
	s.decision(response, request)
	if response.Code != http.StatusConflict || fake.applyCalls != 0 {
		t.Fatalf("latest epoch was not enforced: status=%d apply_calls=%d body=%s", response.Code, fake.applyCalls, response.Body.String())
	}

	// A later applied receipt must settle the durable intent with its virtual tick.
	actor := "d01-operator"
	auditCtx := store.WithActor(ctx, actor)
	if err = s.Store.SaveConfig(auditCtx, s.Network); err != nil {
		t.Fatal(err)
	}
	run, err := s.Store.CreateRun(auditCtx, s.Network.ID, "peak_surge", "recommend", 1101)
	if err != nil {
		t.Fatal(err)
	}
	// Matching approval forwards activation and retains exact receipt identity.
	state.RunId = run.ID.String()
	latest = proto.Clone(state).(*pb.TrafficState)
	fake.latest = latest
	rec.RunId = state.RunId
	rec.Id = store.UUID().String()
	rec.ActivateNotBeforeSimulationS = 45
	s.state = state
	s.analysis.RunId = state.RunId
	s.analysis.Recommendation = rec
	s.sim.command.RunId = state.RunId
	forwardID := "d01-forward-command"
	if _, err = pool.Exec(ctx, "INSERT INTO command_outcomes(id,actor,payload_hash,status,route) VALUES($1,$2,$3,'pending',$4)", forwardID, actor, "hash", "/api/v1/recommendations/id/approve"); err != nil {
		t.Fatal(err)
	}
	route = chi.NewRouteContext()
	route.URLParams.Add("id", rec.Id)
	route.URLParams.Add("action", "approve")
	request = httptest.NewRequest(http.MethodPost, "/api/v1/recommendations/"+rec.Id+"/approve", strings.NewReader("{}"))
	request = request.WithContext(context.WithValue(store.WithCommand(store.WithActor(request.Context(), actor), forwardID), chi.RouteCtxKey, route))
	response = httptest.NewRecorder()
	compute.unavailable = true
	s.decision(response, request)
	if response.Code != 503 || fake.applyCalls != 0 {
		t.Fatalf("cached analysis allowed approval during compute loss: status=%d calls=%d", response.Code, fake.applyCalls)
	}
	compute.unavailable = false
	request = httptest.NewRequest(http.MethodPost, "/api/v1/recommendations/"+rec.Id+"/approve", strings.NewReader("{}"))
	request = request.WithContext(context.WithValue(store.WithCommand(store.WithActor(request.Context(), actor), forwardID), chi.RouteCtxKey, route))
	response = httptest.NewRecorder()
	s.decision(response, request)
	if response.Code != 200 || fake.lastPlan == nil || fake.lastPlan.ActivateNotBeforeSimulationS != 45 || fake.lastPlan.ExpectedSnapshotSequence == nil || fake.lastPlan.GetExpectedSnapshotSequence() != state.SnapshotSequence || fake.lastPlan.ExpectedInputSessionId == nil || fake.lastPlan.GetExpectedInputSessionId() != state.InputSessionId {
		t.Fatalf("reviewed activation omitted: status=%d plan=%v body=%s", response.Code, fake.lastPlan, response.Body.String())
	}
	fake.outcome = &pb.PlanOutcome{CommandId: forwardID, Status: "accepted"}
	s.reconcileDecisions(ctx)
	if !proto.Equal(fake.lastPlan, fake.lastLookup) {
		t.Fatalf("receipt lookup changed the dispatch payload: sent=%v lookup=%v", fake.lastPlan, fake.lastLookup)
	}
	commandID := "d01-applied-command"
	if _, err = pool.Exec(ctx, "INSERT INTO command_outcomes(id,actor,payload_hash,status,route) VALUES($1,$2,$3,'pending',$4)", commandID, actor, "hash", "/api/v1/recommendations/id/approve"); err != nil {
		t.Fatal(err)
	}
	receiptRec := &pb.Recommendation{Id: store.UUID().String(), RunId: run.ID.String(), Status: "pending", Changes: changes}
	write := store.DecisionWrite{CommandID: commandID, Recommendation: jsonProto(receiptRec), Before: []byte("[]"), After: []byte("[]"), Action: "approve", Result: "validated_pending_application"}
	auditCtx = store.WithCommand(auditCtx, commandID)
	if err = s.Store.SaveDecision(auditCtx, write); err != nil {
		t.Fatal(err)
	}
	receiptRec.Status = "approved"
	write.Recommendation = jsonProto(receiptRec)
	write.Result = "accepted_pending_safe_boundary"
	if err = s.Store.SaveDecision(auditCtx, write); err != nil {
		t.Fatal(err)
	}
	tick := 42.0
	fake.outcome = &pb.PlanOutcome{CommandId: commandID, Status: "applied", AppliedAtSimulationS: &tick, InputSessionId: "epoch-1", SnapshotSequence: 9}
	s.reconcileDecisions(ctx)
	var settled bool
	var appliedAt string
	if err = pool.QueryRow(ctx, "SELECT settled FROM decision_intents WHERE command_id=$1", commandID).Scan(&settled); err != nil || !settled {
		t.Fatalf("applied receipt did not settle intent: settled=%v err=%v", settled, err)
	}
	if err = pool.QueryRow(ctx, "SELECT after_values->'plan_outcome'->>'applied_at_simulation_s' FROM audit_events WHERE safety_result='virtual_plan_applied' AND recommendation_id=$1", receiptRec.Id).Scan(&appliedAt); err != nil || appliedAt != "42" {
		t.Fatalf("applied receipt tick was not audited: value=%s err=%v", appliedAt, err)
	}
}
