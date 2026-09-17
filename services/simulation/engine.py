"""Deterministic SUMO/TraCI runtime. All signals are virtual."""
import json
import math
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
import traci
import twin_pb2 as pb
from services.simulation.network import ROOT, binary, compile_network, write_demand

class Engine:
    def __init__(self, config_path=None, directory=None):
        self.config=json.loads(Path(config_path or ROOT/'packages/scenario-config/c1-c6.json').read_text())
        self.directory=Path(directory or ROOT/'.runtime/sumo')
        self.net=compile_network(self.config,self.directory)
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
        self.thread=None

    def reset(self, command):
        if command.schema_version!='1.0' or not command.run_id or command.mode not in ('observe','recommend') or command.seed<1 or command.scenario_type not in {s['id'] for s in self.config['scenarios']}:
            raise ValueError('Invalid version, scenario, seed, mode or run ID')
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
            self.previous={mid:set() for mid in self.moves}
            self.vehicle_moves={}
            self.arrivals={mid:0 for mid in self.moves}
            self.departures={mid:0 for mid in self.moves}
            self.inserted=self.arrived=self.teleported=0
            self.failure=None
            self.signal_states=self._apply_signals(0)
            self.latest=self._snapshot(0)
            self.running=True
            self.version+=1;self.changed.notify_all()
            return self.copy_state()

    def _apply_signals(self, tick):
        states=[]
        for node,phases in self.phases.items():
            stages=[]
            for phase in phases:
                green=max(phase['min_green_s'],min(30,phase['max_green_s']))
                stages.extend([(phase,'green',green),(phase,'amber',phase['amber_s']),(phase,'all_red',phase['all_red_s'])])
            offset=tick%sum(duration for _,_,duration in stages)
            for phase,stage,duration in stages:
                if offset<duration:break
                offset-=duration
            permissions=phase['movement_ids'] if stage=='green' else []
            colours=''.join(('G' if stage=='green' else 'y') if mid in phase['movement_ids'] and stage!='all_red' else 'r' for mid in self.indices[node])
            self.connection.trafficlight.setRedYellowGreenState(node,colours)
            states.append(pb.SignalState(node_id=node,phase_id=phase['id'],indication=stage,remaining_s=duration-offset,permitted_movement_ids=permissions))
        return states

    def _snapshot(self,tick):
        c=self.connection
        ids=sorted(c.vehicle.getIDList())
        memberships={mid:set() for mid in self.moves}
        speeds={};waiting={};on_edge={edge:0 for edge in self.links}
        for vid in ids:
            edge=c.vehicle.getRoadID(vid);route=c.vehicle.getRoute(vid);index=c.vehicle.getRouteIndex(vid)
            if edge in on_edge:on_edge[edge]+=1
            if edge.startswith(':'):
                mid=self.vehicle_moves.get(vid)
            else:
                mid=self.pairs.get((edge,route[index+1])) if index+1<len(route) else None
            self.vehicle_moves[vid]=mid
            if mid:
                memberships[mid].add(vid);speeds[vid]=c.vehicle.getSpeed(vid)*3.6;waiting[vid]=c.vehicle.getWaitingTime(vid)
        self.vehicle_moves={vid:self.vehicle_moves[vid] for vid in ids}
        signal_by_node={s.node_id:s for s in self.signal_states}
        result=pb.TrafficState(schema_version='1.0',run_id=self.command.run_id,timestamp=datetime.now(timezone.utc).isoformat(),simulation_time_s=tick,source='synthetic',signals=self.signal_states,vehicles_in_network=len(ids),inserted_total=self.inserted,arrived_total=self.arrived,teleported_total=self.teleported,scenario_type=self.command.scenario_type,seed=self.command.seed)
        for mid,m in self.moves.items():
            current=memberships[mid];arrivals=len(current-self.previous[mid]);departures=len(self.previous[mid]-current)
            self.arrivals[mid]+=arrivals;self.departures[mid]+=departures
            sig=signal_by_node[m['node_id']]
            permission='green' if mid in sig.permitted_movement_ids else 'amber' if sig.indication=='amber' and mid in next(p for p in self.phases[m['node_id']] if p['id']==sig.phase_id)['movement_ids'] else 'red'
            result.movements.add(movement_id=mid,queue_veh=sum(speeds[v]<.36 for v in current),arrival_rate_vpm=arrivals*60,departure_rate_vpm=departures*60,avg_speed_kph=sum(speeds[v] for v in current)/len(current) if current else 0,occupancy_ratio=min(1,on_edge[m['incoming_link_id']]/self.links[m['incoming_link_id']]['storage_capacity_veh']),downstream_capacity_veh=max(0,self.links[m['outgoing_link_id']]['storage_capacity_veh']-on_edge[m['outgoing_link_id']]),current_phase_id=sig.phase_id,waiting_age_s=max((waiting[v] for v in current),default=0),vehicle_count=len(current),arrivals_total=self.arrivals[mid],departures_total=self.departures[mid],permission=permission)
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
