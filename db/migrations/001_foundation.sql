CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE network_configs (id text PRIMARY KEY, schema_version text NOT NULL, config jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE scenario_runs (
 id uuid PRIMARY KEY, config_id text NOT NULL REFERENCES network_configs(id),
 scenario_type text NOT NULL CHECK (scenario_type IN ('peak_surge','incident_c3','ambulance_corridor')),
 seed bigint NOT NULL CHECK (seed BETWEEN 1 AND 4294967295),
 mode text NOT NULL CHECK (mode IN ('observe','recommend')),
 status text NOT NULL CHECK (status IN ('prepared','running','ended')),
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
CREATE TABLE recommendations (id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES scenario_runs(id), status text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE operator_actions (id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES scenario_runs(id), recommendation_id uuid NOT NULL REFERENCES recommendations(id), actor text NOT NULL CHECK(length(actor)>0), action text NOT NULL CHECK(action IN ('simulate','approve','modify','reject')), reason text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(action NOT IN ('modify','reject') OR length(trim(reason))>0));
CREATE TABLE incidents (id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES scenario_runs(id), node_id text NOT NULL, capacity_ratio double precision NOT NULL CHECK(capacity_ratio BETWEEN 0 AND 1), status text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE emergencies (id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES scenario_runs(id), status text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE system_health_events (id uuid PRIMARY KEY, component text NOT NULL, status text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events (sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id uuid UNIQUE NOT NULL, run_id uuid REFERENCES scenario_runs(id), recommendation_id uuid REFERENCES recommendations(id), actor text NOT NULL CHECK(length(actor)>0), event_type text NOT NULL, before_values jsonb NOT NULL, after_values jsonb NOT NULL, reason text NOT NULL, safety_result text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_run_sequence ON audit_events(run_id, sequence DESC);
CREATE TABLE traffic_state_snapshots (id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES scenario_runs(id), window_start timestamptz NOT NULL, window_s integer NOT NULL CHECK(window_s >= 5), aggregate jsonb NOT NULL);
CREATE OR REPLACE FUNCTION prevent_audit_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit history is append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_rewrite();
INSERT INTO schema_migrations(version) VALUES (1);
