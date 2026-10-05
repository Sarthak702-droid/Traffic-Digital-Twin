"""Controller decisions must explain failures and match virtual execution."""
import copy
import pytest
import twin_pb2 as pb
from services.intelligence.model import Model
from services.shared.network_config import ROOT
from services.simulation.aggregate_engine import AggregateEngine
from services.simulation.metrics import link_metrics

@pytest.mark.parametrize('graph',['c1-c6','three-controlled-junctions'])
@pytest.mark.parametrize('offset',[0,3])
def test_changed_plan_projection_matches_real_virtual_execution(tmp_path,graph,offset):
    config_path=ROOT/'packages/scenario-config'/f'{graph}.json'
    engine=AggregateEngine(config_path=config_path,directory=tmp_path/'live')
    try:
        engine.reset(pb.RunCommand(schema_version='1.0',run_id='parity',scenario_type='peak_surge',seed=1101,mode='recommend'))
        for _ in range(16):engine.step()
        state=engine.copy_state();model=Model(engine.config);plan=model.plan(state)
        phases=next(iter(model.index.phases_by_node.values()))
        plan[phases[0]['id']]+=4;plan[phases[1]['id']]-=4
        offsets={node:offset for node in engine.phases}
        future=copy.deepcopy(engine.demand);trace=[future.next(engine.tick+i) for i in range(1,121)]
        evaluation={**model._evaluation_input(state),'demand_trace':trace}
        predicted=model.rollout(state,plan,120,evaluation,offsets=offsets)
        engine.apply_plan(pb.PlanCommand(run_id=state.run_id,command_id='parity-command',expected_input_session_id=state.input_session_id,expected_snapshot_sequence=state.snapshot_sequence,expected_control_epoch=state.control_epoch,changes=[pb.TimingChange(node_id=model.phases[p]['node_id'],phase_id=p,green_s=g,offset_s=offsets[model.phases[p]['node_id']]) for p,g in plan.items()]))
        delay=wait=spill=0.0;initial_exits=engine.cumulative_exits
        for _ in range(120):
            engine.step()
            metrics=[link_metrics(link,engine.cells[edge],0,0) for edge,link in engine.links.items()]
            delay+=sum(link_metrics(engine.links[edge],engine.cells[edge],0,0)['queued'] for edge in engine.index.movements_by_incoming)
            wait+=sum(engine.backlogs.values());spill+=sum(m['utilization']>=.85 for m in metrics)
        assert predicted['queue_delay']==pytest.approx(delay)
        assert predicted['boundary_wait']==pytest.approx(wait)
        assert predicted['congested']==pytest.approx(spill)
        assert predicted['throughput']==pytest.approx(engine.cumulative_exits-initial_exits)
        assert predicted['final_cells']==engine.cells
        assert predicted['final_backlogs']==engine.backlogs
        assert predicted['scheduler_snapshot']==engine.scheduler.snapshot()
        assert predicted['activation_tick']==engine.scheduler.applied_at
    finally:engine.close()

def test_diagnostics_cover_every_evaluated_candidate_and_its_guards(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    try:
        engine.reset(pb.RunCommand(schema_version='1.0',run_id='diagnose',scenario_type='peak_surge',seed=1101,mode='recommend'))
        for _ in range(120):engine.step()
        model=Model(engine.config);state=engine.copy_state();before=state.SerializeToString()
        result=model.analyze(state)
        diagnostic=model.analysis_diagnostics()
        assert diagnostic['outcome']==result.outcome
        assert diagnostic['snapshot_sequence']==state.snapshot_sequence
        assert len(diagnostic['candidates'])<=model.scoring['max_candidates']
        assert [r['kind'] for r in diagnostic['candidates'][:2]]==['current','local_adaptive']
        for row in diagnostic['candidates']:
            assert 'status' in row and 'reason' in row
            if row['status']=='evaluated':
                assert 'metrics' in row and 'regression_failures' in row and 'activation_tick' in row
        assert state.SerializeToString()==before
    finally:engine.close()

def test_regression_diagnostics_name_displaced_wait_and_lost_exits():
    model=Model();baseline=dict(queue_delay=100,throughput=10,backlog=0,boundary_wait=0,congested=0,worst_service_debt=10)
    candidate={**baseline,'queue_delay':90,'throughput':9,'boundary_wait':1}
    assert set(model.regression_failures(baseline,candidate))=={'throughput','boundary_wait'}
