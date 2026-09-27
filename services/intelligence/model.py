"""Causal aggregate forecasts and bounded signal-plan evaluation."""
import hashlib, json, math, threading, time, uuid
from datetime import datetime, timezone
import twin_pb2 as pb
from services.shared.network_config import NetworkIndex, ROOT, config_hash, load_config
from services.simulation.flow_kernel import step_cells
from services.simulation.metrics import METRICS_VERSION, link_metrics
from services.simulation.safety import Signals, activation_rejection, default_plan, validate_plan
from services.intelligence.forecast_demand import FORECAST_VERSION, HORIZONS_S, boundary_forecast_rates

MODEL='aggregate-predictor-v1'

class Model:
    def __init__(self,config=None):
        self.config=config or load_config(); self.index=NetworkIndex.build(self.config)
        self.moves,self.links,self.phases,self.nodes=self.index.movements,self.index.links,self.index.phases,self.index.nodes
        self.serving={mid:p['id'] for p in self.phases.values() for mid in p['movement_ids']}
        self.scoring=json.loads((ROOT/'packages/scenario-config/comparison-scoring-v1.json').read_text())
        self._analysis_slots=threading.BoundedSemaphore(self.scoring['max_concurrent_analyses'])
    def plan(self,state): return {c.phase_id:c.green_s for c in state.active_plan} or default_plan(self.config)
    def _evaluation_input(self,state):
        frozen=pb.TrafficState();frozen.CopyFrom(state)
        if frozen.schema_version=='1.1':
            cell_ids=[item.link_id for item in frozen.cells]
            if len(cell_ids)!=len(set(cell_ids)) or set(cell_ids)!=set(self.links):
                raise ValueError('Operating comparison requires a complete cell snapshot')
            if frozen.config_hash!=config_hash(self.config):
                raise ValueError('Operating comparison configuration differs from snapshot')
            if {item.node_id for item in frozen.signals}!=set(self.index.phases_by_node):
                raise ValueError('Operating comparison requires every controlled signal')
            pending={item.phase_id:item.green_s for item in frozen.scheduler.pending_plan}
            if pending and pending!=self.plan(frozen):
                raise ValueError('Operating comparison has a pending virtual plan')
        rates,methods=boundary_forecast_rates(frozen,self.index)
        assumptions={'run_id':frozen.run_id,'input_session_id':frozen.input_session_id,'demand_source':frozen.demand_source,'input_quality':frozen.input_quality,'config_hash':frozen.config_hash,'forecast_origin_source_s':frozen.latest_finalized_window_end_source_s,'rates_vps':rates,'forecast_methods':methods}
        digest=hashlib.sha256(json.dumps(assumptions,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        return {'state':frozen,'cells':self._initial_cells(frozen),'backlogs':{item.link_id:item.backlog_veh for item in frozen.boundary_demand},'rates':rates,'methods':methods,'demand_hash':digest}
    def _score_mode(self,state):
        if state.HasField('emergency'):
            if state.emergency.status in ('pre_clearance','priority'):return 'emergency_priority'
            if state.emergency.status=='recovery':return 'emergency_recovery'
        return 'normal'
    def score_metrics(self,metrics,mode='normal'):
        weights=self.scoring['weights'][mode]
        return sum(weights[key]*metrics[key] for key in weights)
    def _scheduler(self,state,plan):
        scheduler=Signals(self.config); scheduler.plan=dict(self.plan(state)); scheduler.pending=dict(scheduler.plan)
        for signal in state.signals:
            if signal.node_id not in scheduler.nodes:continue
            phases=scheduler.nodes[signal.node_id]; index=next(i for i,p in enumerate(phases) if p['id']==signal.phase_id); scheduler.state[signal.node_id]=[index,signal.indication,max(1,int(signal.remaining_s))]
        if state.HasField('scheduler'):
            scheduler.tick=state.scheduler.tick; scheduler.last_served.update({x.phase_id:x.last_served_tick for x in state.scheduler.service_history}); scheduler.priority={x.node_id:x.phase_id for x in state.scheduler.priority}; scheduler.recovering=state.scheduler.recovering
            if state.scheduler.pending_plan:scheduler.pending={x.phase_id:x.green_s for x in state.scheduler.pending_plan}
        if plan != scheduler.plan:
            scheduler.apply(plan)
        return scheduler
    def _initial_cells(self,state):
        exact={item.link_id:list(item.stock_veh) for item in state.cells}
        if exact and set(exact)==set(self.links):
            return exact
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
    def rollout(self,state,plan,horizon=300,evaluation=None):
        validate_plan(self.config,plan)
        evaluation=evaluation or self._evaluation_input(state)
        frozen=evaluation['state']; cells={edge:list(values) for edge,values in evaluation['cells'].items()}; scheduler=self._scheduler(frozen,plan); rates=evaluation['rates']; saved_backlogs=evaluation['backlogs']; backlogs={e:saved_backlogs.get(e,0.0) for e in self.index.boundary_inputs}
        demand_trace=evaluation.get('demand_trace')
        if demand_trace is not None and (len(demand_trace)!=horizon or any(set(row)!=set(self.index.boundary_inputs) or any(not math.isfinite(value) or value<0 for value in row.values()) for row in demand_trace)):
            raise ValueError('Benchmark demand trace must cover every boundary and rollout tick')
        snapshots={}; arrivals={m:0.0 for m in self.moves}; eta={m:None for m in self.moves}; peak=queue_delay=congested=throughput=boundary_wait=worst_service_debt=0.0
        initial_mass=sum(map(sum,cells.values()))+sum(backlogs.values());offered_total=0.0
        capacity={m:1.0 for m in self.moves}
        if state.HasField('incident') and state.incident.status=='active':
            for mid,m in self.moves.items():
                if m['node_id']==state.incident.node_id:capacity[mid]=state.incident.capacity_ratio
        for tick in range(1,horizon+1):
            external=dict(demand_trace[tick-1]) if demand_trace is not None else dict(rates); permissions=set()
            for node,phases in scheduler.nodes.items():
                index,stage,_=scheduler.state[node]
                if stage=='green':permissions.update(phases[index]['movement_ids'])
            offered_total+=sum(external.values());out=step_cells(self.index,cells,backlogs,external,permissions,capacity); throughput+=sum(out.exited.values())
            for mid,m in self.moves.items():
                arrivals[mid]+=(out.admitted.get(m['incoming_link_id'],0.0)+sum(v for source,v in out.junction_flows.items() if self.moves[source]['outgoing_link_id']==m['incoming_link_id']))*m['turning_ratio']
            queues={}; congested_links=0
            for edge,link in self.links.items():
                metric=link_metrics(link,cells[edge],0,0,1); congested_links+=int(metric['utilization']>=.85)
                for m in self.index.movements_by_incoming.get(edge,[]):
                    queues[m['id']]=metric['queued']*m['turning_ratio']
                    if metric['utilization']>=.85 and eta[m['id']] is None:eta[m['id']]=tick
            peak=max(peak,max(queues.values(),default=0)); queue_delay+=sum(queues.values()); congested+=congested_links;boundary_wait+=sum(backlogs.values());scheduler.advance(lambda: activation_rejection(scheduler,cells,self.links,self.moves))
            if scheduler.rejected_reason:
                raise ValueError(scheduler.rejected_reason)
            active_green={scheduler.nodes[node][entry[0]]['id'] for node,entry in scheduler.state.items() if entry[1]=='green'}
            worst_service_debt=max(worst_service_debt,max((scheduler.tick-scheduler.last_served[pid] for pid in self.phases if pid not in active_green),default=0))
            if tick in (30,60,120,300) and tick<=horizon:snapshots[tick]=(dict(queues),dict(arrivals),dict(eta))
        backlog=sum(backlogs.values()); change=sum(abs(plan[p]-self.plan(frozen)[p]) for p in plan)
        metrics={'queue_delay':queue_delay,'boundary_wait':boundary_wait,'congested':congested,'throughput':throughput,'worst_service_debt':worst_service_debt,'timing_change':change}
        cost=self.score_metrics(metrics,self._score_mode(frozen))
        return {'snapshots':snapshots,'peak':peak,'queue_delay':queue_delay,'throughput':throughput,'congested':congested,'backlog':backlog,'boundary_wait':boundary_wait,'worst_service_debt':worst_service_debt,'delay':queue_delay/max(1,sum(arrivals.values())),'spill':congested,'stops':0.0,'cost':cost,'demand_version':FORECAST_VERSION,'offered_external_veh':offered_total,'mass_residual_veh':initial_mass+offered_total-sum(map(sum,cells.values()))-sum(backlogs.values())-throughput}
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
    def comparison(self,state,changes,rec_id='',recommendation_id=None,evaluation=None,horizon_s=0,demand_assumptions_hash=''):
        rec_id=recommendation_id if recommendation_id is not None else rec_id; plan={c.phase_id:c.green_s for c in changes}
        if len(plan)!=len(changes) or any(c.phase_id not in self.phases or self.phases[c.phase_id]['node_id']!=c.node_id for c in changes):raise ValueError('Duplicate or unknown phase/node')
        evaluation=evaluation or self._evaluation_input(state);frozen=evaluation['state'];horizon=self.scoring['window_s']
        if horizon_s not in (0,horizon):raise ValueError('Comparison horizon differs from configured matched window')
        if demand_assumptions_hash and demand_assumptions_hash!=evaluation['demand_hash']:
            raise ValueError('Comparison demand assumptions differ from the captured snapshot')
        base=self.rollout(frozen,self.plan(frozen),horizon,evaluation);candidate=self.rollout(frozen,plan,horizon,evaluation)
        return pb.ComparisonResult(run_id=frozen.run_id,recommendation_id=rec_id,baseline_max_queue_veh=base['peak'],candidate_max_queue_veh=candidate['peak'],initial_time_s=frozen.simulation_time_s,model_version=MODEL,baseline_spillback_s=base['congested'],candidate_spillback_s=candidate['congested'],horizon_s=horizon,seed=frozen.seed,baseline_queue_delay_veh_s=base['queue_delay'],candidate_queue_delay_veh_s=candidate['queue_delay'],baseline_boundary_throughput_veh=base['throughput'],candidate_boundary_throughput_veh=candidate['throughput'],baseline_congested_link_s=base['congested'],candidate_congested_link_s=candidate['congested'],baseline_boundary_backlog_veh=base['backlog'],candidate_boundary_backlog_veh=candidate['backlog'],baseline_worst_service_debt_s=base['worst_service_debt'],candidate_worst_service_debt_s=candidate['worst_service_debt'],baseline_boundary_wait_veh_s=base['boundary_wait'],candidate_boundary_wait_veh_s=candidate['boundary_wait'],input_session_id=frozen.input_session_id,snapshot_sequence=frozen.snapshot_sequence,config_hash=frozen.config_hash,forecast_origin_source_s=frozen.latest_finalized_window_end_source_s,demand_assumptions_hash=evaluation['demand_hash'],window_start_simulation_s=frozen.simulation_time_s,window_end_simulation_s=frozen.simulation_time_s+horizon,scoring_version=self.scoring['version'],metrics_version=METRICS_VERSION)
    def analyze(self,state):
        if not self._analysis_slots.acquire(blocking=False):
            reason='Analysis concurrency limit reached'
            return self._compute_unavailable(state,reason)
        try:return self._analyze(state)
        finally:self._analysis_slots.release()
    def _compute_unavailable(self,state,reason):
        return pb.Analysis(run_id=state.run_id,simulation_time_s=state.simulation_time_s,input_session_id=state.input_session_id,snapshot_sequence=state.snapshot_sequence,config_hash=state.config_hash,model_version=MODEL,metrics_version=METRICS_VERSION,input_quality=state.input_quality or 'synthetic',outcome='cannot_evaluate',outcome_reason=reason,horizon_availability=[pb.HorizonAvailability(horizon_s=h,status='compute_unavailable',reason=reason) for h in HORIZONS_S])
    def _analyze(self,state):
        started=time.monotonic()
        timeout=self.scoring['analysis_timeout_s']
        def expired():return time.monotonic()-started>=timeout
        try:
            evaluation=self._evaluation_input(state)
        except ValueError as exc:
            reason=str(exc)
            status='stale_input' if 'stale' in reason.lower() or state.input_quality=='stale' else 'missing_input'
            return pb.Analysis(run_id=state.run_id,simulation_time_s=state.simulation_time_s,input_session_id=state.input_session_id,snapshot_sequence=state.snapshot_sequence,config_hash=state.config_hash,model_version=MODEL,metrics_version=METRICS_VERSION,input_quality=state.input_quality,outcome='cannot_evaluate',outcome_reason=reason,horizon_availability=[pb.HorizonAvailability(horizon_s=h,status=status,reason=reason) for h in HORIZONS_S])
        state=evaluation['state'];baseline=self.plan(state)
        if expired():
            return self._compute_unavailable(state,'Analysis timeout')
        try:forecast=self.rollout(state,baseline,evaluation=evaluation)
        except ValueError as exc:return self._compute_unavailable(state,f'Current virtual plan cannot be evaluated safely: {exc}')
        forecasts=[]; critical=warning=False
        source_origin=state.latest_finalized_window_end_source_s if state.HasField('latest_finalized_window_end_source_s') else 0.0
        completed=[]
        if state.demand_source=='video_profile':
            completed=[datetime.fromisoformat(row.processed_at_utc.replace('Z','+00:00')) for row in state.observation_history if row.available_at_source_s<=source_origin]
        input_age=max(0.0,(datetime.fromisoformat(state.timestamp.replace('Z','+00:00'))-max(completed)).total_seconds()) if completed else 0.0
        method='ewma' if evaluation['methods'] and all(value=='ewma' for value in evaluation['methods'].values()) else 'persistence'
        for horizon,(queues,arrivals,etas) in forecast['snapshots'].items():
            for mid,q in queues.items():
                move=self.moves[mid];edge=self.links[move['incoming_link_id']];link_q=sum(queues[x['id']] for x in self.index.movements_by_incoming.get(move['incoming_link_id'],[]));occ=min(1,link_q/edge['storage_capacity_veh']);is_critical=occ>=.9 or etas[mid] is not None;is_warning=occ>=.75;critical|=is_critical;warning|=is_warning
                source=edge['from_node'];eta_text=f'{etas[mid]}s' if etas[mid] is not None else 'not predicted';facts=[f'Upstream source: {"external boundary" if self.nodes[source]["kind"]=="boundary" else "junction"} {source} via corridor {move["incoming_link_id"]}',f'Projected causal arrivals: {arrivals[mid]:.1f} veh over {horizon}s',f'Storage utilization: {occ*100:.1f}%',f'Predicted spillback ETA: {eta_text}',f'Demand forecast: {FORECAST_VERSION}; no hidden scenario schedule']
                item=pb.Forecast(id=f'{state.run_id}-{int(state.simulation_time_s)}-{mid}-{horizon}',run_id=state.run_id,movement_id=mid,horizon_s=horizon,queue_veh=q,occupancy_ratio=occ,arrivals_veh=arrivals[mid],risk='critical' if is_critical else 'warning' if is_warning else 'normal',model_version=MODEL,explanation_facts=facts,method=method,origin_source_s=source_origin,input_age_s=input_age,input_quality=state.input_quality or 'synthetic',horizon_status='available',uncertainty_status='unavailable')
                if etas[mid] is not None:item.spillback_eta_s=etas[mid]
                forecasts.append(item)
        result=pb.Analysis(run_id=state.run_id,simulation_time_s=state.simulation_time_s,forecasts=forecasts,input_session_id=state.input_session_id,snapshot_sequence=state.snapshot_sequence,config_hash=state.config_hash,model_version=MODEL,metrics_version=METRICS_VERSION,forecast_origin_source_s=source_origin,input_quality=state.input_quality or 'synthetic',horizon_availability=[pb.HorizonAvailability(horizon_s=h,status='available') for h in HORIZONS_S])
        if expired():
            result.outcome='cannot_evaluate';result.outcome_reason='Analysis timeout';return result
        try:agda=self.allocate(state)
        except ValueError as exc:
            result.outcome='cannot_evaluate';result.outcome_reason=str(exc);return result
        candidates=self._generate_candidates(state,baseline,agda)[:self.scoring['max_candidates']];scored=[]
        for i,plan in enumerate(candidates):
            if expired():
                result.outcome='cannot_evaluate';result.outcome_reason='Analysis timeout';return result
            try:scored.append((self.rollout(state,plan,self.scoring['window_s'],evaluation)['cost'],i,plan))
            except ValueError:
                if i==0:
                    result.outcome='cannot_evaluate';result.outcome_reason='Current virtual plan cannot be evaluated safely';return result
        if expired():
            result.outcome='cannot_evaluate';result.outcome_reason='Analysis timeout';return result
        if not scored:
            result.outcome='cannot_evaluate';result.outcome_reason='No safe candidate could be evaluated';return result
        baseline_cost=next(score for score,i,_ in scored if i==0)
        scored.sort();best_cost,best_index,_=scored[0]
        if best_index==0 or baseline_cost-best_cost<=self.scoring['minimum_benefit_points']:
            result.outcome='no_action';result.outcome_reason='Current plan is best' if best_index==0 else f'Modeled gain {baseline_cost-best_cost:.3f} weighted points does not exceed minimum benefit {self.scoring["minimum_benefit_points"]:g}';return result
        priority='critical' if critical else 'warning' if warning else 'normal';trigger='spillback_risk' if critical else 'corridor_coordination' if warning else 'demand_balancing'; recommendations=[]
        route=next(s['route_node_ids'] for s in self.config['scenarios'] if s['id']==state.scenario_type)
        controlled=[node for node in route if self.nodes[node]['kind']=='controlled']
        if len(controlled)<2: raise ValueError('Configured route has no controlled corridor')
        corridor=next(link for link in self.links.values() if link['from_node']==controlled[0] and link['to_node']==controlled[1])
        eta=corridor['length_m']/(corridor['free_flow_speed_kph']/3.6)
        for rank,(score,index,plan) in enumerate([entry for entry in scored if entry[1]!=0][:self.scoring['max_alternatives']]):
            identity=(state.run_id,state.input_session_id,state.snapshot_sequence,state.config_hash,source_origin,MODEL,METRICS_VERSION,self.scoring['version'],state.simulation_time_s,sorted(plan.items()))
            rid=str(uuid.uuid5(uuid.NAMESPACE_URL,repr(identity)));changes=[pb.TimingChange(node_id=self.phases[p]['node_id'],phase_id=p,green_s=g) for p,g in plan.items()];summary=' · '.join(f'{c.phase_id}: {int(c.green_s)}s' for c in changes)
            recommendations.append(pb.Recommendation(id=rid,run_id=state.run_id,timestamp=datetime.now(timezone.utc).isoformat(),priority=priority if rank==0 else 'normal',reason=f'Best among {len(scored)} evaluated feasible aggregate plans' if rank==0 else f'Feasible alternative #{rank}',changes=changes,safety_status='requires_fresh_validation',status='pending',input_session_id=state.input_session_id,snapshot_sequence=state.snapshot_sequence,config_hash=state.config_hash,model_version=MODEL,metrics_version=METRICS_VERSION,forecast_origin_source_s=source_origin,explanation_facts=[f'Trigger: {trigger} ({priority.upper()} priority)',f'Upstream corridor: {corridor["id"]} modeled free-flow ETA {eta:.1f}s',f'Coordinated timing: {summary}',f'{self.scoring["window_s"]}-second {self.scoring["version"]} weighted model points: {score:.3f}',f'Minimum modeled gain: {self.scoring["minimum_benefit_points"]:g} weighted points',f'Candidate rank #{rank+1}; not a global optimum','Human approval required; virtual signals only; aggregate-predictor-v1']))
        try:
            comparison=self.comparison(state,recommendations[0].changes,recommendations[0].id,evaluation=evaluation)
        except ValueError as exc:
            result.outcome='cannot_evaluate';result.outcome_reason=str(exc);return result
        if expired():
            result.outcome='cannot_evaluate';result.outcome_reason='Analysis timeout';return result
        result.outcome='recommend';result.recommendation.CopyFrom(recommendations[0]);result.alternatives.extend(recommendations[1:]);result.comparison.CopyFrom(comparison);return result
