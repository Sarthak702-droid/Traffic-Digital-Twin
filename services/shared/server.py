"""Epic 1 contract endpoint. Simulation/optimizer RPCs remain UNIMPLEMENTED."""
import argparse
from concurrent import futures
import grpc
import twin_pb2 as pb
import twin_pb2_grpc as rpc
from services.shared.validation import validate_state

class Simulation(rpc.SimulationServicer):
    def ValidateState(self, request, context):
        errors = validate_state(request)
        return pb.ValidationResult(valid=not errors, errors=errors)

class Intelligence(rpc.IntelligenceServicer):
    def ValidateState(self, request, context):
        errors = validate_state(request)
        return pb.ValidationResult(valid=not errors, errors=errors)

def serve(kind, port):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4), options=[('grpc.max_receive_message_length', 1048576)])
    if kind == 'simulation':
        rpc.add_SimulationServicer_to_server(Simulation(), server)
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

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('kind', choices=['simulation', 'intelligence'])
    parser.add_argument('--port', type=int, default=50051)
    args = parser.parse_args()
    serve(args.kind, args.port)
