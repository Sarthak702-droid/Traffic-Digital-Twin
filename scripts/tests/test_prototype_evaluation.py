"""E02 evidence gates: no self-labelled accuracy or fabricated future bins."""

import pytest

from scripts.prototype_evaluation import measurement_score, forecast_scores


CLIP = "a" * 64
GEOMETRY = "b" * 64
PROTOCOL = {"version":"test-protocol-v1", "measurement": {"count_total_abs_error_max_veh": 2,
                            "count_total_relative_error_max": 0.2,
                            "visible_queue_abs_error_max_veh": 2},
            "forecast": {"horizons_s": [30, 60, 120, 300],
                         "minimum_eligible_origins_per_horizon": 5},
            "control": {"primary_queue_delay_reduction_min": 0.05,
                        "boundary_exits_regression_max": 0.02,
                        "boundary_backlog_regression_max": 0.02,
                        "boundary_wait_regression_max": 0.02,
                        "spillback_exposure_regression_max": 0.02,
                        "worst_service_debt_regression_max": 0.1}}


def observation(start, count=1, session="source-1"):
    return {"camera_id": "CAM-12", "window_start_s": start, "window_end_s": start + 5,
            "available_at_source_s": start + 5, "processed_at_utc": "2026-09-26T10:00:00Z",
            "crossings_veh": count, "observation_status": "valid",
            "queue_visible_veh_estimate": 3, "queue_status": "estimated_visible_region",
            "source_identity": {"clip_sha256": CLIP, "geometry_sha256": GEOMETRY,
                                "source_session_id": session}}


def review():
    return {"status": "independently_reviewed", "camera_id": "CAM-12",
            "clip_sha256": CLIP, "geometry_sha256": GEOMETRY,
            "window_start_s": 5, "window_end_s": 10, "count_total": 4,
            "first_reviewer": "reviewer-a", "second_reviewer": "reviewer-b",
            "adjudicated_at_utc": "2026-09-27T00:00:00Z",
            "rights_reference": "user_authorized_internal_review",
            "source_session_id": "source-1", "split": "reserved", "split_protocol_version": "test-protocol-v1",
            "annotation_method_version": "manual-crossing-v1",
            "first_reviewed_at_utc": "2026-09-26T20:00:00Z",
            "second_reviewed_at_utc": "2026-09-26T21:00:00Z",
            "queue": {"status": "available", "count_veh": 2}}


def test_unreviewed_window_has_no_accuracy_number():
    result = measurement_score(observation(5, 5), None, PROTOCOL)
    assert result == {"status": "unavailable", "reason": "independent_review_missing"}


def test_reviewed_window_scores_count_and_supported_queue():
    result = measurement_score(observation(5, 5), review(), PROTOCOL)
    assert result["status"] == "available"
    assert result["count_abs_error_veh"] == 1
    assert result["count_pass"] is True
    assert result["queue_abs_error_veh"] == 1
    assert result["queue_pass"] is True


def test_review_identity_mismatch_is_rejected():
    wrong = review()
    wrong["geometry_sha256"] = "c" * 64
    with pytest.raises(ValueError, match="identity"):
        measurement_score(observation(5, 5), wrong, PROTOCOL)


def test_short_source_has_no_recorded_horizon_score_or_cross_session_target():
    rows = [observation(i * 5, i % 3) for i in range(4)]
    rows += [observation(i * 5, 50, "source-2") for i in range(4, 16)]
    result = forecast_scores(rows, PROTOCOL)
    assert all(row["status"] == "unavailable" for row in result["source-1"].values())
    assert all(row["eligible_origins"] == 0 for row in result["source-1"].values())


