import grpc
import pytest
import twin_pb2 as pb
from services.simulation.service import Simulation

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
