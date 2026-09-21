"""Epic 7 Test Suite: Isolated Equal-Seed Simulation Branches & Synchronized Split-Screen (Stories S21, S22)."""

import pytest
import twin_pb2 as pb
from services.intelligence.model import Model
from services.simulation.safety import default_plan


@pytest.fixture
def sample_state():
    model = Model()
    state = pb.TrafficState(
        schema_version="1.0",
        run_id="run-epic7-eval",
        timestamp="2026-09-17T12:00:00Z",
        scenario_type="peak_surge",
        seed=1337,
        simulation_time_s=45.0,
        source="synthetic",
    )
    for mid, m in model.moves.items():
        state.movements.add(
            movement_id=mid,
            queue_veh=8.5,
            vehicle_count=12,
            arrival_rate_vpm=15.0,
            downstream_capacity_veh=25.0,
            current_phase_id=model.serving[mid],
            waiting_age_s=30.0,
        )
    return model, state


def test_s21_equal_seed_identical_initial_snapshot(sample_state):
    """S21: Baseline and candidate initialize from identical snapshot and seed."""
    model, state = sample_state
    state_bytes_before = state.SerializeToString()

    # Create candidate timing change within safety envelope
    changes = [
        pb.TimingChange(node_id=model.phases[p]["node_id"], phase_id=p, green_s=g)
        for p, g in default_plan(model.config).items()
    ]
    # Alter one phase timing
    changes[0].green_s += 5

    res = model.comparison(state, changes, recommendation_id="rec-test-s21")

    # Documented provenance
    assert res.seed == 1337
    assert res.initial_time_s == 45.0
    assert res.horizon_s == 120
    assert res.model_version == "aggregate-predictor-v1"
    assert res.run_id == "run-epic7-eval"
    assert res.recommendation_id == "rec-test-s21"

    # Zero mutation of live digital twin run
    assert state.SerializeToString() == state_bytes_before


def test_s21_four_outcome_metrics_evaluated(sample_state):
    """S21/S22: Evaluates exactly the 4 required outcome metrics."""
    model, state = sample_state
    changes = [
        pb.TimingChange(node_id=model.phases[p]["node_id"], phase_id=p, green_s=g)
        for p, g in default_plan(model.config).items()
    ]

    res = model.comparison(state, changes, recommendation_id="rec-s22-metrics")

    # Verify all 4 metrics exist and are non-negative
    # 1. Max queue (veh)
    assert res.baseline_max_queue_veh >= 0
    assert res.candidate_max_queue_veh >= 0
    # 2. Average modeled delay (s)
    assert res.baseline_avg_delay_s >= 0
    assert res.candidate_avg_delay_s >= 0
    # 3. Spillback (movement-seconds)
    assert res.baseline_spillback_s >= 0
    assert res.candidate_spillback_s >= 0
    # 4. Modeled stops per vehicle
    assert res.baseline_stops_per_vehicle >= 0
    assert res.candidate_stops_per_vehicle >= 0


def test_s21_identical_plans_yield_exact_zero_deltas(sample_state):
    """S21/S22: Identical plans yield identical baseline and candidate metrics without fabricated delta."""
    model, state = sample_state
    changes = [
        pb.TimingChange(node_id=model.phases[p]["node_id"], phase_id=p, green_s=g)
        for p, g in default_plan(model.config).items()
    ]

    res = model.comparison(state, changes)
    assert res.baseline_max_queue_veh == res.candidate_max_queue_veh
    assert res.baseline_avg_delay_s == res.candidate_avg_delay_s
    assert res.baseline_spillback_s == res.candidate_spillback_s
    assert res.baseline_stops_per_vehicle == res.candidate_stops_per_vehicle


def test_s21_safety_envelope_enforcement_in_simulation(sample_state):
    """S21: Simulation rejects timing changes that violate safety envelope bounds."""
    model, state = sample_state
    changes = [
        pb.TimingChange(node_id=model.phases[p]["node_id"], phase_id=p, green_s=g)
        for p, g in default_plan(model.config).items()
    ]
    # Violate min/max green bound
    changes[0].green_s = 999
    with pytest.raises(ValueError):
        model.comparison(state, changes)


def test_s22_stale_binding_integrity(sample_state):
    """S22: Comparison binds to unique run_id and recommendation_id."""
    model, state = sample_state
    changes = [
        pb.TimingChange(node_id=model.phases[p]["node_id"], phase_id=p, green_s=g)
        for p, g in default_plan(model.config).items()
    ]
    res1 = model.comparison(state, changes, recommendation_id="rec-001")
    assert res1.recommendation_id == "rec-001"
    assert res1.run_id == "run-epic7-eval"

    state.run_id = "run-epic7-next"
    res2 = model.comparison(state, changes, recommendation_id="rec-002")
    assert res2.recommendation_id == "rec-002"
    assert res2.run_id == "run-epic7-next"
