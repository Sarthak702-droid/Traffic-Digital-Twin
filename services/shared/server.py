"""Private gRPC services; the browser communicates through Go only."""
import argparse
import os
import hmac
from concurrent import futures
import grpc
import twin_pb2 as pb
import twin_pb2_grpc as rpc
from services.shared.validation import validate_state

from services.intelligence.service import Intelligence

class ServiceIdentity(grpc.ServerInterceptor):
    def __init__(self, token): self.token=token
    def intercept_service(self, continuation, details):
        handler=continuation(details)
        supplied=dict(details.invocation_metadata).get('x-service-token','')
        if hmac.compare_digest(supplied,self.token): return handler
        def denied(request, context): context.abort(grpc.StatusCode.UNAUTHENTICATED,'Private compute service')
        if handler and handler.response_streaming:
            return grpc.unary_stream_rpc_method_handler(denied,request_deserializer=handler.request_deserializer,response_serializer=handler.response_serializer)
        return grpc.unary_unary_rpc_method_handler(denied,request_deserializer=handler.request_deserializer if handler else None,response_serializer=handler.response_serializer if handler else None)

def serve(kind, port):
    token=os.environ.get('COMPUTE_TOKEN','')
    if len(token)<32: raise RuntimeError('COMPUTE_TOKEN of 32+ characters required')
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4), interceptors=[ServiceIdentity(token)], options=[('grpc.max_receive_message_length', 1048576)])
    if kind == 'simulation':
        from services.simulation.service import Simulation
        simulation = Simulation()
        rpc.add_SimulationServicer_to_server(simulation, server)
    else:
        rpc.add_IntelligenceServicer_to_server(Intelligence(), server)
    if not server.add_insecure_port(f'127.0.0.1:{port}'):
        raise RuntimeError('Unable to bind local gRPC port')
    server.start()
    print(f'{kind} contract service listening on 127.0.0.1:{port}', flush=True)
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        server.stop(2).wait()
    finally:
        if kind == 'simulation':
            simulation.engine.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('kind', choices=['simulation', 'intelligence'])
    parser.add_argument('--port', type=int, default=50051)
    args = parser.parse_args()
    serve(args.kind, args.port)
