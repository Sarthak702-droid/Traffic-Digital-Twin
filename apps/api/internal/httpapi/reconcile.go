package httpapi

import (
	"context"
	"encoding/json"
	"google.golang.org/protobuf/encoding/protojson"
	"time"
	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func terminalReceipt(rec *pb.Recommendation, write *store.DecisionWrite, outcome *pb.PlanOutcome) bool {
	if outcome == nil {
		return false
	}
	switch outcome.Status {
	case "applied":
		rec.Status = "approved"
		rec.SafetyStatus = "virtual_plan_applied"
	case "rejected":
		rec.Status = "failed"
		rec.SafetyStatus = "virtual_plan_rejected"
	default:
		return false
	}
	write.Result = rec.SafetyStatus
	write.PlanOutcome = jsonProto(outcome)
	return true
}

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
			s.reconcileControls(ctx)
			s.reconcileDecisions(ctx)
		}
	}
}

func (s *Server) reconcileControls(ctx context.Context) {
	call, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	rows, err := s.Store.Pool.Query(call, "SELECT id,actor,response FROM command_outcomes WHERE status IN ('pending','unknown') AND response ? 'authority_intent' LIMIT 10")
	if err != nil {
		return
	}
	type item struct {
		id, actor string
		payload   []byte
	}
	items := []item{}
	for rows.Next() {
		var v item
		if rows.Scan(&v.id, &v.actor, &v.payload) == nil {
			items = append(items, v)
		}
	}
	rows.Close()
	for _, v := range items {
		var intent store.ControlIntent
		if json.Unmarshal(v.payload, &intent) != nil {
			continue
		}
		command := new(pb.AuthorityCommand)
		if protojson.Unmarshal(intent.AuthorityIntent, command) != nil || command.CommandId != v.id {
			continue
		}
		s.sim.commands.Lock()
		state, err := s.sim.client.UpdateAuthority(call, command)
		if err == nil {
			save := store.WithCommand(store.WithActor(call, v.actor), v.id)
			if s.Store.Write(save, intent.Operation, intent.Control, nil) == nil {
				s.mu.Lock()
				s.state = state
				s.analysis = nil
				s.manual = state.ControlMode == "manual"
				if s.sim.command != nil {
					s.sim.command.Mode = state.ControlMode
				}
				s.locks = map[string]bool{}
				for _, target := range state.LockedTargets {
					s.locks[target] = true
				}
				s.mu.Unlock()
			}
		}
		s.sim.commands.Unlock()
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
		// Older intents retain their original legacy payload. New intents carry
		// the exact activation/compare-and-set fields used at dispatch.
		command := &pb.PlanCommand{RunId: rec.RunId, CommandId: v.CommandID, Changes: changes}
		if len(v.PlanCommand) > 0 {
			if protojson.Unmarshal(v.PlanCommand, command) != nil || command.RunId != rec.RunId || command.CommandId != v.CommandID {
				continue
			}
		}
		s.sim.commands.Lock()
		outcome, e := s.sim.client.GetPlanOutcome(call, command)
		if e == nil {
			switch outcome.Status {
			case "accepted":
				s.sim.commands.Unlock()
				continue
			case "applied", "rejected":
				terminalReceipt(rec, &v, outcome)
				rec.Changes = changes
			case "unknown", "interrupted":
				// A stopped process does not prove whether application occurred.
				// Retain the durable unresolved intent and approval block.
				s.sim.commands.Unlock()
				continue
			case "not_found":
				if time.Since(p.created) <= 30*time.Second {
					s.sim.commands.Unlock()
					continue
				}
				cancelled, cancelErr := s.sim.client.CancelPlan(call, command)
				if cancelErr != nil || !terminalReceipt(rec, &v, cancelled) {
					s.sim.commands.Unlock()
					continue
				}
				outcome = cancelled
				rec.Changes = changes
			default:
				s.sim.commands.Unlock()
				continue
			}
			v.Result = rec.SafetyStatus
			if len(v.PlanOutcome) == 0 {
				v.PlanOutcome = jsonProto(outcome)
			}
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
