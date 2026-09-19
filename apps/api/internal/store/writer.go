package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/encoding/protojson"
	"io"
	"strings"
	"traffic.local/twin/apps/api/internal/config"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

type contextKey string

func WithActor(ctx context.Context, actor string) context.Context {
	return context.WithValue(ctx, contextKey("actor"), actor)
}
func Actor(ctx context.Context) string {
	if s, ok := ctx.Value(contextKey("actor")).(string); ok && s != "" {
		return s
	}
	return "demo-operator"
}

func WithCommand(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextKey("command"), id)
}
func CommandID(ctx context.Context) string {
	id, _ := ctx.Value(contextKey("command")).(string)
	return id
}

func WithRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, contextKey("role"), role)
}
func Role(ctx context.Context) string {
	if s, ok := ctx.Value(contextKey("role")).(string); ok && s != "" {
		return s
	}
	return "operator"
}

// Write is the persistence-module command boundary. It keeps domain handlers
// from issuing arbitrary SQL while retaining in-process Go transactions for
// the MVP, as required by the architecture specification.
func (s *Store) Write(ctx context.Context, op string, payload any, out any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	v, err := s.execute(ctx, op, b)
	if err != nil {
		return err
	}
	if out != nil {
		vbytes, _ := json.Marshal(v)
		return json.Unmarshal(vbytes, out)
	}
	return nil
}
func decode(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("one payload required")
	}
	return nil
}
func (s *Store) execute(ctx context.Context, op string, b []byte) (any, error) {
	switch op {
	case "ping":
		return map[string]bool{"ready": true}, s.Pool.Ping(ctx)
	case "config":
		var n config.Network
		if e := decode(b, &n); e != nil {
			return nil, e
		}
		if e := n.Validate(); e != nil {
			return nil, e
		}
		return nil, s.SaveConfig(ctx, n)
	case "run.prepare":
		var v struct {
			ConfigID string `json:"config_id"`
			Scenario string `json:"scenario"`
			Mode     string `json:"mode"`
			Seed     int64  `json:"seed"`
		}
		if e := decode(b, &v); e != nil {
			return nil, e
		}
		return s.CreateRun(ctx, v.ConfigID, v.Scenario, v.Mode, v.Seed)
	case "run.activate":
		var v struct {
			ID     pgtype.UUID `json:"id"`
			Reason string      `json:"reason"`
		}
		if e := decode(b, &v); e != nil {
			return nil, e
		}
		return s.Activate(ctx, v.ID, v.Reason)
	case "recommendation":
		rec := new(pb.Recommendation)
		if e := protojson.Unmarshal(b, rec); e != nil {
			return nil, e
		}
		if rec.Id == "" || rec.RunId == "" {
			return nil, errors.New("identity required")
		}
		_, e := s.Pool.Exec(ctx, "INSERT INTO recommendations(id,run_id,status,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", rec.Id, rec.RunId, rec.Status, b)
		return nil, e
	case "decision":
		var v DecisionWrite
		if e := decode(b, &v); e != nil {
			return nil, e
		}
		return nil, s.SaveDecision(ctx, v)
	case "decision.resolve":
		var v DecisionResolveWrite
		if e := decode(b, &v); e != nil {
			return nil, e
		}
		return nil, s.ResolveDecision(ctx, v)
	case "lifecycle":
		return nil, s.SaveLifecycle(ctx, b)
	case "mode", "lock":
		var v ControlWrite
		if e := decode(b, &v); e != nil {
			return nil, e
		}
		return nil, s.SaveControl(ctx, op, v)
	case "command.reserve", "command.finish", "command.get":
		var v CommandWrite
		if e := decode(b, &v); e != nil {
			return nil, e
		}
		return s.Command(ctx, op, v)
	case "lease":
		var v LeaseWrite
		if e := decode(b, &v); e != nil {
			return nil, e
		}
		return s.Lease(ctx, v)
	}
	return nil, errors.New("unknown write operation")
}

type DecisionWrite struct {
	CommandID      string          `json:"command_id,omitempty"`
	Recommendation json.RawMessage `json:"recommendation"`
	Before         json.RawMessage `json:"before"`
	After          json.RawMessage `json:"after"`
	Action         string          `json:"action"`
	Reason         string          `json:"reason"`
	Result         string          `json:"result"`
}

