"""Private gRPC services; the browser communicates through Go only."""
import argparse
from concurrent import futures
import grpc
import twin_pb2 as pb
import twin_pb2_grpc as rpc
from services.shared.validation import validate_state

from services.intelligence.service import Intelligence

def serve(kind, port):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4), options=[('grpc.max_receive_message_length', 1048576)])
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
