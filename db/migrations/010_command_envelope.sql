-- Existing receipts remain queryable; v2 reservations carry operation identity.
ALTER TABLE command_outcomes ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT '';
ALTER TABLE command_outcomes ADD COLUMN IF NOT EXISTS envelope_version text NOT NULL DEFAULT '';
INSERT INTO schema_migrations(version) VALUES (10);
