"""Deterministic SUMO/TraCI runtime. All signals are virtual."""
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
import traci
import traci.constants as tc
import twin_pb2 as pb
from services.simulation.safety import validate_config, Signals, validate_plan, validate_runtime_safety, SafetyViolation
from services.simulation.receipts import Receipts
from services.simulation.network import ROOT, binary, compile_network, write_demand

EMERGENCY_STATUSES = {'scheduled', 'pre_clearance', 'priority', 'recovery', 'complete'}

class Engine:
    def __init__(self, config_path=None, directory=None):
        self.config=json.loads(Path(config_path or ROOT/'packages/scenario-config/c1-c6.json').read_text())
        validate_config(self.config)
        self.directory=Path(directory or os.environ.get('SIMULATION_DIRECTORY') or ROOT/'.runtime/sumo')
        self.net=compile_network(self.config,self.directory)
        self.receipts=Receipts(self.directory/"command-receipts.sqlite")
        self.connection=None
        self.lock=threading.RLock()
        self.changed=threading.Condition(self.lock)
        self.version=0
        self.latest=None
        self.running=False
        self.closed=False
        self.failure=None
        self.phases={n['id']:[p for p in self.config['phases'] if p['node_id']==n['id']] for n in self.config['nodes'] if n['kind']=='controlled'}
        self.moves={m['id']:m for m in self.config['movements']}
        self.pairs={(m['incoming_link_id'],m['outgoing_link_id']):m['id'] for m in self.moves.values()}
        self.links={l['id']:l for l in self.config['links']}
        self.conflicts={frozenset(pair) for pair in self.config.get('conflicts',[])}
        self.thread=None

    def reset(self, command):
        if command.schema_version!='1.0' or not command.run_id or command.mode not in ('observe','recommend','manual') or command.seed<1 or command.scenario_type not in {s['id'] for s in self.config['scenarios']}:
            raise ValueError('Invalid version, scenario, seed, mode or run ID')
        if command.scenario_type!='incident_c3' and (command.incident_kind or command.incident_capacity_ratio):
            raise ValueError('Incident controls are only valid for incident_c3')
        if command.incident_kind and command.incident_kind!='capacity_reduction':
            raise ValueError('Unsupported incident kind')
        if command.incident_capacity_ratio and not .1<=command.incident_capacity_ratio<=.9:
            raise ValueError('Incident capacity must be between 10% and 90%')
        with self.lock:
            self.running=False
            route=write_demand(self.config,command.scenario_type,command.seed,self.directory)
            args=['--net-file',str(self.net),'--route-files',str(route),'--seed',str(command.seed),'--step-length','1','--no-step-log','true','--no-warnings','true','--time-to-teleport','-1','--collision.action','warn','--duration-log.disable','true']
            if self.connection:
                self.connection.load(args)
            else:
                label=f'epic2-{id(self)}'
                traci.start([binary('sumo')]+args,label=label,doSwitch=False,numRetries=3)
                self.connection=traci.getConnection(label)
            self.command=pb.RunCommand();self.command.CopyFrom(command)
            self.indices={}
            for node in self.phases:
                self.indices[node]=[]
                for group in self.connection.trafficlight.getControlledLinks(node):
                    ids={self.pairs.get((a.rsplit('_',1)[0],b.rsplit('_',1)[0])) for a,b,_ in group}
                    if None in ids or len(ids)!=1:raise ValueError('Unmapped SUMO signal connection')
                    self.indices[node].append(next(iter(ids)))
            self.scenario=next(s for s in self.config['scenarios'] if s['id']==command.scenario_type)
            self.incident_kind=command.incident_kind or 'capacity_reduction'
            self.incident_capacity_ratio=command.incident_capacity_ratio or self.scenario['capacity_ratio']
            self.scheduler=Signals(self.config)
            self.applied_commands=set()
            self.vehicle_routes={}
            self.last_capacity_ratio=None
            self.gated={}
            self.emergency_seen=False
            self.emergency_passed_at=None
            self.previous={mid:set() for mid in self.moves}
            self.vehicle_moves={}
            self.arrivals={mid:0 for mid in self.moves}
            self.departures={mid:0 for mid in self.moves}
            self.smoothed_arrival_rate={mid:0.0 for mid in self.moves}
            self.smoothed_departure_rate={mid:0.0 for mid in self.moves}
            self.smoothed_speed={mid:0.0 for mid in self.moves}
            self.inserted=self.arrived=self.teleported=0
            self.failure=None
            self.signal_states=self._apply_signals(0)
            self.latest=self._snapshot(0)
            self.running=True
            self.version+=1;self.changed.notify_all()
            return self.copy_state()

    def apply_plan(self, command):
        with self.lock:
            if not self.running or command.run_id != self.command.run_id:
                raise ValueError('Run is not active')
            if not command.command_id:
                raise ValueError('An idempotency command ID is required')
            receipt = self.receipts.status(command)
            if receipt == 'accepted': return
            if receipt != 'not_found': raise ValueError('Command receipt: '+receipt+'; inspect outcome, do not replay')
            plan={c.phase_id:c.green_s for c in command.changes}
            if len(plan)!=len(command.changes):
                raise ValueError('Duplicate phase changes')
            validate_plan(self.config,plan)
            for c in command.changes:
                if not any(p['id']==c.phase_id and p['node_id']==c.node_id for p in self.config['phases']):
                    raise ValueError('Phase/node mismatch')
            self.receipts.prepare(command)
            self.scheduler.apply(plan)
            self.receipts.accept(command)
            self.applied_commands.add(command.command_id)

    def _scenario_state(self, tick):
        scenario=self.scenario
        # Optional protobuf messages must be absent when their scenario is not
        # active. Empty message objects serialize as structurally present domain
        # events (for example emergency.status == ""), which correctly fail the
        # browser contract and hide otherwise valid live traffic frames.
        incident=None
        emergency=None
        ratio=1.0
        if self.command.scenario_type=='incident_c3':
            active=scenario['incident_start_s']<=tick<scenario['incident_end_s']
            ratio=self.incident_capacity_ratio if active else 1.0
            end=scenario['incident_end_s']
            cycle=max(sum(self.scheduler.plan[p['id']]+p['amber_s']+p['all_red_s'] for p in ps) for ps in self.phases.values())
            recovery=max(0,scenario['recovery_cycles']-int(max(0,tick-end)//cycle)) if tick>=end else scenario['recovery_cycles']
            status='scheduled' if tick<scenario['incident_start_s'] else 'active' if active else 'recovering' if recovery else 'resolved'
            incident=pb.Incident(id=self.command.run_id+'-incident',run_id=self.command.run_id,node_id='C3',kind=self.incident_kind,capacity_ratio=ratio,status=status,recovery_cycles=recovery)
        self.capacity_ratio=ratio
        # A metered virtual entry at C3 implements reduced discharge capacity.
        # Blocked intervals remain red; SUMO itself enforces physical receiving space.
        if self.command.scenario_type=='ambulance_corridor':
            route=scenario['route_node_ids']
            ids=self.connection.vehicle.getIDList()
            eta=[]
            status='scheduled'
            if 'ambulance' in ids:
                self.emergency_seen=True
                edge=self.connection.vehicle.getRoadID('ambulance')
                index=self.connection.vehicle.getRouteIndex('ambulance')
                edges=self.connection.vehicle.getRoute('ambulance')
                position=self.connection.vehicle.getLanePosition('ambulance')
                elapsed=0
                for node_index,node in enumerate(route):
                    if node_index<=index:eta.append(0);continue
                    link=self.links[edges[node_index-1]]
                    distance=max(0,link['length_m']-position) if node_index-1==index else link['length_m']
                    elapsed+=distance/max(1,link['free_flow_speed_kph']/3.6)
                    eta.append(elapsed)
                status='pre_clearance'
                self.scheduler.priority={}
                for i in range(1,len(route)-1):
                    if i<=index:continue
                    mid=self.pairs.get((route[i-1]+'-'+route[i],route[i]+'-'+route[i+1]))
                    if mid and eta[i]<=90:
                        phase=next(p for p in self.phases[route[i]] if mid in p['movement_ids'])
                        self.scheduler.priority[route[i]]=phase['id']
                        state=self.scheduler.state[route[i]]
                        if self.phases[route[i]][state[0]]['id']==phase['id'] and state[1]=='green':status='priority'
            elif self.emergency_seen:
                if self.emergency_passed_at is None:self.emergency_passed_at=tick
                self.scheduler.priority={}
                status='recovery'
                # SUMO has reported that the vehicle left the final edge: each
                # configured route point is therefore passed, while recovery
                # remains a separate signal-state concern.
                eta=[0.0]*len(route)
                cycle=max(sum(self.scheduler.plan[p['id']]+p['amber_s']+p['all_red_s'] for p in ps) for ps in self.phases.values())
                remaining=max(0,scenario['recovery_cycles']-int((tick-self.emergency_passed_at)//cycle))
                if remaining==0:status='complete'
                self.scheduler.recovering=remaining>0
            else:
                # Before insertion these are a deterministic dispatch schedule,
                # not a claimed vehicle position. Once SUMO reports the vehicle,
                # the branch above replaces them with measured route ETAs.
                dispatch=max(0,scenario['emergency_depart_s']-tick)
                eta=[dispatch]
                elapsed=dispatch
                for edge_id in [a+'-'+b for a,b in zip(route,route[1:])]:
                    link=self.links[edge_id]
                    elapsed+=link['length_m']/max(1,link['free_flow_speed_kph']/3.6)
                    eta.append(elapsed)
                remaining=scenario['recovery_cycles']
            remaining=scenario['recovery_cycles'] if self.emergency_passed_at is None else remaining
            if status not in EMERGENCY_STATUSES:
                raise SafetyViolation('Invalid emergency lifecycle status')
            emergency=pb.EmergencyEvent(id=self.command.run_id+'-emergency',run_id=self.command.run_id,route_node_ids=route,status=status,eta_s=eta,recovery_cycles_remaining=remaining,vehicle_id='ambulance')
        self.incident=incident
        self.emergency=emergency

    def _apply_signals(self, tick):
        self._scenario_state(tick)
        states=[]
        for node,phases in self.phases.items():
            index,stage,remaining=self.scheduler.state[node]
            phase=phases[index]
            # Capacity gating is held for whole green intervals to preserve clearances.
            if stage=='green' and remaining==self.scheduler.plan[phase['id']]:
                if not hasattr(self,'gated'):self.gated={}
                self.gated[node]=node=='C3' and self.capacity_ratio==0
            permissions=list(phase['movement_ids']) if stage=='green' else []
            if getattr(self,'gated',{}).get(node,False):permissions=[]
            # Do not release into a full receiving link, including emergency traffic.
            permissions=[mid for mid in permissions if self.connection.edge.getLastStepVehicleNumber(self.moves[mid]['outgoing_link_id']) < self.links[self.moves[mid]['outgoing_link_id']]['storage_capacity_veh']]
            colours=''.join('G' if mid in permissions else 'y' if stage=='amber' and mid in phase['movement_ids'] and not getattr(self,'gated',{}).get(node,False) else 'r' for mid in self.indices[node])
            self.connection.trafficlight.setRedYellowGreenState(node,colours)
            # Reduced speed through C3 models the configured bottleneck without
            # shortening greens or bypassing the normal clearance sequence.
            if self.last_capacity_ratio!=self.capacity_ratio:
                for move in self.moves.values():
                    if move['node_id']=='C3':
                        edge=move['incoming_link_id']
                        self.connection.edge.setMaxSpeed(edge,max(.1,self.links[edge]['free_flow_speed_kph']/3.6*self.capacity_ratio))
                self.last_capacity_ratio=self.capacity_ratio
            states.append(pb.SignalState(node_id=node,phase_id=phase['id'],indication=stage,remaining_s=remaining,permitted_movement_ids=permissions))
        try:
            validate_runtime_safety(self.config, states, self.scheduler.plan)
        except SafetyViolation as sv:
            for n in self.phases:
                self.connection.trafficlight.setRedYellowGreenState(n, 'r' * len(self.indices[n]))
            self.running = False
            self.failure = str(sv)
            raise
        return states

    def _snapshot(self,tick):
        c=self.connection
        ids=sorted(c.vehicle.getIDList())
        memberships={mid:set() for mid in self.moves}
        speeds={};waiting={};on_edge={edge:0 for edge in self.links}
        for vid in ids:
            if vid not in self.vehicle_routes:
                self.vehicle_routes[vid]=c.vehicle.getRoute(vid)
                c.vehicle.subscribe(vid,[tc.VAR_ROAD_ID,tc.VAR_ROUTE_INDEX,tc.VAR_SPEED,tc.VAR_WAITING_TIME])
            observed=c.vehicle.getSubscriptionResults(vid)
            edge=observed[tc.VAR_ROAD_ID];route=self.vehicle_routes[vid];index=observed[tc.VAR_ROUTE_INDEX]
            if edge in on_edge:on_edge[edge]+=1
            if edge.startswith(':'):
                mid=self.vehicle_moves.get(vid)
            else:
                mid=self.pairs.get((edge,route[index+1])) if index+1<len(route) else None
            self.vehicle_moves[vid]=mid
            if mid:
                memberships[mid].add(vid);speeds[vid]=observed[tc.VAR_SPEED]*3.6;waiting[vid]=observed[tc.VAR_WAITING_TIME]
        self.vehicle_moves={vid:self.vehicle_moves[vid] for vid in ids}
        self.vehicle_routes={vid:self.vehicle_routes[vid] for vid in ids}
        signal_by_node={s.node_id:s for s in self.signal_states}
        result=pb.TrafficState(schema_version='1.0',run_id=self.command.run_id,timestamp=datetime.now(timezone.utc).isoformat(),simulation_time_s=tick,source='synthetic',signals=self.signal_states,vehicles_in_network=len(ids),inserted_total=self.inserted,arrived_total=self.arrived,teleported_total=self.teleported,scenario_type=self.command.scenario_type,seed=self.command.seed,active_plan=[pb.TimingChange(node_id=p["node_id"],phase_id=p["id"],green_s=self.scheduler.plan[p["id"]]) for p in self.config["phases"]])
        if self.incident is not None:
            result.incident.CopyFrom(self.incident)
        if self.emergency is not None:
            result.emergency.CopyFrom(self.emergency)
        for mid,m in self.moves.items():
            current=memberships[mid];arrivals=len(current-self.previous[mid]);departures=len(self.previous[mid]-current)
            self.arrivals[mid]+=arrivals;self.departures[mid]+=departures
            raw_arr = float(arrivals * 60)
            raw_dep = float(departures * 60)
            raw_spd = float(sum(speeds[v] for v in current) / len(current)) if current else 0.0
            if tick == 0:
                self.smoothed_arrival_rate[mid] = round(raw_arr, 1)
                self.smoothed_departure_rate[mid] = round(raw_dep, 1)
                self.smoothed_speed[mid] = round(raw_spd, 1)
            else:
                alpha_flow = 0.4
                alpha_speed = 0.35
                self.smoothed_arrival_rate[mid] = round(alpha_flow * raw_arr + (1.0 - alpha_flow) * self.smoothed_arrival_rate[mid], 1)
                self.smoothed_departure_rate[mid] = round(alpha_flow * raw_dep + (1.0 - alpha_flow) * self.smoothed_departure_rate[mid], 1)
                if current:
                    self.smoothed_speed[mid] = round(alpha_speed * raw_spd + (1.0 - alpha_speed) * self.smoothed_speed[mid], 1)
                else:
                    self.smoothed_speed[mid] = round((1.0 - alpha_speed) * self.smoothed_speed[mid], 1)
            sig=signal_by_node[m['node_id']]
            permission='green' if mid in sig.permitted_movement_ids else 'amber' if sig.indication=='amber' and mid in next(p for p in self.phases[m['node_id']] if p['id']==sig.phase_id)['movement_ids'] else 'red'
            result.movements.add(movement_id=mid,queue_veh=sum(speeds[v]<.36 for v in current),arrival_rate_vpm=self.smoothed_arrival_rate[mid],departure_rate_vpm=self.smoothed_departure_rate[mid],avg_speed_kph=self.smoothed_speed[mid],occupancy_ratio=min(1,on_edge[m['incoming_link_id']]/self.links[m['incoming_link_id']]['storage_capacity_veh']),downstream_capacity_veh=max(0,self.links[m['outgoing_link_id']]['storage_capacity_veh']-on_edge[m['outgoing_link_id']]),current_phase_id=sig.phase_id,waiting_age_s=max((waiting[v] for v in current),default=0),vehicle_count=len(current),arrivals_total=self.arrivals[mid],departures_total=self.departures[mid],permission=permission)
        self.previous=memberships
        return result

    def step(self):
        with self.lock:
            if not self.running:raise RuntimeError('No active simulation')
            # Current permissions govern [t,t+1); transitions apply at the next boundary.
            self.connection.simulationStep()
            self.inserted+=self.connection.simulation.getDepartedNumber()
            self.arrived+=self.connection.simulation.getArrivedNumber()
            self.teleported+=self.connection.simulation.getStartingTeleportNumber()
            tick=self.connection.simulation.getTime()
            self.scheduler.advance()
            self.signal_states=self._apply_signals(tick)
            self.latest=self._snapshot(tick)
            self.version+=1;self.changed.notify_all()
            return self.copy_state()

    def copy_state(self):
        value=pb.TrafficState();value.CopyFrom(self.latest);return value

    def start_clock(self):
        def run():
            deadline=time.monotonic()+1
            while not self.closed:
                time.sleep(max(0,deadline-time.monotonic()));deadline+=1
                if time.monotonic()>deadline+1:deadline=time.monotonic()+1
                with self.lock:
                    if self.running:
                        try:self.step()
                        except Exception as error:self.running=False;self.failure=str(error);self.changed.notify_all()
        self.thread=threading.Thread(target=run,daemon=True);self.thread.start()

    def stop(self):
        with self.lock:
            self.running=False;self.latest=None;self.changed.notify_all()

    def close(self):
        self.closed=True
        with self.lock:
            self.running=False
            if self.connection:self.connection.close();self.connection=None
            self.changed.notify_all()
