import json,random,tempfile,copy
from pathlib import Path
import twin_pb2 as pb
from scripts.prototype_evaluation import perturbed_config
from services.shared.network_config import load_config
from services.simulation.aggregate_engine import AggregateEngine
from services.intelligence.model import Model
from services.simulation.safety import validate_plan
p=json.loads(Path('packages/scenario-config/prototype-evaluation-audit-development-v3.json').read_text());rng=random.Random(1101)

for origin in (240,480):
 cfg=perturbed_config(load_config(Path('packages/scenario-config/c1-c6.json')),'peak',p['synthetic']['held_out_perturbations'][1],120)
 with tempfile.TemporaryDirectory() as d:
  path=Path(d)/'world.json';path.write_text(json.dumps(cfg));e=AggregateEngine(config_path=path,directory=Path(d)/'r');e.reset(pb.RunCommand(schema_version='1.0',run_id='development',scenario_type='peak_surge',seed=1101,mode='recommend'))
  for _ in range(origin):e.step()
  s=e.copy_state();m=Model(cfg);v=m._evaluation_input(s);future=copy.deepcopy(e.demand);actual={**v,'demand_trace':[future.next(origin+i) for i in range(1,121)]};current=m.plan(s);local=m.allocate(s);refs=[m.rollout(s,plan,120,actual) for plan in (current,local)]
  limits=m.regression;bounds={'queue_delay':min(z['queue_delay'] for z in refs)*.95,'backlog':min(z['backlog'] for z in refs)*1.02,'boundary_wait':min(z['boundary_wait'] for z in refs)*1.02,'congested':min(z['congested'] for z in refs)*1.02,'worst_service_debt':min(z['worst_service_debt'] for z in refs)*1.1,'throughput':max(z['throughput'] for z in refs)*.98};cache={};best=None
  def score(plan):
   global best
   key=tuple(plan.items())
   if key in cache:return cache[key]
   try:validate_plan(cfg,plan);r=m.rollout(s,plan,120,actual)
   except ValueError:return (100,None)
   residuals={k:max(0,(bounds[k]-r[k] if k=='throughput' else r[k]-bounds[k])/max(1,bounds[k])) for k in bounds};penalty=sum(x*x for x in residuals.values());cache[key]=(penalty,r)
   if best is None or penalty<best[0]:best=(penalty,dict(plan),residuals)
   return cache[key]
  starts=[current,local,*m._generate_candidates(s,current,local)[2:]]
  for start in starts:
   plan=dict(start)
   for step in (6,3,1):
    for _ in range(10):
     old=score(plan)[0];trial=(old,plan)
     for pid in plan:
      for delta in (-step,step):
       q={**plan,pid:plan[pid]+delta};value=score(q)[0]
       if value<trial[0]-1e-12:trial=(value,q)
     if trial[0]>=old-1e-12:break
     plan=trial[1]
  print('development actual-trace diagnostic',origin,'visited',len(cache),'best',best,flush=True);e.close()
