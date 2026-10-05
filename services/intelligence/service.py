import grpc
import twin_pb2_grpc as rpc
from services.intelligence.model import Model
from services.shared.validation import validate_state
import twin_pb2 as pb

class Intelligence(rpc.IntelligenceServicer):
    def __init__(self):self.model=Model()
    def ValidateState(self,request,context):
        errors=validate_state(request)
        return pb.ValidationResult(valid=not errors,errors=errors)
    def Analyze(self,request,context):
        try:
            if not context.is_active():
                context.abort(grpc.StatusCode.CANCELLED, 'Request cancelled')
            errors=validate_state(request)
            if errors:raise ValueError('; '.join(errors))
            res = self.model.analyze(request)
            if res.outcome == 'cannot_evaluate':
                reason = res.outcome_reason.lower()
                if 'concurrency' in reason:
                    context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, res.outcome_reason)
                if 'timeout' in reason:
                    context.abort(grpc.StatusCode.DEADLINE_EXCEEDED, res.outcome_reason)
            if not context.is_active():
                context.abort(grpc.StatusCode.CANCELLED, 'Request cancelled')
            return res
        except (ValueError,KeyError) as e:context.abort(grpc.StatusCode.INVALID_ARGUMENT,str(e))
    def Compare(self,request,context):
        if not self.model._analysis_slots.acquire(blocking=False):
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, 'Analysis concurrency limit reached')
        try:
            import time
            started = time.monotonic()
            timeout = self.model.scoring.get('analysis_timeout_s', 5.0)
            if not context.is_active():
                context.abort(grpc.StatusCode.CANCELLED, 'Request cancelled')
            res = self.model.comparison(request.state,request.changes,request.recommendation_id,horizon_s=request.horizon_s,demand_assumptions_hash=request.demand_assumptions_hash)
            if time.monotonic() - started > timeout:
                context.abort(grpc.StatusCode.DEADLINE_EXCEEDED, 'Analysis timeout')
            if not context.is_active():
                context.abort(grpc.StatusCode.CANCELLED, 'Request cancelled')
            return res
        except (ValueError,KeyError) as e:context.abort(grpc.StatusCode.INVALID_ARGUMENT,str(e))
        finally:
            self.model._analysis_slots.release()
    def Predict(self,request,context):
        analysis=self.Analyze(request,context)
        if not analysis.forecasts:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION,f'Forecast unavailable: {analysis.outcome_reason}')
        return analysis.forecasts[0]