func (s *Store) SaveDecision(ctx context.Context, v DecisionWrite) error {
	rec := new(pb.Recommendation)
	if e := protojson.Unmarshal(v.Recommendation, rec); e != nil {
		return e
	}
	if rec.Id == "" || rec.RunId == "" || v.Result == "" {
		return errors.New("decision identity required")
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if v.CommandID != "" {
		if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", rec.Id); e != nil {
			return e
		}
		if v.Result == "validated_pending_application" || v.Result == "rejected_by_operator" {
			var pending bool
			if e = tx.QueryRow(ctx, "SELECT status IN ('pending','unknown') FROM command_outcomes WHERE id=$1 AND actor=$2 FOR UPDATE", v.CommandID, Actor(ctx)).Scan(&pending); e != nil {
				return e
			}
			if !pending {
				return errors.New("command already settled")
			}
			payload, _ := json.Marshal(v)
			_, e = tx.Exec(ctx, "INSERT INTO decision_intents(command_id,recommendation_id,actor,payload) VALUES($1,$2,$3,$4)", v.CommandID, rec.Id, Actor(ctx), payload)
			if e != nil {
				return errors.New("recommendation already claimed; inspect original command")
			}
		} else if v.Result != "simulated" && !strings.HasPrefix(v.Result, "rejected:") {
			var settled bool
			if e = tx.QueryRow(ctx, "SELECT settled FROM decision_intents WHERE command_id=$1 AND actor=$2 FOR UPDATE", v.CommandID, Actor(ctx)).Scan(&settled); e != nil {
				return e
			}
			if settled {
				return nil
			}
		}
	}
	_, e = tx.Exec(ctx, "INSERT INTO recommendations(id,run_id,status,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload", rec.Id, rec.RunId, rec.Status, v.Recommendation)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO operator_actions(id,run_id,recommendation_id,actor,action,reason,payload) VALUES($1,$2,$3,$4,$5,$6,$7)", UUID(), rec.RunId, rec.Id, Actor(ctx), v.Action, v.Reason, v.After)
	if e != nil {
		return e
	}
	auditAfter := v.After
	if v.CommandID != "" {
		auditAfter, _ = json.Marshal(map[string]any{"command_id": v.CommandID, "changes": json.RawMessage(v.After)})
	}
	_, e = tx.Exec(ctx, "INSERT INTO audit_events(id,run_id,recommendation_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", UUID(), rec.RunId, rec.Id, Actor(ctx), "recommendation."+v.Action, v.Before, auditAfter, v.Reason, v.Result)
	if e != nil {
		return e
	}
	if v.CommandID != "" && (rec.Status == "approved" || rec.Status == "rejected" || rec.Status == "failed") {
		if _, e = tx.Exec(ctx, "UPDATE decision_intents SET settled=true WHERE command_id=$1", v.CommandID); e != nil {
			return e
		}
		if e = completeCommand(ctx, tx, v.CommandID, json.RawMessage(v.Recommendation)); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}

type DecisionResolveWrite struct {
	CommandID        string `json:"command_id"`
	RecommendationID string `json:"recommendation_id"`
	Resolution       string `json:"resolution"`
	Reason           string `json:"reason"`
}

func (s *Store) ResolveDecision(ctx context.Context, v DecisionResolveWrite) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var runID string
	e = tx.QueryRow(ctx, "SELECT payload->'recommendation'->>'run_id' FROM decision_intents WHERE command_id=$1", v.CommandID).Scan(&runID)
	if e != nil {
		return fmt.Errorf("decision intent not found: %w", e)
	}
	if _, e = tx.Exec(ctx, "UPDATE decision_intents SET settled=true WHERE command_id=$1", v.CommandID); e != nil {
		return e
	}
	if v.RecommendationID != "" {
		_, _ = tx.Exec(ctx, "UPDATE recommendations SET status='failed' WHERE id=$1", v.RecommendationID)
	}
	after, _ := json.Marshal(map[string]any{"command_id": v.CommandID, "recommendation_id": v.RecommendationID, "resolution": v.Resolution})
	var runUUID pgtype.UUID
	_ = runUUID.Scan(runID)
	reason := v.Reason
	if reason == "" {
		reason = "Supervisor manual reconciliation"
	}
	_, e = tx.Exec(ctx, "INSERT INTO audit_events(id,run_id,recommendation_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", UUID(), runUUID, v.RecommendationID, Actor(ctx), "decision.reconciled", []byte(`{}`), after, reason, "reconciled_by_supervisor")
	if e != nil {
		return e
	}
	_ = completeCommand(ctx, tx, v.CommandID, map[string]any{"status": "reconciled", "resolution": v.Resolution})
	return tx.Commit(ctx)
}

