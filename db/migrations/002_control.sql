ALTER TABLE scenario_runs DROP CONSTRAINT scenario_runs_mode_check;
ALTER TABLE scenario_runs ADD CONSTRAINT scenario_runs_mode_check CHECK(mode IN ('observe','recommend','manual'));
CREATE TABLE control_locks (target text PRIMARY KEY, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE command_outcomes (id text PRIMARY KEY, actor text NOT NULL, payload_hash text NOT NULL, status text NOT NULL CHECK(status IN ('pending','completed','unknown')), http_status integer, response jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE owner_lease (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), owner text NOT NULL, epoch bigint NOT NULL, expires_at timestamptz NOT NULL);
INSERT INTO schema_migrations(version) VALUES(2);
