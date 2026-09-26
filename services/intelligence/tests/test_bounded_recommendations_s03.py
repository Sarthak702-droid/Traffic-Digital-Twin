"""Analysis must leave the current virtual plan in place when change is unwarranted."""

import twin_pb2 as pb
import grpc
from threading import Event, Thread

from services.intelligence.model import Model
from services.intelligence.service import Intelligence


def empty_state(model):
    state = pb.TrafficState(schema_version="1.0", run_id="s03-empty",
                            timestamp="2026-09-26T00:00:00Z", scenario_type="peak_surge",
                            source="synthetic", seed=7)
    for mid in model.moves:
        state.movements.add(movement_id=mid, current_phase_id=model.serving[mid])
    return state


def test_safe_current_plan_with_no_demand_returns_no_action():
    model = Model()
    result = model.analyze(empty_state(model))
    assert result.outcome == "no_action"
    assert not result.HasField("recommendation")
    assert not result.HasField("comparison")


def test_gain_below_declared_minimum_returns_no_action():
    model = Model()
    model.scoring["minimum_benefit_points"] = 1_000_000_000
    state = empty_state(model)
    for item in state.movements:
        item.queue_veh = 15
        item.vehicle_count = 15
        item.arrival_rate_vpm = 20
        item.downstream_capacity_veh = 30
    result = model.analyze(state)
    assert result.outcome == "no_action"
    assert "minimum benefit 1e+09" in result.outcome_reason
    assert not result.HasField("recommendation")


def test_expired_evaluation_budget_returns_cannot_evaluate():
    model = Model()
    model.scoring["analysis_timeout_s"] = 0
    result = model.analyze(empty_state(model))
    assert result.outcome == "cannot_evaluate"
    assert "timeout" in result.outcome_reason.lower()
    assert not result.HasField("recommendation")
    assert {(item.horizon_s, item.status) for item in result.horizon_availability} == {
        (30, "compute_unavailable"), (60, "compute_unavailable"),
        (120, "compute_unavailable"), (300, "compute_unavailable")
    }


def test_single_analysis_slot_rejects_concurrent_work_without_a_plan_change():
    model = Model()
    state = empty_state(model)
    entered = Event()
    release = Event()
    original = model._analyze

    def held_analysis(snapshot):
        entered.set()
        assert release.wait(2)
        return original(snapshot)

    model._analyze = held_analysis
    first = Thread(target=lambda: model.analyze(state))
    first.start()
    try:
        assert entered.wait(2)
        result = model.analyze(state)
        assert result.outcome == "cannot_evaluate"
        assert "concurrency" in result.outcome_reason.lower()
        assert not result.HasField("recommendation")
        assert {item.status for item in result.horizon_availability} == {"compute_unavailable"}
    finally:
        release.set()
        first.join(timeout=2)


def test_incomplete_operating_snapshot_cannot_evaluate():
    model = Model()
    state = empty_state(model)
    state.schema_version = "1.1"
    result = model.analyze(state)
    assert result.outcome == "cannot_evaluate"
    assert "complete cell snapshot" in result.outcome_reason
    assert not result.HasField("recommendation")


def test_candidate_budget_can_allow_only_the_current_plan():
    model = Model()
    model.scoring["max_candidates"] = 1
    state = empty_state(model)
    for item in state.movements:
        item.queue_veh = 15
        item.vehicle_count = 15
        item.arrival_rate_vpm = 20
        item.downstream_capacity_veh = 30
    result = model.analyze(state)
    assert result.outcome == "no_action"
    assert not result.HasField("recommendation")


def test_unsafe_current_plan_cannot_become_an_actionable_recommendation():
    model = Model()
    state = empty_state(model)
    for phase in model.config["phases"]:
        state.active_plan.add(phase_id=phase["id"], green_s=1)
    result = model.analyze(state)
    assert result.outcome == "cannot_evaluate"
    assert not result.HasField("recommendation")


def test_no_benefit_does_not_force_an_emergency_recovery_change():
    model = Model()
    state = empty_state(model)
    state.emergency.id = "recovery"
    state.emergency.status = "recovery"
    state.emergency.route_node_ids.extend(["C6", "C3", "C1"])
    result = model.analyze(state)
    assert result.outcome == "no_action"
    assert not result.HasField("recommendation")


def test_predict_rpc_reports_unavailable_forecast_without_index_error():
    service = Intelligence()
    state = empty_state(service.model)
    state.demand_source = "video_profile"
    state.input_quality = "cached_valid"
    state.input_session_id = "epoch"
    state.latest_finalized_window_end_source_s = 5
    class Context:
        def abort(self, code, detail):
            assert code == grpc.StatusCode.FAILED_PRECONDITION
            assert "forecast" in detail.lower()
            raise RuntimeError(detail)
    import pytest
    with pytest.raises(RuntimeError, match="Forecast unavailable"):
        service.Predict(state, Context())


def test_actionable_recommendation_binds_current_snapshot_identity():
    model = Model()
    state = empty_state(model)
    state.input_session_id = "epoch-7"
    state.snapshot_sequence = 19
    state.config_hash = "config-7"
    for item in state.movements:
        item.queue_veh = 15
        item.vehicle_count = 15
        item.arrival_rate_vpm = 20
        item.downstream_capacity_veh = 30
    result = model.analyze(state)
    assert result.outcome == "recommend"
    rec = result.recommendation
    assert rec.input_session_id == "epoch-7"
    assert rec.snapshot_sequence == 19
    assert rec.config_hash == "config-7"
    assert rec.model_version == result.model_version
    assert rec.metrics_version == result.metrics_version
    assert rec.forecast_origin_source_s == result.forecast_origin_source_s
    state.input_session_id = "epoch-8"
    refreshed = model.analyze(state)
    assert refreshed.recommendation.id != rec.id
