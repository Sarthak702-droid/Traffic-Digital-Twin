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
from services.simulation.safety import Signals
original_next=Signals._next_green
targets={}
def phased(self,node,state):
 if self.applied_at==self.tick and node in targets:
  index=next(i for i,z in enumerate(self.nodes[node]) if z['id']==targets[node]);state[:]=[index,'green',self.plan[targets[node]]]
 else:original_next(self,node,state)
Signals._next_green=phased
for graph,condition,origin in [('c1-c6','peak',240),('c1-c6','peak',480),('three-controlled-junctions','peak',240),('three-controlled-junctions','incident',480)]:
 cfg=perturbed_config(load_config(Path('packages/scenario-config/'+graph+'.json')),condition,p['synthetic']['held_out_perturbations'][1],120)
 with tempfile.TemporaryDirectory() as d:
  path=Path(d)/'world.json';path.write_text(json.dumps(cfg));e=AggregateEngine(config_path=path,directory=Path(d)/'r');e.reset(pb.RunCommand(schema_version='1.0',run_id='development',scenario_type='incident_c3' if condition=='incident' else 'peak_surge',seed=1101,mode='recommend'))
  for _ in range(origin):e.step()
  s=e.copy_state();m=Model(cfg);v=m._evaluation_input(s);future=copy.deepcopy(e.demand);actual={**v,'demand_trace':[future.next(origin+i) for i in range(1,121)]};current=m.plan(s);local=m.allocate(s);targets={};refs=[m.rollout(s,plan,120,actual) for plan in (current,local)];best=None;valid=admissible=beneficial=0
  plans=[current,local,*m._generate_candidates(s,current,local)[2:]]
  for plan in plans:
   for phases in product(*[[z['id'] for z in ps] for ps in m.index.phases_by_node.values()]):
    targets=dict(zip(m.index.phases_by_node,phases))
    # Same timing still needs an actual new approval/clearance boundary.
    old_scheduler=m._scheduler
    def selected(state,plan,offsets=None):
     z=old_scheduler(state,plan,offsets)
     if z.requested_at is None:z.apply(plan)
     return z
    m._scheduler=selected
    try:r=m.rollout(s,plan,120,actual);valid+=1
    except ValueError:continue
    finally:m._scheduler=old_scheduler
    if all(m._admissible(ref,r) for ref in refs):
     admissible+=1;gain=min(1-r['queue_delay']/ref['queue_delay'] for ref in refs)
     if gain>=.05:beneficial+=1
     if best is None or gain>best[0]:best=(gain,plan,dict(targets))
  print(graph,condition,origin,'valid',valid,'admissible',admissible,'beneficial',beneficial,'best',best,flush=True);e.close()
