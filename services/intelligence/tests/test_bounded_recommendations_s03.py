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
        item.queue_veh = 8
        item.vehicle_count = 8
        item.arrival_rate_vpm = 12
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
        item.queue_veh = 8
        item.vehicle_count = 8
        item.arrival_rate_vpm = 12
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

def test_audit_compare_shares_analysis_admission():
    import pytest
    from services.intelligence.model import ComputeBudgetError
    model=Model();state=empty_state(model)
    assert model._analysis_slots.acquire(blocking=False)
    try:
        with pytest.raises(ComputeBudgetError,match='concurrency'):model.comparison(state,[])
    finally:model._analysis_slots.release()

def test_audit_rollout_checks_rpc_cancellation():
    import pytest
    from services.intelligence.model import ComputeBudgetError
    class Context:
        def time_remaining(self):return 1.5
        def is_active(self):return False
    model=Model()
    with pytest.raises(ComputeBudgetError,match='cancelled'):model.comparison(empty_state(model),[],context=Context())

def test_audit_displaced_congestion_never_passes_admissibility():
    model=Model()
    baseline=dict(queue_delay=100,throughput=10,backlog=0,boundary_wait=0,congested=0,worst_service_debt=10)
    for key in ('backlog','boundary_wait','congested','worst_service_debt'):
        candidate={**baseline,'queue_delay':50,key:100}
        assert not model._admissible(baseline,candidate)
    assert not model._admissible(baseline,{**baseline,'throughput':9})

def test_locked_green_or_offset_changes_are_not_admissible():
    model=Model();state=pb.TrafficState(control_mode='recommend')
    plan=model.plan(state);phase=model.config['phases'][0]
    state.locked_targets.append(phase['id'])
    changed=dict(plan);changed[phase['id']]+=1
    assert not model._authority_admissible(state,changed,{})
    assert not model._authority_admissible(state,plan,{phase['node_id']:1})
    assert model._authority_admissible(state,plan,{})
    state.control_mode='manual'
    assert not model._authority_admissible(state,plan,{})

def test_terminal_cancellation_diagnostic_does_not_prevent_fresh_safe_analysis(tmp_path):
    from services.simulation.aggregate_engine import AggregateEngine
    engine=AggregateEngine(directory=tmp_path)
    try:
        state=engine.reset(pb.RunCommand(schema_version='1.0',run_id='cancel-recover',scenario_type='peak_surge',seed=1101,mode='recommend'))
        for _ in range(16):state=engine.step()
        command=pb.PlanCommand(run_id=state.run_id,command_id='cancel-recover-plan',changes=state.active_plan,expected_input_session_id='',expected_snapshot_sequence=state.snapshot_sequence,expected_control_epoch=0)
        engine.apply_plan(command);engine.cancel_plan(command)
        # Publish fresh authoritative state while retaining the terminal receipt.
        state=engine.update_authority(pb.AuthorityCommand(run_id=state.run_id,command_id='fresh-authority',expected_control_epoch=0,mode='recommend'))
        assert state.scheduler.rejected_reason
        result=Model().analyze(state)
        assert result.outcome in ('recommend','no_action')
        assert result.forecasts
        assert engine.receipts.status(command)=='rejected'
    finally:engine.close()


def test_equal_local_plan_keeps_its_baseline_slot():
    model = Model()
    state = empty_state(model)
    current = model.plan(state)
    candidates = model._generate_candidates(state, current, current)
    # Index 1 is the local reference even when timings equal the current plan.
    assert candidates[0] == current
    assert candidates[1] == current


def test_bounded_candidates_include_a_whole_corridor_split_correction():
    model = Model()
    state = empty_state(model)
    current = model.plan(state)
    local = dict(current)
    for phases in model.index.phases_by_node.values():
        local[phases[0]['id']] += 8
        local[phases[1]['id']] -= 8
    candidates = model._generate_candidates(state, current, local)
    assert len(candidates) <= model.scoring['max_candidates']
    joint = candidates[2]
    for phases in model.index.phases_by_node.values():
        assert joint[phases[0]['id']] == current[phases[0]['id']] + 4
        assert joint[phases[1]['id']] == current[phases[1]['id']] - 4
        assert sum(joint[p['id']] for p in phases) == sum(current[p['id']] for p in phases)


def test_every_offered_alternative_exceeds_minimum_benefit():
    model = Model()
    state = empty_state(model)
    for item in state.movements:
        item.queue_veh = 8
        item.vehicle_count = 8
        item.arrival_rate_vpm = 12
        item.downstream_capacity_veh = 30
    result = model.analyze(state)
    assert result.outcome == 'recommend'
    evaluation = model._evaluation_input(state)
    current = model.rollout(state, model.plan(state), 120, evaluation)
    for rec in [result.recommendation, *result.alternatives]:
        score = model.rollout(state, {c.phase_id: c.green_s for c in rec.changes},
                              120, evaluation,
                              offsets={c.node_id: c.offset_s for c in rec.changes})
        assert current['cost'] - score['cost'] > model.scoring['minimum_benefit_points']


def test_small_gain_alternative_is_not_offered_alongside_beneficial_plan(monkeypatch):
    model = Model()
    state = empty_state(model)
    current = model.plan(state)
    phases = next(iter(model.index.phases_by_node.values()))
    local, small_gain = dict(current), dict(current)
    for plan, delta in ((local, 8), (small_gain, 4)):
        plan[phases[0]['id']] += delta
        plan[phases[1]['id']] -= delta
    monkeypatch.setattr(model, 'allocate', lambda state: local)
    monkeypatch.setattr(model, '_generate_candidates', lambda *args: [current, local, small_gain])
    monkeypatch.setattr(model, '_candidate_offsets', lambda *args: {})
    original = model.rollout
    def controlled_cost(snapshot, plan, *args, **kwargs):
        # Isolate ranking from traffic dynamics; all regression metrics match.
        result = original(snapshot, current, *args, **kwargs)
        result['cost'] = 100 if plan == current else 70 if plan == local else 95
        return result
    monkeypatch.setattr(model, 'rollout', controlled_cost)
    result = model.analyze(state)
    assert result.outcome == 'recommend'
    assert {c.phase_id: c.green_s for c in result.recommendation.changes} == local
    assert not result.alternatives  # Five points cannot meet the ten-point gate.
