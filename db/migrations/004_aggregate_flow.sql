ALTER TABLE scenario_runs
  ADD COLUMN engine_kind text NOT NULL DEFAULT '',
  ADD COLUMN model_version text NOT NULL DEFAULT '',
  ADD COLUMN metrics_version text NOT NULL DEFAULT '',
  ADD COLUMN config_hash text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX traffic_state_snapshots_run_window
  ON traffic_state_snapshots(run_id, window_start, window_s);

INSERT INTO schema_migrations(version) VALUES(4);
