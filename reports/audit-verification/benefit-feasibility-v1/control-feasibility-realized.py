import json,random,tempfile,copy
from pathlib import Path
import twin_pb2 as pb
from scripts.prototype_evaluation import perturbed_config
from services.shared.network_config import load_config
from services.simulation.aggregate_engine import AggregateEngine
from services.intelligence.model import Model
from services.simulation.safety import validate_plan
p=json.loads(Path('packages/scenario-config/prototype-evaluation-audit-development-v3.json').read_text());rng=random.Random(1101)
for graph,condition,origin in [('c1-c6','peak',240),('c1-c6','peak',480),('three-controlled-junctions','peak',240),('three-controlled-junctions','incident',480)]:
 cfg=perturbed_config(load_config(Path('packages/scenario-config/'+graph+'.json')),condition,p['synthetic']['held_out_perturbations'][1],120)
 with tempfile.TemporaryDirectory() as d:
  path=Path(d)/'world.json';path.write_text(json.dumps(cfg));e=AggregateEngine(config_path=path,directory=Path(d)/'r');e.reset(pb.RunCommand(schema_version='1.0',run_id='development',scenario_type='incident_c3' if condition=='incident' else 'peak_surge',seed=1101,mode='recommend'))
  for _ in range(origin):e.step()
  s=e.copy_state();m=Model(cfg);v=m._evaluation_input(s);future=copy.deepcopy(e.demand);actual={**v,'demand_trace':[future.next(origin+i) for i in range(1,121)]};current=m.plan(s);local=m.allocate(s);refs=[]
  for plan in (current,local):
   try:refs.append(m.rollout(s,plan,120,actual))
   except ValueError:refs.append(None)
  best=None;valid=admissible=beneficial=0;rejections={}
  for _ in range(400):
   plan={pid:rng.randint(phase['min_green_s'],phase['max_green_s']) for pid,phase in m.phases.items()};offsets={node:rng.randrange(11) for node in m.index.phases_by_node}
   try:
    validate_plan(cfg,plan);r=m.rollout(s,plan,120,actual,offsets=offsets);valid+=1
   except ValueError as ex:rejections[str(ex)]=rejections.get(str(ex),0)+1;continue
   if all(ref is not None and m._admissible(ref,r) for ref in refs):
    admissible+=1;gain=min(1-r['queue_delay']/ref['queue_delay'] for ref in refs)
    if gain>=.05:beneficial+=1
    if best is None or gain>best[0]:best=(gain,plan,offsets)
  print(graph,condition,origin,'refs',[{k:r[k] for k in ('queue_delay','congested','boundary_wait','backlog')} if r else None for r in refs], 'valid',valid,'admissible',admissible,'beneficial',beneficial,'best',best,'rejections',rejections,flush=True);e.close()
