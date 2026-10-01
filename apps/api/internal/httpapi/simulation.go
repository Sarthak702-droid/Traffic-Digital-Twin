package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"sync"
	"time"
	"traffic.local/twin/apps/api/internal/contracts"
	"traffic.local/twin/apps/api/internal/store"
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
	conn, e := grpc.NewClient(address, s.computeOptions()...)
	if e != nil {
		return e
	}
	s.sim = &simulationLink{client: pb.NewSimulationClient(conn), conn: conn, subscribers: map[chan *pb.TrafficState]struct{}{}, fault: "No simulator state received"}
	if s.Store != nil {
		readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		runs, e := s.Store.Q.ListRuns(readCtx, 50)
		cancel()
		if e != nil {
			conn.Close()
			return e
		}
		if e == nil {
			for _, r := range runs {
				if r.Status == "running" {
					var binding store.RunInputBinding
					if r.DemandSource == "video_profile" {
						bindingCtx, stop := context.WithTimeout(ctx, 2*time.Second)
						var bindingErr error
						binding, bindingErr = s.Store.GetRunInput(bindingCtx, r.ID)
						stop()
						if bindingErr != nil {
							conn.Close()
							return bindingErr
						}
						s.activeInputSessionID = binding.InputSessionID
					}
					s.manual = r.Mode == "manual"
					id, _ := r.ID.Value()
					s.sim.command = &pb.RunCommand{SchemaVersion: "1.0", RunId: id.(string), ScenarioType: r.ScenarioType, Seed: uint32(r.Seed), Mode: r.Mode, DemandSource: r.DemandSource}
					if r.DemandSource == "video_profile" {
						applyInputBinding(s.sim.command, binding)
					}
					break
				}
			}
		}
	}
	if s.Store != nil {
		rows, e := s.Store.Pool.Query(ctx, "SELECT target FROM control_locks")
		if e != nil {
			return e
		}
		s.locks = map[string]bool{}
		for rows.Next() {
			var target string
			if e = rows.Scan(&target); e != nil {
				rows.Close()
				return e
			}
			s.locks[target] = true
		}
		rows.Close()
		if rows.Err() != nil {
			return rows.Err()
		}
	}
	if e := s.reconcileRecoveredSimulation(ctx); e != nil {
		conn.Close()
		return e
	}
	go s.ReconcileDecisions(ctx)
	go s.reconcileUnobservedRun(ctx)
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
					// Only the current durable leaseholder may make a private frame
					// authoritative or fan it out. Standby gateways keep their gRPC
					// connection but discard frames until they acquire the lease.
					if accept && s.requireLeaseSilent() {
						frame = s.withBoundInputSession(frame)
						if err := contracts.ValidateState(frame); err != nil {
							e = err
							break
						}
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
			firstFailure := !s.replaying && s.sim.fault == "" && s.sim.command != nil
			failedRun := ""
			if firstFailure {
				failedRun = s.sim.command.RunId
			}
			if !s.replaying {
				s.sim.fault = "Simulation stream disconnected"
				s.analysis = nil
			}
			s.mu.Unlock()
			if firstFailure {
				s.recordRunFailure(ctx, failedRun, "simulation_unavailable")
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}()
	return nil
}