def test_future_bins_affect_target_not_prediction_at_earlier_origin():
    rows = [observation(i * 5, 1) for i in range(12)]
    normal = forecast_scores(rows, PROTOCOL, {"source-1": 5})
    changed = [dict(row) for row in rows]
    changed[5]["crossings_veh"] = 100
    future = forecast_scores(changed, PROTOCOL, {"source-1": 5})
    assert normal["source-1"][30]["first_origin_prediction_veh"] == future["source-1"][30]["first_origin_prediction_veh"]
    assert normal["source-1"][30]["first_origin_actual_veh"] != future["source-1"][30]["first_origin_actual_veh"]


def test_self_review_cannot_be_counted_as_independent_reference():
    same_person = review()
    same_person["second_reviewer"] = "reviewer-a"
    assert measurement_score(observation(5, 5), same_person, PROTOCOL) == {"status": "unavailable", "reason": "independent_review_missing"}


def test_out_of_order_history_is_rejected_instead_of_sorted_into_a_forecast():
    rows = [observation(5), observation(0), observation(10)]
    with pytest.raises(ValueError, match="Out-of-order"):
        forecast_scores(rows, PROTOCOL)


def test_processed_bundle_refuses_changed_observation_bytes(tmp_path):
    import hashlib
    import json
    from scripts.prototype_evaluation import load_processed_bundle

    rows = tmp_path / "observations.jsonl"
    rows.write_text(json.dumps(observation(5, 5)) + "\n")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "status": "complete", "camera_id": "CAM-12", "clip_sha256": CLIP,
        "geometry_sha256": GEOMETRY, "source_session_id": "source-1",
        "observations_sha256": hashlib.sha256(rows.read_bytes()).hexdigest()
    }))
    assert load_processed_bundle(manifest) == [observation(5, 5)]
    rows.write_text(rows.read_text().replace('"crossings_veh": 5', '"crossings_veh": 50'))
    with pytest.raises(ValueError, match="checksum"):
        load_processed_bundle(manifest)


def test_recorded_report_keeps_unreviewed_measurement_unavailable():
    from scripts.prototype_evaluation import build_recorded_report

    candidate = {"id": "candidate-difficult-01", "camera_id": "CAM-12",
                 "clip_sha256": CLIP, "geometry_sha256": GEOMETRY,
                 "window_start_source_s": 5, "window_end_source_s": 10,
                 "evaluation_split": "reserved"}
    result = build_recorded_report({"version": "prototype-evaluation-v1", **PROTOCOL},
                                   {"windows": [candidate]}, [observation(5, 5)], {})
    assert result["measurement"][0]["window_id"] == "candidate-difficult-01"
    assert result["measurement"][0]["status"] == "unavailable"
    assert result["measurement"][0]["reason"] == "independent_review_missing"
    assert all(item["status"] == "unavailable" for item in result["forecast"]["source-1"].values())


def test_recorded_cli_writes_partial_evidence_without_source_paths(tmp_path):
    import hashlib
    import json
    from scripts.prototype_evaluation import main

    bundle = tmp_path / "bundle"
    bundle.mkdir()
    rows = bundle / "observations.jsonl"
    rows.write_text(json.dumps(observation(5, 5)) + "\n")
    manifest = bundle / "manifest.json"
    manifest.write_text(json.dumps({
        "status": "complete", "camera_id": "CAM-12", "clip_sha256": CLIP,
        "geometry_sha256": GEOMETRY, "source_session_id": "source-1",
        "observations_sha256": hashlib.sha256(rows.read_bytes()).hexdigest(),
        "clip_path": "/private/source-video.mp4"
    }))
    candidates = tmp_path / "candidates.json"
    candidates.write_text(json.dumps({"windows": [{
        "id": "candidate-difficult-01", "camera_id": "CAM-12",
        "clip_sha256": CLIP, "geometry_sha256": GEOMETRY,
        "window_start_source_s": 5, "window_end_source_s": 10,
        "evaluation_split": "reserved"}]}))
    protocol = tmp_path / "protocol.json"
    protocol.write_text(json.dumps({"version": "prototype-evaluation-v1", **PROTOCOL}))
    output = tmp_path / "report.json"
    main(["--recorded-only", "--manifest", str(manifest), "--protocol", str(protocol),
          "--candidates", str(candidates), "--output", str(output)])
    report = json.loads(output.read_text())
    assert report["status"] == "partial_recorded_evidence"
    assert report["recorded"]["measurement"][0]["reason"] == "independent_review_missing"
    assert "/private/source-video.mp4" not in output.read_text()


