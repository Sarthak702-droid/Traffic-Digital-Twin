"""Causal aggregate forecasts and bounded signal-plan evaluation."""
import hashlib, json, math, threading, time, uuid
from contextlib import contextmanager

class ComputeBudgetError(RuntimeError):
    pass
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
        self._request=threading.local()
        self.regression=json.loads((ROOT/'packages/scenario-config/prototype-evaluation-v1.json').read_text())['control']
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
            if frozen.scheduler.HasField('requested_at_tick') or pending and pending!=self.plan(frozen):
                raise ValueError('Operating comparison has a pending virtual plan')
        rates,methods=boundary_forecast_rates(frozen,self.index)
        assumptions={'run_id':frozen.run_id,'input_session_id':frozen.input_session_id,'demand_source':frozen.demand_source,'input_quality':frozen.input_quality,'config_hash':frozen.config_hash,'forecast_origin_source_s':frozen.latest_finalized_window_end_source_s,'source_mapping': {'source_origin_s':frozen.source_time_mapping.source_origin_s,'simulation_origin_s':frozen.source_time_mapping.simulation_origin_s,'rate':frozen.source_time_mapping.source_seconds_per_simulation_second},'source_availability_watermark_s':frozen.snapshot_source_available_s if frozen.HasField('snapshot_source_available_s') else None,'rates_vps':rates,'forecast_methods':methods,'commitments':[{'link':c.boundary_link_id,'start':c.release_start_simulation_s,'end':c.release_end_simulation_s,'remaining':c.remaining_mass_veh,'rate':c.rate_vps} for c in frozen.demand_commitments]}
        digest=hashlib.sha256(json.dumps(assumptions,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        return {'state':frozen,'cells':self._initial_cells(frozen),'backlogs':{item.link_id:item.backlog_veh for item in frozen.boundary_demand},'rates':rates,'methods':methods,'demand_hash':digest}
    def _admissible(self,baseline,candidate,require_benefit=True):
        limits=self.regression
        if require_benefit and candidate['queue_delay']>baseline['queue_delay']+1e-9:return False
        if candidate['throughput']<baseline['throughput']*(1-limits['boundary_exits_regression_max']):return False
        for key,limit in [('backlog','boundary_backlog_regression_max'),('boundary_wait','boundary_wait_regression_max'),('congested','spillback_exposure_regression_max'),('worst_service_debt','worst_service_debt_regression_max')]:
            if candidate[key]>baseline[key]*(1+limits[limit])+1e-9:return False
        return True
    def _score_mode(self,state):
        if state.HasField('emergency'):
            if state.emergency.status in ('pre_clearance','priority'):return 'emergency_priority'
            if state.emergency.status=='recovery':return 'emergency_recovery'
        return 'normal'
    def score_metrics(self,metrics,mode='normal'):
        weights=self.scoring['weights'][mode]
        return sum(weights[key]*metrics[key] for key in weights)
    def _scheduler(self,state,plan,offsets=None):
        scheduler=Signals(self.config); scheduler.plan=dict(self.plan(state)); scheduler.pending=dict(scheduler.plan)
        for signal in state.signals:
            if signal.node_id not in scheduler.nodes:continue
            phases=scheduler.nodes[signal.node_id]; index=next(i for i,p in enumerate(phases) if p['id']==signal.phase_id); scheduler.state[signal.node_id]=[index,signal.indication,max(1,int(signal.remaining_s))]
        if state.HasField('scheduler'):
            scheduler.tick=state.scheduler.tick; scheduler.last_served.update({x.phase_id:x.last_served_tick for x in state.scheduler.service_history}); scheduler.priority={x.node_id:x.phase_id for x in state.scheduler.priority}; scheduler.recovering=state.scheduler.recovering
            if state.scheduler.pending_plan:scheduler.pending={x.phase_id:x.green_s for x in state.scheduler.pending_plan}
            scheduler.activate_not_before=state.scheduler.activate_not_before_tick
            scheduler.offsets.update({x.node_id:x.offset_s for x in state.scheduler.offsets})
            scheduler.release_at={x.node_id:x.release_tick for x in state.scheduler.releases}
            scheduler.waiting=set(state.scheduler.waiting_node_ids)
            scheduler.requested_at=state.scheduler.requested_at_tick if state.scheduler.HasField('requested_at_tick') else None
            scheduler.applied_at=state.scheduler.applied_at_tick if state.scheduler.HasField('applied_at_tick') else None
            # A terminal receipt is historical evidence, not a pending-plan
            # failure in this new rollout. Fresh activation failures below
            # remain fatal and retain all safety constraints.
            scheduler.rejected_reason=(state.scheduler.rejected_reason or None) if scheduler.requested_at is not None else None
        if plan != scheduler.plan or offsets and any(offsets.values()):
            scheduler.apply(plan,offsets=offsets)
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
    def rollout(self,state,plan,horizon=300,evaluation=None,offsets=None):
        validate_plan(self.config,plan)
        evaluation=evaluation or self._evaluation_input(state)
        frozen=evaluation['state']; cells={edge:list(values) for edge,values in evaluation['cells'].items()}; scheduler=self._scheduler(frozen,plan,offsets); rates=evaluation['rates']; saved_backlogs=evaluation['backlogs']; backlogs={e:saved_backlogs.get(e,0.0) for e in self.index.boundary_inputs}
        demand_trace=evaluation.get('demand_trace')
        if demand_trace is not None and (len(demand_trace)!=horizon or any(set(row)!=set(self.index.boundary_inputs) or any(not math.isfinite(value) or value<0 for value in row.values()) for row in demand_trace)):
            raise ValueError('Benchmark demand trace must cover every boundary and rollout tick')
        snapshots={}; arrivals={m:0.0 for m in self.moves}; eta={m:None for m in self.moves}; peak=queue_delay=congested=throughput=boundary_wait=worst_service_debt=0.0
        initial_mass=sum(map(sum,cells.values()))+sum(backlogs.values());offered_total=0.0
        commitments=[{'link':c.boundary_link_id,'start':c.release_start_simulation_s,'end':c.release_end_simulation_s,'remaining':c.remaining_mass_veh,'rate':c.rate_vps} for c in frozen.demand_commitments]
        for c in commitments:
            if c['link'] not in rates or not all(math.isfinite(c[k]) and c[k]>=0 for k in ('start','end','remaining','rate')) or c['end']<=c['start']:raise ValueError('Invalid known demand commitment')
        known_end={link:max((c['end'] for c in commitments if c['link']==link),default=-1) for link in rates}
        capacity={m:1.0 for m in self.moves}
        if state.HasField('incident') and state.incident.status=='active':
            for mid,m in self.moves.items():
                if m['node_id']==state.incident.node_id:capacity[mid]=state.incident.capacity_ratio
        for tick in range(1,horizon+1):
            self._check_budget()
            external=dict(demand_trace[tick-1]) if demand_trace is not None else dict(rates); permissions=set()
            if demand_trace is None and commitments:
                now=frozen.simulation_time_s+tick
                for link in external:
                    if now<known_end[link]:external[link]=0.0
                for c in commitments:
                    overlap=max(0,min(now+1,c['end'])-max(now,c['start']))
                    amount=min(c['remaining'],overlap*c['rate']);c['remaining']-=amount
                    external[c['link']]+=amount

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
        backlog=sum(backlogs.values()); change=sum(abs(plan[p]-self.plan(frozen)[p]) for p in plan)+sum((offsets or {}).values())
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
        # These two slots are semantic references, even if their timings match.
        # Deduplicating them shifts index 1 to an unrelated alternative and
        # silently loses the local-adaptive regression baseline.
        candidates=[dict(baseline),dict(agda)]
        # Joint corrections cover every configured node within the same bounded
        # budget. Interpolate integer splits without changing a node's cycle.
        for fraction in (0.5,0.25,0.75):
            candidate={}
            for phases in self.index.phases_by_node.values():
                values={p['id']:baseline[p['id']]+fraction*(agda[p['id']]-baseline[p['id']]) for p in phases}
                rounded={pid:math.floor(value) for pid,value in values.items()}
                remaining=int(sum(baseline[p['id']] for p in phases)-sum(rounded.values()))
                for pid in sorted(values,key=lambda pid:(-(values[pid]-rounded[pid]),pid))[:remaining]:
                    rounded[pid]+=1
                candidate.update(rounded)
            validate_plan(self.config,candidate)
            candidates.append(candidate)
        return candidates[:self.scoring['max_candidates']]
    def _authority_admissible(self,state,plan,offsets):
        if state.control_mode and state.control_mode!='recommend':return False
        locked=set(state.locked_targets);current=self.plan(state)
        current_offsets={x.node_id:x.offset_s for x in state.scheduler.offsets}
        for phase in self.config['phases']:
            if phase['id'] in locked or locked.intersection(phase['movement_ids']):
                if plan[phase['id']]!=current[phase['id']] or offsets.get(phase['node_id'],0)!=current_offsets.get(phase['node_id'],0):return False
        return True
    def _candidate_offsets(self,state,index):
        if index<3:return {}
        route=next(s['route_node_ids'] for s in self.config['scenarios'] if s['id']==state.scenario_type)
        controlled=[n for n in route if n in self.index.phases_by_node]
        offsets={};elapsed=0.0
        for left,right in zip(controlled,controlled[1:]):
            link=next((l for l in self.links.values() if l['from_node']==left and l['to_node']==right),None)
            if link is None:continue
            elapsed+=link['length_m']/(link['free_flow_speed_kph']/3.6)
            limit=min(p['max_red_s'] for p in self.index.phases_by_node[right])
            offsets[right]=min(limit,max(0,round(elapsed*(0.5 if index==3 else 1.0))))
        return offsets
    def _comparison(self,state,changes,rec_id='',recommendation_id=None,evaluation=None,horizon_s=0,demand_assumptions_hash=''):
        rec_id=recommendation_id if recommendation_id is not None else rec_id; plan={c.phase_id:c.green_s for c in changes}
        if len(plan)!=len(changes) or any(c.phase_id not in self.phases or self.phases[c.phase_id]['node_id']!=c.node_id for c in changes):raise ValueError('Duplicate or unknown phase/node')
        offsets={}
        for change in changes:
            value=change.offset_s if change.HasField('offset_s') else 0
            if change.node_id in offsets and offsets[change.node_id]!=value:raise ValueError('Conflicting offsets for one node')
            offsets[change.node_id]=value
        # Validate even an unchanged plan: an offset is an actual corridor
        # activation, never display metadata which comparison may discard.
        validation=Signals(self.config);validation.apply(plan,offsets=offsets)
        evaluation=evaluation or self._evaluation_input(state);frozen=evaluation['state'];horizon=self.scoring['window_s']
        if horizon_s not in (0,horizon):raise ValueError('Comparison horizon differs from configured matched window')
        if demand_assumptions_hash and demand_assumptions_hash!=evaluation['demand_hash']:
            raise ValueError('Comparison demand assumptions differ from the captured snapshot')
        base=self.rollout(frozen,self.plan(frozen),horizon,evaluation);candidate=self.rollout(frozen,plan,horizon,evaluation,offsets=offsets)
        return pb.ComparisonResult(run_id=frozen.run_id,recommendation_id=rec_id,baseline_max_queue_veh=base['peak'],candidate_max_queue_veh=candidate['peak'],initial_time_s=frozen.simulation_time_s,model_version=MODEL,baseline_spillback_s=base['congested'],candidate_spillback_s=candidate['congested'],horizon_s=horizon,seed=frozen.seed,baseline_queue_delay_veh_s=base['queue_delay'],candidate_queue_delay_veh_s=candidate['queue_delay'],baseline_boundary_throughput_veh=base['throughput'],candidate_boundary_throughput_veh=candidate['throughput'],baseline_congested_link_s=base['congested'],candidate_congested_link_s=candidate['congested'],baseline_boundary_backlog_veh=base['backlog'],candidate_boundary_backlog_veh=candidate['backlog'],baseline_worst_service_debt_s=base['worst_service_debt'],candidate_worst_service_debt_s=candidate['worst_service_debt'],baseline_boundary_wait_veh_s=base['boundary_wait'],candidate_boundary_wait_veh_s=candidate['boundary_wait'],input_session_id=frozen.input_session_id,snapshot_sequence=frozen.snapshot_sequence,config_hash=frozen.config_hash,forecast_origin_source_s=frozen.latest_finalized_window_end_source_s,demand_assumptions_hash=evaluation['demand_hash'],window_start_simulation_s=frozen.simulation_time_s,window_end_simulation_s=frozen.simulation_time_s+horizon,scoring_version=self.scoring['version'],metrics_version=METRICS_VERSION)
    @contextmanager
    def _admission(self,context=None):
        if getattr(self._request,'active',False):
            yield;return
        if not self._analysis_slots.acquire(blocking=False):raise ComputeBudgetError('Analysis concurrency limit reached')
        self._request.active=True
        try:
            remaining=getattr(context,'time_remaining',lambda:None)() if context is not None else None
            self._request.deadline=time.monotonic()+min(self.scoring['analysis_timeout_s'],remaining if remaining is not None else self.scoring['analysis_timeout_s'])
            self._request.context=context
            self._check_budget();yield;self._check_budget()
        finally:
            self._request.active=False;self._analysis_slots.release()
    def _check_budget(self):
        if not getattr(self._request,'active',False):return
        context=self._request.context
        if context is not None and not getattr(context,'is_active',lambda:True)():raise ComputeBudgetError('Analysis cancelled')
        if time.monotonic()>=self._request.deadline:raise ComputeBudgetError('Analysis timeout deadline exceeded')
    def comparison(self,*args,context=None,**kwargs):
        with self._admission(context):return self._comparison(*args,**kwargs)
    def analyze(self,state,context=None):
        try:
            with self._admission(context):return self._analyze(state)
        except ComputeBudgetError as exc:return self._compute_unavailable(state,str(exc))
    def _compute_unavailable(self,state,reason):
        return pb.Analysis(run_id=state.run_id,simulation_time_s=state.simulation_time_s,input_session_id=state.input_session_id,snapshot_sequence=state.snapshot_sequence,config_hash=state.config_hash,model_version=MODEL,metrics_version=METRICS_VERSION,input_quality=state.input_quality or 'synthetic',forecast_origin_source_s=state.latest_finalized_window_end_source_s if state.HasField('latest_finalized_window_end_source_s') else 0,outcome='cannot_evaluate',outcome_reason=reason,horizon_availability=[pb.HorizonAvailability(horizon_s=h,status='compute_unavailable',reason=reason) for h in HORIZONS_S])
    def _analyze(self,state):
        started=time.monotonic()
        timeout=self.scoring['analysis_timeout_s']
        def expired():return time.monotonic()-started>=timeout
        try:
            evaluation=self._evaluation_input(state)
        except ValueError as exc:
            reason=str(exc)
            status='stale_input' if 'stale' in reason.lower() or state.input_quality=='stale' else 'missing_input'
            return pb.Analysis(run_id=state.run_id,simulation_time_s=state.simulation_time_s,input_session_id=state.input_session_id,snapshot_sequence=state.snapshot_sequence,config_hash=state.config_hash,model_version=MODEL,metrics_version=METRICS_VERSION,input_quality=state.input_quality,forecast_origin_source_s=state.latest_finalized_window_end_source_s if state.HasField('latest_finalized_window_end_source_s') else 0,outcome='cannot_evaluate',outcome_reason=reason,horizon_availability=[pb.HorizonAvailability(horizon_s=h,status=status,reason=reason) for h in HORIZONS_S])
        state=evaluation['state'];baseline=self.plan(state)
        if expired():
            return self._compute_unavailable(state,'Analysis timeout')
        try:forecast=self.rollout(state,baseline,evaluation=evaluation)
        except ValueError as exc:return self._compute_unavailable(state,f'Current virtual plan cannot be evaluated safely: {exc}')
        forecasts=[]; critical=warning=False
        source_origin=state.latest_finalized_window_end_source_s if state.HasField('latest_finalized_window_end_source_s') else 0.0
        availability=state.snapshot_source_available_s if state.HasField('snapshot_source_available_s') else source_origin
        completed=[]
        if state.demand_source=='video_profile':
            completed=[datetime.fromisoformat(row.processed_at_utc.replace('Z','+00:00')) for row in state.observation_history if row.window_end_s<=source_origin and row.available_at_source_s<=availability]
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
        candidates=self._generate_candidates(state,baseline,agda)[:self.scoring['max_candidates']];scored=[];metrics={}
        for i,plan in enumerate(candidates):
            if expired():
                result.outcome='cannot_evaluate';result.outcome_reason='Analysis timeout';return result
            if i>0 and not self._authority_admissible(state,plan,self._candidate_offsets(state,i)):continue
            try:
                metrics[i]=self.rollout(state,plan,self.scoring['window_s'],evaluation,offsets=self._candidate_offsets(state,i))
                scored.append((metrics[i]['cost'],i,plan))
            except ValueError:
                if i==0:
                    result.outcome='cannot_evaluate';result.outcome_reason='Current virtual plan cannot be evaluated safely';return result
        if expired():
            result.outcome='cannot_evaluate';result.outcome_reason='Analysis timeout';return result
        if not scored:
            result.outcome='cannot_evaluate';result.outcome_reason='No safe candidate could be evaluated';return result
        baseline_metrics=metrics[0]
        references=[baseline_metrics]+([metrics[1]] if 1 in metrics else [])
        normal=self._score_mode(state)=='normal'
        scored=[entry for entry in scored if entry[1]==0 or all(self._admissible(ref,metrics[entry[1]],require_benefit=normal) for ref in references)]
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
        offered=[];seen_plans=set()
        for entry in scored:
            score,index,plan=entry;signature=tuple(sorted(plan.items()))
            if index==0 or baseline_cost-score<=self.scoring['minimum_benefit_points'] or signature in seen_plans:continue
            seen_plans.add(signature);offered.append(entry)
        for rank,(score,index,plan) in enumerate(offered[:self.scoring['max_alternatives']]):
            identity=(state.run_id,state.input_session_id,state.snapshot_sequence,state.control_epoch,state.config_hash,source_origin,MODEL,METRICS_VERSION,self.scoring['version'],state.simulation_time_s,sorted(plan.items()),sorted(self._candidate_offsets(state,index).items()))
            rid=str(uuid.uuid5(uuid.NAMESPACE_URL,repr(identity)));changes=[pb.TimingChange(node_id=self.phases[p]['node_id'],phase_id=p,green_s=g,offset_s=self._candidate_offsets(state,index).get(self.phases[p]['node_id'],0)) for p,g in plan.items()];summary=' · '.join(f'{c.phase_id}: {int(c.green_s)}s' for c in changes)
            recommendations.append(pb.Recommendation(id=rid,run_id=state.run_id,timestamp=datetime.now(timezone.utc).isoformat(),priority=priority if rank==0 else 'normal',reason=f'Best among {len(scored)} evaluated feasible aggregate plans' if rank==0 else f'Feasible alternative #{rank}',changes=changes,safety_status='requires_fresh_validation',status='pending',input_session_id=state.input_session_id,snapshot_sequence=state.snapshot_sequence,config_hash=state.config_hash,model_version=MODEL,metrics_version=METRICS_VERSION,forecast_origin_source_s=source_origin,control_epoch=state.control_epoch,explanation_facts=[f'Trigger: {trigger} ({priority.upper()} priority)',f'Upstream corridor: {corridor["id"]} modeled free-flow ETA {eta:.1f}s',f'Coordinated timing: {summary}',f'{self.scoring["window_s"]}-second {self.scoring["version"]} weighted model points: {score:.3f}',f'Minimum modeled gain: {self.scoring["minimum_benefit_points"]:g} weighted points',f'Candidate rank #{rank+1}; not a global optimum','Human approval required; virtual signals only; aggregate-predictor-v1']))
        try:
            comparison=self.comparison(state,recommendations[0].changes,recommendations[0].id,evaluation=evaluation)
        except ValueError as exc:
            result.outcome='cannot_evaluate';result.outcome_reason=str(exc);return result
        if expired():
            result.outcome='cannot_evaluate';result.outcome_reason='Analysis timeout';return result
        result.outcome='recommend';result.recommendation.CopyFrom(recommendations[0]);result.alternatives.extend(recommendations[1:]);result.comparison.CopyFrom(comparison);return result