// Business state, audit and recoverable command result commit together.
func completeCommand(ctx context.Context, tx pgx.Tx, id string, response any) error {
	if id == "" {
		return nil
	}
	b, e := json.Marshal(response)
	if e != nil {
		return e
	}
	tag, e := tx.Exec(ctx, "UPDATE command_outcomes SET status='completed',http_status=200,response=$1,updated_at=now() WHERE id=$2 AND actor=$3 AND status IN ('pending','unknown')", b, id, Actor(ctx))
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return errors.New("command reservation missing or already completed")
	}
	return nil
}

type ControlWrite struct {
	RunID  string `json:"run_id"`
	Mode   string `json:"mode"`
	Target string `json:"target"`
	Locked bool   `json:"locked"`
}

func (s *Store) SaveControl(ctx context.Context, op string, v ControlWrite) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var configBytes []byte
	if e = tx.QueryRow(ctx, "SELECT n.config FROM scenario_runs r JOIN network_configs n ON n.id=r.config_id WHERE r.id=$1 FOR UPDATE OF r", v.RunID).Scan(&configBytes); e != nil {
		return e
	}
	event, reason, result := "mode.changed", "Operator changed mode to "+v.Mode, "no_actuation"
	before := map[string]any{}
	if op == "mode" {
		if v.Mode != "observe" && v.Mode != "recommend" && v.Mode != "manual" {
			return errors.New("invalid mode")
		}
		var previous string
		if e = tx.QueryRow(ctx, "SELECT mode FROM scenario_runs WHERE id=$1", v.RunID).Scan(&previous); e != nil {
			return e
		}
		before["mode"] = previous
		_, e = tx.Exec(ctx, "UPDATE scenario_runs SET mode=$1 WHERE id=$2", v.Mode, v.RunID)
	} else {
		var n config.Network
		if e = json.Unmarshal(configBytes, &n); e != nil {
			return e
		}
		valid := false
		for _, p := range n.Phases {
			if p.ID == v.Target {
				valid = true
			}
		}
		for _, m := range n.Movements {
			if m.ID == v.Target {
				valid = true
			}
		}
		if !valid {
			return errors.New("unknown lock target")
		}
		var existed bool
		if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM control_locks WHERE target=$1)", v.Target).Scan(&existed); e != nil {
			return e
		}
		before["locked"] = existed
		event = "lock.released"
		if v.Locked {
			event = "lock.applied"
			_, e = tx.Exec(ctx, "INSERT INTO control_locks(target,actor) VALUES($1,$2) ON CONFLICT(target) DO UPDATE SET actor=EXCLUDED.actor", v.Target, Actor(ctx))
		} else {
			_, e = tx.Exec(ctx, "DELETE FROM control_locks WHERE target=$1", v.Target)
		}
		reason = "Operator updated configured timing lock"
		result = "durable_lock"
	}
	if e != nil {
		return e
	}
	after, _ := json.Marshal(v)
	old, _ := json.Marshal(before)
	_, e = tx.Exec(ctx, "INSERT INTO audit_events(id,run_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", UUID(), v.RunID, Actor(ctx), event, old, after, reason, result)
	if e != nil {
		return e
	}
	response := map[string]any{"target": v.Target, "locked": v.Locked}
	if op == "mode" {
		response = map[string]any{"mode": v.Mode}
	}
	if e = completeCommand(ctx, tx, CommandID(ctx), response); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

type CommandWrite struct {
	Route      string          `json:"route,omitempty"`
	ID         string          `json:"id"`
	Hash       string          `json:"hash"`
	HTTPStatus int             `json:"http_status"`
	Response   json.RawMessage `json:"response"`
	Unknown    bool            `json:"unknown"`
}

