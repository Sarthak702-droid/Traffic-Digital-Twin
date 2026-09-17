import copy
import json
import xml.etree.ElementTree as ET
from pathlib import Path
import pytest
import twin_pb2 as pb
from services.simulation.safety import Signals, validate_config, validate_plan, default_plan, validate_runtime_safety, SafetyViolation
from services.simulation.network import ROOT, write_demand

@pytest.fixture
def config():return json.loads((ROOT/'packages/scenario-config/c1-c6.json').read_text())

@pytest.mark.parametrize('change',['conflict','bounds','pedestrian','missing_conflict','nan','ratio'])
def test_bad_configuration_rejected(config,change):
    if change=='conflict':config['phases'][0]['movement_ids'].append(config['phases'][1]['movement_ids'][0])
    if change=='bounds':config['phases'][0]['max_green_s']=1
    if change=='pedestrian':config['phases'][0]['pedestrian_clearance_s']=10
    if change=='missing_conflict':config['conflicts'].pop()
    if change=='nan':config['phases'][0]['amber_s']=float('nan')
    if change=='ratio':config['movements'][0]['turning_ratio']=.9
    with pytest.raises(ValueError):validate_config(config)

def test_exact_durations_and_safe_pending_plan(config):
    scheduler=Signals(config)
    node='C1';phases=scheduler.nodes[node]
    assert scheduler.state[node]==[0,'green',30]
    for _ in range(12):scheduler.advance()
    plan=default_plan(config);plan[phases[0]['id']]=15;scheduler.apply(plan)
    for _ in range(18):scheduler.advance()
    assert scheduler.state[node]==[0,'amber',3]
    for _ in range(3):scheduler.advance()
    assert scheduler.state[node]==[0,'all_red',2]
    for _ in range(2):scheduler.advance()
    assert scheduler.state[node]==[1,'green',30]
    assert scheduler.plan[phases[0]['id']]==15
    invalid=dict(plan);invalid[phases[0]['id']]=100
    with pytest.raises(ValueError):scheduler.apply(invalid)
    assert scheduler.pending==plan

def test_route_demand_respects_turning_ratios(config,tmp_path):
    chosen=[m for m in config['movements'] if m['incoming_link_id']=='C3-C1']
    for i,m in enumerate(chosen):m['turning_ratio']=.98 if i==0 else .01
    root=ET.parse(write_demand(config,'peak_surge',1101,tmp_path)).getroot()
    routes={r.attrib['id']:r.attrib['edges'].split() for r in root.findall('route')}
    counts={m['outgoing_link_id']:0 for m in chosen}
    for v in root.findall('vehicle'):
        edges=routes[v.attrib['route']]
        if 'C3-C1' in edges:
            counts[edges[edges.index('C3-C1')+1]]+=1
    assert counts[chosen[0]['outgoing_link_id']]/sum(counts.values())>.94
    first=(tmp_path/'demand.rou.xml').read_bytes()
    write_demand(config,'peak_surge',1101,tmp_path)
    assert first==(tmp_path/'demand.rou.xml').read_bytes()


def test_runtime_safety_validator_rejects_violations(config):
    # 1. Conflicting green movements
    states = [
        pb.SignalState(node_id='C3', phase_id='C3-FROM-C1', indication='green', remaining_s=15, permitted_movement_ids=['C1-C3-C6']),
        pb.SignalState(node_id='C3', phase_id='C3-FROM-C6', indication='green', remaining_s=15, permitted_movement_ids=['C6-C3-C1'])
    ]
    with pytest.raises(SafetyViolation) as err:
        validate_runtime_safety(config, states)
    assert 'Conflicting movements' in str(err.value)

    # 1b. Movement permitted outside configured phase
    states = [
        pb.SignalState(node_id='C1', phase_id='C1-FROM-C2', indication='green', remaining_s=15, permitted_movement_ids=['C3-C1-C2']),
    ]
    with pytest.raises(SafetyViolation) as err:
        validate_runtime_safety(config, states)
    assert 'permitted outside its configured phase' in str(err.value)

    # 2. Movement permitted during amber
    states = [
        pb.SignalState(node_id='C1', phase_id='C1-FROM-C2', indication='amber', remaining_s=2, permitted_movement_ids=['C2-C1-C3']),
        pb.SignalState(node_id='C3', phase_id='C3-FROM-C6', indication='green', remaining_s=15, permitted_movement_ids=['C6-C3-C1'])
    ]
    with pytest.raises(SafetyViolation) as err:
        validate_runtime_safety(config, states)
    assert 'during amber' in str(err.value)

    # 3. Movement permitted during all-red
    states = [
        pb.SignalState(node_id='C1', phase_id='C1-FROM-C2', indication='all_red', remaining_s=1, permitted_movement_ids=['C2-C1-C3']),
        pb.SignalState(node_id='C3', phase_id='C3-FROM-C6', indication='green', remaining_s=15, permitted_movement_ids=['C6-C3-C1'])
    ]
    with pytest.raises(SafetyViolation) as err:
        validate_runtime_safety(config, states)
    assert 'during all-red' in str(err.value)

    # 4. Green remaining time > max_green_s
    states = [
        pb.SignalState(node_id='C1', phase_id='C1-FROM-C2', indication='green', remaining_s=999, permitted_movement_ids=['C2-C1-C3']),
        pb.SignalState(node_id='C3', phase_id='C3-FROM-C6', indication='green', remaining_s=15, permitted_movement_ids=['C6-C3-C1'])
    ]
    with pytest.raises(SafetyViolation) as err:
        validate_runtime_safety(config, states)
    assert 'outside allowed range' in str(err.value)

    # 5. Pedestrian clearance violation in phase config
    bad_config = copy.deepcopy(config)
    bad_config['phases'][0]['pedestrian_clearance_s'] = 5
    bad_config['phases'][0]['all_red_s'] = 2
    states = [
        pb.SignalState(node_id='C1', phase_id='C1-FROM-C2', indication='all_red', remaining_s=2, permitted_movement_ids=[]),
        pb.SignalState(node_id='C3', phase_id='C3-FROM-C6', indication='green', remaining_s=15, permitted_movement_ids=['C6-C3-C1'])
    ]
    with pytest.raises(SafetyViolation) as err:
        validate_runtime_safety(bad_config, states)
    assert 'pedestrian clearance' in str(err.value)


def test_all_controlled_junction_exact_stage_durations(config):
    for node_id in ('C1', 'C3'):
        scheduler = Signals(config)
        phases = [p for p in config['phases'] if p['node_id'] == node_id]
        for p in phases:
            green_len = scheduler.plan[p['id']]
            amber_len = p['amber_s']
            all_red_len = p['all_red_s']
            assert all_red_len >= p['pedestrian_clearance_s']
            assert scheduler.state[node_id][1] == 'green'
            assert scheduler.state[node_id][2] == green_len
            for _ in range(green_len):
                scheduler.advance()
            assert scheduler.state[node_id][1] == 'amber'
            assert scheduler.state[node_id][2] == amber_len
            for _ in range(amber_len):
                scheduler.advance()
            assert scheduler.state[node_id][1] == 'all_red'
            assert scheduler.state[node_id][2] == all_red_len
            for _ in range(all_red_len):
                scheduler.advance()

