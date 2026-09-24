import copy
import json

import pytest
import twin_pb2 as pb

from services.shared.network_config import NetworkIndex, load_config
from services.simulation.aggregate_engine import AggregateEngine
from services.simulation.emergency import route_free_flow_eta
from services.simulation.video_demand import VideoProfileDemandProvider


def test_mapping_is_configured_and_rejects_internal_or_duplicate_injection():
    config = load_config()
    assert config['camera_boundary_links']['CAM-06'] == 'C6-C3'
    for change in (
        {**{key: value for key, value in config['camera_boundary_links'].items() if key != 'CAM-06'}, 'CAM-04': 'C6-C3'},
        {**config['camera_boundary_links'], 'CAM-02': 'C2-C1'},
        {**config['camera_boundary_links'], 'CAM-06': 'C3-C6'},
    ):
        invalid = copy.deepcopy(config)
        invalid['camera_boundary_links'] = change
        from services.simulation.safety import validate_config
        with pytest.raises(ValueError):
            validate_config(invalid)


def test_video_demand_uses_declared_mapping_only(tmp_path):
    config = load_config()
    config['camera_boundary_links'] = {'CAM-06': 'C6-C3'}
    for camera in ('CAM-06', 'CAM-04'):
        (tmp_path / f'{camera}_observations.jsonl').write_text(json.dumps({
            'observation_status': 'valid', 'window_start_s': 0, 'window_end_s': 5,
            'available_at_source_s': 5, 'crossings_veh': 10,
        }) + '\n')
    provider = VideoProfileDemandProvider(observations_dir=tmp_path, camera_boundary_links=config['camera_boundary_links'])
    assert provider.next(5) == {'C6-C3': 2.0}
    assert provider.export_manifest()['boundary_links']['C6-C3']['assigned_camera'] == 'CAM-06'


@pytest.mark.parametrize('name,controlled', [('c1-c6.json', 2), ('three-controlled-junctions.json', 3)])
@pytest.mark.parametrize('scenario,seed', [('peak_surge', 1101), ('incident_c3', 2202), ('ambulance_corridor', 3303)])
def test_both_graphs_preserve_scenarios_and_mass(tmp_path, name, controlled, scenario, seed):
    from services.shared.network_config import ROOT
    path = ROOT / 'packages/scenario-config' / name
    config = load_config(path)
    assert sum(node['kind'] == 'controlled' for node in config['nodes']) == controlled
    index = NetworkIndex.build(config)
    assert set(config['camera_boundary_links'].values()) == set(index.boundary_inputs)
    engine = AggregateEngine(config_path=path, directory=tmp_path / f'{name}-{scenario}')
    try:
        state = engine.reset(pb.RunCommand(schema_version='1.0', scenario_type=scenario, seed=seed, mode='recommend', run_id='n01'))
        if scenario == 'incident_c3':
            assert state.incident.node_id == engine.scenario['incident_node_id']
        if scenario == 'ambulance_corridor':
            assert state.emergency.route_node_ids == engine.scenario['route_node_ids']
        for _ in range(180):
            state = engine.step()
            if scenario == 'ambulance_corridor' and state.simulation_time_s == 6:
                controlled_route = {node for node in state.emergency.route_node_ids if node in engine.phases}
                assert controlled_route <= set(engine.scheduler.priority)
            assert abs(state.cumulative_demand_veh - sum(link.stock_veh for link in state.links)
                       - state.boundary_backlog_veh - state.cumulative_boundary_exits_veh) < 1e-6
    finally:
        engine.close()


def test_incident_and_route_follow_configured_non_c3_node(tmp_path):
    from services.shared.network_config import ROOT
    config = load_config(ROOT / 'packages/scenario-config/three-controlled-junctions.json')
    incident = next(s for s in config['scenarios'] if s['id'] == 'incident_c3')
    assert incident['incident_node_id'] != 'C3'
    assert route_free_flow_eta(incident['route_node_ids'], {l['id']: l for l in config['links']})[-1] > 0
    path = tmp_path / 'renamed.json'
    path.write_text(json.dumps(config))
    engine = AggregateEngine(config_path=path, directory=tmp_path / 'runtime')
    try:
        engine.reset(pb.RunCommand(schema_version='1.0', scenario_type='incident_c3', seed=2202, mode='recommend', run_id='incident'))
        for _ in range(31):
            state = engine.step()
        assert state.incident.node_id == incident['incident_node_id']
        assert all(engine._events()[m['id']] == incident['capacity_ratio'] for m in config['movements'] if m['node_id'] == incident['incident_node_id'])
    finally:
        engine.close()


def test_three_junction_analysis_uses_its_route(tmp_path):
    from services.intelligence.model import Model
    from services.shared.network_config import ROOT
    path = ROOT / 'packages/scenario-config/three-controlled-junctions.json'
    engine = AggregateEngine(config_path=path, directory=tmp_path)
    try:
        state = engine.reset(pb.RunCommand(schema_version='1.0', scenario_type='peak_surge', seed=1101, mode='recommend', run_id='analysis'))
        result = Model(engine.config).analyze(state)
        assert 'C3-C7' in ' '.join(result.recommendation.explanation_facts)
    finally:
        engine.close()


def test_network_config_environment_selects_same_graph_for_both_python_services(monkeypatch):
    from services.intelligence.model import Model
    from services.shared.network_config import ROOT
    monkeypatch.setenv('NETWORK_CONFIG', str(ROOT / 'packages/scenario-config/three-controlled-junctions.json'))
    assert Model().config['id'] == load_config()['id'] == 'three-controlled-junctions-v1'
