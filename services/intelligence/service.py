import grpc
import twin_pb2_grpc as rpc
from services.intelligence.model import Model, ComputeBudgetError
from services.shared.validation import validate_state
import twin_pb2 as pb

class Intelligence(rpc.IntelligenceServicer):
    def __init__(self):self.model=Model()
    def ValidateState(self,request,context):
        errors=validate_state(request)
        return pb.ValidationResult(valid=not errors,errors=errors)
    def Analyze(self,request,context):
        try:
            errors=validate_state(request)
            if errors:raise ValueError('; '.join(errors))
            return self.model.analyze(request,context=context)
        except (ValueError,KeyError) as e:context.abort(grpc.StatusCode.INVALID_ARGUMENT,str(e))
    def Compare(self,request,context):
        try:return self.model.comparison(request.state,request.changes,request.recommendation_id,horizon_s=request.horizon_s,demand_assumptions_hash=request.demand_assumptions_hash,context=context)
        except ComputeBudgetError as e:
            code=grpc.StatusCode.RESOURCE_EXHAUSTED if 'concurrency' in str(e) else grpc.StatusCode.CANCELLED if 'cancelled' in str(e) else grpc.StatusCode.DEADLINE_EXCEEDED
            context.abort(code,str(e))
        except (ValueError,KeyError) as e:context.abort(grpc.StatusCode.INVALID_ARGUMENT,str(e))
    def Predict(self,request,context):
        analysis=self.Analyze(request,context)
        if not analysis.forecasts:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION,f'Forecast unavailable: {analysis.outcome_reason}')
        return analysis.forecasts[0]
