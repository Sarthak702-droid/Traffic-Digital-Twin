CREATE TABLE auth_sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 username text NOT NULL,
 account_version integer NOT NULL CHECK(account_version>0),
 expires_at timestamptz NOT NULL,
 revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
INSERT INTO schema_migrations(version) VALUES (7);
