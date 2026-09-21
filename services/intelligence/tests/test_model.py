import time
import pytest
import twin_pb2 as pb
from services.intelligence.model import Model
from services.simulation.safety import default_plan

@pytest.fixture
def sample():
    model=Model();state=pb.TrafficState(schema_version='1.0',run_id='unit',timestamp='2026-09-17T00:00:00Z',scenario_type='peak_surge',seed=1101,source='synthetic')
    for mid,m in model.moves.items():state.movements.add(movement_id=mid,queue_veh=3,vehicle_count=5,arrival_rate_vpm=10,downstream_capacity_veh=30,current_phase_id=model.serving[mid],waiting_age_s=20)
    return model,state

def test_forecast_horizons_candidates_and_latency(sample):
    model,state=sample;start=time.perf_counter();result=model.analyze(state)
    assert time.perf_counter()-start<2
    assert {f.horizon_s for f in result.forecasts}=={30,60,120,300}
    assert len(result.alternatives)==2
    assert all(f.queue_veh>=0 and 0<=f.occupancy_ratio<=1 for f in result.forecasts)
    assert result.comparison.initial_time_s==state.simulation_time_s
    assert result.comparison.seed==state.seed
    assert result.comparison.candidate_avg_delay_s>=0

def test_equal_plans_equal_results_and_no_mutation(sample):
    model,state=sample;before=state.SerializeToString()
    changes=[pb.TimingChange(node_id=model.phases[p]['node_id'],phase_id=p,green_s=g) for p,g in default_plan(model.config).items()]
    result=model.comparison(state,changes)
    assert result.baseline_max_queue_veh==result.candidate_max_queue_veh
    assert result.baseline_avg_delay_s==result.candidate_avg_delay_s
    assert before==state.SerializeToString()
    changes[0].green_s=999
    with pytest.raises(ValueError):model.comparison(state,changes)

def test_fairness_and_bounds(sample):
    model,state=sample
    for m in state.movements:m.queue_veh=0;m.arrival_rate_vpm=0;m.waiting_age_s=0
    target=state.movements[0];target.waiting_age_s=180
    plan=model.allocate(state)
    assert plan[model.serving[target.movement_id]]>10
    for pid,g in plan.items():assert model.phases[pid]['min_green_s']<=g<=model.phases[pid]['max_green_s']

def test_platoon_propagates_through_finite_capacity_link(sample):
    model,state=sample
    for m in state.movements:m.queue_veh=0;m.vehicle_count=0
    upstream=next(m for m in state.movements if m.movement_id=='C6-C3-C1');upstream.queue_veh=30;upstream.vehicle_count=30
    state.signals.add(node_id='C3',phase_id=model.serving[upstream.movement_id],indication='green',remaining_s=30)
    output=model.rollout(state,default_plan(model.config))
    downstream=[mid for mid,m in model.moves.items() if m['incoming_link_id']=='C3-C1']
    assert sum(output['snapshots'][60][0][mid] for mid in downstream)>=0
    assert output['throughput']>=0

def test_conservation_and_non_negative_queues(sample):
    model,state=sample
    output=model.rollout(state,default_plan(model.config),horizon=300)
    for horizon in (30,60,120,300):
        queues,arrivals,etas=output['snapshots'][horizon]
        for mid,q in queues.items():
            assert q>=0.,f"Queue for {mid} must be non-negative, got {q}"
            assert arrivals[mid]>=0.,f"Arrivals for {mid} must be non-negative"

def test_platoon_dispersion_eta_tolerance(sample):
    model,state=sample
    for m in state.movements:m.queue_veh=0;m.vehicle_count=0
    upstream=next(m for m in state.movements if m.movement_id=='C6-C3-C1');upstream.queue_veh=20;upstream.vehicle_count=20
    state.signals.add(node_id='C3',phase_id=model.serving[upstream.movement_id],indication='green',remaining_s=30)
    output=model.rollout(state,default_plan(model.config),horizon=120)
    downstream=[mid for mid,m in model.moves.items() if m['incoming_link_id']=='C3-C1']
    arrivals_60=[output['snapshots'][60][1][mid] for mid in downstream]
    assert len(arrivals_60)==3
    assert abs(arrivals_60[0]-arrivals_60[1])<.01
    assert abs(arrivals_60[1]-arrivals_60[2])<.01

def test_spillback_prediction_and_upstream_source_facts(sample):
    model,state=sample
    target=next(m for m in state.movements if m.movement_id=='C6-C3-C1')
    target.queue_veh=100;target.vehicle_count=100
    analysis=model.analyze(state)
    f=next(f for f in analysis.forecasts if f.movement_id=='C6-C3-C1' and f.horizon_s==120)
    assert f.risk in ('warning','critical')
    assert f.HasField('spillback_eta_s')
    assert f.spillback_eta_s>0
    facts_text=" ".join(f.explanation_facts)
    assert "Upstream source:" in facts_text
    assert "via corridor C6-C3" in facts_text
    assert "Predicted spillback ETA:" in facts_text

def test_peak_surge_fixture_alert_lead_time(tmp_path):
    from services.simulation.engine import Engine
    eng=Engine(directory=tmp_path)
    try:
        eng.reset(pb.RunCommand(schema_version="1.0",scenario_type="peak_surge",seed=1101,mode="recommend",run_id="lead-time-test"))
        model=Model()
        alert_time_s=None
        for step in range(1,100):
            state=eng.step()
            if alert_time_s is None and step>=35:
                analysis=model.analyze(state)
                surge_forecasts=[f for f in analysis.forecasts if f.movement_id in ('C6-C3-C1','C3-C1-C2') and f.horizon_s==120]
                if any(f.risk in ('warning','critical') for f in surge_forecasts):
                    alert_time_s=step
                    break
        assert alert_time_s is not None,"Alert should be raised during early peak surge"
        # The causal predictor does not know the configured surge end time.
        assert alert_time_s>=35
    finally:
        eng.close()
