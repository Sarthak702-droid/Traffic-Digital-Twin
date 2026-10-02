import pytest
import twin_pb2 as pb
from services.simulation.aggregate_engine import AggregateEngine


def started(tmp_path):
    engine = AggregateEngine(directory=tmp_path)
    state = engine.reset(pb.RunCommand(schema_version='1.0', scenario_type='peak_surge',
                                      seed=1101, mode='recommend', run_id='dispatch-run'))
    return engine, state


def plan(engine, state, command_id='dispatch-1'):
    return pb.PlanCommand(run_id=state.run_id, command_id=command_id,
        expected_input_session_id=state.input_session_id,
        expected_snapshot_sequence=state.snapshot_sequence,
        activate_not_before_simulation_s=45,
        changes=[pb.TimingChange(node_id=p['node_id'], phase_id=p['id'], green_s=15)
                 for p in engine.config['phases']])


def test_unbound_legacy_dispatch_fails_closed(tmp_path):
    engine, state = started(tmp_path)
    try:
        request = pb.PlanCommand(run_id=state.run_id, command_id='legacy',
            changes=[pb.TimingChange(node_id=p['node_id'], phase_id=p['id'], green_s=15)
                     for p in engine.config['phases']])
        before = engine.scheduler.snapshot()
        with pytest.raises(ValueError, match='dispatch identity'):
            engine.apply_plan(request)
        assert engine.receipts.status(request) == 'not_found'
        assert engine.scheduler.snapshot() == before
    finally:
        engine.close()


@pytest.mark.parametrize('change', ['snapshot', 'epoch'])
def test_state_change_after_gateway_validation_cannot_schedule(tmp_path, change):
    engine, state = started(tmp_path)
    try:
        request = plan(engine, state)
        if change == 'snapshot':
            engine.step()
        else:
            engine.latest.input_session_id = 'new-epoch'
        before = engine.scheduler.snapshot()
        with pytest.raises(ValueError, match='changed'):
            engine.apply_plan(request)
        assert engine.scheduler.snapshot() == before
        assert engine.receipts.status(request) == 'not_found'
    finally:
        engine.close()


def test_matched_dispatch_retains_activation_and_idempotent_receipt(tmp_path):
    engine, state = started(tmp_path)
    try:
        request = plan(engine, state)
        engine.apply_plan(request)
        engine.step()
        engine.apply_plan(request)  # Accepted retry may have an older sequence.
        assert engine.receipts.status(request) == 'accepted'
        while engine.tick < 44:
            engine.step()
            assert engine.scheduler.applied_at is None
        for _ in range(100):
            engine.step()
            if engine.scheduler.applied_at is not None:
                break
        assert engine.scheduler.applied_at >= 45
        assert engine.receipts.status(request) == 'applied'
    finally:
        engine.close()