def test_virtual_perturbation_preserves_valid_turning_ratios_and_changes_capacity():
    from services.shared.network_config import load_config
    from services.simulation.safety import validate_config
    from scripts.prototype_evaluation import perturbed_config

    base = load_config()
    variant = perturbed_config(base, "peak", {"internal_link_capacity_scale": 0.8,
                  "turning_ratio_shift": 0.1, "boundary_demand_scale": 1.1}, 120)
    validate_config(variant)
    internal = next(link["id"] for link in base["links"] if link["from_node"] == "C1" and link["to_node"] == "C3")
    original = next(link["storage_capacity_veh"] for link in base["links"] if link["id"] == internal)
    changed = next(link["storage_capacity_veh"] for link in variant["links"] if link["id"] == internal)
    assert changed == pytest.approx(original * 0.8)
    assert variant["scenarios"][0]["base_rate_vps"] == pytest.approx(base["scenarios"][0]["base_rate_vps"] * 1.1)
    assert variant["movements"] != base["movements"]


def test_virtual_origin_compares_plans_from_same_state_and_realized_demand(tmp_path):
    import twin_pb2 as pb
    from services.intelligence.model import Model
    from services.simulation.aggregate_engine import AggregateEngine
    from scripts.prototype_evaluation import sample_virtual_origin

    engine = AggregateEngine(directory=tmp_path)
    try:
        engine.reset(pb.RunCommand(schema_version="1.0", run_id="e02-case", mode="recommend",
                                   seed=1101, scenario_type="peak_surge"))
        for _ in range(45):
            engine.step()
        result = sample_virtual_origin(engine, Model(engine.config), 30, PROTOCOL)
        assert result["origin_simulation_s"] == 45
        assert set(result["plans"]) == {"fixed_timing", "local_adaptive", "coordinated"}
        assert len({entry["demand_trace_sha256"] for entry in result["plans"].values()}) == 1
        assert all(abs(entry["mass_residual_veh"]) < 1e-6 for entry in result["plans"].values())
        next_state = engine.step()
        assert result["first_tick_offered_veh"] == pytest.approx(
            next_state.cumulative_demand_veh - result["origin_cumulative_demand_veh"])
    finally:
        engine.close()


def test_virtual_case_replays_a_declared_origin_and_preserves_world_mass(tmp_path):
    from services.shared.network_config import ROOT
    from scripts.prototype_evaluation import run_virtual_case

    result = run_virtual_case(ROOT / "packages/scenario-config/c1-c6.json", 4404, "peak",
                              {"id": "low_capacity", "internal_link_capacity_scale": 0.8,
                               "turning_ratio_shift": 0.1, "boundary_demand_scale": 1.1},
                              {"synthetic": {"run_duration_s": 60, "warmup_s": 30},
                               "control": {**PROTOCOL["control"], "comparison_window_s": 30}},
                              tmp_path)
    assert result["seed"] == 4404
    assert result["world_config_hash"]
    assert len(result["origins"]) == 1
    assert abs(result["world_mass_residual_veh"]) < 1e-6
    assert result["origins"][0]["origin_simulation_s"] == 30


