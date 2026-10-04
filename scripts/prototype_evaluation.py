"""Review-gated recorded measurement and causal forecast scoring for E02."""

from __future__ import annotations

from collections import defaultdict
import hashlib
import json
from pathlib import Path
import stat
from datetime import datetime, timezone
from math import isfinite

from services.intelligence.forecast_demand import CausalForecaster


def _identity(row):
    source = row.get("source_identity", {})
    return (row.get("camera_id"), source.get("clip_sha256"),
            source.get("geometry_sha256"), source.get("source_session_id"))


def measurement_score(observation, review, protocol, expected_split=None):
    """Score only an adjudicated, identity-matched source window."""
    if (review is None or review.get("status") != "independently_reviewed" or
            not review.get("first_reviewer") or not review.get("second_reviewer") or
            review["first_reviewer"] == review["second_reviewer"] or
            not all(review.get(key) for key in ("adjudicated_at_utc", "rights_reference",
                    "annotation_method_version", "first_reviewed_at_utc",
                    "second_reviewed_at_utc", "source_session_id", "split", "split_protocol_version"))):
        return {"status": "unavailable", "reason": "independent_review_missing"}
    try:
        times=[datetime.fromisoformat(review[key].replace('Z','+00:00')) for key in ('first_reviewed_at_utc','second_reviewed_at_utc','adjudicated_at_utc')]
        if any(t.tzinfo is None for t in times) or max(times[:2])>times[2] or max(times)>datetime.now(timezone.utc) or review['split'] not in ('tuning','reserved','held_out') or (expected_split is not None and review['split']!=expected_split) or review['split_protocol_version']!=protocol.get('version'):raise ValueError('Invalid review times')
    except (TypeError,ValueError):
        return {"status":"unavailable","reason":"independent_review_metadata_invalid"}
    source_id = _identity(observation)
    reference_id = (review.get("camera_id"), review.get("clip_sha256"),
                    review.get("geometry_sha256"), review.get("source_session_id"))
    if source_id != reference_id or any(
        observation.get(key) != review.get(key)
        for key in ("window_start_s", "window_end_s")
    ):
        raise ValueError("Reference identity differs from observation")
    if observation.get("observation_status") != "valid":
        return {"status": "unavailable", "reason": "observation_not_valid"}
    observed, reference = observation.get("crossings_veh"), review.get("count_total")
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or
           not isfinite(value) or value < 0 for value in (observed, reference)):
        raise ValueError("Invalid nonnegative count")
    criteria = protocol["measurement"]
    error = abs(observed - reference)
    result = {"status": "available", "count_abs_error_veh": error,
              "count_signed_error_veh": observed - reference,
              "count_pass": error <= max(criteria["count_total_abs_error_max_veh"],
                                         criteria["count_total_relative_error_max"] * reference),
              "queue_abs_error_veh": None, "queue_pass": None,
              "queue_availability": "unsupported_reference"}
    queue = review.get("queue") or {}
    if queue.get("status") == "available":
        estimate = observation.get("queue_visible_veh_estimate")
        if observation.get("queue_status") not in ("estimated_visible_region", "valid") or estimate is None:
            result["queue_availability"] = "observation_unavailable"
        else:
            if any(not isinstance(value, (int, float)) or isinstance(value, bool) or
                   not isfinite(value) or value < 0 for value in (estimate, queue.get("count_veh"))):
                raise ValueError("Invalid nonnegative queue count")
            result["queue_abs_error_veh"] = abs(estimate - queue["count_veh"])
            result["queue_pass"] = result["queue_abs_error_veh"] <= criteria["visible_queue_abs_error_max_veh"]
            result["queue_availability"] = "available"
    return result


def _completed_at(row):
    raw = row["processed_at_utc"].replace("Z", "+00:00")
    value = datetime.fromisoformat(raw)
    if value.tzinfo is None:
        raise ValueError("Processing completion must include a timezone")
    return value


