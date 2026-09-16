-- name: SaveConfig :exec
INSERT INTO network_configs (id, schema_version, config) VALUES ($1,$2,$3) ON CONFLICT(id) DO NOTHING;
-- name: GetConfig :one
SELECT * FROM network_configs WHERE id=$1;
-- name: CreateRun :one
INSERT INTO scenario_runs (id,config_id,scenario_type,seed,mode,status) VALUES ($1,$2,$3,$4,$5,'prepared') RETURNING *;
-- name: GetRun :one
SELECT * FROM scenario_runs WHERE id=$1;
-- name: ListRuns :many
SELECT * FROM scenario_runs ORDER BY started_at DESC,id DESC LIMIT $1;
-- name: AppendAudit :one
INSERT INTO audit_events (id,run_id,recommendation_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;
-- name: ListAudit :many
SELECT * FROM audit_events WHERE sequence > $1 ORDER BY sequence ASC LIMIT $2;
-- name: SaveRecommendation :exec
INSERT INTO recommendations (id,run_id,status,payload) VALUES ($1,$2,$3,$4);
-- name: SaveOperatorAction :exec
INSERT INTO operator_actions(id,run_id,recommendation_id,actor,action,reason,payload) VALUES ($1,$2,$3,$4,$5,$6,$7);
-- name: SaveIncident :exec
INSERT INTO incidents(id,run_id,node_id,capacity_ratio,status,payload) VALUES ($1,$2,$3,$4,$5,$6);
-- name: SaveEmergency :exec
INSERT INTO emergencies(id,run_id,status,payload) VALUES ($1,$2,$3,$4);
-- name: SaveHealthEvent :exec
INSERT INTO system_health_events(id,component,status,details) VALUES ($1,$2,$3,$4);
-- name: SaveAggregate :exec
INSERT INTO traffic_state_snapshots(id,run_id,window_start,window_s,aggregate) VALUES ($1,$2,$3,$4,$5);