// reconcileRecoveredSimulation distinguishes a live simulator surviving a Go
// gateway failover from a full-stack restart. PostgreSQL may still say that a
// run is active, but the simulator is intentionally in-memory and starts empty.
// Keeping that stale command would leave the UI permanently degraded and make
// yesterday's run look active today.
func (s *Server) reconcileRecoveredSimulation(ctx context.Context) error {
	if s.Store == nil || s.sim == nil || !s.requireLeaseSilent() {
		return nil
	}
	s.mu.RLock()
	command := s.sim.command
	if command != nil {
		command = proto.Clone(command).(*pb.RunCommand)
	}
	s.mu.RUnlock()
	if command == nil {
		return nil
	}

	checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	frame, e := s.sim.client.GetState(checkCtx, &pb.RunRequest{RunId: command.RunId})
	cancel()
	if e == nil && frame.RunId == command.RunId {
		return s.acceptFrame(frame)
	}
	if e != nil && status.Code(e) != codes.FailedPrecondition && status.Code(e) != codes.NotFound {
		// A transient compute/network error is not evidence that a durable run
		// ended. The normal stream reconnect loop will keep reporting it honestly.
		return nil
	}

	var runID pgtype.UUID
	if parseErr := runID.Scan(command.RunId); parseErr != nil {
		return fmt.Errorf("invalid recovered run id %q: %w", command.RunId, parseErr)
	}
	reconcileCtx, reconcileCancel := context.WithTimeout(ctx, 2*time.Second)
	e = s.Store.EndInterruptedRun(reconcileCtx, runID, "Full-stack restart found no matching in-memory simulator state; start a fresh deterministic scenario")
	reconcileCancel()
	if e != nil {
		return e
	}
	s.mu.Lock()
	if s.sim.command != nil && s.sim.command.RunId == command.RunId {
		s.sim.command = nil
		s.state = nil
		s.analysis = nil
		s.activeInputSessionID = ""
		s.manual = false
		s.sim.fault = "No simulator state received"
	}
	s.mu.Unlock()
	slog.Info("Reconciled interrupted simulation run", "run_id", command.RunId)
	return nil
}
func (s *Server) acceptFrame(frame *pb.TrafficState) error {
	if e := contracts.ValidateState(frame); e != nil {
		return e
	}
	// Persist completed aggregate observations before publishing this frame.
	// Database work must not hold the subscriber/state mutex.
	s.mu.RLock()
	eligible := s.sim != nil && s.sim.command != nil && frame.RunId == s.sim.command.RunId &&
		(s.state == nil || s.state.RunId != frame.RunId || s.state.SimulationTimeS <= frame.SimulationTimeS)
	epoch := s.activeInputSessionID
	s.mu.RUnlock()
	if !eligible {
		return nil
	}
	if frame.InputSessionId != "" && frame.InputSessionId != epoch {
		return fmt.Errorf("simulator state carries a different input epoch")
	}
	if s.Store != nil && len(frame.ObservationHistory) > 0 {
		var runID pgtype.UUID
		if e := runID.Scan(frame.RunId); e != nil {
			return fmt.Errorf("invalid report run id: %w", e)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		for _, observation := range frame.ObservationHistory {
			if e := s.Store.SaveObservationEvidence(ctx, runID, observation); e != nil {
				return fmt.Errorf("persist finalized observation: %w", e)
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sim == nil || s.sim.command == nil || frame.RunId != s.sim.command.RunId {
		return nil
	}
	if s.state != nil && s.state.RunId == frame.RunId && s.state.SimulationTimeS > frame.SimulationTimeS {
		return nil
	}
	if frame.InputSessionId != "" && frame.InputSessionId != s.activeInputSessionID {
		return fmt.Errorf("simulator state carries a different input epoch")
	}
	s.state = proto.Clone(frame).(*pb.TrafficState)
	s.state.InputSessionId = s.activeInputSessionID
	s.sim.received = time.Now()
	s.sim.fault = ""
	for channel := range s.sim.subscribers {
		copy := proto.Clone(s.state).(*pb.TrafficState)
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

func (s *Server) withBoundInputSession(frame *pb.TrafficState) *pb.TrafficState {
	s.mu.RLock()
	epoch := s.activeInputSessionID
	s.mu.RUnlock()
	copy := proto.Clone(frame).(*pb.TrafficState)
	if copy.InputSessionId == "" {
		copy.InputSessionId = epoch
	}
	return copy
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
	if s.state != nil && s.state.EngineKind != "" {
		return "normal", s.state.EngineKind + " aggregate flow stream connected at 1 Hz"
	}
	return "normal", "Aggregate flow stream connected at 1 Hz"
}
func (s *Server) startScenario(w http.ResponseWriter, r *http.Request) {
	if s.sim == nil {
		problem(w, 503, "Simulation service is not configured")
		return
	}
	if !s.db(w) || !s.requireLease(w) {
		return
	}
	var body struct {
		Version        string            `json:"schema_version"`
		Seed           uint32            `json:"seed"`
		Mode           string            `json:"mode"`
		DemandSource   string            `json:"demand_source"`
		SourceSessions map[string]string `json:"source_sessions,omitempty"`
		Incident       *struct {
			Kind          string  `json:"kind"`
			CapacityRatio float64 `json:"capacity_ratio"`
		} `json:"incident,omitempty"`
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
	if !valid || body.Version != "1.0" || body.Seed == 0 || (body.Mode != "recommend" && body.Mode != "observe" && body.Mode != "manual") {
		problem(w, 400, "Valid scenario, schema_version, seed and mode (recommend/observe/manual) required")
		return
	}
	if body.DemandSource == "" {
		body.DemandSource = "seeded"
	}
	if body.DemandSource != "seeded" && body.DemandSource != "video_profile" {
		problem(w, 400, "demand_source must be seeded or video_profile")
		return
	}
	input := store.RunInputBinding{}
	if body.DemandSource == "video_profile" {
		var err error
		input, err = s.resolveInputBinding(body.SourceSessions)
		if err != nil {
			problem(w, 409, err.Error())
			return
		}
	} else if len(body.SourceSessions) > 0 {
		problem(w, 400, "Source sessions require video_profile demand")
		return
	}
	// Emergency priority is a virtual schedule, never an override of the
	// operator's manual protection. Reject before a run is prepared so Python
	// cannot receive a command which conflicts with the Go-owned lock state.
	if scenario == "ambulance_corridor" {
		s.mu.RLock()
		manual := s.manual
		locked := false
		for _, lk := range s.locks {
			if lk {
				locked = true
				break
			}
		}
		s.mu.RUnlock()
		if manual || locked || body.Mode == "manual" {
			reason := "Emergency corridor was not scheduled because a manual mode or timing lock remains active"
			ctx, cancel := context.WithTimeout(r.Context(), time.Second)
			err := s.Store.RecordSafetyRejection(ctx, "emergency.rejected", reason)
			cancel()
			if err != nil {
				problem(w, 503, "Emergency safety rejection could not be audited")
				return
			}
			problem(w, 409, reason)
			return
		}
	}
	if body.Incident != nil && scenario != "incident_c3" {
		problem(w, 400, "Incident controls are only available for incident_c3")
		return
	}
	command := &pb.RunCommand{SchemaVersion: "1.0", ScenarioType: scenario, Seed: body.Seed, Mode: body.Mode, DemandSource: body.DemandSource}
	reason := "Started an aggregate-flow scenario with " + body.DemandSource + " demand"
	if body.Incident != nil {
		if body.Incident.Kind != "capacity_reduction" || body.Incident.CapacityRatio < 0.1 || body.Incident.CapacityRatio > 0.9 {
			problem(w, 400, "incident.kind must be capacity_reduction and capacity_ratio must be between 0.10 and 0.90")
			return
		}
		command.IncidentKind = body.Incident.Kind
		command.IncidentCapacityRatio = body.Incident.CapacityRatio
		reason = fmt.Sprintf("Started C3 capacity_reduction scenario at %.0f%% virtual capacity", body.Incident.CapacityRatio*100)
	}
	s.sim.commands.Lock()
	defer s.sim.commands.Unlock()
	s.launch(w, r, command, reason, input)
}
func (s *Server) resetScenario(w http.ResponseWriter, r *http.Request) {
	if s.sim == nil {
		problem(w, 503, "Simulation service is not configured")
		return
	}
	if !s.db(w) || !s.requireLease(w) {
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
	input := store.RunInputBinding{}
	if command.DemandSource == "video_profile" {
		var id pgtype.UUID
		if err := id.Scan(command.RunId); err != nil {
			problem(w, 409, "Active run identity is invalid")
			return
		}
		bound, err := s.Store.GetRunInput(r.Context(), id)
		if err != nil {
			problem(w, 409, "Active source binding is unavailable")
			return
		}
		input, err = s.resolveInputBinding(bound.SourceSessions)
		if err != nil {
			problem(w, 409, err.Error())
			return
		}
		for camera, identity := range bound.SourceIdentities {
			if input.SourceIdentities[camera] != identity {
				problem(w, 409, "Source identity changed; start a new run with explicit source selection")
				return
			}
		}
	}
	s.launch(w, r, command, "Reset to identical seed and initial aggregate-flow conditions", input)
}
func (s *Server) launch(w http.ResponseWriter, r *http.Request, command *pb.RunCommand, reason string, input store.RunInputBinding) {
	ctx, cancel := context.WithTimeout(r.Context(), 4500*time.Millisecond)
	defer cancel()
	dbMode := command.Mode
	run, e := s.Store.CreateRunWithInput(ctx, s.Network.ID, command.ScenarioType, dbMode, int64(command.Seed), command.DemandSource, input)
	if e != nil {
		problem(w, 503, "Could not prepare run; simulation unchanged")
		return
	}

	for camera, session := range input.SourceSessions {
		entry, err := selectProcessedEntry(s.processedEntries(camera), session)
		if err != nil || entry.Manifest.sourceBinding() != input.SourceIdentities[camera] {
			problem(w, 409, "Input identity changed before activation")
			return
		}
		if entry.Manifest.ResourceMeasurements != nil {
			if err = s.Store.SavePerceptionResource(ctx, run.ID, camera, session, *entry.Manifest.ResourceMeasurements); err != nil {
				problem(w, 503, "Perception evidence persistence failed; no run activated")
				return
			}
		}
	}
	id, _ := run.ID.Value()
	command.RunId = id.(string)
	applyInputBinding(command, input)
	frame, e := s.sim.client.Reset(ctx, command)
	if e != nil {
		slog.Error("Simulator reset failed", "error", e)
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
	if s.replayCancel != nil {
		s.replayCancel()
		s.replayCancel = nil
	}
	s.replaying = false
	s.activeInputSessionID = input.InputSessionID
	s.manual = command.Mode == "manual"
	s.analysis = nil
	s.analysisFault = ""
	s.sim.command = proto.Clone(command).(*pb.RunCommand)
	s.state = nil
	s.mu.Unlock()
	if e = s.acceptFrame(frame); e != nil {
		problem(w, 502, "Invalid simulator payload")
		return
	}
	send(w, 200, struct {
		RunID          string `json:"run_id"`
		InputSessionID string `json:"input_session_id,omitempty"`
		Scenario       string `json:"scenario_type"`
		Seed           uint32 `json:"seed"`
		Status         string `json:"status"`
	}{command.RunId, input.InputSessionID, command.ScenarioType, command.Seed, "running"})
}

func applyInputBinding(command *pb.RunCommand, input store.RunInputBinding) {
	command.InputSessionId = input.InputSessionID
	command.SourceBindings = nil
	cameras := make([]string, 0, len(input.SourceSessions))
	for camera := range input.SourceSessions {
		cameras = append(cameras, camera)
	}
	sort.Strings(cameras)
	for _, camera := range cameras {
		identity := input.SourceIdentities[camera]
		command.SourceBindings = append(command.SourceBindings, &pb.BoundSource{
			CameraId: camera, SourceSessionId: input.SourceSessions[camera],
			ClipSha256: identity.ClipSHA256, GeometrySha256: identity.GeometrySHA256,
			ModelSha256: identity.ModelSHA256, ConfigHash: identity.ConfigHash,
			ObservationsSha256: identity.ObservationsSHA256,
			DetectorVersion:    identity.DetectorVersion, TrackerVersion: identity.TrackerVersion,
			ObservationSchemaVersion: identity.ObservationSchemaVersion,
		})
	}
}

// Startup/failover can precede simulator readiness or lease acquisition. Retry
// while no authoritative frame is available; a transient outage is never proof
// of an ended run. A confirmed empty restarted engine is audited as interrupted.
func (s *Server) reconcileUnobservedRun(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.RLock()
			eligible := s.sim != nil && s.sim.command != nil && !s.replaying && (s.state == nil || s.sim.fault != "")
			s.mu.RUnlock()
			if !eligible || !s.requireLeaseSilent() {
				continue
			}
			s.sim.commands.Lock()
			s.mu.RLock()
			eligible = s.sim.command != nil && !s.replaying && (s.state == nil || s.sim.fault != "")
			s.mu.RUnlock()
			if eligible {
				if err := s.reconcileRecoveredSimulation(ctx); err != nil {
					slog.Warn("Run recovery deferred", "error", err)
				}
			}
			s.sim.commands.Unlock()
		}
	}
}