def forecast_scores(observations, protocol, reserved_origin_by_session=None):
    """Use each session's completed, non-overlapping windows; never fill missing targets."""
    groups = defaultdict(list)
    for row in observations:
        if row.get("observation_status") != "valid":
            continue
        camera, clip, geometry, session = _identity(row)
        if not all((camera, clip, geometry, session)):
            raise ValueError("Forecast source identity is incomplete")
        groups[session].append(row)
    output = {}
    for session, rows in groups.items():
        if any(rows[index]["window_start_s"] >= rows[index + 1]["window_start_s"]
               for index in range(len(rows) - 1)):
            raise ValueError("Out-of-order finalized history")
        if any(row["window_end_s"] <= row["window_start_s"] or
               row["available_at_source_s"] < row["window_end_s"] for row in rows):
            raise ValueError("Invalid finalized window")
        if any(rows[index]["window_end_s"] > rows[index + 1]["window_start_s"]
               for index in range(len(rows) - 1)):
            raise ValueError("Overlapping finalized windows")
        if len({_identity(row) for row in rows}) != 1:
            raise ValueError("Mixed source identity within session")
        scores = {}
        for horizon in protocol["forecast"]["horizons_s"]:
            if reserved_origin_by_session is None or session not in reserved_origin_by_session:
                scores[horizon] = {"status": "unavailable", "eligible_origins": 0,
                                   "target_type": "detector_derived",
                                   "reason": "chronological_split_not_frozen"}
                continue
            reserved_start = reserved_origin_by_session[session]
            pairs = []
            for index, origin in enumerate(rows):
                start = origin["window_end_s"]
                if start < reserved_start:
                    continue
                target_end = start + horizon
                target = []
                cursor = start
                for later in rows[index + 1:]:
                    if later["window_start_s"] != cursor or later["window_end_s"] > target_end:
                        break
                    target.append(later)
                    cursor = later["window_end_s"]
                    if cursor == target_end:
                        break
                if cursor != target_end:
                    continue
                forecaster = CausalForecaster()
                eligible = [row for row in rows[:index + 1]
                            if row["available_at_source_s"] <= start and
                            _completed_at(row) <= _completed_at(origin)]
                if not eligible or eligible[-1] is not origin:
                    continue
                for row in eligible:
                    span = row["window_end_s"] - row["window_start_s"]
                    forecaster.update(session, row["crossings_veh"] * 60 / span)
                projected = forecaster.forecast_link(session)
                predicted = projected.active_forecast[horizon] * horizon / 60
                persistence = projected.baseline_persistence[horizon] * horizon / 60
                actual = sum(row["crossings_veh"] for row in target)
                pairs.append((predicted, persistence, actual))
            minimum = protocol["forecast"]["minimum_eligible_origins_per_horizon"]
            item = {"status": "available" if len(pairs) >= minimum else "unavailable",
                    "eligible_origins": len(pairs), "target_type": "detector_derived"}
            if len(pairs) >= minimum:
                item["first_origin_prediction_veh"] = pairs[0][0]
                item["first_origin_actual_veh"] = pairs[0][2]
                item["active_mae_veh"] = sum(abs(pred - actual) for pred, _, actual in pairs) / len(pairs)
                item["persistence_mae_veh"] = sum(abs(base - actual) for _, base, actual in pairs) / len(pairs)
                item["active_bias_veh"] = sum(pred - actual for pred, _, actual in pairs) / len(pairs)
            else:
                item["reason"] = "insufficient_later_finalized_windows"
            scores[horizon] = item
        output[session] = scores
    return output


def load_processed_bundle(manifest_path):
    """Read a completed local bundle after checking byte identity and source epoch."""
    manifest_path = Path(manifest_path)
    if not stat.S_ISREG(manifest_path.lstat().st_mode):
        raise ValueError("Manifest must be a regular file")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("status") != "complete":
        raise ValueError("Processed bundle is not complete")
    path = manifest_path.parent / "observations.jsonl"
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("Observations must be a regular file")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != manifest.get("observations_sha256"):
        raise ValueError("Observation checksum differs from manifest")
    rows = [json.loads(line) for line in data.splitlines() if line.strip()]
    if len(rows) != manifest.get("window_count", len(rows)):
        raise ValueError("Observation window count differs from manifest")
    for row in rows:
        camera, clip, geometry, session = _identity(row)
        if (camera, clip, geometry, session) != (manifest.get("camera_id"),
                manifest.get("clip_sha256"), manifest.get("geometry_sha256"),
                manifest.get("source_session_id")):
            raise ValueError("Observation identity differs from manifest")
    return rows


