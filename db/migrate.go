package db

import (
	"context"
	_ "embed"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/001_foundation.sql
var foundation string

//go:embed migrations/002_control.sql
var control string

//go:embed migrations/003_decisions.sql
var decisions string

//go:embed migrations/004_aggregate_flow.sql
var aggregateFlow string

//go:embed migrations/005_video_observations.sql
var videoObservations string

//go:embed migrations/006_demand_source.sql
var demandSource string

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	tx, e := pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(710001)"); e != nil {
		return e
	}
	var exists bool
	if e = tx.QueryRow(ctx, "SELECT to_regclass('schema_migrations') IS NOT NULL").Scan(&exists); e != nil {
		return e
	}
	if exists {
		var applied bool
		if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=1)").Scan(&applied); e != nil {
			return e
		}
		if applied {
			return applyControl(ctx, tx)
		}
	}
	if _, e = tx.Exec(ctx, foundation); e != nil {
		return e
	}
	return applyControl(ctx, tx)
}

func applyControl(ctx context.Context, tx pgx.Tx) error {
	var done bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=2)").Scan(&done); err != nil {
		return err
	}
	if !done {
		if _, err := tx.Exec(ctx, control); err != nil {
			return err
		}
	}
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=3)").Scan(&done); err != nil {
		return err
	}
	if !done {
		if _, err := tx.Exec(ctx, decisions); err != nil {
			return err
		}
	}
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=4)").Scan(&done); err != nil {
		return err
	}
	if !done {
		if _, err := tx.Exec(ctx, aggregateFlow); err != nil {
			return err
		}
	}
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=5)").Scan(&done); err != nil {
		return err
	}
	if !done {
		if _, err := tx.Exec(ctx, videoObservations); err != nil {
			return err
		}
	}
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=6)").Scan(&done); err != nil {
		return err
	}
	if !done {
		if _, err := tx.Exec(ctx, demandSource); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
