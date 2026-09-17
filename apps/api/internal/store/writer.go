package store

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/encoding/protojson"
	"io"
	"net/http"
	"time"
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

type WriteEnvelope struct {
	Operation string          `json:"operation"`
	Actor     string          `json:"actor"`
	Payload   json.RawMessage `json:"payload"`
}

func (s *Store) Write(ctx context.Context, op string, payload any, out any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if s.Gateway == "" {
		v, e := s.execute(ctx, op, b)
		if e != nil {
			return e
		}
		if out != nil {
			vbytes, _ := json.Marshal(v)
			return json.Unmarshal(vbytes, out)
		}
		return nil
	}
	data, _ := json.Marshal(WriteEnvelope{op, Actor(ctx), b})
	req, err := http.NewRequestWithContext(ctx, "POST", s.Gateway+"/internal/write", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("X-Service-Token", s.Token)
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("writer unavailable (%d)", resp.StatusCode)
	}
	if out != nil {
		return json.Unmarshal(body, out)
	}
	return nil
}
func (s *Store) WriterHandler(token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Service-Token")), []byte(token)) != 1 {
			http.Error(w, `{"message":"Private writer"}`, 401)
			return
		}
		if r.Method != "POST" || r.URL.Path != "/internal/write" {
			http.NotFound(w, r)
			return
		}
		var e WriteEnvelope
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
		d.DisallowUnknownFields()
		if d.Decode(&e) != nil || d.Decode(new(any)) != io.EOF || e.Actor == "" {
			http.Error(w, `{"message":"Invalid typed write"}`, 400)
			return
		}
		ctx, cancel := context.WithTimeout(WithActor(r.Context(), e.Actor), 4*time.Second)
		defer cancel()
		out, err := s.execute(ctx, e.Operation, e.Payload)
		if err != nil {
			http.Error(w, `{"message":"Write not confirmed; inspect command outcome"}`, 503)
			return
		}
		json.NewEncoder(w).Encode(out)
	})
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
	_, e = tx.Exec(ctx, "INSERT INTO recommendations(id,run_id,status,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload", rec.Id, rec.RunId, rec.Status, v.Recommendation)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO operator_actions(id,run_id,recommendation_id,actor,action,reason,payload) VALUES($1,$2,$3,$4,$5,$6,$7)", UUID(), rec.RunId, rec.Id, Actor(ctx), v.Action, v.Reason, v.After)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO audit_events(id,run_id,recommendation_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", UUID(), rec.RunId, rec.Id, Actor(ctx), "recommendation."+v.Action, v.Before, v.After, v.Reason, v.Result)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
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
	return tx.Commit(ctx)
}

type CommandWrite struct {
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
		tag, e := s.Pool.Exec(ctx, "INSERT INTO command_outcomes(id,actor,payload_hash,status) VALUES($1,$2,$3,'pending') ON CONFLICT(id) DO NOTHING", v.ID, Actor(ctx), v.Hash)
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