def build_recorded_report(protocol, candidates, observations, reviews):
    """Assemble scored or explicitly unavailable reserved/tuning evidence."""
    measurement = []
    for window in candidates["windows"]:
        matched = [row for row in observations
                   if row.get("camera_id") == window["camera_id"]
                   and row.get("source_identity", {}).get("clip_sha256") == window["clip_sha256"]
                   and row.get("source_identity", {}).get("geometry_sha256") == window["geometry_sha256"]
                   and row.get("window_start_s") == window["window_start_source_s"]
                   and row.get("window_end_s") == window["window_end_source_s"]]
        if len(matched) > 1:
            raise ValueError(f"Ambiguous source session for {window['id']}")
        result = ({"status": "unavailable", "reason": "processed_observation_missing"}
                  if not matched else measurement_score(matched[0], reviews.get(window["id"]), protocol, expected_split=window["evaluation_split"]))
        measurement.append({"window_id": window["id"], "split": window["evaluation_split"], **result})
    return {"protocol_version": protocol["version"], "measurement": measurement,
            "forecast": forecast_scores(observations, protocol,
                                        protocol["forecast"].get("reserved_origin_by_session"))}


def main(argv=None):
    """Run recorded scoring and optional synthetic comparison with open gates labelled."""
    import argparse
    from datetime import timezone

    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Evaluate prototype evidence")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--recorded-only", action="store_true")
    mode.add_argument("--full", action="store_true")
    parser.add_argument("--manifest", action="append", type=Path, default=[])
    parser.add_argument("--protocol", type=Path,
                        default=root / "packages/scenario-config/prototype-evaluation-v1.json")
    parser.add_argument("--candidates", type=Path,
                        default=root / "packages/reference-samples/candidate-windows-v1.json")
    parser.add_argument("--reviews", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    protocol = json.loads(args.protocol.read_text())
    candidates = json.loads(args.candidates.read_text())
    reviews = json.loads(args.reviews.read_text()) if args.reviews else {}
    observations = [row for path in args.manifest for row in load_processed_bundle(path)]
    virtual = (run_virtual_suite(protocol, args.output.parent / f".{args.output.stem}-cases")
               if args.full else {"status": "not_run"})
    result = {"status": "benchmark_executed_with_open_gates" if args.full else "partial_recorded_evidence",
              "generated_at_utc": datetime.now(timezone.utc).isoformat(),
              "recorded": build_recorded_report(protocol, candidates, observations, reviews),
              "virtual_control": virtual,
              "resources": {"status": "not_run"},
              "independent_operator": {"status": "not_run"}}
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def perturbed_config(base, condition, perturbation, warmup_s):
    """Build a separately hashed, valid synthetic world without mutating base."""
    import copy
    from services.simulation.safety import validate_config

    config = copy.deepcopy(base)
    nodes = {node["id"]: node for node in config["nodes"]}
    for link in config["links"]:
        if (nodes[link["from_node"]]["kind"] != "boundary" and
                nodes[link["to_node"]]["kind"] != "boundary"):
            link["storage_capacity_veh"] *= perturbation["internal_link_capacity_scale"]
    by_incoming = defaultdict(list)
    for movement in config["movements"]:
        by_incoming[movement["incoming_link_id"]].append(movement)
    for group in by_incoming.values():
        if len(group) < 2:
            continue
        first = group[0]
        old = first["turning_ratio"]
        revised = min(1 - 0.01 * (len(group) - 1),
                      max(0.01, old + perturbation["turning_ratio_shift"]))
        first["turning_ratio"] = revised
        for movement in group[1:]:
            movement["turning_ratio"] *= (1 - revised) / (1 - old)
    for scenario in config["scenarios"]:
        for key in ("base_rate_vps", "feeder_rate_vps", "surge_rate_vps"):
            scenario[key] *= perturbation["boundary_demand_scale"]
            if condition == "off_peak":
                scenario[key] *= 0.5
            elif condition == "no_benefit":
                scenario[key] = 0.001
        if condition == "emergency" and scenario["id"] == "ambulance_corridor":
            scenario["emergency_depart_s"] = max(0, warmup_s - 5)
    validate_config(config)
    return config


def _within_regression(candidate, baseline, key, fraction, lower_is_better=True):
    value, reference = candidate[key], baseline[key]
    if lower_is_better:
        return value <= reference * (1 + fraction) + 1e-9
    return value + 1e-9 >= reference * (1 - fraction)


def emergency_plan_metrics(live, plan, horizon_s, trace=None):
    """Tuning diagnostic of aggregate route service and actual model recovery.

    Replay the same configured seeded world to the complete origin, then use the
    same realized boundary trace for every policy. This is not ambulance travel
    time, independent footage evidence, or an operating future-demand input.
    """
    import copy
    import tempfile
    import twin_pb2 as pb
    from services.simulation.aggregate_engine import AggregateEngine

    if horizon_s <= 0 or live.command.scenario_type != 'ambulance_corridor':
        raise ValueError('Emergency metric requires an emergency comparison window')
    origin = int(live.tick)
    future = copy.deepcopy(live.demand)
    trace = trace if trace is not None else [future.next(origin + tick) for tick in range(1, horizon_s + 1)]
    if len(trace) != horizon_s:
        raise ValueError('Emergency comparison trace must cover the entire window')
    scenario = live.scenario
    route = scenario['route_node_ids']
    route_moves = {mid for mid, move in live.moves.items()
        if any(move['node_id'] == node and live.links[move['incoming_link_id']]['from_node'] == previous
               and live.links[move['outgoing_link_id']]['to_node'] == following
               for previous, node, following in zip(route, route[1:], route[2:]))}
    if not route_moves:
        raise ValueError('Emergency route has no configured controlled movement')
    with tempfile.TemporaryDirectory(prefix='traffic-emergency-metric-') as directory:
        config = Path(directory) / 'world.json'
        config.write_text(json.dumps(live.config))
        engine = AggregateEngine(config_path=config, directory=Path(directory) / 'runtime')
        try:
            state = engine.reset(live.command)
            recovery_start = recovery_end = None
            def observe_recovery(frame):
                nonlocal recovery_start, recovery_end
                if frame.emergency.status == 'recovery' and recovery_start is None:
                    recovery_start = frame.simulation_time_s
                if (recovery_start is not None and recovery_end is None
                    and frame.emergency.status == 'complete' and not engine.scheduler.priority
                    and not engine.scheduler.recovering):
                    recovery_end = frame.simulation_time_s
            for _ in range(origin):
                state = engine.step()
                observe_recovery(state)
            if engine.snapshot_internal() != live.snapshot_internal():
                raise ValueError('Emergency benchmark origin is not the same complete seeded state')
            current = {change.phase_id: change.green_s for change in state.active_plan}
            if plan != current:
                engine.apply_plan(pb.PlanCommand(run_id=state.run_id, command_id='metric-plan',
                    expected_input_session_id=state.input_session_id,
                    expected_snapshot_sequence=state.snapshot_sequence,
                    changes=[pb.TimingChange(node_id=engine.index.phases[phase]['node_id'], phase_id=phase, green_s=green)
                             for phase, green in plan.items()]))
            class TraceDemand:
                def next(self, tick):
                    return dict(trace[tick - origin - 1])
            engine.demand = TraceDemand()
            departed = sum(engine.movement_departures[mid] for mid in route_moves)
            green_service = 0
            for _ in range(horizon_s):
                green_service += sum(mid in signal.permitted_movement_ids for mid in route_moves for signal in engine.signal_states)
                state = engine.step()
                observe_recovery(state)
            return {'status': 'available', 'route_service_target': 'aggregate_route_traffic_not_ambulance_travel',
                'route_departures_veh': sum(engine.movement_departures[mid] for mid in route_moves) - departed,
                'route_green_service_node_s': green_service,
                'recovery_status': 'completed' if recovery_end is not None else 'censored_at_window_end',
                'recovery_time_s': recovery_end - recovery_start if recovery_end is not None else None,
                'recovery_started_at_simulation_s': recovery_start,
                'recovery_completed_at_simulation_s': recovery_end,
                'window_start_simulation_s': origin, 'window_end_simulation_s': origin + horizon_s,
                'measurement_scope': 'synthetic authorized-request lifecycle; recovery observed from request start; route flow during matched window'}
        finally:
            engine.close()


def sample_virtual_origin(engine, model, horizon_s, protocol, condition="peak"):
    """Choose plans causally, then score each on one copied future demand trace."""
    import copy

    state = engine.copy_state()
    current = model.plan(state)
    decision_state = copy.deepcopy(state)
    if condition == "degraded_input":
        decision_state.demand_source = "video_profile"
        decision_state.input_quality = "stale"
    analysis = model.analyze(decision_state)
    future = copy.deepcopy(engine.demand)
    trace = [future.next(int(state.simulation_time_s) + tick)
             for tick in range(1, horizon_s + 1)]
    trace_hash = hashlib.sha256(json.dumps(trace, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    evaluation = {**model._evaluation_input(state), "demand_trace": trace}
    try:
        local = model.allocate(state)
    except ValueError:
        local = current
    coordinated = ({change.phase_id: change.green_s for change in analysis.recommendation.changes}
                   if analysis.outcome == "recommend" else current)
    coordinated_offsets=({c.node_id:c.offset_s for c in analysis.recommendation.changes} if analysis.outcome=='recommend' else {})
    plans = {}
    for name, plan in (("fixed_timing", current), ("local_adaptive", local),
                       ("coordinated", coordinated)):
        try:
            score = model.rollout(state, plan, horizon_s, evaluation, offsets=coordinated_offsets if name=="coordinated" else None)
            plans[name] = {"status": "available", "demand_trace_sha256": trace_hash,
                           "queue_delay_veh_s": score["queue_delay"],
                           "boundary_exits_veh": score["throughput"],
                           "boundary_backlog_veh": score["backlog"],
                           "boundary_wait_veh_s": score["boundary_wait"],
                           "spillback_exposure_link_s": score["congested"],
                           "worst_service_debt_s": score["worst_service_debt"],
                           "timing_change_s": sum(abs(plan[key] - current[key]) for key in plan),
                           "offered_external_veh": score["offered_external_veh"],
                           "mass_residual_veh": score["mass_residual_veh"]}
        except ValueError as exc:
            plans[name] = {"status": "cannot_evaluate", "reason": str(exc),
                           "demand_trace_sha256": trace_hash}
    result = {"origin_simulation_s": state.simulation_time_s,
              "origin_cumulative_demand_veh": state.cumulative_demand_veh,
              "first_tick_offered_veh": sum(trace[0].values()),
              "input_quality": decision_state.input_quality,
              "analysis_outcome": analysis.outcome,
              "analysis_reason": analysis.outcome_reason,
              "plans": plans}
    if condition in ("degraded_input", "no_benefit"):
        result["pass"] = analysis.outcome != "recommend"
        return result
    if condition == "emergency":
        result["emergency_status"] = state.emergency.status if state.HasField("emergency") else "missing"
        if protocol.get('emergency_metrics') == 'aggregate-route-service-v1':
            metrics = {}
            for name, plan in (("fixed_timing", current), ("local_adaptive", local), ("coordinated", coordinated)):
                try:
                    metrics[name] = emergency_plan_metrics(engine, plan, horizon_s, trace)
                except ValueError as error:
                    metrics[name] = {'status': 'cannot_evaluate', 'reason': str(error)}
            result['emergency_metrics'] = metrics
            result['emergency_recovery_availability'] = 'completed' if all(item.get('recovery_status') == 'completed' for item in metrics.values()) else 'censored_or_rejected'
            result['pass'] = all(item.get('status') == 'available' and item.get('recovery_status') == 'completed' for item in metrics.values())
        else:
            result["emergency_recovery_availability"] = "unavailable_no_matched_route_metric"
            result["pass"] = False
        return result
    if any(item["status"] != "available" or abs(item["mass_residual_veh"]) >= 1e-6
           for item in plans.values()):
        result["pass"] = False
        return result
    candidate = plans["coordinated"]
    criteria = protocol["control"]
    result["pass"] = all(
        candidate["queue_delay_veh_s"] <=
        baseline["queue_delay_veh_s"] * (1 - criteria["primary_queue_delay_reduction_min"]) + 1e-9
        and _within_regression(candidate, baseline, "boundary_exits_veh",
                               criteria["boundary_exits_regression_max"], False)
        and _within_regression(candidate, baseline, "boundary_backlog_veh",
                               criteria["boundary_backlog_regression_max"])
        and _within_regression(candidate, baseline, "boundary_wait_veh_s",
                               criteria["boundary_wait_regression_max"])
        and _within_regression(candidate, baseline, "spillback_exposure_link_s",
                               criteria["spillback_exposure_regression_max"])
        and _within_regression(candidate, baseline, "worst_service_debt_s",
                               criteria["worst_service_debt_regression_max"])
        for baseline in (plans["fixed_timing"], plans["local_adaptive"])
    )
    return result


def run_virtual_case(graph_path, seed, condition, perturbation, protocol, workspace):
    """Replay the fixed seeded world and score four causal origins by default."""
    import twin_pb2 as pb
    from services.intelligence.model import Model
    from services.shared.network_config import config_hash, load_config
    from services.simulation.aggregate_engine import AggregateEngine

    scenario_id = {"peak": "peak_surge", "off_peak": "peak_surge",
                   "incident": "incident_c3", "emergency": "ambulance_corridor",
                   "degraded_input": "peak_surge", "no_benefit": "peak_surge"}[condition]
    duration = protocol["synthetic"]["run_duration_s"]
    warmup = protocol["synthetic"]["warmup_s"]
    horizon = protocol["control"]["comparison_window_s"]
    if horizon <= 0 or warmup < 0 or duration < warmup + horizon:
        raise ValueError("Virtual benchmark has no complete comparison window")
    config = perturbed_config(load_config(graph_path), condition, perturbation, warmup)
    workspace = Path(workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    config_path = workspace / "world-config.json"
    config_path.write_text(json.dumps(config, sort_keys=True))
    engine = AggregateEngine(config_path=config_path, directory=workspace / "runtime")
    try:
        run_id = f"e02-{Path(graph_path).stem}-{condition}-{seed}-{perturbation['id']}"
        engine.reset(pb.RunCommand(schema_version="1.0", run_id=run_id,
                                   scenario_type=scenario_id, seed=seed, mode="recommend"))
        model = Model(config)
        origins = []
        worst_residual = 0.0
        for tick in range(duration + 1):
            if tick:
                state = engine.step()
                residual = (state.cumulative_demand_veh -
                            sum(link.stock_veh for link in state.links) -
                            state.boundary_backlog_veh -
                            state.cumulative_boundary_exits_veh)
                worst_residual = max(worst_residual, abs(residual))
            if tick >= warmup and tick + horizon <= duration and (tick - warmup) % horizon == 0:
                origins.append(sample_virtual_origin(engine, model, horizon, protocol, condition))
        return {"graph": Path(graph_path).name, "seed": seed,
                "condition": condition, "perturbation": perturbation["id"],
                "world_config_hash": config_hash(config),
                "world_mass_residual_veh": worst_residual,
                "origins": origins}
    finally:
        engine.close()


def run_virtual_suite(protocol, workspace):
    """Execute every frozen graph, seed, condition, and perturbation."""
    from itertools import product

    root = Path(__file__).resolve().parents[1]
    synthetic = protocol["synthetic"]
    dimensions = list(product(synthetic["graphs"], synthetic["held_out_seeds"],
                              synthetic["conditions"], synthetic["held_out_perturbations"]))
    cases = []
    for graph, seed, condition, perturbation in dimensions:
        case_id = f"{Path(graph).stem}-{seed}-{condition}-{perturbation['id']}"
        try:
            result = run_virtual_case(root / "packages/scenario-config" / graph,
                                      seed, condition, perturbation, protocol,
                                      Path(workspace) / case_id)
            cases.append({"case_id": case_id, "status": "completed", **result})
        except Exception as exc:
            cases.append({"case_id": case_id, "status": "failed",
                          "error_type": type(exc).__name__, "reason": str(exc)})
    eligible = [origin for case in cases if case["status"] == "completed"
                and case["condition"] in ("peak", "off_peak", "incident")
                for origin in case["origins"]]
    improved = sum(bool(origin["pass"]) for origin in eligible)
    guarded = all(origin["pass"] for case in cases if case["status"] == "completed"
                  and case["condition"] in ("emergency", "degraded_input", "no_benefit")
                  for origin in case["origins"])
    conservation = all(case["world_mass_residual_veh"] < 1e-6 for case in cases
                       if case["status"] == "completed")
    failed = sum(case["status"] != "completed" for case in cases)
    return {"target_type": "synthetic_model", "declared_cases": len(dimensions),
            "failed_cases": failed, "eligible_origins": len(eligible),
            "improved_origins": improved,
            "improved_fraction": improved / len(eligible) if eligible else None,
            "gate_pass": (protocol.get("evidence_scope") != "tuning_only" and failed == 0 and bool(eligible) and guarded and conservation
                          and improved / len(eligible) >=
                          protocol["control"]["minimum_improved_eligible_cases_fraction"]),
            "cases": cases}
