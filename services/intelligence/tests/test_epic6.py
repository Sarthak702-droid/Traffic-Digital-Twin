import time
import pytest
import twin_pb2 as pb
from services.intelligence.model import Model
from services.simulation.safety import default_plan

@pytest.fixture
def model_and_state():
    model = Model()
    state = pb.TrafficState(
        schema_version="1.0",
        run_id="epic6-test-run",
        timestamp="2026-09-17T00:00:00Z",
        scenario_type="peak_surge",
        seed=1101,
        source="synthetic",
        simulation_time_s=45.0,
    )
    for mid, m in model.moves.items():
        state.movements.add(
            movement_id=mid,
            queue_veh=5.0,
            vehicle_count=8,
            arrival_rate_vpm=12.0,
            downstream_capacity_veh=25.0,
            current_phase_id=model.serving[mid],
            waiting_age_s=25.0,
        )
    return model, state

# --- Story S16: Bounded AGDA phase allocation ---

def test_s16_budget_feasibility_rejection(model_and_state):
    model, state = model_and_state
    # Modify active plan to have infeasibly low green sum below min_green_s
    for p in model.phases.values():
        state.active_plan.add(node_id=p['node_id'], phase_id=p['id'], green_s=2.0)
    with pytest.raises(ValueError, match="Infeasible green budget"):
        model.allocate(state)

def test_s16_emergency_boost_priority(model_and_state):
    model, state = model_and_state
    # Normal baseline allocation
    normal_plan = model.allocate(state)
    
    # Activate emergency on C6 -> C3 -> C1 -> C2 corridor
    state.emergency.status = "priority"
    state.emergency.route_node_ids.extend(["C6", "C3", "C1", "C2"])
    emergency_plan = model.allocate(state)
    
    # Corridor phases on C1 and C3 should receive boosted green time
    assert emergency_plan["C1-FROM-C3"] >= normal_plan["C1-FROM-C3"]
    assert emergency_plan["C3-FROM-C6"] >= normal_plan["C3-FROM-C6"]
    # All allocated greens must respect configured phase bounds
    for pid, g in emergency_plan.items():
        assert model.phases[pid]["min_green_s"] <= g <= model.phases[pid]["max_green_s"]

def test_s16_incident_penalty_prevents_feeding_blocked_link(model_and_state):
    model, state = model_and_state
    # Normal allocation
    normal_plan = model.allocate(state)
    
    # Set incident at C3
    state.scenario_type = "incident_c3"
    state.incident.status = "active"
    state.incident.node_id = "C3"
    state.incident.capacity_ratio = 0.35
    
    incident_plan = model.allocate(state)
    # Gating: Green into blocked C3 should be penalized / metered
    assert incident_plan["C3-FROM-C6"] <= normal_plan["C3-FROM-C6"]
    for pid, g in incident_plan.items():
        assert model.phases[pid]["min_green_s"] <= g <= model.phases[pid]["max_green_s"]

def test_s16_waiting_age_fairness_starvation_prevention(model_and_state):
    model, state = model_and_state
    # Set zero queues on all movements
    for m in state.movements:
        m.queue_veh = 0.0
        m.arrival_rate_vpm = 0.0
        m.waiting_age_s = 0.0
    # Starve minor movement C1 cross street (C1-FROM-C5)
    minor_moves = [m for m in state.movements if model.serving[m.movement_id] == "C1-FROM-C5"]
    for m in minor_moves:
        m.waiting_age_s = 150.0  # Starved waiting age
    
    plan = model.allocate(state)
    # C1-FROM-C5 should receive substantial green due to fairness guard
    assert plan["C1-FROM-C5"] >= 20.0

# --- Story S17: Coordinated candidate signal plans ---

def test_s17_coordinated_candidates_generation(model_and_state):
    model, state = model_and_state
    baseline = model.plan(state)
    agda = model.allocate(state)
    candidates = model._generate_candidates(state, baseline, agda)
    
    # Must generate multiple coordinated candidate plans
    assert len(candidates) >= 3
    # Every candidate must be a valid plan with safe bounds and safe phases
    for cand in candidates:
        assert set(cand.keys()) == set(model.phases.keys())
        for pid, g in cand.items():
            assert model.phases[pid]["min_green_s"] <= g <= model.phases[pid]["max_green_s"]
        # Preserves cycle budget per controlled junction
        for node_id in ("C1", "C3"):
            node_phases = [p["id"] for p in model.phases.values() if p["node_id"] == node_id]
            expected_sum = sum(agda[p] for p in node_phases)
            actual_sum = sum(cand[p] for p in node_phases)
            assert actual_sum == expected_sum

# --- Story S18: Simulate and score PN-MPC candidates ---

def test_s18_simulate_and_score_pn_mpc_candidates(model_and_state):
    model, state = model_and_state
    start = time.perf_counter()
    analysis = model.analyze(state)
    elapsed = time.perf_counter() - start
    
    # Must execute within 2 seconds
    assert elapsed < 2.0, f"Analysis took {elapsed:.2f}s, expected < 2.0s"
    
    # Returns best plan and 2 distinct feasible alternatives
    assert analysis.recommendation is not None
    assert len(analysis.alternatives) == 2
    
    # Primary recommendation and alternatives must have distinct plans
    rec_plan = {c.phase_id: c.green_s for c in analysis.recommendation.changes}
    alt1_plan = {c.phase_id: c.green_s for c in analysis.alternatives[0].changes}
    alt2_plan = {c.phase_id: c.green_s for c in analysis.alternatives[1].changes}
    assert rec_plan != alt1_plan or rec_plan != alt2_plan

# --- Story S19: Explain recommendations from structured facts ---

def test_s19_structured_explanation_facts(model_and_state):
    model, state = model_and_state
    analysis = model.analyze(state)
    rec = analysis.recommendation
    
    assert rec.id != ""
    assert rec.priority in ("normal", "warning", "critical")
    assert rec.safety_status == "requires_fresh_validation"
    assert rec.status == "pending"
    assert len(rec.changes) > 0
    
    # Check structured facts derivation
    facts = rec.explanation_facts
    assert len(facts) >= 5
    facts_str = " ".join(facts)
    
    # Verify required structured facts
    assert "Trigger:" in facts_str
    assert "Upstream corridor:" in facts_str
    assert "Coordinated timing:" in facts_str
    assert "120-second PN-MPC network cost:" in facts_str
    assert "Human approval required" in facts_str
    assert "conservation-v2" in facts_str
    # Verify no fake ML or hallucinated confidence bands
    assert "neural" not in facts_str.lower()
    assert "deep learning" not in facts_str.lower()
    assert "confidence interval" not in facts_str.lower()
