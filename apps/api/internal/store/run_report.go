package store

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/encoding/protojson"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

// Reports use explicit public fields, never arbitrary evidence payloads. The
// repeatable-read snapshot keeps input, analysis and decisions mutually consistent.
func (s *Store) RunReport(ctx context.Context, id pgtype.UUID) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	run, err := s.Q.WithTx(tx).GetRun(ctx, id)
	if err != nil {
		return nil, err
	}
	config, err := s.Q.WithTx(tx).GetConfig(ctx, run.ConfigID)
	if err != nil {
		return nil, err
	}
	var network struct {
		FlowModel struct {
			MetricsVersion string `json:"metrics_version"`
		} `json:"flow_model"`
	}
	if err = json.Unmarshal(config.Config, &network); err != nil {
		return nil, err
	}
	inputs := []any{}
	var session any
	var configHash any
	var binding RunInputBinding
	var sources, identities []byte
	err = tx.QueryRow(ctx, "SELECT input_session_id,config_hash,source_sessions,source_identities FROM run_input_bindings WHERE run_id=$1", id).Scan(&binding.InputSessionID, &binding.ConfigHash, &sources, &identities)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		if err = json.Unmarshal(sources, &binding.SourceSessions); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(identities, &binding.SourceIdentities); err != nil {
			return nil, err
		}
		session = binding.InputSessionID
		configHash = binding.ConfigHash
		cameras := []string{}
		for camera := range binding.SourceSessions {
			cameras = append(cameras, camera)
		}
		sort.Strings(cameras)
		for _, camera := range cameras {
			b := binding.SourceIdentities[camera]
			inputs = append(inputs, map[string]any{"camera_id": camera, "clip_sha256": b.ClipSHA256, "geometry_sha256": b.GeometrySHA256, "model_sha256": b.ModelSHA256, "observations_sha256": b.ObservationsSHA256, "detector_version": b.DetectorVersion, "tracker_version": b.TrackerVersion, "observation_schema_version": b.ObservationSchemaVersion, "source_session_id": binding.SourceSessions[camera], "last_finalized_window_end_source_s": nil, "processing_mode": "cached_observations", "validation_level": "provisional_unreviewed"})
		}
	}
	missing := func() map[string]any { return map[string]any{"value": nil, "availability": "not_measured"} }
	report := map[string]any{"schema_version": "prototype-run-report-v2", "report_id": UUID().String(), "run_id": id.String(), "created_at_utc": time.Now().UTC().Format(time.RFC3339Nano), "scenario_type": run.ScenarioType, "seed": run.Seed, "demand_source": run.DemandSource, "run_status": run.Status, "input_session_id": session, "inputs": inputs, "versions": map[string]any{"config_hash": configHash, "config_id": run.ConfigID, "model_version": nil, "metrics_version": network.FlowModel.MetricsVersion, "scoring_version": nil}, "forecast": map[string]any{"origin_source_s": nil, "origin_simulation_s": nil, "method": "unavailable", "input_quality": "not_evaluated", "horizons": []any{}, "uncertainty": map[string]any{"value": nil, "availability": "not_calibrated"}}, "analysis_outcome": "cannot_evaluate", "alternatives": []any{}, "comparisons": []any{}, "operator_decisions": []any{}, "applied_outcome": nil, "failures": []any{}, "resources": map[string]any{"fresh_inference_fps": missing(), "recommendation_latency_s": missing(), "peak_cpu_percent": missing(), "peak_ram_bytes": missing()}, "analyses": []any{}, "observations": []any{}, "clock_events": []any{}, "application_events": []any{}}
	rows, err := tx.Query(ctx, "SELECT sequence,kind,payload,created_at FROM run_evidence_events WHERE run_id=$1 ORDER BY sequence", id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var sequence int64
		var kind string
		var payload []byte
		var created time.Time
		if err = rows.Scan(&sequence, &kind, &payload, &created); err != nil {
			rows.Close()
			return nil, err
		}
		switch kind {
		case "failure":
			var failure struct {
				Code string `json:"code"`
			}
			if err = json.Unmarshal(payload, &failure); err != nil {
				rows.Close()
				return nil, err
			}
			report["failures"] = append(report["failures"].([]any), map[string]any{"code": failure.Code, "occurred_at_utc": created.UTC().Format(time.RFC3339Nano), "message": "Dependency/input failure observed; no physical control target"})
		case "resource":
			var resource struct {
				AnalysisWallS *float64            `json:"analysis_wall_s"`
				Perception    *PerceptionResource `json:"perception"`
			}
			if err = json.Unmarshal(payload, &resource); err != nil {
				rows.Close()
				return nil, err
			}
			metrics := report["resources"].(map[string]any)
			prior := metrics["recommendation_latency_s"].(map[string]any)
			maximum, _ := prior["value"].(float64)
			if resource.AnalysisWallS != nil && (prior["value"] == nil || *resource.AnalysisWallS > maximum) {
				metrics["recommendation_latency_s"] = map[string]any{"value": *resource.AnalysisWallS, "availability": "measured_max_analysis_rpc_wall_s"}
			}

			if resource.Perception != nil {
				p := resource.Perception
				for key, value := range map[string]float64{"peak_cpu_percent": p.PeakCPUPercent, "peak_ram_bytes": p.PeakRAMBytes} {
					previous := metrics[key].(map[string]any)
					old, _ := previous["value"].(float64)
					if previous["value"] == nil || value > old {
						metrics[key] = map[string]any{"value": value, "availability": "measured_peak_fresh_source_process"}
					}
				}
				if p.FreshInferenceFPS != nil {
					previous := metrics["fresh_inference_fps"].(map[string]any)
					old, _ := previous["value"].(float64)
					if previous["value"] == nil || *p.FreshInferenceFPS < old {
						metrics["fresh_inference_fps"] = map[string]any{"value": *p.FreshInferenceFPS, "availability": "measured_min_fresh_source_process"}
					}
				}
			}

		case "analysis":
			a := &pb.Analysis{}
			if err = protojson.Unmarshal(payload, a); err != nil {
				rows.Close()
				return nil, err
			}
			if a.RunId != "" && a.RunId != id.String() {
				rows.Close()
				return nil, errors.New("report analysis run mismatch")
			}
			clean := publicAnalysis(a)
			clean["sequence"] = sequence
			clean["recorded_at_utc"] = created.UTC().Format(time.RFC3339Nano)
			report["analyses"] = append(report["analyses"].([]any), clean)
			report["analysis_outcome"] = a.Outcome
			if a.ConfigHash != "" {
				report["versions"].(map[string]any)["config_hash"] = a.ConfigHash
			}
			if a.ModelVersion != "" {
				report["versions"].(map[string]any)["model_version"] = a.ModelVersion
			}
			if a.MetricsVersion != "" {
				report["versions"].(map[string]any)["metrics_version"] = a.MetricsVersion
			}
			horizons := []any{}
			for _, h := range a.HorizonAvailability {
				horizons = append(horizons, map[string]any{"horizon_s": h.HorizonS, "status": h.Status, "recorded_score_status": "not_evaluated"})
			}
			var origin any
			method := "unavailable"
			if len(a.Forecasts) > 0 {
				method = a.Forecasts[0].Method
			}
			if len(a.Forecasts) > 0 && run.DemandSource != "seeded" {
				origin = a.ForecastOriginSourceS
				method = a.Forecasts[0].Method
			}
			report["forecast"] = map[string]any{"origin_source_s": origin, "origin_simulation_s": a.SimulationTimeS, "method": method, "input_quality": a.InputQuality, "horizons": horizons, "uncertainty": map[string]any{"value": nil, "availability": "not_calibrated"}}
			report["alternatives"] = clean["alternatives"]
			if a.Comparison != nil {
				report["comparisons"] = append(report["comparisons"].([]any), clean["comparison"])
				report["versions"].(map[string]any)["scoring_version"] = a.Comparison.ScoringVersion
			}
		case "observation":
			o := &pb.FinalizedObservation{}
			if err = protojson.Unmarshal(payload, o); err != nil {
				rows.Close()
				return nil, err
			}
			report["observations"] = append(report["observations"].([]any), map[string]any{"sequence": sequence, "observation_id": o.ObservationId, "camera_id": o.CameraId, "boundary_link_id": o.BoundaryLinkId, "window_start_source_s": o.WindowStartS, "window_end_source_s": o.WindowEndS, "available_at_source_s": o.AvailableAtSourceS, "processed_at_utc": o.ProcessedAtUtc, "crossings_veh": o.CrossingsVeh, "observation_status": o.ObservationStatus, "queue_visible_veh_estimate": o.QueueVisibleVehEstimate, "queue_status": o.QueueStatus, "source_session_id": o.GetSourceIdentity().GetSourceSessionId()})
			for _, input := range inputs {
				p := input.(map[string]any)
				if p["camera_id"] == o.CameraId && p["source_session_id"] == o.GetSourceIdentity().GetSourceSessionId() {
					end, _ := p["last_finalized_window_end_source_s"].(float64)
					if o.WindowEndS > end {
						p["last_finalized_window_end_source_s"] = o.WindowEndS
					}
				}
			}
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	seenDecisions := map[string]bool{}
	audit, err := tx.Query(ctx, "SELECT sequence,actor,event_type,recommendation_id,after_values,reason,safety_result,created_at FROM audit_events WHERE run_id=$1 ORDER BY sequence", id)
	if err != nil {
		return nil, err
	}
	for audit.Next() {
		var sequence int64
		var actor, event, reason, result string
		var recommendation pgtype.UUID
		var after []byte
		var created time.Time
		if err = audit.Scan(&sequence, &actor, &event, &recommendation, &after, &reason, &result, &created); err != nil {
			audit.Close()
			return nil, err
		}
		var detail struct {
			CommandID   string          `json:"command_id"`
			PlanOutcome json.RawMessage `json:"plan_outcome"`
		}
		if event == "scenario.interrupted" {
			report["failures"] = append(report["failures"].([]any), map[string]any{"code": "simulator_state_missing_after_restart", "occurred_at_utc": created.UTC().Format(time.RFC3339Nano), "message": "Run ended after simulator restart; fresh analysis requires a new run"})
		}
		if event == "clock.changed" {
			var clock struct {
				CommandID string `json:"command_id"`
				Paused    bool   `json:"paused"`
				Status    string `json:"status"`
			}
			if err = json.Unmarshal(after, &clock); err != nil {
				audit.Close()
				return nil, err
			}
			report["clock_events"] = append(report["clock_events"].([]any), map[string]any{"sequence": sequence, "command_id": clock.CommandID, "actor": actor, "paused": clock.Paused, "status": clock.Status, "occurred_at_utc": created.UTC().Format(time.RFC3339Nano)})
		}
		if strings.HasPrefix(event, "recommendation.") {
			if err = json.Unmarshal(after, &detail); err != nil {
				audit.Close()
				return nil, err
			}
		}
		if strings.HasPrefix(event, "recommendation.") {
			action := strings.TrimPrefix(event, "recommendation.")
			decisionKey := detail.CommandID + ":" + recommendation.String() + ":" + action
			if !seenDecisions[decisionKey] {
				seenDecisions[decisionKey] = true
				report["operator_decisions"] = append(report["operator_decisions"].([]any), map[string]any{"sequence": sequence, "command_id": detail.CommandID, "actor": actor, "action": action, "recommendation_id": recommendation.String(), "reason": reason, "safety_result": result, "decided_at_utc": created.UTC().Format(time.RFC3339Nano)})
			}
			if len(detail.PlanOutcome) > 0 && string(detail.PlanOutcome) != "null" {
				outcome := &pb.PlanOutcome{}
				if err = protojson.Unmarshal(detail.PlanOutcome, outcome); err != nil {
					audit.Close()
					return nil, err
				}
				report["applied_outcome"] = map[string]any{"command_id": detail.CommandID, "status": outcome.Status, "applied_at_simulation_s": outcome.AppliedAtSimulationS, "resolved_at_utc": created.UTC().Format(time.RFC3339Nano)}
				report["application_events"] = append(report["application_events"].([]any), report["applied_outcome"])
			}
			if strings.HasPrefix(result, "rejected:") || strings.Contains(result, "failed") || strings.Contains(result, "timed_out") {
				report["failures"] = append(report["failures"].([]any), map[string]any{"code": "decision_not_applied", "occurred_at_utc": created.UTC().Format(time.RFC3339Nano), "message": "Virtual decision did not apply; inspect authenticated command outcome"})
			}
		}
	}
	err = audit.Err()
	audit.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return report, nil
}

func publicAnalysis(a *pb.Analysis) map[string]any {
	// Deliberately omit free-form compute explanations and raw payloads.
	var origin any
	if len(a.Forecasts) > 0 && a.InputQuality != "synthetic" {
		origin = a.ForecastOriginSourceS
	}
	forecasts := []any{}
	for _, f := range a.Forecasts {
		var sourceOrigin any
		if a.InputQuality != "synthetic" && f.InputQuality != "synthetic" {
			sourceOrigin = f.OriginSourceS
		}
		forecasts = append(forecasts, map[string]any{"movement_id": f.MovementId, "horizon_s": f.HorizonS, "queue_veh": f.QueueVeh, "occupancy_ratio": f.OccupancyRatio, "arrivals_veh": f.ArrivalsVeh, "method": f.Method, "origin_source_s": sourceOrigin, "input_age_s": f.InputAgeS, "input_quality": f.InputQuality, "horizon_status": f.HorizonStatus, "uncertainty_status": f.UncertaintyStatus})
	}
	alternatives := []any{}
	for _, r := range a.Alternatives {
		alternatives = append(alternatives, publicRecommendation(r))
	}
	var comparison any
	if a.Comparison != nil {
		c := a.Comparison
		comparison = map[string]any{"recommendation_id": c.RecommendationId, "input_session_id": c.InputSessionId, "snapshot_sequence": c.SnapshotSequence, "config_hash": c.ConfigHash, "model_version": c.ModelVersion, "metrics_version": c.MetricsVersion, "scoring_version": c.ScoringVersion, "forecast_origin_source_s": c.ForecastOriginSourceS, "window_start_simulation_s": c.WindowStartSimulationS, "window_end_simulation_s": c.WindowEndSimulationS, "demand_assumptions_hash": c.DemandAssumptionsHash, "baseline": map[string]any{"queue_delay_veh_s": c.BaselineQueueDelayVehS, "boundary_exits_veh": c.BaselineBoundaryThroughputVeh, "boundary_backlog_veh": c.BaselineBoundaryBacklogVeh, "boundary_wait_veh_s": c.BaselineBoundaryWaitVehS, "worst_service_debt_s": c.BaselineWorstServiceDebtS, "congested_link_s": c.BaselineCongestedLinkS}, "candidate": map[string]any{"queue_delay_veh_s": c.CandidateQueueDelayVehS, "boundary_exits_veh": c.CandidateBoundaryThroughputVeh, "boundary_backlog_veh": c.CandidateBoundaryBacklogVeh, "boundary_wait_veh_s": c.CandidateBoundaryWaitVehS, "worst_service_debt_s": c.CandidateWorstServiceDebtS, "congested_link_s": c.CandidateCongestedLinkS}}
	}
	var recommendation any
	if a.Recommendation != nil {
		recommendation = publicRecommendation(a.Recommendation)
	}
	return map[string]any{"outcome": a.Outcome, "run_id": a.RunId, "simulation_time_s": a.SimulationTimeS, "input_session_id": a.InputSessionId, "snapshot_sequence": a.SnapshotSequence, "config_hash": a.ConfigHash, "model_version": a.ModelVersion, "metrics_version": a.MetricsVersion, "forecast_origin_source_s": origin, "input_quality": a.InputQuality, "forecasts": forecasts, "recommendation": recommendation, "alternatives": alternatives, "comparison": comparison}
}
func publicRecommendation(r *pb.Recommendation) map[string]any {
	changes := []any{}
	for _, c := range r.Changes {
		changes = append(changes, map[string]any{"node_id": c.NodeId, "phase_id": c.PhaseId, "green_s": c.GreenS, "offset_s": c.OffsetS})
	}
	return map[string]any{"recommendation_id": r.Id, "status": r.Status, "safety_status": r.SafetyStatus, "input_session_id": r.InputSessionId, "snapshot_sequence": r.SnapshotSequence, "config_hash": r.ConfigHash, "model_version": r.ModelVersion, "metrics_version": r.MetricsVersion, "changes": changes}
}
