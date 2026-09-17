package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/contracts"
	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func jsonProto(v proto.Message) []byte {
	b, _ := (protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true}).Marshal(v)
	return b
}
func (s *Server) ConnectIntelligence(ctx context.Context, address string) error {
	conn, e := grpc.NewClient(address, s.computeOptions()...)
	if e != nil {
		return e
	}
	s.intelligence = pb.NewIntelligenceClient(conn)
	go func() {
		defer conn.Close()
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.mu.RLock()
				var state *pb.TrafficState
				if s.state != nil && s.sim != nil && s.sim.fault == "" && time.Since(s.sim.received) < 2500*time.Millisecond && !s.replaying {
					state = proto.Clone(s.state).(*pb.TrafficState)
				}
				s.mu.RUnlock()
				if state == nil {
					continue
				}
				call, cancel := context.WithTimeout(ctx, 2*time.Second)
				analysis, err := s.intelligence.Analyze(call, state)
				cancel()
				s.mu.Lock()
				if err != nil {
					s.analysisFault = err.Error()
					s.mu.Unlock()
					continue
				}
				s.analysisFault = ""
				if s.state == nil || s.state.RunId != analysis.RunId {
					s.mu.Unlock()
					continue
				}
				if s.manual || s.sim.command == nil || s.sim.command.Mode != "recommend" {
					analysis.Recommendation = nil
					analysis.Alternatives = nil
				}
				// Keep an actionable recommendation stable long enough for operator review.
				if !s.manual && s.sim.command != nil && s.sim.command.Mode == "recommend" && s.analysis != nil && s.analysis.RunId == analysis.RunId && s.analysis.Recommendation != nil && s.analysis.Recommendation.Status == "pending" && state.SimulationTimeS-s.recommendationTime < 30 {
					analysis.Recommendation = proto.Clone(s.analysis.Recommendation).(*pb.Recommendation)
					if s.analysis.Comparison != nil {
						analysis.Comparison = proto.Clone(s.analysis.Comparison).(*pb.ComparisonResult)
					}
					analysis.Alternatives = nil
				} else {
					s.recommendationTime = state.SimulationTimeS
				}
				persisted := proto.Clone(analysis).(*pb.Analysis)
				s.mu.Unlock()
				if s.Store != nil && persisted.Recommendation != nil {
					saveCtx, saveCancel := context.WithTimeout(ctx, time.Second)
					err := s.Store.Write(saveCtx, "recommendation", json.RawMessage(jsonProto(persisted.Recommendation)), nil)
					saveCancel()
					if err != nil {
						s.mu.Lock()
						s.analysisFault = "Recommendation persistence failed"
						s.mu.Unlock()
						continue
					}
				}
				s.mu.Lock()
				if s.state != nil && s.state.RunId == persisted.RunId && !s.replaying {
					// Persistence can overlap an operator command; never resurrect its pending state.
					if s.manual || s.sim.command == nil || s.sim.command.Mode != "recommend" {
						persisted.Recommendation = nil
						persisted.Comparison = nil
						persisted.Alternatives = nil
					} else if s.analysis != nil && s.analysis.Recommendation != nil && persisted.Recommendation != nil && s.analysis.Recommendation.Id == persisted.Recommendation.Id && s.analysis.Recommendation.Status != "pending" {
						persisted.Recommendation = proto.Clone(s.analysis.Recommendation).(*pb.Recommendation)
						persisted.Comparison = nil
						persisted.Alternatives = nil
					}
					s.analysis = persisted
				}
				s.mu.Unlock()
			}
		}
	}()
	return nil
}

func hasConflict(conflicts [][2]string, a, b string) bool {
	for _, c := range conflicts {
		if (c[0] == a && c[1] == b) || (c[0] == b && c[1] == a) {
			return true
		}
	}
	return false
}

