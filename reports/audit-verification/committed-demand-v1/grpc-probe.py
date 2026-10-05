import json,secrets,tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import grpc
import twin_pb2 as pb
import twin_pb2_grpc as rpc
from services.shared.server import ServiceIdentity
from services.intelligence.service import Intelligence
from services.intelligence.model import Model
from services.shared.network_config import ROOT
from services.simulation.aggregate_engine import AggregateEngine
rows=[]
for graph in ['c1-c6','three-controlled-junctions']:
 with tempfile.TemporaryDirectory() as d:
  engine=AggregateEngine(config_path=ROOT/'packages/scenario-config'/f'{graph}.json',directory=d)
  engine.reset(pb.RunCommand(schema_version='1.0',run_id='known-release-grpc',scenario_type='peak_surge',seed=1101,mode='recommend'))
  state=engine.copy_state();service=Intelligence();service.model=Model(engine.config)
  link=next(iter(service.model.index.boundary_inputs))
  state.demand_commitments.add(boundary_link_id=link,release_start_simulation_s=1,release_end_simulation_s=20.5,remaining_mass_veh=39,rate_vps=2)
  before=state.SerializeToString();identity=secrets.token_hex(32)
  server=grpc.server(ThreadPoolExecutor(max_workers=2),interceptors=[ServiceIdentity(identity)])
  rpc.add_IntelligenceServicer_to_server(service,server)
  port=server.add_insecure_port('127.0.0.1:0');assert port;server.start()
  try:
   with grpc.insecure_channel(f'127.0.0.1:{port}') as channel:
    stub=rpc.IntelligenceStub(channel);metadata=[('x-service-token',identity)]
    try:stub.Analyze(state,timeout=2);raise AssertionError('Unauthenticated request accepted')
    except grpc.RpcError as e:assert e.code()==grpc.StatusCode.UNAUTHENTICATED
    analysis=stub.Analyze(state,metadata=metadata,timeout=2)
    assert analysis.outcome in ('recommend','no_action'),analysis.outcome_reason
    digest=service.model._evaluation_input(state)['demand_hash']
    command=pb.CompareCommand(state=state,horizon_s=120,demand_assumptions_hash=digest,
       changes=[pb.TimingChange(node_id=service.model.phases[p]['node_id'],phase_id=p,green_s=g) for p,g in service.model.plan(state).items()])
    result=stub.Compare(command,metadata=metadata,timeout=2)
    assert result.scoring_version=='comparison-scoring-v1.4'
    assert result.demand_assumptions_hash==digest
    command.state.demand_commitments[0].remaining_mass_veh=38
    try:stub.Compare(command,metadata=metadata,timeout=2);raise AssertionError('Stale demand identity accepted')
    except grpc.RpcError as e:assert e.code()==grpc.StatusCode.INVALID_ARGUMENT
    assert state.SerializeToString()==before
    rows.append({'graph':graph,'analysis_outcome':analysis.outcome,'comparison_scoring_version':result.scoring_version,'private_authentication':'passed','stale_demand_identity_rejection':'passed','snapshot_immutability':'passed'})
  finally:server.stop(0).wait();engine.close()
Path('reports/audit-verification/committed-demand-v1/grpc-integration.json').write_text(json.dumps({'scope':'Real loopback authenticated private gRPC with complete synthetic engine snapshots and known-release fixtures; not recorded-video, Go/PostgreSQL/browser or human acceptance','cases':rows},indent=2)+'\n')
print('Two graph private authenticated gRPC checks passed')
