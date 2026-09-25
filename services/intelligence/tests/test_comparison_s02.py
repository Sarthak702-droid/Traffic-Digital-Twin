import twin_pb2 as pb
import pytest
from google.protobuf.json_format import MessageToDict

from services.intelligence.model import Model
from services.simulation.aggregate_engine import AggregateEngine


def _state(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    try:
        state=engine.reset(pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='s02-run'))
        for _ in range(45):state=engine.step()
        return state
    finally:
        engine.close()


def test_comparison_reports_matched_window_and_all_public_aggregate_metrics(tmp_path):
    state=_state(tmp_path)
    model=Model()
    before=state.SerializeToString(deterministic=True)
    changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in model.config['phases']]
    result=model.comparison(state,changes,'candidate-1')
    assert state.SerializeToString(deterministic=True)==before
    assert result.window_start_simulation_s==45
    assert result.window_end_simulation_s==165
    assert result.horizon_s==120
    assert result.baseline_queue_delay_veh_s>=0
    assert result.candidate_queue_delay_veh_s>=0
    assert result.baseline_boundary_throughput_veh>=0
    assert result.candidate_boundary_throughput_veh>=0
    assert result.baseline_boundary_wait_veh_s>=0
    assert result.candidate_boundary_wait_veh_s>=0
    assert result.baseline_worst_service_debt_s>0
    assert result.candidate_worst_service_debt_s>0
    assert result.demand_assumptions_hash
    assert result.scoring_version
    public=MessageToDict(result,preserving_proto_field_name=True)
    assert 'baseline_avg_delay_s' not in public
    assert 'candidate_avg_delay_s' not in public
    assert 'baseline_stops_per_vehicle' not in public


def test_same_plan_has_identical_metrics_and_bound_demand_hash(tmp_path):
    state=_state(tmp_path)
    model=Model()
    changes=[pb.TimingChange(node_id=model.phases[pid]['node_id'],phase_id=pid,green_s=g) for pid,g in model.plan(state).items()]
    first=model.comparison(state,changes)
    second=model.comparison(state,changes)
    for name in ('queue_delay_veh_s','boundary_throughput_veh','boundary_backlog_veh','boundary_wait_veh_s','worst_service_debt_s','congested_link_s'):
        assert getattr(first,'baseline_'+name)==getattr(first,'candidate_'+name)
    assert first.demand_assumptions_hash==second.demand_assumptions_hash
    state.input_session_id='next-session'
    assert model.comparison(state,changes).demand_assumptions_hash!=first.demand_assumptions_hash


def test_boundary_displacement_cannot_score_as_unconditional_gain():
    model=Model()
    baseline={'queue_delay':200,'boundary_wait':0,'congested':5,'throughput':40,'worst_service_debt':50,'timing_change':0}
    displaced={**baseline,'queue_delay':100,'boundary_wait':1000,'timing_change':5}
    assert model.score_metrics(displaced)>model.score_metrics(baseline)
    starved={**baseline,'queue_delay':190,'worst_service_debt':200}
    assert model.score_metrics(starved)>model.score_metrics(baseline)
    assert model.score_metrics(starved,'emergency_priority')>model.score_metrics(starved,'normal')


def test_compare_rejects_different_window_or_demand_assumptions(tmp_path):
    state=_state(tmp_path)
    model=Model()
    changes=[pb.TimingChange(node_id=model.phases[pid]['node_id'],phase_id=pid,green_s=g) for pid,g in model.plan(state).items()]
    with pytest.raises(ValueError,match='horizon'):
        model.comparison(state,changes,horizon_s=60)
    with pytest.raises(ValueError,match='demand assumptions'):
        model.comparison(state,changes,demand_assumptions_hash='forged')


def test_candidate_rejected_if_downstream_remains_full_at_safe_boundary(tmp_path):
    state=_state(tmp_path)
    model=Model()
    edge='C1-C3'
    cells=next(item for item in state.cells if item.link_id==edge)
    cells.stock_veh[:]=[model.links[edge]['storage_capacity_veh']/len(cells.stock_veh)]*len(cells.stock_veh)
    state.incident.id='blocked-c3';state.incident.node_id='C3';state.incident.status='active';state.incident.capacity_ratio=0
    changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in model.config['phases']]
    with pytest.raises(ValueError,match='Downstream storage'):
        model.comparison(state,changes)


def test_operating_comparison_rejects_incomplete_cell_snapshot(tmp_path):
    state=_state(tmp_path)
    model=Model()
    del state.cells[-1]
    changes=[pb.TimingChange(node_id=model.phases[pid]['node_id'],phase_id=pid,green_s=g) for pid,g in model.plan(state).items()]
    with pytest.raises(ValueError,match='complete cell snapshot'):
        model.comparison(state,changes)


def test_pending_virtual_application_cannot_be_compared_as_stable_baseline(tmp_path):
    state=_state(tmp_path)
    model=Model()
    state.scheduler.pending_plan[0].green_s=15
    changes=[pb.TimingChange(node_id=model.phases[pid]['node_id'],phase_id=pid,green_s=g) for pid,g in model.plan(state).items()]
    with pytest.raises(ValueError,match='pending virtual plan'):
        model.comparison(state,changes)
