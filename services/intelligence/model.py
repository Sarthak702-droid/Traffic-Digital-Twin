"""Causal aggregate forecasts and bounded signal-plan evaluation."""
import math, uuid
from datetime import datetime, timezone
import twin_pb2 as pb
from services.shared.network_config import NetworkIndex, load_config
from services.simulation.flow_kernel import step_cells
from services.simulation.metrics import METRICS_VERSION, link_metrics
from services.simulation.safety import Signals, default_plan, validate_plan
from services.intelligence.forecast_demand import FORECAST_VERSION, boundary_rates

MODEL='aggregate-predictor-v1'

class Model:
    def __init__(self,config=None):
        self.config=config or load_config(); self.index=NetworkIndex.build(self.config)
        self.moves,self.links,self.phases,self.nodes=self.index.movements,self.index.links,self.index.phases,self.index.nodes
        self.serving={mid:p['id'] for p in self.phases.values() for mid in p['movement_ids']}
    def plan(self,state): return {c.phase_id:c.green_s for c in state.active_plan} or default_plan(self.config)
    def _scheduler(self,state,plan):
        scheduler=Signals(self.config); scheduler.plan=dict(self.plan(state)); scheduler.pending=dict(scheduler.plan); scheduler.apply(plan)
        for signal in state.signals:
            if signal.node_id not in scheduler.nodes:continue
            phases=scheduler.nodes[signal.node_id]; index=next(i for i,p in enumerate(phases) if p['id']==signal.phase_id); scheduler.state[signal.node_id]=[index,signal.indication,max(1,int(signal.remaining_s))]
        if state.HasField('scheduler'):
            scheduler.tick=state.scheduler.tick; scheduler.last_served.update({x.phase_id:x.last_served_tick for x in state.scheduler.service_history}); scheduler.priority={x.node_id:x.phase_id for x in state.scheduler.priority}; scheduler.recovering=state.scheduler.recovering
            if state.scheduler.pending_plan:scheduler.pending={x.phase_id:x.green_s for x in state.scheduler.pending_plan}
            scheduler.apply(plan)
        return scheduler
    def _initial_cells(self,state):
        cell_length=float(self.config.get('flow_model',{}).get('cell_length_m',40)); public={x.link_id:x for x in state.links}; cells={}
        movement={x.movement_id:x for x in state.movements}
        for edge,link in self.links.items():
            count=max(1,math.ceil(link['length_m']/cell_length)); stock=public[edge].stock_veh if edge in public else sum(movement[item['id']].vehicle_count for item in self.index.movements_by_incoming.get(edge,[]) if item['id'] in movement)
            queued=public[edge].queued_veh_estimate if edge in public else sum(movement[item['id']].queue_veh for item in self.index.movements_by_incoming.get(edge,[]) if item['id'] in movement)
            values=[max(0.0,stock-queued)/count]*count; remaining=min(stock,queued); cap=link['storage_capacity_veh']/count
            for i in range(count-1,-1,-1):
                add=min(remaining,max(0.0,cap-values[i])); values[i]+=add;remaining-=add
            cells[edge]=values
        return cells
    def rollout(self,state,plan,horizon=300):
        validate_plan(self.config,plan); cells=self._initial_cells(state); scheduler=self._scheduler(state,plan); rates=boundary_rates(state,self.index); backlogs={e:0.0 for e in self.index.boundary_inputs}
        snapshots={}; arrivals={m:0.0 for m in self.moves}; eta={m:None for m in self.moves}; peak=queue_delay=congested=throughput=0.0
        capacity={m:1.0 for m in self.moves}
        if state.HasField('incident') and state.incident.status=='active':
            for mid,m in self.moves.items():
                if m['node_id']==state.incident.node_id:capacity[mid]=state.incident.capacity_ratio
        for tick in range(1,horizon+1):
            external=dict(rates); permissions=set()
            for node,phases in scheduler.nodes.items():
                index,stage,_=scheduler.state[node]
                if stage=='green':permissions.update(phases[index]['movement_ids'])
            out=step_cells(self.index,cells,backlogs,external,permissions,capacity); throughput+=sum(out.exited.values())
            for mid,m in self.moves.items():
                arrivals[mid]+=(out.admitted.get(m['incoming_link_id'],0.0)+sum(v for source,v in out.junction_flows.items() if self.moves[source]['outgoing_link_id']==m['incoming_link_id']))*m['turning_ratio']
            queues={}; congested_links=0
            for edge,link in self.links.items():
                metric=link_metrics(link,cells[edge],0,0,1); congested_links+=int(metric['utilization']>=.85)
                for m in self.index.movements_by_incoming.get(edge,[]):
                    queues[m['id']]=metric['queued']*m['turning_ratio']
                    if metric['utilization']>=.85 and eta[m['id']] is None:eta[m['id']]=tick
            peak=max(peak,max(queues.values(),default=0)); queue_delay+=sum(queues.values()); congested+=congested_links; scheduler.advance()
            if tick in (30,60,120,300) and tick<=horizon:snapshots[tick]=(dict(queues),dict(arrivals),dict(eta))
        backlog=sum(backlogs.values()); change=sum(abs(plan[p]-self.plan(state)[p]) for p in plan)
        cost=queue_delay/max(1,100*horizon)+3*congested/max(1,horizon)+2*backlog/50+.25*change/30
        return {'snapshots':snapshots,'peak':peak,'queue_delay':queue_delay,'throughput':throughput,'congested':congested,'backlog':backlog,'delay':queue_delay/max(1,sum(arrivals.values())),'spill':congested,'stops':0.0,'cost':cost,'demand_version':FORECAST_VERSION}
    def allocate(self,state):
        values={m.movement_id:m for m in state.movements}; current=self.plan(state); plan={}
        for node in sorted({p['node_id'] for p in self.phases.values()}):
            phases=[p for p in self.phases.values() if p['node_id']==node]; budget=sum(current[p['id']] for p in phases); min_sum=sum(p['min_green_s'] for p in phases); max_sum=sum(p['max_green_s'] for p in phases)
            if budget<min_sum:raise ValueError(f'Infeasible green budget for node {node}: {budget}s < min green sum {min_sum}s')
            if budget>max_sum:raise ValueError(f'Infeasible green budget for node {node}: {budget}s > max green sum {max_sum}s')
            weights=[]
            for p in phases:
                score=0.0
                for mid in p['movement_ids']:
                    m=values[mid]; move=self.moves[mid]; incoming=self.links[move['incoming_link_id']]; outgoing=self.links[move['outgoing_link_id']]; out_storage=outgoing['storage_capacity_veh']; downstream=max(0,min(1,(out_storage-m.downstream_capacity_veh)/out_storage)); receiving=max(0,1-downstream**2)
                    need=m.queue_veh/max(1,incoming['storage_capacity_veh']*move['turning_ratio'])+.8*(m.arrival_rate_vpm*.5)/max(1,incoming['storage_capacity_veh']*move['turning_ratio'])+.4*min(3,m.waiting_age_s/60); score+=need*receiving*(1+min(3,m.waiting_age_s/45))
                if state.HasField('emergency') and state.emergency.status in ('pre_clearance','priority'):
                    route=list(state.emergency.route_node_ids)
                    if any((self.links[self.moves[mid]['incoming_link_id']]['from_node'],node,self.links[self.moves[mid]['outgoing_link_id']]['to_node']) in list(zip(route,route[1:],route[2:])) for mid in p['movement_ids']):score+=60
                if state.HasField('incident') and state.incident.status=='active' and node==state.incident.node_id:score*=max(0,state.incident.capacity_ratio)
                weights.append(max(.01,score))
            flex=budget-min_sum; total=sum(weights)
            for p,w in zip(phases,weights):plan[p['id']]=max(int(p['min_green_s']),min(int(p['max_green_s']),int(p['min_green_s']+round(flex*w/total))))
            diff=int(budget-sum(plan[p['id']] for p in phases))
            while diff:
                eligible=[(i,p) for i,p in enumerate(phases) if (diff>0 and plan[p['id']]<p['max_green_s']) or (diff<0 and plan[p['id']]>p['min_green_s'])]
                if not eligible:break
                _,p=(max(eligible,key=lambda x:weights[x[0]]) if diff>0 else min(eligible,key=lambda x:weights[x[0]]));plan[p['id']]+=1 if diff>0 else -1;diff+=-1 if diff>0 else 1
        validate_plan(self.config,plan);return plan
    def _generate_candidates(self,state,baseline,agda):
        candidates=[dict(baseline),dict(agda)]
        for delta in (-5,5,10):
            candidate=dict(agda)
            for node in sorted(self.index.phases_by_node):
                phases=self.index.phases_by_node[node]
                if len(phases)<2:continue
                a,b=phases[0],phases[1]; actual=max(-candidate[a['id']]+a['min_green_s'],min(delta,a['max_green_s']-candidate[a['id']],candidate[b['id']]-b['min_green_s'],b['max_green_s']-candidate[b['id']]))
                candidate[a['id']]+=actual;candidate[b['id']]-=actual
            try:validate_plan(self.config,candidate);candidates.append(candidate)
            except ValueError:pass
        seen=set();return [p for p in candidates if not (tuple(sorted(p.items())) in seen or seen.add(tuple(sorted(p.items()))))]
    def comparison(self,state,changes,rec_id='',recommendation_id=None):
        rec_id=recommendation_id if recommendation_id is not None else rec_id; plan={c.phase_id:c.green_s for c in changes}
        if len(plan)!=len(changes) or any(c.phase_id not in self.phases or self.phases[c.phase_id]['node_id']!=c.node_id for c in changes):raise ValueError('Duplicate or unknown phase/node')
        base=self.rollout(state,self.plan(state),120);candidate=self.rollout(state,plan,120)
        return pb.ComparisonResult(run_id=state.run_id,recommendation_id=rec_id,baseline_max_queue_veh=base['peak'],candidate_max_queue_veh=candidate['peak'],baseline_avg_delay_s=base['delay'],candidate_avg_delay_s=candidate['delay'],initial_time_s=state.simulation_time_s,model_version=MODEL,baseline_spillback_s=base['congested'],candidate_spillback_s=candidate['congested'],horizon_s=120,seed=state.seed,baseline_queue_delay_veh_s=base['queue_delay'],candidate_queue_delay_veh_s=candidate['queue_delay'],baseline_boundary_throughput_veh=base['throughput'],candidate_boundary_throughput_veh=candidate['throughput'],baseline_congested_link_s=base['congested'],candidate_congested_link_s=candidate['congested'],baseline_boundary_backlog_veh=base['backlog'],candidate_boundary_backlog_veh=candidate['backlog'],metrics_version=METRICS_VERSION)
    def analyze(self,state):
        baseline=self.plan(state); forecast=self.rollout(state,baseline); forecasts=[]; critical=warning=False
        for horizon,(queues,arrivals,etas) in forecast['snapshots'].items():
            for mid,q in queues.items():
                move=self.moves[mid];edge=self.links[move['incoming_link_id']];link_q=sum(queues[x['id']] for x in self.index.movements_by_incoming.get(move['incoming_link_id'],[]));occ=min(1,link_q/edge['storage_capacity_veh']);is_critical=occ>=.9 or etas[mid] is not None;is_warning=occ>=.75;critical|=is_critical;warning|=is_warning
                source=edge['from_node'];eta_text=f'{etas[mid]}s' if etas[mid] is not None else 'not predicted';facts=[f'Upstream source: {"external boundary" if self.nodes[source]["kind"]=="boundary" else "junction"} {source} via corridor {move["incoming_link_id"]}',f'Projected causal arrivals: {arrivals[mid]:.1f} veh over {horizon}s',f'Storage utilization: {occ*100:.1f}%',f'Predicted spillback ETA: {eta_text}',f'Demand forecast: {FORECAST_VERSION}; no hidden scenario schedule']
                item=pb.Forecast(id=f'{state.run_id}-{int(state.simulation_time_s)}-{mid}-{horizon}',run_id=state.run_id,movement_id=mid,horizon_s=horizon,queue_veh=q,occupancy_ratio=occ,arrivals_veh=arrivals[mid],risk='critical' if is_critical else 'warning' if is_warning else 'normal',model_version=MODEL,explanation_facts=facts)
                if etas[mid] is not None:item.spillback_eta_s=etas[mid]
                forecasts.append(item)
        agda=self.allocate(state);candidates=self._generate_candidates(state,baseline,agda);scored=sorted((self.rollout(state,p,120)['cost'],i,p) for i,p in enumerate(candidates));priority='critical' if critical else 'warning' if warning else 'normal';trigger='spillback_risk' if critical else 'corridor_coordination' if warning else 'demand_balancing'; recommendations=[]
        eta=self.links['C3-C1']['length_m']/(self.links['C3-C1']['free_flow_speed_kph']/3.6)
        for rank,(score,_,plan) in enumerate(scored[:3]):
            rid=str(uuid.uuid5(uuid.NAMESPACE_URL,f'{state.run_id}:{state.simulation_time_s}:{sorted(plan.items())}'));changes=[pb.TimingChange(node_id=self.phases[p]['node_id'],phase_id=p,green_s=g) for p,g in plan.items()];summary=' · '.join(f'{c.phase_id}: {int(c.green_s)}s' for c in changes)
            recommendations.append(pb.Recommendation(id=rid,run_id=state.run_id,timestamp=datetime.now(timezone.utc).isoformat(),priority=priority if rank==0 else 'normal',reason=f'Best among {len(candidates)} evaluated feasible aggregate plans' if rank==0 else f'Feasible alternative #{rank}',changes=changes,safety_status='requires_fresh_validation',status='pending',explanation_facts=[f'Trigger: {trigger} ({priority.upper()} priority)',f'Upstream corridor: C3-C1 modeled free-flow ETA {eta:.1f}s',f'Coordinated timing: {summary}',f'120-second PN-MPC normalized cost: {score:.3f}',f'Candidate rank #{rank+1}; not a global optimum','Human approval required; virtual signals only; aggregate-predictor-v1']))
        result=pb.Analysis(run_id=state.run_id,simulation_time_s=state.simulation_time_s,forecasts=forecasts,recommendation=recommendations[0],alternatives=recommendations[1:]);result.comparison.CopyFrom(self.comparison(state,result.recommendation.changes,result.recommendation.id));return result
