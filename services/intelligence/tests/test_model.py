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

def test_platoon_propagates_after_travel_time(sample):
    model,state=sample
    for m in state.movements:m.queue_veh=0;m.vehicle_count=0
    upstream=next(m for m in state.movements if m.movement_id=='C6-C3-C1');upstream.queue_veh=30;upstream.vehicle_count=30
    state.signals.add(node_id='C3',phase_id=model.serving[upstream.movement_id],indication='green',remaining_s=30)
    output=model.rollout(state,default_plan(model.config))
    downstream=[mid for mid,m in model.moves.items() if m['incoming_link_id']=='C3-C1']
    assert sum(output['snapshots'][60][1][mid] for mid in downstream)>sum(output['snapshots'][30][1][mid] for mid in downstream)
