package store

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/store/queries"
)

type Store struct {
	Pool    *pgxpool.Pool
	Q       *queries.Queries
	Gateway string
	Token   string
}

func New(pool *pgxpool.Pool) *Store { return &Store{Pool: pool, Q: queries.New(pool)} }
func UUID() pgtype.UUID {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return pgtype.UUID{Bytes: b, Valid: true}
}
func (s *Store) SaveConfig(ctx context.Context, n config.Network) error {
	if s.Gateway != "" {
		return s.Write(ctx, "config", n, nil)
	}
	b, e := json.Marshal(n)
	if e != nil {
		return e
	}
	if e = s.Q.SaveConfig(ctx, queries.SaveConfigParams{ID: n.ID, SchemaVersion: n.Version, Config: b}); e != nil {
		return e
	}
	old, e := s.Q.GetConfig(ctx, n.ID)
	if e != nil {
		return e
	}
	var existing config.Network
	if e = json.Unmarshal(old.Config, &existing); e != nil {
		return e
	}
	normalized, _ := json.Marshal(existing)
	if string(normalized) != string(b) {
		return fmt.Errorf("config %s already exists with different content; increment config id", n.ID)
	}
	return nil
}
func (s *Store) CreateRun(ctx context.Context, configID, scenario, mode string, seed int64) (queries.ScenarioRun, error) {
	if s.Gateway != "" {
		var out queries.ScenarioRun
		err := s.Write(ctx, "run.prepare", map[string]any{"config_id": configID, "scenario": scenario, "mode": mode, "seed": seed}, &out)
		return out, err
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return queries.ScenarioRun{}, e
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	run, e := q.CreateRun(ctx, queries.CreateRunParams{ID: UUID(), ConfigID: configID, ScenarioType: scenario, Seed: seed, Mode: mode})
	if e != nil {
		return run, e
	}
	after, e := json.Marshal(run)
	if e != nil {
		return run, e
	}
	_, e = q.AppendAudit(ctx, queries.AppendAuditParams{ID: UUID(), RunID: run.ID, Actor: Actor(ctx), EventType: "run.prepared", BeforeValues: []byte(`{}`), AfterValues: after, Reason: "Deterministic scenario prepared; simulation is not started", SafetyResult: "not_applied"})
	if e != nil {
		return run, e
	}
	return run, tx.Commit(ctx)
}

func (s *Store) Activate(ctx context.Context, id pgtype.UUID, reason string) (queries.ScenarioRun, error) {
	if s.Gateway != "" {
		var out queries.ScenarioRun
		err := s.Write(ctx, "run.activate", map[string]any{"id": id, "reason": reason}, &out)
		return out, err
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return queries.ScenarioRun{}, e
	}
	defer tx.Rollback(ctx)
	q := s.Q.WithTx(tx)
	if e = q.EndRunningRuns(ctx); e != nil {
		return queries.ScenarioRun{}, e
	}
	run, e := q.ActivateRun(ctx, id)
	if e != nil {
		return run, e
	}
	after, e := json.Marshal(run)
	if e != nil {
		return run, e
	}
	_, e = q.AppendAudit(ctx, queries.AppendAuditParams{ID: UUID(), RunID: run.ID, Actor: Actor(ctx), EventType: "scenario.started", BeforeValues: []byte(`{}`), AfterValues: after, Reason: reason, SafetyResult: "virtual_configured_plan"})
	if e != nil {
		return run, e
	}
	return run, tx.Commit(ctx)
}
