package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrSessionMissing = errors.New("session not found")

// AuthSession contains only the account identity and revocation data. The
// browser token is never persisted; PostgreSQL receives its SHA-256 digest.
type AuthSession struct {
	Username       string
	AccountVersion int
	ExpiresAt      time.Time
	Revoked        bool
}

func (s *Store) CreateSession(ctx context.Context, tokenHash string, v AuthSession) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO auth_sessions(token_hash,username,account_version,expires_at) VALUES($1,$2,$3,$4)`, tokenHash, v.Username, v.AccountVersion, v.ExpiresAt)
	return err
}

func (s *Store) LookupSession(ctx context.Context, tokenHash string) (AuthSession, error) {
	var v AuthSession
	err := s.Pool.QueryRow(ctx, `SELECT username,account_version,expires_at,revoked FROM auth_sessions WHERE token_hash=$1`, tokenHash).Scan(&v.Username, &v.AccountVersion, &v.ExpiresAt, &v.Revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return AuthSession{}, ErrSessionMissing
	}
	return v, err
}

func (s *Store) RevokeSession(ctx context.Context, tokenHash string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE auth_sessions SET revoked=true WHERE token_hash=$1`, tokenHash)
	return err
}
