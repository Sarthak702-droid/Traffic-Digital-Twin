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
            errors=validate_state(request)
            if errors:raise ValueError('; '.join(errors))
            return self.model.analyze(request)
        except (ValueError,KeyError) as e:context.abort(grpc.StatusCode.INVALID_ARGUMENT,str(e))
    def Compare(self,request,context):
        try:return self.model.comparison(request.state,request.changes,request.recommendation_id,horizon_s=request.horizon_s,demand_assumptions_hash=request.demand_assumptions_hash)
        except (ValueError,KeyError) as e:context.abort(grpc.StatusCode.INVALID_ARGUMENT,str(e))
    def Predict(self,request,context):
        analysis=self.Analyze(request,context)
        if not analysis.forecasts:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION,f'Forecast unavailable: {analysis.outcome_reason}')
        return analysis.forecasts[0]
