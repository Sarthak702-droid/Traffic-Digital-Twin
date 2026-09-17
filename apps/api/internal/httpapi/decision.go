package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/go-chi/chi/v5"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func jsonProto(v proto.Message) []byte {
	b, _ := (protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true}).Marshal(v)
	return b
}
func (s *Server) ConnectIntelligence(ctx context.Context, address string) error {
	conn, e := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
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
				if s.analysis != nil && s.analysis.RunId == analysis.RunId && s.analysis.Recommendation != nil && s.analysis.Recommendation.Status == "pending" && state.SimulationTimeS-s.recommendationTime < 30 {
					analysis.Recommendation = proto.Clone(s.analysis.Recommendation).(*pb.Recommendation)
				} else {
					s.recommendationTime = state.SimulationTimeS
				}
				s.analysis = analysis
				persisted := proto.Clone(analysis).(*pb.Analysis)
				s.mu.Unlock()
				if s.Store != nil && persisted.Recommendation != nil {
					saveCtx, saveCancel := context.WithTimeout(ctx, time.Second)
					_, err := s.Store.Pool.Exec(saveCtx, "INSERT INTO recommendations(id,run_id,status,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", persisted.Recommendation.Id, persisted.RunId, persisted.Recommendation.Status, jsonProto(persisted.Recommendation))
					saveCancel()
					if err != nil {
						s.mu.Lock()
						if s.analysis != nil && s.analysis.RunId == persisted.RunId {
							s.analysisFault = "Recommendation persistence failed"
						}
						s.mu.Unlock()
					}
				}
			}
		}
	}()
	return nil
}

func validateChanges(n config.Network, state *pb.TrafficState, changes []*pb.TimingChange) error {
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
	for _, p := range n.Phases {
		cycle := 0.
		for _, other := range n.Phases {
			if other.Node == p.Node {
				cycle += plan[other.ID] + other.Amber + other.AllRed
			}
		}
		if cycle-plan[p.ID] > p.MaxRed {
			return fmt.Errorf("maximum cross-traffic wait exceeded")
		}
		for _, m := range state.Movements {
			for _, mid := range p.Movements {
				if m.MovementId == mid && m.DownstreamCapacityVeh <= 0 && plan[p.ID] > current[p.ID] {
					return fmt.Errorf("cannot extend release into blocked/full downstream link")
				}
			}
		}
	}
	if state.Emergency != nil && (state.Emergency.Status == "priority" || state.Emergency.Status == "pre_clearance") {
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
	if s.sim == nil || time.Since(s.sim.received) > 2500*time.Millisecond || s.sim.fault != "" || s.manual || s.analysis == nil || s.analysis.Recommendation == nil || s.analysisFault != "" {
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
	if (action == "modify" || action == "reject") && strings.TrimSpace(body.Reason) == "" {
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
	blocked := s.manual || s.replaying || s.analysisFault != "" || time.Since(s.sim.received) > 2500*time.Millisecond || s.sim.fault != ""
	recTime := s.recommendationTime
	s.mu.RUnlock()
	if blocked || rec == nil || state == nil || rec.Id != chi.URLParam(r, "id") || rec.RunId != state.RunId || rec.Status != "pending" || state.SimulationTimeS-recTime > 30 {
		problem(w, 409, "Recommendation is stale, unavailable, locked or already decided")
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
		if e := validateChanges(s.Network, state, changes); e != nil {
			s.auditDecision(r.Context(), rec, state, action, body.Reason, "rejected: "+e.Error(), changes)
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
		if e := s.auditDecision(ctx, rec, state, action, body.Reason, "rejected_by_operator", changes); e != nil {
			problem(w, 503, "Decision could not be persisted")
			return
		}
		rec.Status = "rejected"
		s.Store.Pool.Exec(ctx, "UPDATE recommendations SET status=$1,payload=$2 WHERE id=$3", rec.Status, jsonProto(rec), rec.Id)
	} else {
		// Durable intent precedes virtual actuation; ambiguous RPC failure is never reported as success.
		if e := s.auditDecision(ctx, rec, state, action, body.Reason, "validated_pending_application", changes); e != nil {
			problem(w, 503, "Decision could not be persisted; nothing applied")
			return
		}
		result, e := s.sim.client.ApplyPlan(ctx, &pb.PlanCommand{RunId: state.RunId, Changes: changes, CommandId: rec.Id})
		if e != nil || !result.Valid {
			s.auditDecision(context.Background(), rec, state, action, body.Reason, "application_failed_or_unconfirmed", changes)
			problem(w, 503, "Application not confirmed; inspect audit and current plan")
			return
		}
		rec.Status = "approved"
		rec.Changes = changes
		rec.SafetyStatus = "applied_at_safe_boundary"
		if e := s.auditDecision(ctx, rec, state, action, body.Reason, "accepted_at_safe_boundary", changes); e != nil {
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
	tx, e := s.Store.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, "INSERT INTO recommendations(id,run_id,status,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload", rec.Id, rec.RunId, rec.Status, jsonProto(rec))
	if e != nil {
		return e
	}
	before, _ := json.Marshal(state.ActivePlan)
	after, _ := json.Marshal(changes)
	_, e = tx.Exec(ctx, "INSERT INTO operator_actions(id,run_id,recommendation_id,actor,action,reason,payload) VALUES($1,$2,$3,'demo-operator',$4,$5,$6)", store.UUID(), rec.RunId, rec.Id, action, reason, after)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO audit_events(id,run_id,recommendation_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES($1,$2,$3,'demo-operator',$4,$5,$6,$7,$8)", store.UUID(), rec.RunId, rec.Id, "recommendation."+action, before, after, reason, result)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Server) setMode(w http.ResponseWriter, r *http.Request) {
	mode := chi.URLParam(r, "mode")
	if mode != "manual" && mode != "recommendation" {
		problem(w, 400, "Unknown mode")
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
	dbMode := "recommend"
	if mode == "manual" {
		dbMode = "observe"
	}
	tx, e := s.Store.Pool.Begin(r.Context())
	if e != nil {
		problem(w, 503, "Mode persistence unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), "UPDATE scenario_runs SET mode=$1 WHERE id=$2", dbMode, s.sim.command.RunId)
	if e == nil {
		_, e = tx.Exec(r.Context(), "INSERT INTO audit_events(id,run_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES($1,$2,'demo-operator','mode.changed','{}',$3,'Operator changed mode','no_actuation')", store.UUID(), s.sim.command.RunId, []byte(fmt.Sprintf(`{"mode":%q}`, mode)))
	}
	if e != nil || tx.Commit(r.Context()) != nil {
		problem(w, 503, "Mode audit failed")
		return
	}
	s.manual = mode == "manual"
	s.sim.command.Mode = dbMode
	if s.analysis != nil {
		s.analysis.Recommendation = nil
		s.analysis.Alternatives = nil
	}
	send(w, 200, map[string]string{"mode": mode})
}
