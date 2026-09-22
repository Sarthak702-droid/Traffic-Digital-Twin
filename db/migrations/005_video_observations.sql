CREATE TABLE IF NOT EXISTS camera_observations (
  id text PRIMARY KEY,
  run_id uuid REFERENCES scenario_runs(id) ON DELETE CASCADE,
  camera_id text NOT NULL,
  clip_id text NOT NULL DEFAULT '',
  session_id text NOT NULL DEFAULT '',
  direction_id text NOT NULL DEFAULT 'approaching',
  window_start_s double precision NOT NULL,
  window_end_s double precision NOT NULL,
  available_at_s double precision NOT NULL,
  crossings integer NOT NULL DEFAULT 0,
  flow_vpm double precision NOT NULL DEFAULT 0.0,
  queue_estimate integer,
  queue_status text NOT NULL DEFAULT 'unavailable',
  speed_kph double precision,
  speed_status text NOT NULL DEFAULT 'uncalibrated',
  status text NOT NULL DEFAULT 'valid',
  validation_level text NOT NULL DEFAULT 'agent_reviewed',
  media_source text NOT NULL DEFAULT 'recorded_video',
  processing_mode text NOT NULL DEFAULT 'online_inference',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_camera_obs_cam_window
  ON camera_observations(camera_id, window_start_s);

CREATE INDEX IF NOT EXISTS idx_camera_obs_run_cam
  ON camera_observations(run_id, camera_id);

INSERT INTO schema_migrations(version) VALUES(5)
  ON CONFLICT (version) DO NOTHING;
