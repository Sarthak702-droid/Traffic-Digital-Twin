"""Operating candidates use causal demand and configurable topology."""
import copy
import pytest
import twin_pb2 as pb
from services.intelligence.model import Model
from services.shared.network_config import ROOT
from services.simulation.aggregate_engine import AggregateEngine
from services.simulation.safety import validate_plan

@pytest.fixture(params=['c1-c6','three-controlled-junctions'])
def world(request,tmp_path):
    engine=AggregateEngine(config_path=ROOT/'packages/scenario-config'/f'{request.param}.json',directory=tmp_path)
    engine.reset(pb.RunCommand(schema_version='1.0',run_id='candidate-regression',scenario_type='peak_surge',seed=1101,mode='recommend'))
    for _ in range(120):engine.step()
    yield Model(engine.config),engine.copy_state()
    engine.close()

def test_operating_candidates_explore_cycles_within_existing_safety_envelope(world):
    model,state=world;current=model.plan(state)
    candidates=model._generate_candidates(state,current,model.allocate(state))
    assert len(candidates)<=model.scoring['max_candidates']
    assert candidates[:2]==[current,model.allocate(state)]
    assert any(sum(p.values())!=sum(current.values()) for p in candidates[2:])
    for plan in candidates:validate_plan(model.config,plan)

def test_candidate_generation_ignores_future_scenario_schedule_and_seed(world):
    model,state=world;current=model.plan(state);local=model.allocate(state)
    before=state.SerializeToString();expected=model._generate_candidates(state,current,local)
    altered=copy.deepcopy(state);altered.seed=99317
    assert model._generate_candidates(altered,current,local)==expected
    assert state.SerializeToString()==before

def test_offered_backlog_changes_pressure_at_its_actual_configured_node(world):
    model,state=world;current=model.plan(state);local=model.allocate(state)
    original=model._generate_candidates(state,current,local)[2]
    rows=list(state.boundary_demand);rows[0].backlog_veh+=1000
    # Backlog is external offered mass, not merely admitted approach arrivals.
    adjusted=model._generate_candidates(state,current,local)[2]
    incoming=rows[0].link_id
    phase=next(p for p in model.phases.values() if any(model.moves[mid]['incoming_link_id']==incoming for mid in p['movement_ids']))
    assert adjusted[phase['id']]>original[phase['id']]

def test_unavailable_local_reference_cannot_be_silently_omitted(world,monkeypatch):
    model,state=world;current=model.plan(state);local=model.allocate(state)
    candidate=dict(current);phases=next(iter(model.index.phases_by_node.values()))
    candidate[phases[0]['id']]+=1;candidate[phases[1]['id']]-=1
    original=model.rollout
    def controlled(snapshot,plan,*args,**kwargs):
        if plan==local:raise ValueError('Downstream storage unavailable at activation boundary')
        result=original(snapshot,current,*args,**kwargs)
        result['cost']=100 if plan==current else 20
        return result
    monkeypatch.setattr(model,'rollout',controlled)
    monkeypatch.setattr(model,'_generate_candidates',lambda *args:[current,local,candidate])
    monkeypatch.setattr(model,'_candidate_offsets',lambda *args:{})
    result=model.analyze(state)
    assert result.outcome=='cannot_evaluate'
    assert 'local' in result.outcome_reason.lower()
    assert not result.HasField('recommendation')

def test_analytical_proposals_check_cancellation_inside_their_loops(world):
    from services.intelligence.controller import coordinated_plan
    from services.intelligence.model import ComputeBudgetError
    model,state=world;count=0
    def cancelled():
        nonlocal count
        count+=1
        if count==2:raise ComputeBudgetError('Analysis cancelled')
    with pytest.raises(ComputeBudgetError,match='cancelled'):
        coordinated_plan(model.index,model.config,state,model.plan(state),model._evaluation_input(state),model.scoring['candidate_policy']['variants'][0],120,check_budget=cancelled)
    assert count==2

def test_route_offsets_follow_candidate_phase_progression_and_remain_bounded(world):
    model,state=world;current=model.plan(state);plans=model._generate_candidates(state,current,model.allocate(state))
    offsets=model._candidate_offsets(state,4)
    assert offsets
    assert set(offsets)<=set(model.index.phases_by_node)
    assert all(0<=value<=10 and int(value)==value for value in offsets.values())
    from services.simulation.safety import Signals
    Signals(model.config).apply(plans[4],offsets=offsets)

@pytest.mark.parametrize('graph',['c1-c6','three-controlled-junctions'])
def test_known_unreleased_demand_changes_candidate_allocation(tmp_path,graph):
    engine=AggregateEngine(config_path=ROOT/'packages/scenario-config'/f'{graph}.json',directory=tmp_path)
    engine.reset(pb.RunCommand(schema_version='1.0',run_id='committed-candidate',scenario_type='peak_surge',seed=1101,mode='recommend'))
    try:
        model=Model(engine.config);state=engine.copy_state();current=model.plan(state)
        policy=model.scoring['candidate_policy']['variants'][0]
        from services.intelligence.controller import coordinated_plan
        before=coordinated_plan(model.index,model.config,state,current,model._evaluation_input(state),policy,120)
        link=next(iter(model.index.boundary_inputs))
        state.demand_commitments.add(boundary_link_id=link,release_start_simulation_s=1,release_end_simulation_s=21,remaining_mass_veh=100,rate_vps=5)
        after=coordinated_plan(model.index,model.config,state,current,model._evaluation_input(state),policy,120)
        phase=next(p for p in model.phases.values() if any(model.moves[mid]['incoming_link_id']==link for mid in p['movement_ids']))
        assert after[phase['id']]>before[phase['id']]
        assert state.demand_commitments[0].remaining_mass_veh==100
        validate_plan(model.config,after)
    finally:engine.close()
