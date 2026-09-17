import grpc
import twin_pb2 as pb
import twin_pb2_grpc as rpc
from services.shared.validation import validate_state
from services.simulation.engine import Engine

class Simulation(rpc.SimulationServicer):
    def __init__(self, engine=None):
        self.engine=engine or Engine()
        self.engine.start_clock()
    def ValidateState(self, request, context):
        errors=validate_state(request)
        return pb.ValidationResult(valid=not errors,errors=errors)
    def Reset(self,request,context):
        try:return self.engine.reset(request)
        except ValueError as error:context.abort(grpc.StatusCode.INVALID_ARGUMENT,str(error))
        except Exception as error:context.abort(grpc.StatusCode.UNAVAILABLE,str(error))
    def GetState(self,request,context):
        with self.engine.lock:
            if not self.engine.running or self.engine.latest is None:context.abort(grpc.StatusCode.FAILED_PRECONDITION,'No active simulation')
            if request.run_id and request.run_id!=self.engine.latest.run_id:context.abort(grpc.StatusCode.NOT_FOUND,'Run is not active')
            return self.engine.copy_state()
    def StreamState(self,request,context):
        version=-1
        while context.is_active():
            value=None
            with self.engine.changed:
                if self.engine.failure:context.abort(grpc.StatusCode.UNAVAILABLE,self.engine.failure)
                if self.engine.running and self.engine.latest is not None and self.engine.version!=version:
                    version=self.engine.version
                    if not request.run_id or request.run_id==self.engine.latest.run_id:value=self.engine.copy_state()
                else:self.engine.changed.wait(timeout=.2)
            if value is not None:yield value
    def ApplyPlan(self,request,context):
        try:
            self.engine.apply_plan(request)
            return pb.ValidationResult(valid=True)
        except ValueError as error:
            return pb.ValidationResult(valid=False,errors=[str(error)])
    def Stop(self,request,context):
        with self.engine.lock:
            if request.run_id and self.engine.latest and request.run_id!=self.engine.latest.run_id:context.abort(grpc.StatusCode.NOT_FOUND,'Run is not active')
            self.engine.stop()
        return pb.ValidationResult(valid=True)
