package httpapi

import (
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
	"io"
	"net/http"
	"sync"
	"time"
	"traffic.local/twin/apps/api/internal/contracts"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

type simulationLink struct {
	client      pb.SimulationClient
	conn        *grpc.ClientConn
	commands    sync.Mutex
	command     *pb.RunCommand                     // guarded by Server.mu
	received    time.Time                          // guarded by Server.mu
	fault       string                             // guarded by Server.mu
	subscribers map[chan *pb.TrafficState]struct{} // guarded by Server.mu
}

func (s *Server) ConnectSimulation(ctx context.Context, address string) error {
	conn, e := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if e != nil {
		return e
	}
	s.sim = &simulationLink{client: pb.NewSimulationClient(conn), conn: conn, subscribers: map[chan *pb.TrafficState]struct{}{}, fault: "No simulator state received"}
	if s.Store != nil {
		readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		runs, e := s.Store.Q.ListRuns(readCtx, 50)
		cancel()
		if e == nil {
			for _, r := range runs {
				if r.Status == "running" {
					id, _ := r.ID.Value()
					s.sim.command = &pb.RunCommand{SchemaVersion: "1.0", RunId: id.(string), ScenarioType: r.ScenarioType, Seed: uint32(r.Seed), Mode: r.Mode}
					break
				}
			}
		}
	}
	go func() {
		defer conn.Close()
		for ctx.Err() == nil {
			stream, e := s.sim.client.StreamState(ctx, &pb.RunRequest{})
			if e == nil {
				for {
					var frame *pb.TrafficState
					frame, e = stream.Recv()
					if e != nil {
						break
					}
					s.mu.RLock()
					accept := s.sim.command != nil && frame.RunId == s.sim.command.RunId
					s.mu.RUnlock()
					if accept {
						if err := s.persistLifecycle(frame); err != nil {
							e = err
							break
						}
						if err := s.acceptFrame(frame); err != nil {
							e = err
							break
						}
					}
				}
			}
			s.mu.Lock()
			if !s.replaying {
				s.sim.fault = "Simulation stream disconnected"
			}
			s.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}()
	return nil
}
func (s *Server) acceptFrame(frame *pb.TrafficState) error {
	if e := contracts.ValidateState(frame); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sim == nil || s.sim.command == nil || frame.RunId != s.sim.command.RunId {
		return nil
	}
	if s.state != nil && s.state.RunId == frame.RunId && s.state.SimulationTimeS > frame.SimulationTimeS {
		return nil
	}
	s.state = proto.Clone(frame).(*pb.TrafficState)
	s.sim.received = time.Now()
	s.sim.fault = ""
	for channel := range s.sim.subscribers {
		copy := proto.Clone(frame).(*pb.TrafficState)
		select {
		case channel <- copy:
		default:
			select {
			case <-channel:
			default:
			}
			select {
			case channel <- copy:
			default:
			}
		}
	}
	return nil
}
func (s *Server) simulationHealth() (string, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.sim == nil {
		return "unavailable", "Simulation service is not configured"
	}
	if s.sim.command == nil {
		return "unavailable", "No scenario has been started"
	}
	if s.sim.fault != "" {
		return "unavailable", s.sim.fault
	}
	if time.Since(s.sim.received) > 2500*time.Millisecond {
		return "unavailable", "Simulator state is stale"
	}
	if s.replaying {
		return "normal", "GOLDEN REPLAY · prerecorded synthetic traffic"
	}
	return "normal", "SUMO/TraCI stream connected at 1 Hz"
}
func (s *Server) startScenario(w http.ResponseWriter, r *http.Request) {
	if s.sim == nil {
		problem(w, 503, "Simulation service is not configured")
		return
	}
	if !s.db(w) {
		return
	}
	var body struct {
		Version string `json:"schema_version"`
		Seed    uint32 `json:"seed"`
		Mode    string `json:"mode"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if e := d.Decode(&body); e != nil {
		problem(w, 400, "Invalid scenario command")
		return
	}
	if d.Decode(new(any)) != io.EOF {
		problem(w, 400, "Exactly one command required")
		return
	}
	scenario := chi.URLParam(r, "type")
	valid := false
	for _, c := range s.Network.Scenarios {
		if c.ID == scenario {
			valid = true
		}
	}
	if !valid || body.Version != "1.0" || body.Seed == 0 || (body.Mode != "recommend" && body.Mode != "observe") {
		problem(w, 400, "Valid scenario, schema_version, seed and mode required")
		return
	}
	s.sim.commands.Lock()
	defer s.sim.commands.Unlock()
	s.launch(w, r, &pb.RunCommand{SchemaVersion: "1.0", ScenarioType: scenario, Seed: body.Seed, Mode: body.Mode}, "Started a seeded SUMO scenario")
}
func (s *Server) resetScenario(w http.ResponseWriter, r *http.Request) {
	if s.sim == nil {
		problem(w, 503, "Simulation service is not configured")
		return
	}
	if !s.db(w) {
		return
	}
	s.sim.commands.Lock()
	defer s.sim.commands.Unlock()
	s.mu.RLock()
	var command *pb.RunCommand
	if s.sim.command != nil {
		command = proto.Clone(s.sim.command).(*pb.RunCommand)
	}
	s.mu.RUnlock()
	if command == nil {
		problem(w, 409, "Start a scenario before resetting")
		return
	}
	s.launch(w, r, command, "Reset to identical seed and initial SUMO conditions")
}
func (s *Server) launch(w http.ResponseWriter, r *http.Request, command *pb.RunCommand, reason string) {
	s.mu.Lock()
	if s.replayCancel != nil {
		s.replayCancel()
		s.replayCancel = nil
	}
	s.replaying = false
	s.manual = command.Mode == "observe"
	s.analysis = nil
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 4500*time.Millisecond)
	defer cancel()
	run, e := s.Store.CreateRun(ctx, s.Network.ID, command.ScenarioType, command.Mode, int64(command.Seed))
	if e != nil {
		problem(w, 503, "Could not prepare run; simulation unchanged")
		return
	}
	id, _ := run.ID.Value()
	command.RunId = id.(string)
	frame, e := s.sim.client.Reset(ctx, command)
	if e != nil {
		s.mu.Lock()
		s.state = nil
		s.sim.fault = "Simulator start/reset failed"
		s.mu.Unlock()
		problem(w, 503, "Simulator start/reset failed; no successful start recorded")
		return
	}
	if frame.RunId != command.RunId || frame.Seed != command.Seed || frame.ScenarioType != command.ScenarioType {
		problem(w, 502, "Simulator returned a mismatched run")
		return
	}
	if e = contracts.ValidateState(frame); e != nil {
		problem(w, 502, "Invalid simulator state; no running status committed")
		return
	}
	if _, e = s.Store.Activate(ctx, run.ID, reason); e != nil {
		stopCtx, stop := context.WithTimeout(context.Background(), time.Second)
		defer stop()
		s.sim.client.Stop(stopCtx, &pb.RunRequest{RunId: command.RunId})
		s.mu.Lock()
		s.state = nil
		s.sim.fault = "Start was not committed"
		s.mu.Unlock()
		problem(w, 503, "Run activation failed; simulation stopped")
		return
	}
	s.mu.Lock()
	s.sim.command = proto.Clone(command).(*pb.RunCommand)
	s.state = nil
	s.mu.Unlock()
	if e = s.acceptFrame(frame); e != nil {
		problem(w, 502, "Invalid simulator payload")
		return
	}
	send(w, 200, struct {
		RunID    string `json:"run_id"`
		Scenario string `json:"scenario_type"`
		Seed     uint32 `json:"seed"`
		Status   string `json:"status"`
	}{command.RunId, command.ScenarioType, command.Seed, "running"})
}