func validateChanges(n config.Network, state *pb.TrafficState, changes []*pb.TimingChange, activeLocks ...map[string]bool) error {
	if e := n.Validate(); e != nil {
		return e
	}
	if len(changes) != len(n.Phases) {
		return fmt.Errorf("complete configured phase plan required")
	}
	plan := map[string]float64{}
	phases := map[string]config.Phase{}
	for _, p := range n.Phases {
		phases[p.ID] = p
	}
	for _, c := range changes {
		p, ok := phases[c.PhaseId]
		if !ok || p.Node != c.NodeId {
			return fmt.Errorf("unknown phase/node")
		}
		if _, ok := plan[c.PhaseId]; ok {
			return fmt.Errorf("duplicate phase")
		}
		if math.IsNaN(c.GreenS) || math.IsInf(c.GreenS, 0) || c.GreenS != math.Trunc(c.GreenS) || c.GreenS < p.Min || c.GreenS > p.Max {
			return fmt.Errorf("green outside configured bounds")
		}
		plan[c.PhaseId] = c.GreenS
	}
	current := map[string]float64{}
	for _, c := range state.ActivePlan {
		current[c.PhaseId] = c.GreenS
	}

	locks := map[string]bool{}
	if len(activeLocks) > 0 && activeLocks[0] != nil {
		locks = activeLocks[0]
	}

	for _, p := range n.Phases {
		// Rule 1: Conflicting greens check within phase movements
		for _, m1 := range p.Movements {
			for _, m2 := range p.Movements {
				if m1 != m2 && hasConflict(n.Conflicts, m1, m2) {
					return fmt.Errorf("conflicting greens: movements %s and %s conflict", m1, m2)
				}
			}
		}

		// Rule 2: Amber clearance check
		if p.Amber <= 0 {
			return fmt.Errorf("amber clearance breach: phase %s amber %.0fs <= 0", p.ID, p.Amber)
		}

		// Rule 3: All-red clearance check
		if p.AllRed <= 0 {
			return fmt.Errorf("all-red clearance breach: phase %s all-red %.0fs <= 0", p.ID, p.AllRed)
		}

		// Rule 4: Modeled pedestrian clearance check
		if p.Pedestrian > 0 && plan[p.ID] < p.Pedestrian {
			return fmt.Errorf("pedestrian clearance breach: phase %s green %.0fs is below clearance %.0fs", p.ID, plan[p.ID], p.Pedestrian)
		}

		// Rule 5: Modeled cross-road wait violation (max_red_s)
		cycle := 0.
		for _, other := range n.Phases {
			if other.Node == p.Node {
				cycle += plan[other.ID] + other.Amber + other.AllRed
			}
		}
		if cycle-plan[p.ID] > p.MaxRed {
			return fmt.Errorf("maximum cross-traffic wait exceeded")
		}

		// Rule 6: Manual locks enforcement
		if locks[p.ID] && plan[p.ID] != current[p.ID] {
			return fmt.Errorf("manual lock violation: phase %s is locked by operator", p.ID)
		}
		for _, mid := range p.Movements {
			if locks[mid] && plan[p.ID] != current[p.ID] {
				return fmt.Errorf("manual lock violation: movement %s is locked by operator", mid)
			}
		}

		// Rule 7: Blocked / full receiving links
		for _, m := range state.Movements {
			for _, mid := range p.Movements {
				if m.MovementId == mid {
					if m.DownstreamCapacityVeh <= 0 && plan[p.ID] > current[p.ID] {
						return fmt.Errorf("cannot extend release into blocked/full downstream link")
					}
					if m.OccupancyRatio >= 1.0 && plan[p.ID] > current[p.ID] {
						return fmt.Errorf("cannot extend release into blocked/full downstream link")
					}
				}
			}
		}

		// Rule 8: Incident closures enforcement
		if state.Incident != nil && (state.Incident.Status == "active" || state.Incident.Status == "closed") {
			if state.Incident.NodeId == p.Node && state.Incident.CapacityRatio <= 0 && plan[p.ID] > 0 {
				return fmt.Errorf("incident closure: node %s has an active closure", p.Node)
			}
			if state.Incident.NodeId == p.Node && state.Incident.CapacityRatio < 0.4 && plan[p.ID] > current[p.ID] {
				return fmt.Errorf("incident closure: cannot extend green into incident-restricted junction %s", p.Node)
			}
		}
	}

	// Rule 9: Emergency protections
	if state.Emergency != nil && (state.Emergency.Status == "priority" || state.Emergency.Status == "pre_clearance" || state.Emergency.Status == "active") {
		return fmt.Errorf("emergency protection active; retry after recovery")
	}
	return nil
}
func (s *Server) getAnalysis(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.sim == nil || time.Since(s.sim.received) > 2500*time.Millisecond || s.sim.fault != "" || s.analysis == nil || s.analysisFault != "" || s.state == nil || s.analysis.RunId != s.state.RunId || s.state.SimulationTimeS-s.analysis.SimulationTimeS > 10 {
		problem(w, 503, "Fresh intelligence unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(jsonProto(s.analysis))
}
func (s *Server) activeRecommendation(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.sim == nil || time.Since(s.sim.received) > 2500*time.Millisecond || s.sim.fault != "" || s.manual || s.analysis == nil || s.analysis.Recommendation == nil || s.analysisFault != "" || s.state == nil || s.analysis.RunId != s.state.RunId || s.state.SimulationTimeS-s.recommendationTime > 30 {
		problem(w, 503, "No active recommendation")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(jsonProto(s.analysis.Recommendation))
}
func (s *Server) decision(w http.ResponseWriter, r *http.Request) {
	if !s.db(w) {
		return
	}
	if s.sim == nil || s.intelligence == nil {
		problem(w, 503, "Services unavailable")
		return
	}
	var body struct {
		Reason  string             `json:"reason"`
		Changes []*pb.TimingChange `json:"changes"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF {
		problem(w, 400, "Invalid decision body")
		return
	}
	action := chi.URLParam(r, "action")
	if action != "simulate" && action != "approve" && action != "modify" && action != "reject" {
		problem(w, 404, "Unknown decision")
		return
	}
	if (action == "modify" || action == "reject") && !validReason(body.Reason) {
		problem(w, 400, "A reason is required")
		return
	}
	s.sim.commands.Lock()
	defer s.sim.commands.Unlock()
	s.mu.RLock()
	var rec *pb.Recommendation
	var state *pb.TrafficState
	if s.analysis != nil && s.analysis.Recommendation != nil {
		rec = proto.Clone(s.analysis.Recommendation).(*pb.Recommendation)
	}
	if s.state != nil {
		state = proto.Clone(s.state).(*pb.TrafficState)
	}
	blocked := s.sim.command == nil || s.sim.command.Mode != "recommend" || s.manual || s.replaying || s.analysisFault != "" || time.Since(s.sim.received) > 2500*time.Millisecond || s.sim.fault != ""
	recTime := s.recommendationTime
	s.mu.RUnlock()
	if blocked || rec == nil || state == nil || rec.Id != chi.URLParam(r, "id") || rec.RunId != state.RunId || rec.Status != "pending" || state.SimulationTimeS-recTime > 30 {
		problem(w, 409, "Recommendation is stale, unavailable, locked or already decided")
		return
	}
	var unresolved bool
	var pendingCmdID string
	var pendingPayloadBytes []byte
	err := s.Store.Pool.QueryRow(r.Context(), "SELECT command_id, payload FROM decision_intents WHERE NOT settled AND payload->'recommendation'->>'run_id'=$1 LIMIT 1", state.RunId).Scan(&pendingCmdID, &pendingPayloadBytes)
	if err == nil {
		unresolved = true
	}
	if unresolved {
		currentCmdID := commandID(r.Context(), rec.Id)
		if currentCmdID != "" && currentCmdID != pendingCmdID {
			problem(w, 409, "Payload conflict: a prior decision is pending reconciliation; inspect or resolve the pending decision first")
			return
		}
		problem(w, 409, "A prior decision is being reconciled; inspect its command outcome before another decision")
		return
	}
	changes := rec.Changes
	if action == "modify" {
		changes = body.Changes
	} else if len(body.Changes) > 0 {
		problem(w, 400, "Changes are only accepted for modify")
		return
	}
	if action != "reject" {
		if e := validateChanges(s.Network, state, changes, s.refreshLocks(r.Context())); e != nil {
			if err := s.auditDecision(r.Context(), rec, state, action, body.Reason, "rejected: "+e.Error(), changes); err != nil {
				problem(w, 503, "Unsafe plan refused; audit write not confirmed")
				return
			}
			problem(w, 409, e.Error())
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	if action == "simulate" {
		result, e := s.intelligence.Compare(ctx, &pb.CompareCommand{State: state, Changes: changes, RecommendationId: rec.Id})
		if e != nil {
			problem(w, 503, "Comparison unavailable")
			return
		}
		if e = s.auditDecision(ctx, rec, state, action, body.Reason, "simulated", changes); e != nil {
			problem(w, 503, "Comparison audit failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(jsonProto(result))
		return
	}
	if action == "modify" {
		if _, e := s.intelligence.Compare(ctx, &pb.CompareCommand{State: state, Changes: changes, RecommendationId: rec.Id}); e != nil {
			problem(w, 503, "Modified plan comparison failed; nothing applied")
			return
		}
	}
	if action == "reject" {
		rec.Status = "rejected"
		if e := s.auditDecision(ctx, rec, state, action, body.Reason, "rejected_by_operator", changes); e != nil {
			problem(w, 503, "Decision could not be persisted")
			return
		}
	} else {
		latest, err := s.sim.client.GetState(ctx, &pb.RunRequest{RunId: state.RunId})
		if err != nil {
			problem(w, 503, "Fresh simulator validation unavailable; nothing applied")
			return
		}
		if err = contracts.ValidateState(latest); err != nil {
			problem(w, 503, "Invalid simulator state; nothing applied")
			return
		}
		if err = validateChanges(s.Network, latest, changes, s.refreshLocks(ctx)); err != nil {
			if auditErr := s.auditDecision(ctx, rec, latest, action, body.Reason, "rejected: "+err.Error(), changes); auditErr != nil {
				problem(w, 503, "Plan refused; audit unavailable")
				return
			}
			problem(w, 409, err.Error())
			return
		}
		state = latest
		// Durable intent precedes virtual actuation; ambiguous RPC failure is never reported as success.
		if e := s.auditDecision(ctx, rec, state, action, body.Reason, "validated_pending_application", changes); e != nil {
			problem(w, 503, "Decision could not be persisted; nothing applied")
			return
		}
		result, e := s.sim.client.ApplyPlan(ctx, &pb.PlanCommand{RunId: state.RunId, Changes: changes, CommandId: commandID(r.Context(), rec.Id)})
		if e != nil || !result.Valid {
			auditCtx, auditCancel := context.WithTimeout(context.Background(), time.Second)
			auditCtx = store.WithCommand(store.WithActor(auditCtx, store.Actor(r.Context())), store.CommandID(r.Context()))
			auditErr := s.auditDecision(auditCtx, rec, state, action, body.Reason, "application_failed_or_unconfirmed", changes)
			auditCancel()
			if auditErr != nil {
				problem(w, 503, "Application and audit outcome unknown; reconcile command before retrying")
				return
			}
			problem(w, 503, "Application not confirmed; inspect audit and current plan")
			return
		}
		rec.Status = "approved"
		rec.Changes = changes
		rec.SafetyStatus = "accepted_pending_safe_boundary"
		if e := s.auditDecision(ctx, rec, state, action, body.Reason, "accepted_pending_safe_boundary", changes); e != nil {
			problem(w, 503, "Virtual plan accepted but final audit failed; durable intent exists")
			return
		}
	}
	s.mu.Lock()
	if s.analysis != nil && s.analysis.Recommendation != nil && s.analysis.Recommendation.Id == rec.Id {
		s.analysis.Recommendation = rec
	}
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Write(jsonProto(rec))
}
func (s *Server) auditDecision(ctx context.Context, rec *pb.Recommendation, state *pb.TrafficState, action, reason, result string, changes []*pb.TimingChange) error {
	before, _ := json.Marshal(state.ActivePlan)
	after, _ := json.Marshal(changes)
	return s.Store.Write(ctx, "decision", store.DecisionWrite{CommandID: store.CommandID(ctx), Recommendation: jsonProto(rec), Before: before, After: after, Action: action, Reason: reason, Result: result}, nil)
}

func (s *Server) getLocks() map[string]bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	locksCopy := make(map[string]bool, len(s.locks))
	for k, v := range s.locks {
		if v {
			locksCopy[k] = true
		}
	}
	return locksCopy
}

func (s *Server) refreshLocks(ctx context.Context) map[string]bool {
	if s.Store != nil {
		c, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		rows, err := s.Store.Pool.Query(c, "SELECT target FROM control_locks")
		if err == nil {
			s.mu.Lock()
			s.locks = map[string]bool{}
			for rows.Next() {
				var target string
				if rows.Scan(&target) == nil {
					s.locks[target] = true
				}
			}
			rows.Close()
			s.mu.Unlock()
		}
	}
	return s.getLocks()
}

func (s *Server) listLocks(w http.ResponseWriter, r *http.Request) {
	locks := s.refreshLocks(r.Context())
	list := []string{}
	for k, v := range locks {
		if v {
			list = append(list, k)
		}
	}
	send(w, 200, map[string]any{"locks": list})
}

func (s *Server) setLock(w http.ResponseWriter, r *http.Request)    { s.changeLock(w, r, true) }
func (s *Server) deleteLock(w http.ResponseWriter, r *http.Request) { s.changeLock(w, r, false) }
func (s *Server) changeLock(w http.ResponseWriter, r *http.Request, locked bool) {
	id := chi.URLParam(r, "id")
	valid := false
	for _, p := range s.Network.Phases {
		if p.ID == id {
			valid = true
		}
	}
	for _, m := range s.Network.Movements {
		if m.ID == id {
			valid = true
		}
	}
	if !valid {
		problem(w, 400, "Unknown configured lock target")
		return
	}
	if !s.db(w) {
		return
	}
	if s.sim == nil {
		problem(w, 503, "Simulation unavailable")
		return
	}
	s.sim.commands.Lock()
	defer s.sim.commands.Unlock()
	s.mu.RLock()
	runID := ""
	if s.sim.command != nil {
		runID = s.sim.command.RunId
	}
	s.mu.RUnlock()
	if runID == "" {
		problem(w, 409, "Start a scenario first")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.Store.Write(ctx, "lock", store.ControlWrite{RunID: runID, Target: id, Locked: locked}, nil); err != nil {
		problem(w, 503, "Lock not confirmed; reconcile command before retrying")
		return
	}
	s.mu.Lock()
	if s.locks == nil {
		s.locks = map[string]bool{}
	}
	s.locks[id] = locked
	s.mu.Unlock()
	send(w, 200, map[string]any{"target": id, "locked": locked})
}

func (s *Server) getMode(w http.ResponseWriter, r *http.Request) {
	locksMap := s.refreshLocks(r.Context())
	s.mu.RLock()
	mode := "recommend"
	if s.manual {
		mode = "manual"
	} else if s.sim != nil && s.sim.command != nil && s.sim.command.Mode == "observe" {
		mode = "observe"
	}
	manual := s.manual
	s.mu.RUnlock()

	locks := []string{}
	for k, v := range locksMap {
		if v {
			locks = append(locks, k)
		}
	}
	send(w, 200, map[string]any{
		"mode":   mode,
		"manual": manual,
		"locks":  locks,
	})
}

func (s *Server) getUnresolvedDecisions(w http.ResponseWriter, r *http.Request) {
	if !s.db(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	rows, err := s.Store.Pool.Query(ctx, "SELECT command_id, recommendation_id, actor, payload, created_at FROM decision_intents WHERE NOT settled ORDER BY created_at DESC LIMIT 20")
	if err != nil {
		problem(w, 503, "Failed to query unresolved decisions")
		return
	}
	defer rows.Close()
	type item struct {
		CommandID        string          `json:"command_id"`
		RecommendationID string          `json:"recommendation_id"`
		Actor            string          `json:"actor"`
		CreatedAt        string          `json:"created_at"`
		Payload          json.RawMessage `json:"payload"`
	}
	list := []item{}
	for rows.Next() {
		var it item
		var t time.Time
		if rows.Scan(&it.CommandID, &it.RecommendationID, &it.Actor, &it.Payload, &t) == nil {
			it.CreatedAt = t.UTC().Format(time.RFC3339Nano)
			list = append(list, it)
		}
	}
	send(w, 200, map[string]any{"unresolved": list})
}

func (s *Server) resolveDecision(w http.ResponseWriter, r *http.Request) {
	if !s.db(w) {
		return
	}
	role := store.Role(r.Context())
	if role != "supervisor" && role != "operator" {
		problem(w, 403, "Only supervisor or operator can resolve decision intents")
		return
	}
	var req struct {
		CommandID        string `json:"command_id"`
		RecommendationID string `json:"recommendation_id"`
		Resolution       string `json:"resolution"`
		Reason           string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CommandID == "" {
		problem(w, 400, "Valid command_id and resolution required")
		return
	}
	if req.Reason == "" {
		req.Reason = "Supervisor manual reconciliation"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	err := s.Store.Write(ctx, "decision.resolve", req, nil)
	if err != nil {
		problem(w, 500, "Failed to resolve decision intent: "+err.Error())
		return
	}
	send(w, 200, map[string]any{
		"settled":           true,
		"command_id":        req.CommandID,
		"recommendation_id": req.RecommendationID,
		"resolution":        req.Resolution,
	})
}

func (s *Server) setMode(w http.ResponseWriter, r *http.Request) {
	mode := chi.URLParam(r, "mode")
	if mode != "manual" && mode != "observe" && mode != "recommend" && mode != "recommendation" {
		problem(w, 400, "Unknown mode: must be recommend, observe, or manual")
		return
	}
	if !s.db(w) {
		return
	}
	if s.sim == nil {
		problem(w, 503, "No simulation")
		return
	}
	s.sim.commands.Lock()
	defer s.sim.commands.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sim.command == nil {
		problem(w, 409, "Start a scenario first")
		return
	}
	canonicalMode := mode
	if mode == "recommendation" {
		canonicalMode = "recommend"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if e := s.Store.Write(ctx, "mode", store.ControlWrite{RunID: s.sim.command.RunId, Mode: canonicalMode}, nil); e != nil {
		problem(w, 503, "Mode change not confirmed; inspect command outcome")
		return
	}
	s.manual = canonicalMode == "manual"
	s.sim.command.Mode = canonicalMode
	if canonicalMode != "recommend" && s.analysis != nil {
		s.analysis.Recommendation = nil
		s.analysis.Alternatives = nil
		s.analysis.Comparison = nil
	}
	send(w, 200, map[string]string{"mode": canonicalMode})
}

func commandID(ctx context.Context, fallback string) string {
	if id := store.CommandID(ctx); id != "" {
		return id
	}
	return fallback
}
func validReason(reason string) bool {
	category := strings.TrimSpace(strings.SplitN(reason, ":", 2)[0])
	for _, allowed := range []string{"Field observation", "Accident/obstruction", "Pedestrian crowd", "Procession/festival", "VIP movement", "Emergency vehicle", "Camera/sensor issue", "Signal malfunction", "Other"} {
		if category == allowed {
			return len(reason) <= 2000
		}
	}
	return false
}
