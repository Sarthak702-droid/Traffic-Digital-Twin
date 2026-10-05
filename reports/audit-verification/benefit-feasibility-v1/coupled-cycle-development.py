import json,random,tempfile,copy
from pathlib import Path
import twin_pb2 as pb
from scripts.prototype_evaluation import perturbed_config
from services.shared.network_config import load_config
from services.simulation.aggregate_engine import AggregateEngine
from services.intelligence.model import Model
from services.simulation.safety import validate_plan
p=json.loads(Path('packages/scenario-config/prototype-evaluation-audit-development-v3.json').read_text());rng=random.Random(1101)

from itertools import product
for graph,condition,origin in [('c1-c6','peak',240),('c1-c6','peak',480)]:
 cfg=perturbed_config(load_config(Path('packages/scenario-config/'+graph+'.json')),condition,p['synthetic']['held_out_perturbations'][1],120)
 with tempfile.TemporaryDirectory() as d:
  path=Path(d)/'world.json';path.write_text(json.dumps(cfg));e=AggregateEngine(config_path=path,directory=Path(d)/'r');e.reset(pb.RunCommand(schema_version='1.0',run_id='development',scenario_type='peak_surge',seed=1101,mode='recommend'))
  for _ in range(origin):e.step()
  s=e.copy_state();m=Model(cfg);v=m._evaluation_input(s);future=copy.deepcopy(e.demand);actual={**v,'demand_trace':[future.next(origin+i) for i in range(1,121)]};current=m.plan(s);local=m.allocate(s);refs=[m.rollout(s,plan,120,actual) for plan in (current,local)];best=None;valid=admissible=beneficial=0
  for green,other,feeder,offset in product((30,40,50,55),(10,15,20,25),(20,25,30,35,40),(0,3,6,9)):
   plan={pid:other for pid in m.phases};plan['C1-FROM-C3']=green;plan['C3-FROM-C6']=feeder;plan['C3-FROM-C1']=60-feeder;offsets={'C1':0,'C3':offset}
   try:validate_plan(cfg,plan);r=m.rollout(s,plan,120,actual,offsets=offsets);valid+=1
   except ValueError:continue
   if all(m._admissible(ref,r) for ref in refs):
    admissible+=1;gain=min(1-r['queue_delay']/ref['queue_delay'] for ref in refs)
    if gain>=.05:beneficial+=1
    if best is None or gain>best[0]:
     projected=m.rollout(s,plan,120,v,offsets=offsets);pref=[m.rollout(s,z,120,v) for z in (current,local)];best=(gain,plan,offsets,[m.regression_failures(z,projected) for z in pref])
  print(graph,condition,origin,'valid',valid,'admissible',admissible,'beneficial',beneficial,'best',best,flush=True);e.close()
