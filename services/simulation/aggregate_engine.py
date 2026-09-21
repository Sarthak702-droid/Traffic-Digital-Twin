"""Deterministic finite-capacity aggregate traffic runtime."""
import math, os, threading, time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
import twin_pb2 as pb
from services.shared.network_config import NetworkIndex, config_hash, load_config, ROOT
from services.simulation.demand import BoundaryDemand
from services.simulation.emergency import lifecycle
from services.simulation.flow_kernel import step_cells
from services.simulation.metrics import METRICS_VERSION, link_metrics
from services.simulation.receipts import Receipts
from services.simulation.safety import Signals, validate_plan, validate_runtime_safety

class AggregateEngine:
    engine_kind, model_version = "aggregate_ctm", "aggregate-v1"
    def __init__(self, config_path=None, directory=None):
        self.config=load_config(config_path); self.index=NetworkIndex.build(self.config)
        self.links,self.moves,self.phases=self.index.links,self.index.movements,self.index.phases_by_node
        self.directory=Path(directory or os.environ.get("SIMULATION_DIRECTORY") or ROOT/".runtime/aggregate"); self.directory.mkdir(parents=True,exist_ok=True)
        self.receipts=Receipts(self.directory/"aggregate-command-receipts.sqlite")
        self.lock=threading.RLock(); self.changed=threading.Condition(self.lock)
        self.version=0; self.latest=None; self.running=False; self.closed=False; self.failure=None; self.thread=None
        self.config_digest=config_hash(self.config)
    def _validate_command(self,c):
        if c.schema_version!='1.0' or not c.run_id or c.mode not in ('observe','recommend','manual') or c.seed<1 or c.scenario_type not in {s['id'] for s in self.config['scenarios']}: raise ValueError('Invalid version, scenario, seed, mode or run ID')
        if c.scenario_type!='incident_c3' and (c.incident_kind or c.incident_capacity_ratio): raise ValueError('Incident controls are only valid for incident_c3')
        if c.incident_kind and c.incident_kind!='capacity_reduction': raise ValueError('Unsupported incident kind')
        if c.incident_capacity_ratio and not .1<=c.incident_capacity_ratio<=.9: raise ValueError('Incident capacity must be between 10% and 90%')
    def reset(self,command):
        self._validate_command(command)
        with self.lock:
            self.command=pb.RunCommand(); self.command.CopyFrom(command); self.scenario=next(s for s in self.config['scenarios'] if s['id']==command.scenario_type)
            length=float(self.config.get('flow_model',{}).get('cell_length_m',40))
            self.cells={e:[0.0]*max(1,math.ceil(l['length_m']/length)) for e,l in self.links.items()}; self.backlogs={e:0.0 for e in self.index.boundary_inputs}
            self.demand=BoundaryDemand(self.config,self.index,self.scenario,command.seed); self.scheduler=Signals(self.config); self.tick=0
            self.cumulative_demand=self.cumulative_admitted=self.cumulative_exits=0.0
            self.flow_history={e:deque(maxlen=60) for e in self.links}; self.movement_arrivals={m:0.0 for m in self.moves}; self.movement_departures={m:0.0 for m in self.moves}; self.waiting_age={m:0.0 for m in self.moves}
            self.failure=None; self.incident=None; self.emergency=None; self.version=0; self._events(); self.signal_states=self._signal_states(); self.latest=self._snapshot(); self.running=True; self.version+=1; self.changed.notify_all(); return self.copy_state()
    def _events(self):
        self.incident=self.emergency=None; ratios={m:1.0 for m in self.moves}
        if self.command.scenario_type=='incident_c3':
            s,e=self.scenario['incident_start_s'],self.scenario['incident_end_s']; active=s<=self.tick<e; configured=self.command.incident_capacity_ratio or self.scenario['capacity_ratio']; applied=configured if active else 1.0
            cycle=max(sum(self.scheduler.plan[p['id']]+p['amber_s']+p['all_red_s'] for p in ps) for ps in self.phases.values()); remaining=max(0,self.scenario['recovery_cycles']-int(max(0,self.tick-e)//cycle)) if self.tick>=e else self.scenario['recovery_cycles']; status='scheduled' if self.tick<s else 'active' if active else 'recovering' if remaining else 'resolved'
            for mid,m in self.moves.items():
                if m['node_id']=='C3': ratios[mid]=applied
            self.incident=pb.Incident(id=self.command.run_id+'-incident',run_id=self.command.run_id,node_id='C3',kind=self.command.incident_kind or 'capacity_reduction',capacity_ratio=applied,status=status,recovery_cycles=remaining)
        if self.command.scenario_type=='ambulance_corridor':
            status,eta,remaining=lifecycle(self.tick,self.scenario,self.links); route=self.scenario['route_node_ids']; self.scheduler.priority={}
            if status in ('pre_clearance','priority'):
                for a,node,b in zip(route,route[1:],route[2:]):
                    mid=next((m['id'] for m in self.moves.values() if m['incoming_link_id']==f'{a}-{node}' and m['outgoing_link_id']==f'{node}-{b}'),None)
                    if mid and node in self.phases: self.scheduler.priority[node]=next(p['id'] for p in self.phases[node] if mid in p['movement_ids'])
            self.scheduler.recovering=status=='recovery'; self.emergency=pb.EmergencyEvent(id=self.command.run_id+'-emergency',run_id=self.command.run_id,route_node_ids=route,status=status,eta_s=eta,recovery_cycles_remaining=remaining)
        return ratios
    def _signal_states(self):
        states=[]
        for node,phases in self.phases.items():
            index,stage,remaining=self.scheduler.state[node]; phase=phases[index]; permitted=list(phase['movement_ids']) if stage=='green' else []
            states.append(pb.SignalState(node_id=node,phase_id=phase['id'],indication=stage,remaining_s=remaining,permitted_movement_ids=permitted))
        validate_runtime_safety(self.config,states,self.scheduler.plan); return states
    def step(self):
        with self.lock:
            if not self.running: raise RuntimeError('No active simulation')
            self.tick+=1; ratios=self._events(); external=self.demand.next(self.tick); self.cumulative_demand+=sum(external.values()); permissions={m for s in self.signal_states for m in s.permitted_movement_ids}
            out=step_cells(self.index,self.cells,self.backlogs,external,permissions,ratios); self.cumulative_admitted+=sum(out.admitted.values()); self.cumulative_exits+=sum(out.exited.values())
            for edge in self.links:
                incoming=out.admitted.get(edge,0.0)+sum(v for m,v in out.junction_flows.items() if self.moves[m]['outgoing_link_id']==edge); outgoing=out.exited.get(edge,0.0)+sum(v for m,v in out.junction_flows.items() if self.moves[m]['incoming_link_id']==edge); self.flow_history[edge].append((incoming,outgoing))
            for mid,m in self.moves.items():
                stock=sum(self.cells[m['incoming_link_id']])*m['turning_ratio']; departed=out.junction_flows.get(mid,0.0); self.movement_departures[mid]+=departed
                added=(out.admitted.get(m['incoming_link_id'],0.0)+sum(v for source,v in out.junction_flows.items() if self.moves[source]['outgoing_link_id']==m['incoming_link_id']))*m['turning_ratio']; self.movement_arrivals[mid]+=added; self.waiting_age[mid]=self.waiting_age[mid]+1 if stock>.1 and departed<.01 else 0.0
            self.scheduler.advance(); self.signal_states=self._signal_states(); self.latest=self._snapshot(); self.version+=1; self.changed.notify_all(); return self.copy_state()
    def _snapshot(self):
        r=pb.TrafficState(schema_version='1.1',run_id=self.command.run_id,timestamp=datetime.now(timezone.utc).isoformat(),simulation_time_s=self.tick,source='synthetic',signals=self.signal_states,vehicles_in_network=round(sum(map(sum,self.cells.values()))),inserted_total=round(self.cumulative_admitted),arrived_total=round(self.cumulative_exits),teleported_total=0,scenario_type=self.command.scenario_type,seed=self.command.seed,active_plan=[pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=self.scheduler.plan[p['id']]) for p in self.config['phases']],engine_kind=self.engine_kind,model_version=self.model_version,metrics_version=METRICS_VERSION,config_hash=self.config_digest,snapshot_sequence=self.version+1,boundary_backlog_veh=sum(self.backlogs.values()),cumulative_demand_veh=self.cumulative_demand,cumulative_admitted_veh=self.cumulative_admitted,cumulative_boundary_exits_veh=self.cumulative_exits,control_target='virtual_only')
        r.scheduler.tick=self.scheduler.tick; r.scheduler.recovering=self.scheduler.recovering
        r.scheduler.pending_plan.extend(pb.TimingChange(node_id=p['node_id'],phase_id=p['id'],green_s=self.scheduler.pending[p['id']]) for p in self.config['phases'])
        r.scheduler.service_history.extend(pb.SchedulerService(phase_id=pid,last_served_tick=tick) for pid,tick in self.scheduler.last_served.items())
        r.scheduler.priority.extend(pb.SchedulerPriority(node_id=node,phase_id=pid) for node,pid in self.scheduler.priority.items())
        if self.incident is not None:r.incident.CopyFrom(self.incident)
        if self.emergency is not None:r.emergency.CopyFrom(self.emergency)
        signals={s.node_id:s for s in self.signal_states}; values={}
        for edge,link in self.links.items():
            metric=link_metrics(link,self.cells[edge],sum(v[0] for v in self.flow_history[edge]),sum(v[1] for v in self.flow_history[edge]),max(1,len(self.flow_history[edge]))); values[edge]=metric
            item=r.links.add(link_id=edge,stock_veh=metric['stock'],queued_veh_estimate=metric['queued'],density_veh_per_km_lane=metric['density'],storage_utilization_ratio=metric['utilization'],receiving_storage_veh=metric['receiving'],receiving_blocked=metric['receiving'] <= 1e-9,inflow_vpm=metric['inflow_vpm'],outflow_vpm=metric['outflow_vpm'],flow_window_s=max(1,len(self.flow_history[edge])),queue_length_m_estimate=metric['queue_length_m'],speed_method='aggregate_model',speed_status='modeled' if metric['speed_kph'] is not None else 'unavailable')
            if metric['speed_kph'] is not None:item.mean_speed_kph=metric['speed_kph']
        for mid,m in self.moves.items():
            incoming,outgoing=values[m['incoming_link_id']],values[m['outgoing_link_id']]; signal=signals[m['node_id']]; permission='green' if mid in signal.permitted_movement_ids else 'amber' if signal.indication=='amber' and mid in self.index.phases[signal.phase_id]['movement_ids'] else 'red'; stock=incoming['stock']*m['turning_ratio']
            legacy_stock=round(stock); legacy_departures=round(self.movement_departures[mid])
            r.movements.add(movement_id=mid,queue_veh=incoming['queued']*m['turning_ratio'],arrival_rate_vpm=incoming['inflow_vpm']*m['turning_ratio'],departure_rate_vpm=incoming['outflow_vpm']*m['turning_ratio'],avg_speed_kph=incoming['speed_kph'] or 0.0,occupancy_ratio=incoming['utilization'],downstream_capacity_veh=outgoing['receiving'],current_phase_id=signal.phase_id,waiting_age_s=self.waiting_age[mid],vehicle_count=legacy_stock,arrivals_total=legacy_departures+legacy_stock,departures_total=legacy_departures,permission=permission)
        return r
    def snapshot_internal(self): return {'cells':{k:tuple(v) for k,v in self.cells.items()},'backlogs':dict(self.backlogs),'scheduler':self.scheduler.snapshot(),'tick':self.tick,'config_hash':self.config_digest}
    def apply_plan(self,c):
        with self.lock:
            if not self.running or c.run_id!=self.command.run_id:raise ValueError('Run is not active')
            if not c.command_id:raise ValueError('An idempotency command ID is required')
            receipt=self.receipts.status(c)
            if receipt=='accepted':return
            if receipt!='not_found':raise ValueError('Command receipt: '+receipt+'; inspect outcome, do not replay')
            plan={v.phase_id:v.green_s for v in c.changes}
            if len(plan)!=len(c.changes):raise ValueError('Duplicate phase changes')
            validate_plan(self.config,plan)
            if any(v.phase_id not in self.index.phases or self.index.phases[v.phase_id]['node_id']!=v.node_id for v in c.changes):raise ValueError('Phase/node mismatch')
            self.receipts.prepare(c);self.scheduler.apply(plan);self.receipts.accept(c)
    def copy_state(self):v=pb.TrafficState();v.CopyFrom(self.latest);return v
    def start_clock(self):
        def run():
            deadline=time.monotonic()+1
            while not self.closed:
                time.sleep(max(0,deadline-time.monotonic()));deadline+=1
                with self.lock:
                    if self.running:
                        try:self.step()
                        except Exception as error:self.running=False;self.failure=str(error);self.changed.notify_all()
        self.thread=threading.Thread(target=run,daemon=True);self.thread.start()
    def stop(self):
        with self.lock:self.running=False;self.latest=None;self.changed.notify_all()
    def close(self):
        self.closed=True
        with self.lock:self.running=False;self.changed.notify_all()
