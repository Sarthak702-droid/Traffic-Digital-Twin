"""Operating evaluation rejects incomplete/ambiguous physical snapshots."""
import math
import pytest
import twin_pb2 as pb
from services.intelligence.model import Model
from services.shared.network_config import ROOT
from services.simulation.aggregate_engine import AggregateEngine

@pytest.fixture(params=['c1-c6','three-controlled-junctions'])
def operating(request,tmp_path):
    engine=AggregateEngine(config_path=ROOT/'packages/scenario-config'/f'{request.param}.json',directory=tmp_path)
    try:
        state=engine.reset(pb.RunCommand(schema_version='1.0',run_id='integrity',scenario_type='peak_surge',seed=1101,mode='recommend'))
        yield Model(engine.config),state
    finally:engine.close()

@pytest.mark.parametrize('fault',[
    'missing_boundary','duplicate_boundary','unknown_boundary','negative_backlog',
    'missing_movement','duplicate_movement','unknown_movement','nan_movement',
    'duplicate_signal','wrong_signal_phase','nan_signal','excessive_green','conflicting_permission',
    'short_cells','negative_cells','nan_cells','over_capacity_cells'])
def test_invalid_operating_snapshot_fails_closed(operating,fault):
    model,state=operating
    if fault=='missing_boundary':state.boundary_demand.pop()
    elif fault=='duplicate_boundary':state.boundary_demand.add().CopyFrom(state.boundary_demand[0])
    elif fault=='unknown_boundary':state.boundary_demand[0].link_id='unknown-boundary'
    elif fault=='negative_backlog':state.boundary_demand[0].backlog_veh=-1
    elif fault=='missing_movement':state.movements.pop()
    elif fault=='duplicate_movement':state.movements.add().CopyFrom(state.movements[0])
    elif fault=='unknown_movement':state.movements[0].movement_id='unknown-movement'
    elif fault=='nan_movement':state.movements[0].queue_veh=math.nan
    elif fault=='duplicate_signal':state.signals.add().CopyFrom(state.signals[0])
    elif fault=='wrong_signal_phase':state.signals[0].phase_id='unknown-phase'
    elif fault=='nan_signal':state.signals[0].remaining_s=math.nan
    elif fault=='excessive_green':state.signals[0].remaining_s=model.phases[state.signals[0].phase_id]['max_green_s']+1
    elif fault=='conflicting_permission':
        row=state.signals[0]
        row.permitted_movement_ids.append(next(mid for mid in model.moves if mid not in model.phases[row.phase_id]['movement_ids']))
    elif fault=='short_cells':state.cells[0].stock_veh.pop()
    elif fault=='negative_cells':state.cells[0].stock_veh[0]=-1
    elif fault=='nan_cells':state.cells[0].stock_veh[0]=math.nan
    elif fault=='over_capacity_cells':state.cells[0].stock_veh[0]=model.links[state.cells[0].link_id]['storage_capacity_veh']+1
    original=state.SerializeToString()
    result=model.analyze(state)
    assert result.outcome=='cannot_evaluate'
    assert not result.forecasts and not result.HasField('recommendation')
    assert state.SerializeToString()==original
    with pytest.raises(ValueError):model.comparison(state,state.active_plan)

def test_complete_zero_demand_is_evaluable_and_preserves_legacy_optional_window(operating):
    model,state=operating
    for row in state.boundary_demand:row.ClearField('offered_window_s')
    result=model.analyze(state)
    assert result.outcome=='no_action' and result.forecasts
