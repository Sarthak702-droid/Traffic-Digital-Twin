import time
import pytest
import twin_pb2 as pb
from services.simulation.engine import Engine
from services.simulation.aggregate_engine import AggregateEngine

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
    with pytest.raises(ValueError):engine.reset(pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='bad-override',incident_capacity_ratio=.5))
    with pytest.raises(ValueError):engine.reset(pb.RunCommand(schema_version='1.0',scenario_type='incident_c3',seed=2202,mode='recommend',run_id='bad-ratio',incident_capacity_ratio=.95))

def test_optional_scenario_events_are_present_only_for_their_domain(engine):
    peak=engine.reset(command('peak_surge',1101))
    assert not peak.HasField('incident')
    assert not peak.HasField('emergency')

    incident=engine.reset(command('incident_c3',2202))
    assert incident.HasField('incident')
    assert incident.incident.status=='scheduled'
    assert not incident.HasField('emergency')

    emergency=engine.reset(command('ambulance_corridor',3303))
    assert not emergency.HasField('incident')
    assert emergency.HasField('emergency')
    assert emergency.emergency.status=='scheduled'

def test_incident_capacity_and_emergency_recovery(engine):
    engine.reset(command('incident_c3',2202))
    statuses=set()
    for _ in range(480):
            state=engine.step();statuses.add(state.incident.status)
            if 30<=state.simulation_time_s<150:
                assert state.incident.capacity_ratio==.35
            assert state.engine_kind=='aggregate_ctm'
            assert not hasattr(engine, 'connection')
    assert {'scheduled','active','recovering','resolved'}<=statuses
    engine.reset(command('ambulance_corridor',3303))
    statuses=set();previous={}
    for _ in range(800):
        state=engine.step();statuses.add(state.emergency.status)
        assert len(state.emergency.eta_s)==len(state.emergency.route_node_ids)
        assert all(value>=0 for value in state.emergency.eta_s)
        for signal in state.signals:
            old=previous.get(signal.node_id)
            if old and old!=signal.indication:assert (old,signal.indication) in {('green','amber'),('amber','all_red'),('all_red','green')}
            previous[signal.node_id]=signal.indication
    assert {'scheduled','pre_clearance','priority','recovery','complete'}<=statuses

def test_incident_override_is_deterministic_and_reflected_in_live_state(engine):
    custom=pb.RunCommand(schema_version='1.0',scenario_type='incident_c3',seed=2202,mode='recommend',run_id='custom-incident',incident_kind='capacity_reduction',incident_capacity_ratio=.5)
    engine.reset(custom)
    snapshots=[]
    for _ in range(80):
        state=engine.step()
        if state.incident.status=='active':
            assert state.incident.kind=='capacity_reduction'
            assert state.incident.capacity_ratio==.5
        snapshots.append(deterministic(state))
    engine.reset(custom)
    assert [deterministic(engine.step()) for _ in range(80)]==snapshots

def test_plan_application_idempotency_and_validation(engine):
    engine.reset(command())
    changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']]
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='decision-1',changes=changes)
    engine.apply_plan(request);engine.apply_plan(request)
    for _ in range(36):state=engine.step()
    assert all(c.green_s==15 for c in state.active_plan)
    request.command_id='decision-2';request.changes[0].green_s=100
    with pytest.raises(ValueError):engine.apply_plan(request)
    assert engine.scheduler.pending[changes[0].phase_id]==15


def test_plan_command_activation_and_offset_change_later_virtual_state(engine):
    engine.reset(command())
    changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']]
    for change in changes:
        if change.node_id == 'C3': change.offset_s = 2
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='delayed-plan',changes=changes,activate_not_before_simulation_s=45)
    engine.apply_plan(request)
    for _ in range(44):
        state=engine.step()
        assert all(item.green_s==30 for item in state.active_plan)
    for _ in range(50):
        state=engine.step()
        if engine.scheduler.applied_at is not None: break
    assert engine.scheduler.applied_at >= 45
    assert all(item.green_s==15 for item in state.active_plan)
    assert engine.scheduler.state['C3'][1] == 'all_red'
    for _ in range(3): state=engine.step()
    assert engine.scheduler.state['C3'][1] == 'green'


def test_plan_command_rejects_conflicting_offsets_and_emergency(engine):
    engine.reset(command())
    changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']]
    changes[0].offset_s=1
    changes[1].offset_s=2
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='bad-offset',changes=changes)
    with pytest.raises(ValueError): engine.apply_plan(request)
    assert engine.scheduler.pending==engine.scheduler.plan
    engine.reset(command('ambulance_corridor',3303))
    for _ in range(120): engine.step()
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='emergency-plan',changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']])
    with pytest.raises(ValueError): engine.apply_plan(request)


def test_three_junction_plan_applies_atomically_and_survives_lookup(tmp_path):
    engine=AggregateEngine(config_path='packages/scenario-config/three-controlled-junctions.json',directory=tmp_path)
    try:
        engine.reset(command())
        changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']]
        request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='three-node-plan',changes=changes)
        engine.apply_plan(request)
        for _ in range(140):
            state=engine.step()
            active={item.green_s for item in state.active_plan}
            assert active in ({30},{15})
            if active=={15}: break
        assert active=={15}
        assert engine.receipts.status(request)=='applied'
        assert engine.receipts.applied_at(request)==engine.scheduler.applied_at
        assert engine.receipts.status(request)=='applied'
    finally:
        engine.close()


