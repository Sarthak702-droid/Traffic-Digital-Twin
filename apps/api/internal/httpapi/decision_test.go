package httpapi

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"traffic.local/twin/apps/api/internal/config"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestPlanBoundsAndReceivingSafety(t *testing.T) {
	s := app(t)
	state := &pb.TrafficState{}
	changes := []*pb.TimingChange{}
	for _, p := range s.Network.Phases {
		changes = append(changes, &pb.TimingChange{NodeId: p.Node, PhaseId: p.ID, GreenS: 30})
		state.ActivePlan = append(state.ActivePlan, &pb.TimingChange{NodeId: p.Node, PhaseId: p.ID, GreenS: 30})
	}
	if e := validateChanges(s.Network, state, changes); e != nil {
		t.Fatal(e)
	}
	changes[0].GreenS = 999
	if validateChanges(s.Network, state, changes) == nil {
		t.Fatal("unsafe bound accepted")
	}
	changes[0].GreenS = 35
	state.Movements = []*pb.MovementState{{MovementId: s.Network.Phases[0].Movements[0], DownstreamCapacityVeh: 0}}
	if validateChanges(s.Network, state, changes) == nil {
		t.Fatal("blocked receiving link accepted")
	}
	changes[0].GreenS = 30
	state.Emergency = &pb.EmergencyEvent{Status: "priority"}
	if validateChanges(s.Network, state, changes) == nil {
		t.Fatal("emergency protection bypassed")
	}
}
func TestFramesRejectOldRunsAndIsolatePayload(t *testing.T) {
	s := app(t)
	ch := make(chan *pb.TrafficState, 1)
	s.sim = &simulationLink{command: &pb.RunCommand{RunId: "current"}, subscribers: map[chan *pb.TrafficState]struct{}{ch: {}}}
	frame := &pb.TrafficState{Movements: []*pb.MovementState{{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6"}}, SchemaVersion: "1.0", RunId: "old", Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Source: "synthetic"}
	if e := s.acceptFrame(frame); e != nil {
		t.Fatal(e)
	}
	if s.state != nil {
		t.Fatal("old run accepted")
	}
	frame.RunId = "current"
	frame.SimulationTimeS = 10
	s.acceptFrame(frame)
	frame.SimulationTimeS = 1
	s.acceptFrame(frame)
	if s.state.SimulationTimeS != 10 {
		t.Fatal("out-of-order state accepted")
	}
	received := <-ch
	received.SimulationTimeS = 99
	if s.state.SimulationTimeS != 10 {
		t.Fatal("subscriber aliased cache")
	}
	s.sim.received = time.Now().Add(-3 * time.Second)
	health, _ := s.simulationHealth()
	if health != "unavailable" {
		t.Fatal("stale service marked healthy")
	}
}

type failingSimulation struct {
	pb.UnimplementedSimulationServer
}

func (f failingSimulation) StreamState(_ *pb.RunRequest, stream grpc.ServerStreamingServer[pb.TrafficState]) error {
	return status.Error(codes.Unavailable, "test disconnect")
}
func TestStreamFailureVisible(t *testing.T) {
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	server := grpc.NewServer()
	pb.RegisterSimulationServer(server, failingSimulation{})
	go server.Serve(listener)
	defer server.Stop()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := app(t)
	if e = s.ConnectSimulation(ctx, listener.Addr().String()); e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.RLock()
		fault := s.sim.fault
		s.mu.RUnlock()
		if fault == "Simulation stream disconnected" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("disconnect not visible")
}

type resetSimulation struct {
	pb.UnimplementedSimulationServer
	fail bool
	last *pb.RunCommand
}

func (f *resetSimulation) Reset(_ context.Context, c *pb.RunCommand) (*pb.TrafficState, error) {
	if f.fail {
		return nil, status.Error(codes.Unavailable, "SUMO unavailable")
	}
	f.last = proto.Clone(c).(*pb.RunCommand)
	return &pb.TrafficState{SchemaVersion: "1.0", RunId: c.RunId, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), ScenarioType: c.ScenarioType, Seed: c.Seed, Source: "synthetic", Movements: []*pb.MovementState{{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6"}}}, nil
}

func cloneNetwork(n config.Network) config.Network {
	cp := n
	cp.Phases = make([]config.Phase, len(n.Phases))
	for i, p := range n.Phases {
		cp.Phases[i] = p
		cp.Phases[i].Movements = append([]string{}, p.Movements...)
	}
	return cp
}

func TestSafetyValidatorRuleBreaches(t *testing.T) {
	baseState := func() (*Server, *pb.TrafficState, []*pb.TimingChange) {
		s := app(t)
		state := &pb.TrafficState{}
		changes := []*pb.TimingChange{}
		for _, p := range s.Network.Phases {
			changes = append(changes, &pb.TimingChange{NodeId: p.Node, PhaseId: p.ID, GreenS: 25})
			state.ActivePlan = append(state.ActivePlan, &pb.TimingChange{NodeId: p.Node, PhaseId: p.ID, GreenS: 25})
		}
		return s, state, changes
	}

	// 1. Min green violation
	t.Run("MinGreenViolation", func(t *testing.T) {
		s, state, changes := baseState()
		changes[0].GreenS = 2 // less than min (10s)
		err := validateChanges(s.Network, state, changes)
		if err == nil || !strings.Contains(err.Error(), "green outside configured bounds") {
			t.Fatalf("expected min green rejection, got %v", err)
		}
	})

	// 2. Max green violation / excessive hold
	t.Run("MaxGreenAndExcessiveHold", func(t *testing.T) {
		s, state, changes := baseState()
		changes[0].GreenS = 120 // exceeds max (55s)
		err := validateChanges(s.Network, state, changes)
		if err == nil || !strings.Contains(err.Error(), "green outside configured bounds") {
			t.Fatalf("expected max green / hold rejection, got %v", err)
		}
	})

	// 3. Complete configured phase plan required
	t.Run("IncompletePhasePlan", func(t *testing.T) {
		s, state, changes := baseState()
		err := validateChanges(s.Network, state, changes[:len(changes)-1])
		if err == nil || !strings.Contains(err.Error(), "complete configured phase plan required") {
			t.Fatalf("expected incomplete plan rejection, got %v", err)
		}
	})

	// 4. Duplicate phase in changes
	t.Run("DuplicatePhase", func(t *testing.T) {
		s, state, changes := baseState()
		changes[1] = &pb.TimingChange{NodeId: changes[0].NodeId, PhaseId: changes[0].PhaseId, GreenS: 25}
		err := validateChanges(s.Network, state, changes)
		if err == nil || !strings.Contains(err.Error(), "duplicate phase") {
			t.Fatalf("expected duplicate phase rejection, got %v", err)
		}
	})

	// 5. Pedestrian clearance breach
	t.Run("PedestrianClearanceBreach", func(t *testing.T) {
		s, state, changes := baseState()
		networkCopy := cloneNetwork(s.Network)
		// Phase 0 has min 10, max 55, set Pedestrian to 30, AllRed to 30, green to 25
		for i := range networkCopy.Phases {
			if networkCopy.Phases[i].ID == "C1-FROM-C2" {
				networkCopy.Phases[i].Pedestrian = 30
				networkCopy.Phases[i].AllRed = 30
			}
		}
		changes[0].GreenS = 25 // 25s < 30s pedestrian clearance
		err := validateChanges(networkCopy, state, changes)
		if err == nil || !strings.Contains(err.Error(), "pedestrian clearance breach") {
			t.Fatalf("expected pedestrian clearance rejection, got %v", err)
		}
	})

	// 6. Amber clearance breach
	t.Run("AmberClearanceBreach", func(t *testing.T) {
		s, state, changes := baseState()
		networkCopy := cloneNetwork(s.Network)
		for i := range networkCopy.Phases {
			if networkCopy.Phases[i].ID == "C1-FROM-C2" {
				networkCopy.Phases[i].Amber = -1
			}
		}
		err := validateChanges(networkCopy, state, changes)
		if err == nil {
			t.Fatalf("expected amber clearance breach or invalid network rejection, got nil")
		}
	})

	// 7. Conflicting greens within phase
	t.Run("ConflictingGreensInPhase", func(t *testing.T) {
		s, state, changes := baseState()
		networkCopy := cloneNetwork(s.Network)
		// Add conflicting movement into phase 0
		for i := range networkCopy.Phases {
			if networkCopy.Phases[i].ID == "C1-FROM-C2" {
				networkCopy.Phases[i].Movements = append(networkCopy.Phases[i].Movements, "C3-C1-C2")
			}
		}
		err := validateChanges(networkCopy, state, changes)
		if err == nil || !strings.Contains(err.Error(), "conflicting greens") {
			t.Fatalf("expected conflicting greens rejection, got %v", err)
		}
	})

	// 8. Max cross-traffic wait exceeded
	t.Run("MaxCrossWaitExceeded", func(t *testing.T) {
		s, state, changes := baseState()
		networkCopy := cloneNetwork(s.Network)
		for i := range networkCopy.Phases {
			if networkCopy.Phases[i].Node == "C1" {
				networkCopy.Phases[i].MaxRed = 50 // Cycle at C1 is 4*25 + 20 = 120s, wait = 95s > 50s
			}
		}
		err := validateChanges(networkCopy, state, changes)
		if err == nil || !strings.Contains(err.Error(), "maximum cross-traffic wait exceeded") {
			t.Fatalf("expected cross-traffic wait rejection, got %v", err)
		}
	})

	// 9. Manual lock enforcement
	t.Run("ManualLockEnforcement", func(t *testing.T) {
		s, state, changes := baseState()
		changes[0].GreenS = 35 // altered from current 25
		locks := map[string]bool{s.Network.Phases[0].ID: true}
		err := validateChanges(s.Network, state, changes, locks)
		if err == nil || !strings.Contains(err.Error(), "manual lock violation") {
			t.Fatalf("expected manual lock rejection for phase, got %v", err)
		}

		movementLocks := map[string]bool{s.Network.Phases[0].Movements[0]: true}
		err = validateChanges(s.Network, state, changes, movementLocks)
		if err == nil || !strings.Contains(err.Error(), "manual lock violation") {
			t.Fatalf("expected manual lock rejection for movement, got %v", err)
		}
	})

	// 10. Incident closure protection
	t.Run("IncidentClosureProtection", func(t *testing.T) {
		s, state, changes := baseState()
		state.Incident = &pb.Incident{Status: "active", NodeId: "C3", CapacityRatio: 0.0}
		err := validateChanges(s.Network, state, changes)
		if err == nil || !strings.Contains(err.Error(), "incident closure") {
			t.Fatalf("expected incident closure rejection, got %v", err)
		}

		// Restricted capacity: cannot increase green
		state.Incident = &pb.Incident{Status: "active", NodeId: "C3", CapacityRatio: 0.3}
		for i := range changes {
			if changes[i].NodeId == "C3" {
				changes[i].GreenS = 40 // increased from 25
			}
		}
		err = validateChanges(s.Network, state, changes)
		if err == nil || !strings.Contains(err.Error(), "incident closure") {
			t.Fatalf("expected incident restriction rejection, got %v", err)
		}
	})

	// 11. Downstream link 100% full (occupancy = 1.0)
	t.Run("DownstreamOccupancyFull", func(t *testing.T) {
		s, state, changes := baseState()
		changes[0].GreenS = 35
		state.Movements = []*pb.MovementState{{MovementId: s.Network.Phases[0].Movements[0], DownstreamCapacityVeh: 10, OccupancyRatio: 1.0}}
		err := validateChanges(s.Network, state, changes)
		if err == nil || !strings.Contains(err.Error(), "cannot extend release into blocked/full downstream link") {
			t.Fatalf("expected full downstream occupancy rejection, got %v", err)
		}
	})
}

func TestNoPhysicalActuationEndpoint(t *testing.T) {
	h := app(t).Handler()
	forbiddenEndpoints := []string{
		"/api/v1/signals/actuate",
		"/api/v1/controller/actuate",
		"/api/v1/physical/actuate",
		"/api/v1/traffic-lights/override",
	}
	for _, ep := range forbiddenEndpoints {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", ep, nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("endpoint %s should not exist (expected 404, got %d)", ep, w.Code)
		}
	}
}

func TestModesAndLockEndpoints(t *testing.T) {
	s := app(t)
	h := s.Handler()

	// Default mode check
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/mode", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 from GET /api/v1/mode, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"mode":"recommend"`) {
		t.Fatalf("expected default mode 'recommend', got %s", w.Body.String())
	}

	// Reject invalid mode
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/mode/autonomous_flywheel", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown mode, got %d", w.Code)
	}

	// Locks endpoints: empty list
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/locks", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"locks":[]`) {
		t.Fatalf("expected empty locks, got %s", w.Body.String())
	}

	// Lock movement
	s.mu.Lock()
	if s.locks == nil {
		s.locks = make(map[string]bool)
	}
	s.locks["C6-C3-C1"] = true
	s.mu.Unlock()

	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/locks", nil))
	if !strings.Contains(w.Body.String(), "C6-C3-C1") {
		t.Fatalf("expected locked movement in list, got %s", w.Body.String())
	}

	// Delete lock
	s.mu.Lock()
	delete(s.locks, "C6-C3-C1")
	s.mu.Unlock()

	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/locks", nil))
	if strings.Contains(w.Body.String(), "C6-C3-C1") {
		t.Fatalf("expected lock to be removed, got %s", w.Body.String())
	}
}