func (s *Store) Command(ctx context.Context, op string, v CommandWrite) (any, error) {
	if len(v.ID) < 8 || len(v.ID) > 128 {
		return nil, errors.New("command ID required")
	}
	if op == "command.reserve" {
		if len(v.Hash) != 64 {
			return nil, errors.New("payload hash required")
		}
		tag, e := s.Pool.Exec(ctx, "INSERT INTO command_outcomes(id,actor,payload_hash,status,route) VALUES($1,$2,$3,'pending',$4) ON CONFLICT(id) DO NOTHING", v.ID, Actor(ctx), v.Hash, v.Route)
		if e != nil {
			return nil, e
		}
		if tag.RowsAffected() == 1 {
			return map[string]any{"id": v.ID, "status": "reserved"}, nil
		}
	}
	if op == "command.finish" {
		state := "completed"
		if v.Unknown {
			state = "unknown"
		}
		if len(v.Response) == 0 {
			v.Response = json.RawMessage(`{}`)
		}
		_, e := s.Pool.Exec(ctx, "UPDATE command_outcomes SET status=$1,http_status=$2,response=$3,updated_at=now() WHERE id=$4 AND actor=$5 AND payload_hash=$6 AND status IN ('pending','unknown')", state, v.HTTPStatus, v.Response, v.ID, Actor(ctx), v.Hash)
		if e != nil {
			return nil, e
		}
	}
	if op == "command.get" {
		// Only decision/control writes have atomic completion with business state.
		// Expire abandoned reservations after all domain deadlines, never replay them.
		_, e := s.Pool.Exec(ctx, `UPDATE command_outcomes c SET status='completed',http_status=409,response='{"message":"Command expired without committed decision/control; no action replayed"}'::jsonb,updated_at=now() WHERE id=$1 AND actor=$2 AND status IN ('pending','unknown') AND created_at<now()-interval '30 seconds' AND (route LIKE '/api/v1/recommendations/%' OR route LIKE '/api/v1/mode/%' OR route LIKE '/api/v1/locks/%') AND NOT EXISTS(SELECT 1 FROM decision_intents d WHERE d.command_id=c.id)`, v.ID, Actor(ctx))
		if e != nil {
			return nil, e
		}
	}
	var actor, hash, status string
	var code *int
	var response json.RawMessage
	e := s.Pool.QueryRow(ctx, "SELECT actor,payload_hash,status,http_status,response FROM command_outcomes WHERE id=$1", v.ID).Scan(&actor, &hash, &status, &code, &response)
	if e != nil {
		return nil, e
	}
	if actor != Actor(ctx) || (v.Hash != "" && hash != v.Hash) {
		return map[string]any{"id": v.ID, "status": "conflict"}, nil
	}
	return map[string]any{"id": v.ID, "status": status, "http_status": code, "response": response}, nil
}

type LeaseWrite struct {
	Owner   string `json:"owner"`
	Epoch   int64  `json:"epoch"`
	Acquire bool   `json:"acquire"`
}

func (s *Store) Lease(ctx context.Context, v LeaseWrite) (any, error) {
	if v.Acquire && v.Owner != "" {
		_, e := s.Pool.Exec(ctx, `INSERT INTO owner_lease(singleton,owner,epoch,expires_at) VALUES(true,$1,1,now()+interval '6 seconds') ON CONFLICT(singleton) DO UPDATE SET owner=EXCLUDED.owner,epoch=owner_lease.epoch+1,expires_at=EXCLUDED.expires_at WHERE owner_lease.expires_at<now()`, v.Owner)
		if e != nil {
			return nil, e
		}
	} else if v.Owner != "" && v.Epoch > 0 {
		_, e := s.Pool.Exec(ctx, "UPDATE owner_lease SET expires_at=now()+interval '6 seconds' WHERE singleton AND owner=$1 AND epoch=$2 AND expires_at>now()", v.Owner, v.Epoch)
		if e != nil {
			return nil, e
		}
	}
	var owner string
	var epoch int64
	var valid bool
	if e := s.Pool.QueryRow(ctx, "SELECT owner,epoch,expires_at>now() FROM owner_lease WHERE singleton").Scan(&owner, &epoch, &valid); e != nil {
		return map[string]any{"valid": false}, nil
	}
	return map[string]any{"owner": owner, "epoch": epoch, "valid": valid}, nil
}
