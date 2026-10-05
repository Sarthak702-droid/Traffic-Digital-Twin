import json,tempfile,copy
from pathlib import Path
import twin_pb2 as pb
from scripts.prototype_evaluation import perturbed_config
from services.shared.network_config import load_config
from services.simulation.aggregate_engine import AggregateEngine
from services.intelligence.model import Model
from services.intelligence.controller import coordinated_plan
p=json.loads(Path('packages/scenario-config/prototype-evaluation-audit-development-v3.json').read_text())
for graph,condition,origin in [('c1-c6','peak',240),('c1-c6','peak',480),('three-controlled-junctions','peak',240),('three-controlled-junctions','incident',480)]:
 cfg=perturbed_config(load_config(Path('packages/scenario-config/'+graph+'.json')),condition,p['synthetic']['held_out_perturbations'][1],120)
 with tempfile.TemporaryDirectory() as d:
  path=Path(d)/'world.json';path.write_text(json.dumps(cfg));e=AggregateEngine(config_path=path,directory=Path(d)/'r');e.reset(pb.RunCommand(schema_version='1.0',run_id='development',scenario_type='incident_c3' if condition=='incident' else 'peak_surge',seed=1101,mode='recommend'))
  for _ in range(origin):e.step()
  s=e.copy_state();m=Model(cfg);v=m._evaluation_input(s);future=copy.deepcopy(e.demand);actual={**v,'demand_trace':[future.next(origin+i) for i in range(1,121)]};current=m.plan(s);local=m.allocate(s);refs=[]
  for plan in (current,local):
   try:refs.append(m.rollout(s,plan,120,actual))
   except ValueError:refs.append(None)
  for cycle in (140,160,180,200,220):
   for weight in (0,1):
    try:
     plan=coordinated_plan(m.index,cfg,s,current,v,{'cycle_s':cycle,'queue_weight':weight,'receiving_floor':.05},120);r=m.rollout(s,plan,120,actual)
     gain=min(1-r['queue_delay']/ref['queue_delay'] for ref in refs if ref)
     failures={i:m.regression_failures(ref,r) if ref else ['reference_unavailable'] for i,ref in enumerate(refs)}
     print(graph,condition,origin,cycle,weight,'gain',gain,'guards',failures,'plan',plan,flush=True)
    except ValueError as x:print(graph,condition,origin,cycle,weight,'rejected',str(x),flush=True)
  e.close()