func TestViewerRoleMutationForbidden(t *testing.T) {
	h := app(t).Handler()

	mutations := []struct {
		method string
		path   string
		body   string
	}{
		{"POST", "/api/v1/mode/manual", ""},
		{"POST", "/api/v1/locks/C1-FROM-C2", ""},
		{"DELETE", "/api/v1/locks/C1-FROM-C2", ""},
		{"POST", "/api/v1/recommendations/rec-1/approve", "{}"},
		{"POST", "/api/v1/recommendations/rec-1/reject", `{"reason":"Other: test"}`},
		{"POST", "/api/v1/decisions/resolve", `{"command_id":"cmd-1"}`},
	}

	for _, m := range mutations {
		for _, role := range []string{"viewer", "observer"} {
			req := httptest.NewRequest(m.method, m.path, strings.NewReader(m.body))
			req.Header.Set("X-Role", role)
			req.Header.Set("X-Actor", "test-user")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != http.StatusForbidden {
				t.Errorf("expected 403 Forbidden for %s on %s %s, got %d", role, m.method, m.path, w.Code)
			}
		}
	}
}

func TestResolveDecisionValidation(t *testing.T) {
	s := app(t)
	h := s.Handler()

	// Without store (DB nil), returns 503
	req := httptest.NewRequest("POST", "/api/v1/decisions/resolve", strings.NewReader(`{"command_id":"cmd-1","resolution":"fail"}`))
	req.Header.Set("X-Role", "supervisor")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when db is unavailable, got %d", w.Code)
	}

	// Unresolved query without store returns 503
	req = httptest.NewRequest("GET", "/api/v1/decisions/unresolved", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when db is unavailable, got %d", w.Code)
	}
}