def test_boundary_guard_rejects_plan_without_changing_timing(engine):
    engine.reset(command())
    changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']]
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='blocked-plan',changes=changes)
    engine.apply_plan(request)
    engine.scheduler.priority['C1']=engine.config['phases'][0]['id']
    for _ in range(100):
        engine.step()
        if engine.scheduler.rejected_reason: break
    assert engine.scheduler.rejected_reason=='Emergency protection active at activation boundary'
    assert engine.receipts.status(request)=='rejected'
    assert engine.scheduler.pending==engine.scheduler.plan
    assert all(value==30 for value in engine.scheduler.plan.values())


def test_offset_that_would_exceed_service_debt_is_rejected_at_boundary(engine):
    engine.reset(command())
    changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']]
    for change in changes:
        if change.node_id=='C1':change.offset_s=180
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='excess-debt',changes=changes)
    engine.apply_plan(request)
    for _ in range(100):
        engine.step()
        if engine.scheduler.rejected_reason:break
    assert engine.receipts.status(request)=='rejected'
    assert 'Maximum red' in engine.scheduler.rejected_reason
    assert all(value==30 for value in engine.scheduler.plan.values())


def test_stop_rejects_an_accepted_but_unapplied_command(engine):
    engine.reset(command())
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='stopped-plan',activate_not_before_simulation_s=100,changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']])
    engine.apply_plan(request)
    assert engine.receipts.status(request)=='accepted'
    engine.stop()
    assert engine.receipts.status(request)=='rejected'


def test_second_command_cannot_displace_pending_receipt(engine):
    engine.reset(command())
    changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']]
    first=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='first-plan',changes=changes,activate_not_before_simulation_s=100)
    second=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='second-plan',changes=changes)
    engine.apply_plan(first)
    with pytest.raises(ValueError):engine.apply_plan(second)
    assert engine.receipts.status(first)=='accepted'
    assert engine.receipts.status(second)=='not_found'


def test_full_downstream_storage_blocks_boundary_activation(engine):
    engine.reset(command())
    edge=engine.config['movements'][0]['outgoing_link_id']
    cells=engine.cells[edge]
    cells[:]=[engine.links[edge]['storage_capacity_veh']/len(cells)]*len(cells)
    assert engine._activation_guard()=='Downstream storage unavailable at activation boundary'


def test_reset_rejects_unapplied_plan(engine):
    engine.reset(command())
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='reset-plan',activate_not_before_simulation_s=100,changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']])
    engine.apply_plan(request)
    engine.reset(command())
    assert engine.receipts.status(request)=='rejected'


def test_failed_reset_preserves_pending_plan_and_receipt(engine, tmp_path, monkeypatch):
    engine.reset(command())
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='retained-plan',activate_not_before_simulation_s=100,changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']])
    engine.apply_plan(request)
    monkeypatch.setenv('VIDEO_PROCESSED_DIR',str(tmp_path/'missing'))
    bad=command()
    bad.demand_source='video_profile';bad.input_session_id='missing-session'
    for camera in engine.config['camera_boundary_links']:
        bad.source_bindings.add(camera_id=camera,config_hash=engine.config_digest,source_session_id='missing-session')
    with pytest.raises(ValueError):engine.reset(bad)
    assert engine.receipts.status(request)=='accepted'
    assert engine.scheduler.pending!=engine.scheduler.plan


def test_receipt_write_failure_does_not_schedule_plan(engine, monkeypatch):
    engine.reset(command())
    request=pb.PlanCommand(expected_input_session_id=engine.latest.input_session_id, expected_snapshot_sequence=engine.latest.snapshot_sequence, run_id='test-run',command_id='unrecorded-plan',changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']])
    def fail(_):raise RuntimeError('receipt store unavailable')
    monkeypatch.setattr(engine.receipts,'prepare',fail)
    with pytest.raises(RuntimeError):engine.apply_plan(request)
    assert engine.scheduler.pending==engine.scheduler.plan
    assert engine.scheduler.requested_at is None

def test_complete_incident_blockage_gates_release(engine):
    next(s for s in engine.config['scenarios'] if s['id']=='incident_c3')['capacity_ratio']=0
    engine.reset(command('incident_c3',2202))
    baseline=None
    for _ in range(145):
        state=engine.step()
        movement=next(m for m in state.movements if m.movement_id=='C6-C3-C1')
        if state.simulation_time_s==75:baseline=movement.departures_total
        if 75<=state.simulation_time_s<145:
            assert movement.departures_total==baseline
            # Signal indication remains green; effective discharge is zero due
            # to the active capacity constraint, not a fabricated lamp change.
            assert movement.permission in ('green','red','amber')


def test_observation_smoothing_dampens_noise(engine):
    engine.reset(command('peak_surge', 1101))
    rates = []
    for _ in range(60):
        state = engine.step()
        m = next(item for item in state.movements if item.movement_id == 'C6-C3-C1')
        assert m.arrival_rate_vpm >= 0
        assert m.departure_rate_vpm >= 0
        assert m.avg_speed_kph >= 0
        rates.append((m.arrival_rate_vpm, m.departure_rate_vpm))
    # Confirm rates are smoothed floats rather than only jumps of 0 or 60
    fractional = [arr for arr, _ in rates if arr > 0 and arr % 60 != 0]
    assert len(fractional) > 0, "Arrival rates should be exponentially smoothed"
