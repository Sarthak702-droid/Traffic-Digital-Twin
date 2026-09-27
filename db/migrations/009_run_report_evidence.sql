CREATE TABLE run_evidence_events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 id uuid UNIQUE NOT NULL,
 run_id uuid NOT NULL REFERENCES scenario_runs(id),
 event_identity text,
 kind text NOT NULL CHECK(kind IN ('observation','analysis','comparison','decision','application','failure','resource')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX run_evidence_events_identity ON run_evidence_events(run_id,kind,event_identity) WHERE event_identity IS NOT NULL;
CREATE INDEX run_evidence_events_run_sequence ON run_evidence_events(run_id, sequence);
CREATE TRIGGER run_evidence_events_append_only BEFORE UPDATE OR DELETE ON run_evidence_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_rewrite();
INSERT INTO schema_migrations(version) VALUES (9);