def test_virtual_suite_runs_declared_cross_product_without_dropping_failures(tmp_path):
    from scripts.prototype_evaluation import run_virtual_suite

    protocol = {
        "synthetic": {"graphs": ["c1-c6.json"], "held_out_seeds": [4404],
                      "conditions": ["peak"], "held_out_perturbations": [
                          {"id": "low_capacity", "internal_link_capacity_scale": 0.8,
                           "turning_ratio_shift": 0.1, "boundary_demand_scale": 1.1}],
                      "run_duration_s": 60, "warmup_s": 30},
        "control": {**PROTOCOL["control"], "comparison_window_s": 30,
                    "minimum_improved_eligible_cases_fraction": 0.5}}
    report = run_virtual_suite(protocol, tmp_path)
    assert report["target_type"] == "synthetic_model"
    assert report["declared_cases"] == 1
    assert len(report["cases"]) == 1
    assert report["eligible_origins"] == 1
    assert report["failed_cases"] == 0


def test_full_cli_executes_virtual_cases_and_keeps_other_gates_open(tmp_path):
    import json
    from scripts.prototype_evaluation import main

    protocol = {"version": "prototype-evaluation-v1",
                "synthetic": {"graphs": ["c1-c6.json"], "held_out_seeds": [4404],
                              "conditions": ["peak"], "held_out_perturbations": [
                                  {"id": "low_capacity", "internal_link_capacity_scale": 0.8,
                                   "turning_ratio_shift": 0.1, "boundary_demand_scale": 1.1}],
                              "run_duration_s": 60, "warmup_s": 30},
                "control": {**PROTOCOL["control"], "comparison_window_s": 30,
                            "minimum_improved_eligible_cases_fraction": 0.5},
                "forecast": PROTOCOL["forecast"], "measurement": PROTOCOL["measurement"]}
    config = tmp_path / "protocol.json"
    config.write_text(json.dumps(protocol))
    candidates = tmp_path / "candidates.json"
    candidates.write_text(json.dumps({"windows": []}))
    output = tmp_path / "report.json"
    main(["--full", "--protocol", str(config), "--candidates", str(candidates),
          "--output", str(output)])
    report = json.loads(output.read_text())
    assert report["status"] == "benchmark_executed_with_open_gates"
    assert report["virtual_control"]["declared_cases"] == 1
    assert report["resources"]["status"] == "not_run"


