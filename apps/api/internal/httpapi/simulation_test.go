package httpapi

import (
	"context"
	"fmt"
	"net"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/store"
	"traffic.local/twin/db"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestSimulationHealthStates(t *testing.T) {
	s := app(t)

	// 1. Sim is nil
	h, msg := s.simulationHealth()
	if h != "unavailable" || !strings.Contains(msg, "not configured") {
		t.Fatalf("expected unavailable for nil sim, got %s: %s", h, msg)
	}

	// 2. Sim present, but no scenario started
	s.sim = &simulationLink{}
	h, msg = s.simulationHealth()
	if h != "unavailable" || !strings.Contains(msg, "No scenario has been started") {
		t.Fatalf("expected unavailable for nil command, got %s: %s", h, msg)
	}

	// 3. Command present, but fault recorded
	s.sim.command = &pb.RunCommand{RunId: "run-1"}
	s.sim.fault = "Simulation stream disconnected"
	h, msg = s.simulationHealth()
	if h != "unavailable" || msg != "Simulation stream disconnected" {
		t.Fatalf("expected fault message, got %s: %s", h, msg)
	}

	// 4. Stale state (last received > 2500ms ago)
	s.sim.fault = ""
	s.sim.received = time.Now().Add(-3 * time.Second)
	h, msg = s.simulationHealth()
	if h != "unavailable" || !strings.Contains(msg, "stale") {
		t.Fatalf("expected stale state, got %s: %s", h, msg)
	}

	// 5. Fresh state connected
	s.sim.received = time.Now()
	h, msg = s.simulationHealth()
	if h != "normal" || !strings.Contains(msg, "1 Hz") {
		t.Fatalf("expected normal 1 Hz, got %s: %s", h, msg)
	}

	// 6. Replaying mode
	s.replaying = true
	h, msg = s.simulationHealth()
	if h != "normal" || !strings.Contains(msg, "GOLDEN REPLAY") {
		t.Fatalf("expected normal golden replay, got %s: %s", h, msg)
	}
}

func TestStartScenarioInputValidation(t *testing.T) {
	s := app(t)
	// Without store or sim configured
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/scenarios/peak_surge/start", strings.NewReader(`{"schema_version":"1.0","seed":1101,"mode":"recommend"}`)))
	if w.Code != 503 {
		t.Fatalf("expected 503 for unconfigured sim, got %d", w.Code)
	}

	s.sim = &simulationLink{subscribers: map[chan *pb.TrafficState]struct{}{}}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/scenarios/peak_surge/start", strings.NewReader(`{"schema_version":"1.0","seed":1101,"mode":"recommend"}`)))
	if w.Code != 503 {
		t.Fatalf("expected 503 for unconfigured store, got %d", w.Code)
	}
}

func TestResetScenarioPreconditions(t *testing.T) {
	s := app(t)
	// 1. Sim unconfigured
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/scenarios/reset", strings.NewReader(`{}`)))
	if w.Code != 503 {
		t.Fatalf("expected 503 when sim unconfigured, got %d", w.Code)
	}

	// 2. Sim configured but no active command
	s.sim = &simulationLink{subscribers: map[chan *pb.TrafficState]struct{}{}}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/scenarios/reset", strings.NewReader(`{}`)))
	if w.Code != 503 {
		t.Fatalf("expected 503 when store is nil, got %d", w.Code)
	}
}

func TestAcceptFrameFilteringAndSubscriberBuffer(t *testing.T) {
	s := app(t)
	ch := make(chan *pb.TrafficState, 1)
	s.sim = &simulationLink{
		command:     &pb.RunCommand{RunId: "run-active"},
		subscribers: map[chan *pb.TrafficState]struct{}{ch: {}},
	}

	// 1. Invalid contracts frame (e.g. occupancy > 1.0)
	badFrame := &pb.TrafficState{
		SchemaVersion: "1.0",
		RunId:         "run-active",
		Timestamp:     time.Now().UTC().Format(time.RFC3339Nano),
		Source:        "synthetic",
		Movements: []*pb.MovementState{
			{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6", OccupancyRatio: 2.5},
		},
	}
	if err := s.acceptFrame(badFrame); err == nil {
		t.Fatal("expected error on contract violation frame")
	}

	// 2. Frame for different run
	mismatched := &pb.TrafficState{
		SchemaVersion: "1.0",
		RunId:         "different-run",
		Timestamp:     time.Now().UTC().Format(time.RFC3339Nano),
		Source:        "synthetic",
		Movements: []*pb.MovementState{
			{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6"},
		},
	}
	if err := s.acceptFrame(mismatched); err != nil {
		t.Fatal("unexpected error on mismatched run", err)
	}
	if s.state != nil {
		t.Fatal("mismatched run frame should not update server state")
	}

	// 3. Valid frame updates state and clears fault
	s.sim.fault = "Some previous fault"
	valid1 := &pb.TrafficState{
		SchemaVersion:   "1.0",
		RunId:           "run-active",
		Timestamp:       time.Now().UTC().Format(time.RFC3339Nano),
		SimulationTimeS: 5,
		Source:          "synthetic",
		Movements: []*pb.MovementState{
			{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6", QueueVeh: 3},
		},
	}
	if err := s.acceptFrame(valid1); err != nil {
		t.Fatal(err)
	}
	if s.state.SimulationTimeS != 5 || s.sim.fault != "" {
		t.Fatal("state not updated or fault not cleared")
	}
	select {
	case received := <-ch:
		if received.SimulationTimeS != 5 {
			t.Fatal("subscriber received wrong frame")
		}
	default:
		t.Fatal("subscriber did not receive frame")
	}

	// 4. Out-of-order frame (earlier simulation time)
	validOlder := &pb.TrafficState{
		SchemaVersion:   "1.0",
		RunId:           "run-active",
		Timestamp:       time.Now().UTC().Format(time.RFC3339Nano),
		SimulationTimeS: 3,
		Source:          "synthetic",
		Movements: []*pb.MovementState{
			{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6", QueueVeh: 1},
		},
	}
	if err := s.acceptFrame(validOlder); err != nil {
		t.Fatal(err)
	}
	if s.state.SimulationTimeS != 5 {
		t.Fatal("out-of-order frame overwrote newer state")
	}

	// 5. Subscriber channel overflow doesn't block server
	valid2 := &pb.TrafficState{
		SchemaVersion:   "1.0",
		RunId:           "run-active",
		Timestamp:       time.Now().UTC().Format(time.RFC3339Nano),
		SimulationTimeS: 6,
		Source:          "synthetic",
		Movements: []*pb.MovementState{
			{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6"},
		},
	}
	valid3 := &pb.TrafficState{
		SchemaVersion:   "1.0",
		RunId:           "run-active",
		Timestamp:       time.Now().UTC().Format(time.RFC3339Nano),
		SimulationTimeS: 7,
		Source:          "synthetic",
		Movements: []*pb.MovementState{
			{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6"},
		},
	}
	// Channel capacity is 1, sending 2 frames must not deadlock
	_ = s.acceptFrame(valid2)
	_ = s.acceptFrame(valid3)
	if s.state.SimulationTimeS != 7 {
		t.Fatal("latest state not updated")
	}
}

type configurableMockSimulation struct {
	pb.UnimplementedSimulationServer
	returnErr      error
	mismatchRunID  bool
	mismatchSeed   bool
	mismatchScenario bool
	invalidState   bool
}

func (m *configurableMockSimulation) Reset(_ context.Context, c *pb.RunCommand) (*pb.TrafficState, error) {
	if m.returnErr != nil {
		return nil, m.returnErr
	}
	runID := c.RunId
	if m.mismatchRunID {
		runID = "mismatched-run-id"
	}
	seed := c.Seed
	if m.mismatchSeed {
		seed = 99999
	}
	scenario := c.ScenarioType
	if m.mismatchScenario {
		scenario = "different_scenario"
	}
	occupancy := 0.2
	if m.invalidState {
		occupancy = 5.0 // Invalid occupancy > 1
	}
	return &pb.TrafficState{
		SchemaVersion: "1.0",
		RunId:         runID,
		Seed:          seed,
		ScenarioType:  scenario,
		Timestamp:     time.Now().UTC().Format(time.RFC3339Nano),
		Source:        "synthetic",
		Movements: []*pb.MovementState{
			{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6", OccupancyRatio: occupancy},
		},
	}, nil
}

func setupTestStore(t *testing.T) (*store.Store, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skip("PostgreSQL not available:", err)
		return nil, nil
	}
	schema := fmt.Sprintf("sim_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Skip("PostgreSQL schema create failed:", err)
		return nil, nil
	}
	cfg, _ := pgxpool.ParseConfig(dsn)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		t.Fatal(err)
	}
	if err = db.Migrate(context.Background(), pool); err != nil {
		pool.Close()
		admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		t.Fatal(err)
	}
	cleanup := func() {
		pool.Close()
		admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	}
	st := store.New(pool)
	n, err := config.Load("../../../../packages/scenario-config/c1-c6.json")
	if err == nil {
		_ = st.SaveConfig(context.Background(), n)
	}
	return st, cleanup
}

func TestLaunchFailureModes(t *testing.T) {
	st, cleanup := setupTestStore(t)
	if st == nil {
		return
	}
	defer cleanup()

	tests := []struct {
		name         string
		mock         configurableMockSimulation
		expectedCode int
		expectedText string
	}{
		{
			name:         "gRPC reset error",
			mock:         configurableMockSimulation{returnErr: status.Error(codes.Unavailable, "SUMO crashed")},
			expectedCode: 503,
			expectedText: "Simulator start/reset failed",
		},
		{
			name:         "mismatched run ID",
			mock:         configurableMockSimulation{mismatchRunID: true},
			expectedCode: 502,
			expectedText: "Simulator returned a mismatched run",
		},
		{
			name:         "mismatched seed",
			mock:         configurableMockSimulation{mismatchSeed: true},
			expectedCode: 502,
			expectedText: "Simulator returned a mismatched run",
		},
		{
			name:         "mismatched scenario",
			mock:         configurableMockSimulation{mismatchScenario: true},
			expectedCode: 502,
			expectedText: "Simulator returned a mismatched run",
		},
		{
			name:         "invalid state contract",
			mock:         configurableMockSimulation{invalidState: true},
			expectedCode: 502,
			expectedText: "Invalid simulator state",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			grpcServer := grpc.NewServer()
			pb.RegisterSimulationServer(grpcServer, &tc.mock)
			go grpcServer.Serve(listener)
			defer grpcServer.Stop()

			s := app(t)
			s.Store = st
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if err := s.ConnectSimulation(ctx, listener.Addr().String()); err != nil {
				t.Fatal(err)
			}

			w := httptest.NewRecorder()
			r := httptest.NewRequest("POST", "/api/v1/scenarios/peak_surge/start", strings.NewReader(`{"schema_version":"1.0","seed":1101,"mode":"recommend"}`))
			s.Handler().ServeHTTP(w, r)
			if w.Code != tc.expectedCode {
				t.Fatalf("expected code %d, got %d: %s", tc.expectedCode, w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), tc.expectedText) {
				t.Fatalf("expected response to contain %q, got: %s", tc.expectedText, w.Body.String())
			}
		})
	}
}
