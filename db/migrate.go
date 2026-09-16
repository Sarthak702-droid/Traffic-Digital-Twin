package db

import (
	"context"
	_ "embed"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/001_foundation.sql
var foundation string

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
			return tx.Commit(ctx)
		}
	}
	if _, e = tx.Exec(ctx, foundation); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