def test_cli_process_loads_generated_contracts_without_pytest_pythonpath(tmp_path):
    import json
    import os
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    protocol = json.loads((root / "packages/scenario-config/prototype-evaluation-v1.json").read_text())
    protocol["synthetic"].update(graphs=["c1-c6.json"], held_out_seeds=[4404],
                                 conditions=["peak"], run_duration_s=60, warmup_s=30,
                                 held_out_perturbations=protocol["synthetic"]["held_out_perturbations"][:1])
    protocol["control"]["comparison_window_s"] = 30
    config = tmp_path / "protocol.json"
    config.write_text(json.dumps(protocol))
    candidates = tmp_path / "candidates.json"
    candidates.write_text(json.dumps({"windows": []}))
    output = tmp_path / "report.json"
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    run = subprocess.run([sys.executable, str(root / "scripts/evaluate-prototype.py"),
                          "--full", "--protocol", str(config), "--candidates", str(candidates),
                          "--output", str(output)], cwd=root, env=env, capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert json.loads(output.read_text())["virtual_control"]["failed_cases"] == 0


def test_emergency_origin_does_not_claim_recovery_without_route_measurement(tmp_path):
    import twin_pb2 as pb
    from services.intelligence.model import Model
    from services.simulation.aggregate_engine import AggregateEngine
    from scripts.prototype_evaluation import sample_virtual_origin

    engine = AggregateEngine(directory=tmp_path)
    try:
        engine.reset(pb.RunCommand(schema_version="1.0", run_id="emergency-e02", mode="recommend",
                                   seed=3303, scenario_type="ambulance_corridor"))
        for _ in range(30):
            engine.step()
        result = sample_virtual_origin(engine, Model(engine.config), 30, PROTOCOL, "emergency")
        assert result["emergency_recovery_availability"] == "unavailable_no_matched_route_metric"
        assert result["pass"] is False
    finally:
        engine.close()


def test_review_without_rights_provenance_is_unavailable():
    incomplete = review()
    del incomplete["rights_reference"]
    assert measurement_score(observation(5, 5), incomplete, PROTOCOL) == {"status": "unavailable", "reason": "independent_review_missing"}


def test_long_recording_without_frozen_chronological_split_has_no_score():
    rows = [observation(i * 5, 1) for i in range(12)]
    result = forecast_scores(rows, PROTOCOL)
    horizon = result["source-1"][30]
    assert horizon["status"] == "unavailable"
    assert horizon["reason"] == "chronological_split_not_frozen"
    assert "active_mae_veh" not in horizon


def test_insufficient_later_windows_do_not_publish_partial_forecast_score():
    rows = [observation(i * 5, 1) for i in range(7)]
    result = forecast_scores(rows, PROTOCOL, {"source-1": 5})["source-1"][30]
    assert result["status"] == "unavailable"
    assert result["eligible_origins"] == 1
    assert "first_origin_prediction_veh" not in result
    assert "active_mae_veh" not in result


def test_emergency_diagnostic_measures_real_route_flow_and_censored_recovery(tmp_path):
    from scripts.prototype_evaluation import emergency_plan_metrics
    from services.simulation.aggregate_engine import AggregateEngine
    import twin_pb2 as pb
    engine = AggregateEngine(directory=tmp_path / 'live')
    try:
        state = engine.reset(pb.RunCommand(schema_version='1.0', run_id='emergency-metric',
            scenario_type='ambulance_corridor', seed=1101, mode='recommend'))
        for _ in range(120): state = engine.step()
        plan = {p.phase_id:p.green_s for p in state.active_plan}
        short = emergency_plan_metrics(engine, plan, 5)
        assert short['status'] == 'available'
        assert short['route_service_target'] == 'aggregate_route_traffic_not_ambulance_travel'
        assert short['recovery_status'] == 'censored_at_window_end'
        assert short['recovery_time_s'] is None
        assert short['route_departures_veh'] >= 0
        assert short['route_green_service_node_s'] >= 0
        long = emergency_plan_metrics(engine, plan, 500)
        assert long['recovery_status'] == 'completed'
        assert long['recovery_time_s'] > 0
        assert long['recovery_completed_at_simulation_s'] > long['recovery_started_at_simulation_s']
        assert engine.tick == 120  # Diagnostics cannot advance the live world.
    finally:
        engine.close()

@pytest.mark.parametrize('change',[{'split':'invented'},{'split_protocol_version':'different'},{'first_reviewed_at_utc':'2999-01-01T00:00:00Z'}])
def test_reference_split_and_actual_review_times_required(change):
    record=review();record.update(change)
    assert measurement_score(observation(5),record,PROTOCOL)['status']=='unavailable'

def test_emergency_recovery_observation_does_not_extend_matched_flow_window(tmp_path):
    from scripts.prototype_evaluation import emergency_plan_metrics
    from services.simulation.aggregate_engine import AggregateEngine
    import twin_pb2 as pb
    engine=AggregateEngine(directory=tmp_path/'live')
    try:
        state=engine.reset(pb.RunCommand(schema_version='1.0',run_id='separate-recovery',scenario_type='ambulance_corridor',seed=1101,mode='recommend'))
        for _ in range(30):state=engine.step()
        plan={p.phase_id:p.green_s for p in state.active_plan}
        short=emergency_plan_metrics(engine,plan,30)
        observed=emergency_plan_metrics(engine,plan,30,recovery_observation_end_s=600)
        assert short['recovery_status']=='censored_at_window_end'
        assert observed['recovery_status']=='completed'
        assert observed['window_end_simulation_s']==short['window_end_simulation_s']==60
        assert observed['route_departures_veh']==short['route_departures_veh']
        assert observed['route_green_service_node_s']==short['route_green_service_node_s']
        assert observed['recovery_observation_end_simulation_s']>60
        assert engine.tick==30
    finally:engine.close()

@pytest.mark.parametrize('graph',['c1-c6','three-controlled-junctions'])
def test_zero_delay_no_action_is_not_a_normal_benefit_pass(tmp_path,graph):
    import json
    import twin_pb2 as pb
    from scripts.prototype_evaluation import sample_virtual_origin
    from services.intelligence.model import Model
    from services.shared.network_config import ROOT,load_config
    from services.simulation.aggregate_engine import AggregateEngine
    config=load_config(ROOT/'packages/scenario-config'/f'{graph}.json')
    for scenario in config['scenarios']:
        for key in ('base_rate_vps','feeder_rate_vps','surge_rate_vps'):scenario[key]=.001
    path=tmp_path/'world.json';path.write_text(json.dumps(config))
    engine=AggregateEngine(config_path=path,directory=tmp_path/'runtime')
    try:
        engine.reset(pb.RunCommand(schema_version='1.0',run_id='zero-delay-regression',scenario_type='peak_surge',seed=1101,mode='recommend'))
        for _ in range(120):engine.step()
        result=sample_virtual_origin(engine,Model(config),120,PROTOCOL,condition='off_peak')
        assert result['analysis_outcome']=='no_action'
        assert result['plans']['fixed_timing']['queue_delay_veh_s']==0
        assert not result['pass']
        assert 'no_action_is_not_an_improvement' in result['benefit_failures']['coordinated']
        assert 'zero_reference_delay_has_no_percentage_gain' in result['benefit_failures']['fixed_timing']
    finally:engine.close()

@pytest.mark.parametrize('residual',[None,float('nan'),float('inf')])
def test_missing_or_nonfinite_mass_evidence_cannot_qualify(residual):
    from scripts.prototype_evaluation import control_benefit_failures
    base={'status':'available','mass_residual_veh':0,'queue_delay_veh_s':100,
          'boundary_exits_veh':10,'boundary_backlog_veh':0,'boundary_wait_veh_s':0,
          'spillback_exposure_link_s':0,'worst_service_debt_s':10}
    candidate={**base,'queue_delay_veh_s':90}
    if residual is None:candidate.pop('mass_residual_veh')
    else:candidate['mass_residual_veh']=residual
    failures=control_benefit_failures({'fixed_timing':base,'local_adaptive':base,'coordinated':candidate},'recommend',PROTOCOL['control'])
    assert failures['coordinated']==['mass_conservation_failure']

@pytest.mark.parametrize('queue',[None,float('nan'),float('inf')])
def test_invalid_delay_evidence_cannot_prove_percentage_gain(queue):
    from scripts.prototype_evaluation import control_benefit_failures
    base={'status':'available','mass_residual_veh':0,'queue_delay_veh_s':100,
          'boundary_exits_veh':10,'boundary_backlog_veh':0,'boundary_wait_veh_s':0,
          'spillback_exposure_link_s':0,'worst_service_debt_s':10}
    plans={'fixed_timing':base,'local_adaptive':base,'coordinated':{**base,'queue_delay_veh_s':queue}}
    assert control_benefit_failures(plans,'recommend',PROTOCOL['control'])['coordinated']==['invalid_metric_evidence:queue_delay_veh_s']

def test_real_positive_improvement_still_qualifies_with_original_limits():
    from scripts.prototype_evaluation import control_benefit_failures
    base={'status':'available','mass_residual_veh':0,'queue_delay_veh_s':100,
          'boundary_exits_veh':10,'boundary_backlog_veh':0,'boundary_wait_veh_s':0,
          'spillback_exposure_link_s':0,'worst_service_debt_s':10}
    plans={'fixed_timing':base,'local_adaptive':base,'coordinated':{**base,'queue_delay_veh_s':90}}
    assert not any(control_benefit_failures(plans,'recommend',PROTOCOL['control']).values())
