package httpapi

import (
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/proto"
	"io"
	"net/http"
	"time"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func (s *Server) setRunClock(w http.ResponseWriter, r *http.Request) {
	if !s.db(w) || !s.requireLease(w) {
		return
	}
	if s.sim == nil {
		problem(w, 503, "Simulation unavailable")
		return
	}
	if len(r.Header.Get("Idempotency-Key")) < 8 {
		problem(w, 400, "An idempotency key is required")
		return
	}
	var body struct {
		Paused *bool `json:"paused"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF || body.Paused == nil {
		problem(w, 400, "Explicit paused boolean required")
		return
	}
	s.sim.commands.Lock()
	defer s.sim.commands.Unlock()
	s.mu.RLock()
	var frame *pb.TrafficState
	if s.state != nil && !s.replaying && s.sim.command != nil && s.sim.command.RunId == chi.URLParam(r, "id") && s.sim.fault == "" && time.Since(s.sim.received) < 2500*time.Millisecond {
		frame = proto.Clone(s.state).(*pb.TrafficState)
	}
	s.mu.RUnlock()
	if frame == nil {
		problem(w, 409, "A current live virtual run is required")
		return
	}
	var id pgtype.UUID
	if id.Scan(frame.RunId) != nil {
		problem(w, 409, "Invalid active run identity")
		return
	}
	call, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.Store.SaveClockAudit(call, id, *body.Paused, "requested"); err != nil {
		problem(w, 503, "Clock intent persistence failed; no action dispatched")
		return
	}
	held, err := s.sim.client.SetClock(call, &pb.ClockCommand{RunId: frame.RunId, InputSessionId: frame.InputSessionId, Paused: *body.Paused})
	if err != nil {
		_ = s.Store.SaveClockAudit(call, id, *body.Paused, "unknown")
		problem(w, 503, "Clock command outcome uncertain; inspect current run state")
		return
	}
	if held.RunId != frame.RunId || held.InputSessionId != frame.InputSessionId || held.SimulationPaused != *body.Paused {
		problem(w, 503, "Clock result identity differs; inspect current state")
		return
	}
	if err = s.acceptFrame(held); err != nil {
		problem(w, 503, "Clock state unavailable; inspect command outcome")
		return
	}
	if err = s.Store.SaveClockAudit(call, id, *body.Paused, "confirmed", held); err != nil {
		problem(w, 503, "Clock outcome persistence failed; inspect current state")
		return
	}
	send(w, 200, map[string]any{"run_id": held.RunId, "paused": held.SimulationPaused, "simulation_time_s": held.SimulationTimeS, "snapshot_sequence": held.SnapshotSequence})
}
