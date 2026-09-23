import twin_pb2 as pb
import json

from services.simulation.engine import Engine
from services.simulation.flow_kernel import step_cells
from services.shared.network_config import NetworkIndex, load_config


def test_aggregate_state_conserves_external_demand(tmp_path):
    engine = Engine(directory=tmp_path)
    try:
        engine.reset(pb.RunCommand(schema_version='1.0', scenario_type='peak_surge', seed=1101, mode='recommend', run_id='aggregate-invariant'))
        for _ in range(180):
            state = engine.step()
            stock = sum(link.stock_veh for link in state.links)
            assert abs(state.cumulative_demand_veh - stock - state.boundary_backlog_veh - state.cumulative_boundary_exits_veh) < 1e-6
            assert all(0 <= link.storage_utilization_ratio <= 1 for link in state.links)
            assert all(link.stock_veh <= next(item['storage_capacity_veh'] for item in engine.config['links'] if item['id'] == link.link_id) + 1e-9 for link in state.links)
    finally:
        engine.close()


def test_full_receiver_retains_boundary_backlog():
    config = load_config()
    index = NetworkIndex.build(config)
    cells = {edge: [0.0] for edge in index.links}
    source = index.boundary_inputs[0]
    cells[source][0] = index.links[source]['storage_capacity_veh']
    backlog = {edge: 0.0 for edge in index.boundary_inputs}
    result = step_cells(index, cells, backlog, {source: 10.0}, set(), {mid: 1.0 for mid in index.movements})
    assert result.admitted[source] == 0
    assert backlog[source] == 10.0


def test_default_runtime_uses_the_aggregate_provider():
    from services.simulation.aggregate_engine import AggregateEngine
    assert Engine is AggregateEngine


def test_video_profile_reaches_snapshot_and_predictor(tmp_path, monkeypatch):
    from services.intelligence.forecast_demand import boundary_rates
    from services.intelligence.model import Model
    from services.simulation.video_demand import CAMERA_TO_BOUNDARY_LINK

    observations = tmp_path / 'observations'
    observations.mkdir()
    for camera in CAMERA_TO_BOUNDARY_LINK:
        record = {'observation_status': 'valid', 'window_start_s': 0, 'window_end_s': 5,
                  'available_at_source_s': 5, 'crossings_veh': 5}
        (observations / f'{camera}_observations.jsonl').write_text(json.dumps(record) + '\n')
    monkeypatch.setenv('VIDEO_OBSERVATIONS_DIR', str(observations))
    engine = Engine(directory=tmp_path / 'runtime')
    try:
        engine.reset(pb.RunCommand(schema_version='1.0', scenario_type='peak_surge', seed=1101,
                                   mode='recommend', run_id='video-profile-test', demand_source='video_profile'))
        for _ in range(6):
            state = engine.step()
        assert state.demand_source == 'video_profile'
        assert len(state.boundary_demand) == 4
        assert len(state.cells) == len(engine.links)
        assert state.cumulative_demand_veh == 8
        model = Model()
        assert model._initial_cells(state) == {edge: list(stock) for edge, stock in engine.cells.items()}
        assert all(rate > 0 for rate in boundary_rates(state, model.index).values())
        assert len(model.analyze(state).forecasts) == 56
    finally:
        engine.close()
