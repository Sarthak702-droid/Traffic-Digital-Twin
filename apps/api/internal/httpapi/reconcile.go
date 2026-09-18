package httpapi

import (
	"context"
	"encoding/json"
	"google.golang.org/protobuf/encoding/protojson"
	"time"
	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

// Reconcile receipts, never repeat actuation. Survives domain/gateway restart.
func (s *Server) ReconcileDecisions(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if s.Store == nil || s.sim == nil {
				continue
			}
			s.reconcileDecisions(ctx)
		}
	}
}
func (s *Server) reconcileDecisions(ctx context.Context) {
	call, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	rows, err := s.Store.Pool.Query(call, "SELECT actor,payload,created_at FROM decision_intents WHERE NOT settled ORDER BY created_at LIMIT 10")
	if err != nil {
		return
	}
	type pending struct {
		actor   string
		payload []byte
		created time.Time
	}
	var list []pending
	for rows.Next() {
		var p pending
		if rows.Scan(&p.actor, &p.payload, &p.created) == nil {
			list = append(list, p)
		}
	}
	rows.Close()
	for _, p := range list {
		var v store.DecisionWrite
		if json.Unmarshal(p.payload, &v) != nil {
			continue
		}
		rec := new(pb.Recommendation)
		if protojson.Unmarshal(v.Recommendation, rec) != nil {
			continue
		}
		var changes []*pb.TimingChange
		if json.Unmarshal(v.After, &changes) != nil {
			continue
		}
		s.sim.commands.Lock()
		outcome, e := s.sim.client.GetPlanOutcome(call, &pb.PlanCommand{RunId: rec.RunId, CommandId: v.CommandID, Changes: changes})
		if e == nil {
			switch outcome.Status {
			case "accepted":
				rec.Status = "approved"
				rec.SafetyStatus = "accepted_pending_safe_boundary"
				rec.Changes = changes
			case "interrupted":
				rec.Status = "failed"
				rec.SafetyStatus = "simulator_restarted_outcome_interrupted"
			case "unknown":
				if time.Since(p.created) <= 30*time.Second {
					s.sim.commands.Unlock()
					continue
				}
				stopped, stopErr := s.sim.client.Stop(call, &pb.RunRequest{RunId: rec.RunId})
				if stopErr != nil || !stopped.Valid {
					s.sim.commands.Unlock()
					continue
				}
				rec.Status = "failed"
				rec.SafetyStatus = "application_unknown_simulator_stopped"
			case "not_found":
				if time.Since(p.created) > 30*time.Second {
					rec.Status = "failed"
					rec.SafetyStatus = "not_dispatched_before_deadline"
				} else {
					s.sim.commands.Unlock()
					continue
				}
			default:
				s.sim.commands.Unlock()
				continue
			}
			v.Result = rec.SafetyStatus
			v.Recommendation = jsonProto(rec)
			save := store.WithCommand(store.WithActor(call, p.actor), v.CommandID)
			if s.Store.Write(save, "decision", v, nil) == nil {
				s.mu.Lock()
				if s.analysis != nil && s.analysis.Recommendation != nil && s.analysis.Recommendation.Id == rec.Id {
					s.analysis.Recommendation = rec
				}
				s.mu.Unlock()
			}
		}
		s.sim.commands.Unlock()
	}
}
