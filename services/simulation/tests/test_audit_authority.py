import pytest
import twin_pb2 as pb
from services.simulation.aggregate_engine import AggregateEngine

@pytest.mark.parametrize('mode,locks',[('manual',[]),('recommend',['C1-main'])])
def test_authority_change_cancels_pending_plan(tmp_path,mode,locks):
    engine=AggregateEngine(directory=tmp_path)
    try:
        state=engine.reset(pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='audit'))
        changes=list(state.active_plan)
        command=pb.PlanCommand(run_id='audit',command_id='audit-plan',changes=changes,activate_not_before_simulation_s=20,expected_input_session_id='',expected_snapshot_sequence=state.snapshot_sequence,expected_control_epoch=state.control_epoch)
        engine.apply_plan(command)
        engine.set_clock(pb.ClockCommand(run_id='audit',paused=True))
        lock=engine.config['phases'][0]['id']
        updated=engine.update_authority(pb.AuthorityCommand(run_id='audit',command_id='authority-change',expected_control_epoch=state.control_epoch,mode=mode,locked_targets=[lock] if locks else []))
        assert updated.simulation_paused
        engine.set_clock(pb.ClockCommand(run_id="audit",paused=False))
        assert updated.control_epoch==state.control_epoch+1
        assert engine.receipts.status(command)=='rejected'
        assert engine.pending_command is None
        for _ in range(160):engine.step()
        assert engine.receipts.status(command)=='rejected'
        assert engine.update_authority(pb.AuthorityCommand(run_id='audit',command_id='authority-change',expected_control_epoch=state.control_epoch,mode=mode,locked_targets=[lock] if locks else [])).control_epoch==updated.control_epoch
    finally:engine.close()

def test_cancel_fences_late_dispatch_and_preserves_offset_authority(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    try:
        state=engine.reset(pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='audit'))
        command=pb.PlanCommand(run_id='audit',command_id='late',changes=state.active_plan,expected_input_session_id='',expected_snapshot_sequence=state.snapshot_sequence,expected_control_epoch=0)
        assert engine.cancel_plan(command)=='rejected'
        with pytest.raises(ValueError,match='receipt'):engine.apply_plan(command)
        command.command_id='pending-offset'
        for change in command.changes:change.offset_s=10
        before=dict(engine.scheduler.offsets)
        engine.apply_plan(command)
        assert engine.cancel_plan(command)=='rejected'
        assert engine.scheduler.offsets==before
        for _ in range(160):engine.step()
        assert engine.receipts.status(command)=='rejected'
    finally:engine.close()

def test_run_reset_preserves_declared_locks_and_resets_paused_clock(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    try:
        command=pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='old')
        engine.reset(command);engine.set_clock(pb.ClockCommand(run_id='old',paused=True))
        command.run_id='new';command.locked_targets.append(engine.config['phases'][0]['id'])
        state=engine.reset(command)
        assert not state.simulation_paused
        assert set(state.locked_targets)==set(command.locked_targets)
        assert state.source_time_mapping.source_seconds_per_simulation_second==0 # seeded input has no source mapping
    finally:engine.close()

def test_degraded_input_cancels_pending_approval_and_recovery_cannot_revive_it(tmp_path):
    class Input:
        recovered=False
        def next(self,tick):return {}
        def eligible_commitments(self,tick):return []
        def finalized_history(self,tick):
            return [pb.FinalizedObservation(boundary_link_id=edge,window_start_s=max(0,tick-5),window_end_s=tick) for edge in engine.index.boundary_inputs] if self.recovered else []
    engine=AggregateEngine(directory=tmp_path)
    try:
        state=engine.reset(pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='audit'))
        command=pb.PlanCommand(run_id='audit',command_id='input-degraded',changes=state.active_plan,activate_not_before_simulation_s=20,expected_input_session_id='',expected_snapshot_sequence=state.snapshot_sequence,expected_control_epoch=0)
        engine.apply_plan(command)
        engine.demand_source='video_profile';engine.demand=Input()
        assert engine.step().input_quality=='missing'
        assert engine.receipts.status(command)=='rejected'
        engine.demand.recovered=True
        for _ in range(160):engine.step()
        assert engine.pending_command is None
        assert engine.receipts.status(command)=='rejected'
    finally:engine.close()

def test_clock_acknowledgement_has_a_new_snapshot_sequence(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    try:
        state=engine.reset(pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='clock-sequence'))
        held=engine.set_clock(pb.ClockCommand(run_id=state.run_id,paused=True))
        assert held.snapshot_sequence>state.snapshot_sequence
        resumed=engine.set_clock(pb.ClockCommand(run_id=state.run_id,paused=False))
        assert resumed.snapshot_sequence>held.snapshot_sequence
    finally:engine.close()
