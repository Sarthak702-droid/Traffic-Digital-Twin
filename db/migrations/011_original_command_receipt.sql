-- Preserve the first HTTP acknowledgement separately from later application proof.
ALTER TABLE command_outcomes ADD COLUMN IF NOT EXISTS initial_response jsonb;
ALTER TABLE command_outcomes ADD COLUMN IF NOT EXISTS initial_http_status integer;
INSERT INTO schema_migrations(version) VALUES (11);
