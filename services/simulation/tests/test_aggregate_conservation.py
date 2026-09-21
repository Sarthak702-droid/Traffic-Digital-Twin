import twin_pb2 as pb

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
