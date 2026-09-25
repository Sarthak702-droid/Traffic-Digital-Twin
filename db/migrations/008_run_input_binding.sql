CREATE TABLE run_input_bindings (
  run_id uuid PRIMARY KEY REFERENCES scenario_runs(id),
  input_session_id text NOT NULL CHECK (length(input_session_id) > 0),
  config_hash text NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  source_sessions jsonb NOT NULL CHECK (jsonb_typeof(source_sessions) = 'object' AND source_sessions <> '{}'::jsonb),
  source_identities jsonb NOT NULL CHECK (jsonb_typeof(source_identities) = 'object' AND source_identities <> '{}'::jsonb),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION prevent_input_binding_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Run input binding is immutable'; END $$;
CREATE TRIGGER run_input_binding_immutable BEFORE UPDATE OR DELETE ON run_input_bindings FOR EACH ROW EXECUTE FUNCTION prevent_input_binding_rewrite();
INSERT INTO schema_migrations(version) VALUES (8);
