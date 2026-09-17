ALTER TABLE command_outcomes ADD COLUMN route text NOT NULL DEFAULT '';
CREATE TABLE decision_intents (
 command_id text PRIMARY KEY REFERENCES command_outcomes(id),
 recommendation_id text UNIQUE NOT NULL,
 actor text NOT NULL,
 payload jsonb NOT NULL,
 settled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(3);
