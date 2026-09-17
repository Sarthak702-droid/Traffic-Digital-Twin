import time
import pytest
import twin_pb2 as pb
from services.simulation.engine import Engine

@pytest.fixture
def engine(tmp_path):
    value=Engine(directory=tmp_path)
    yield value
    value.close()

def command(scenario='peak_surge',seed=1101):
    return pb.RunCommand(schema_version='1.0',scenario_type=scenario,seed=seed,mode='recommend',run_id='test-run')

def deterministic(state):
    state.timestamp=''
    return state.SerializeToString(deterministic=True)

@pytest.mark.parametrize('scenario,seed',[('peak_surge',1101),('incident_c3',2202),('ambulance_corridor',3303)])
def test_repeatable_reset_and_conservation(engine,scenario,seed):
    started=time.perf_counter();engine.reset(command(scenario,seed));assert time.perf_counter()-started<5
    snapshots=[]
    for _ in range(100):
        state=engine.step()
        assert state.inserted_total-state.arrived_total==state.vehicles_in_network
        assert state.teleported_total==0
        for m in state.movements:
            assert m.arrivals_total-m.departures_total==m.vehicle_count
            assert 0<=m.occupancy_ratio<=1
        snapshots.append(deterministic(state))
    assert state.inserted_total>0
    started=time.perf_counter();engine.reset(command(scenario,seed));assert time.perf_counter()-started<5
    assert [deterministic(engine.step()) for _ in range(100)]==snapshots

def test_clearance_and_compatible_permissions(engine):
    engine.reset(command())
    previous={}
    durations={}
    seen=set()
    conflicts={frozenset(pair) for pair in engine.config['conflicts']}
    for _ in range(160):
        state=engine.step()
        for signal in state.signals:
            key=(signal.phase_id,signal.indication)
            seen.add(signal.indication)
            assert signal.remaining_s>0
            for a in signal.permitted_movement_ids:
                for b in signal.permitted_movement_ids:assert frozenset([a,b]) not in conflicts
            if signal.node_id in previous and previous[signal.node_id]!=key:
                old=previous[signal.node_id]
                assert (old[1],signal.indication) in {('green','amber'),('amber','all_red'),('all_red','green')}
            if signal.indication!='green':assert not signal.permitted_movement_ids
            previous[signal.node_id]=key
    assert seen=={'green','amber','all_red'}

def test_bad_command(engine):
    with pytest.raises(ValueError):engine.reset(command(seed=0))
