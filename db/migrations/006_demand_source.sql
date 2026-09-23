ALTER TABLE scenario_runs ADD COLUMN demand_source text NOT NULL DEFAULT 'seeded'
  CHECK (demand_source IN ('seeded', 'video_profile'));
INSERT INTO schema_migrations(version) VALUES (6);
