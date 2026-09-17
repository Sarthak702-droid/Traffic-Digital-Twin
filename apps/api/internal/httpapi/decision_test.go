package httpapi

import (
	"context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"net"
	"testing"
	"time"
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
}

func (f *resetSimulation) Reset(_ context.Context, c *pb.RunCommand) (*pb.TrafficState, error) {
	if f.fail {
		return nil, status.Error(codes.Unavailable, "SUMO unavailable")
	}
	return &pb.TrafficState{SchemaVersion: "1.0", RunId: c.RunId, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), ScenarioType: c.ScenarioType, Seed: c.Seed, Source: "synthetic", Movements: []*pb.MovementState{{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6"}}}, nil
}
