import grpc
import pytest
import twin_pb2 as pb
from services.simulation.service import Simulation
from services.simulation.aggregate_engine import AggregateEngine

class Context:
    def abort(self,code,message):raise RuntimeError(code,message)
    def is_active(self):return True

class FailedEngine:
    failure='aggregate runtime disconnected'
    running=False
    def __init__(self):
        import threading
        self.lock=threading.RLock();self.changed=threading.Condition(self.lock)
    def start_clock(self):pass
    def reset(self,command):raise ValueError('bad command')


def test_reset_validation_and_stream_failure():
    service=Simulation(FailedEngine())
    with pytest.raises(RuntimeError) as error:service.Reset(pb.RunCommand(),Context())
    assert error.value.args[0]==grpc.StatusCode.INVALID_ARGUMENT
    with pytest.raises(RuntimeError) as error:next(service.StreamState(pb.RunRequest(),Context()))
    assert error.value.args[0]==grpc.StatusCode.UNAVAILABLE


def test_applied_outcome_reports_actual_virtual_boundary(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    service=Simulation(engine)
    try:
        service.Reset(pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='outcome-run'),Context())
        request=pb.PlanCommand(run_id='outcome-run',command_id='outcome-1',changes=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=15) for p in engine.config['phases']])
        assert service.ApplyPlan(request,Context()).valid
        assert service.GetPlanOutcome(request,Context()).status=='accepted'
        for _ in range(50):
            engine.step()
            if engine.scheduler.applied_at is not None:break
        outcome=service.GetPlanOutcome(request,Context())
        assert outcome.status=='applied'
        assert outcome.HasField('applied_at_simulation_s')
        assert outcome.applied_at_simulation_s==engine.scheduler.applied_at
    finally:
        engine.close()


def test_explicit_clock_pause_preserves_snapshot_and_rejects_wrong_epoch(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    service=Simulation(engine)
    try:
        frame=service.Reset(pb.RunCommand(schema_version='1.0',scenario_type='peak_surge',seed=1101,mode='recommend',run_id='clock-run'),Context())
        command=pb.ClockCommand(run_id='clock-run',input_session_id=frame.input_session_id,paused=True)
        held=service.SetClock(command,Context())
        assert held.simulation_paused
        stream=service.StreamState(pb.RunRequest(run_id='clock-run'),Context())
        first=next(stream);second=next(stream)
        assert second.snapshot_sequence==first.snapshot_sequence
        assert second.timestamp>first.timestamp
        stream.close()
        assert engine.step().snapshot_sequence==held.snapshot_sequence
        assert engine.step().simulation_time_s==held.simulation_time_s
        with pytest.raises(RuntimeError):service.SetClock(pb.ClockCommand(run_id='other',paused=False),Context())
        resumed=service.SetClock(pb.ClockCommand(run_id='clock-run',input_session_id=frame.input_session_id,paused=False),Context())
        assert not resumed.simulation_paused
        assert engine.step().simulation_time_s>held.simulation_time_s
    finally:engine.close()
