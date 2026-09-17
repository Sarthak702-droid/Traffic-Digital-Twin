"""Deterministic conservation-model forecasts and bounded network MPC.

This aggregate digital twin is an engineering model, not trained ML. Candidate
branches copy one initial state and share demand, turn ratios and travel delays.
"""
import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
import twin_pb2 as pb
from services.simulation.safety import default_plan, validate_config, validate_plan, Signals
from services.simulation.network import ROOT

MODEL='conservation-v2'

class Model:
    def __init__(self, config=None):
        self.config=config or json.loads((ROOT/'packages/scenario-config/c1-c6.json').read_text())
        validate_config(self.config)
        self.moves={m['id']:m for m in self.config['movements']}
        self.links={l['id']:l for l in self.config['links']}
        self.phases={p['id']:p for p in self.config['phases']}
        self.nodes={n['id']:n for n in self.config['nodes']}
        self.serving={mid:p['id'] for p in self.phases.values() for mid in p['movement_ids']}

    def plan(self,state):
        return {c.phase_id:c.green_s for c in state.active_plan} or default_plan(self.config)

    def rollout(self,state,plan,horizon=300):
        validate_plan(self.config,plan)
        q={m.movement_id:float(m.queue_veh) for m in state.movements}
        initial={m.movement_id:m for m in state.movements}
        if q.keys()!=self.moves.keys():raise ValueError('Complete movement state required')
        arrival={mid:0.0 for mid in q};eta={mid:None for mid in q}
        transit={};snapshots={};queue_integral=0.;peak=max(q.values(),default=0);spill=0;stops=0;total_arrivals=0
        scheduler=Signals(self.config)
        scheduler.plan=dict(self.plan(state))
        scheduler.apply(plan)
        for signal in state.signals:
            phases=scheduler.nodes[signal.node_id]
            index=next(i for i,p in enumerate(phases) if p['id']==signal.phase_id)
            scheduler.state[signal.node_id]=[index,signal.indication,int(signal.remaining_s)]
        scenario=next(s for s in self.config['scenarios'] if s['id']==state.scenario_type)
        for t in range(1,horizon+1):
            incoming={mid:transit.pop((t,mid),0.) for mid in q}
            for mid,m in self.moves.items():
                edge=self.links[m['incoming_link_id']]
                if self.nodes[edge['from_node']]['kind']=='boundary':
                    now=state.simulation_time_s+t
                    feeder=edge['from_node']==scenario['route_node_ids'][0]
                    rate=scenario['base_rate_vps']
                    if feeder:rate=scenario['surge_rate_vps'] if scenario['surge_start_s']<=now<scenario['surge_end_s'] else scenario['feeder_rate_vps']
                    incoming[mid]+=rate*m['turning_ratio'] if now<scenario['demand_duration_s'] else 0
                elif t<=math.ceil(edge['length_m']/(edge['free_flow_speed_kph']/3.6)):
                    incoming[mid]+=max(0,initial[mid].vehicle_count-initial[mid].queue_veh)/max(1,math.ceil(edge['length_m']/(edge['free_flow_speed_kph']/3.6)))
            for mid in q:q[mid]+=incoming[mid];arrival[mid]+=incoming[mid]
            occupied={edge:sum(q[mid] for mid,m in self.moves.items() if m['incoming_link_id']==edge) for edge in self.links}
            reserved={edge:0. for edge in self.links}
            for mid,m in self.moves.items():
                index,stage,_=scheduler.state[m['node_id']]
                pid=scheduler.nodes[m['node_id']][index]['id']
                out=m['outgoing_link_id'];link=self.links[out]
                receiver=max(0,link['storage_capacity_veh']-occupied[out]-reserved[out])
                capacity=.5*self.links[m['incoming_link_id']]['lanes']*m['turning_ratio']
                now=state.simulation_time_s+t
                if state.scenario_type=='incident_c3' and m['node_id']=='C3' and scenario['incident_start_s']<=now<scenario['incident_end_s']:capacity*=scenario['capacity_ratio']
                discharge=min(q[mid],capacity,receiver) if stage=='green' and pid==self.serving[mid] else 0
                q[mid]-=discharge;reserved[out]+=discharge
                targets=[n for n in self.moves.values() if n['incoming_link_id']==out]
                delay=max(1,math.ceil(link['length_m']/(link['free_flow_speed_kph']/3.6)))
                for target in targets:
                    key=(t+delay,target['id']);transit[key]=transit.get(key,0)+discharge*target['turning_ratio']
                cap=self.links[m['incoming_link_id']]['storage_capacity_veh']
                if q[mid]/cap>=.9:
                    spill+=1
                    if eta[mid] is None:eta[mid]=t
                stops+=incoming[mid] if q[mid]>.1 else 0
            scheduler.advance()
            total_arrivals+=sum(incoming.values());queue_integral+=sum(q.values());peak=max(peak,max(q.values()))
            if t in (30,60,120,300):snapshots[t]=(dict(q),dict(arrival),dict(eta))
        count=max(1,sum(m.vehicle_count for m in state.movements)+total_arrivals)
        fairness=sum(max(0,q[mid]-initial[mid].queue_veh)*initial[mid].waiting_age_s for mid in q)
        switches=sum(abs(plan[p]-self.plan(state)[p]) for p in plan)
        emergency=sum(q[mid] for mid,m in self.moves.items() if m['node_id'] in state.emergency.route_node_ids) if state.emergency.status in ('pre_clearance','priority') else 0
        return {'snapshots':snapshots,'peak':peak,'delay':queue_integral/count,'spill':spill,'stops':stops/count,'cost':1.8*queue_integral+3*spill+.35*stops+1.2*fairness+.25*switches+10*emergency}

    def allocate(self,state):
        values={m.movement_id:m for m in state.movements};plan={}
        for node in {p['node_id'] for p in self.phases.values()}:
            phases=[p for p in self.phases.values() if p['node_id']==node]
            weights=[]
            for p in phases:
                weight=0
                for mid in p['movement_ids']:
                    m=values[mid];cap=self.links[self.moves[mid]['outgoing_link_id']]['storage_capacity_veh']
                    receive=max(0,1-(1-min(1,m.downstream_capacity_veh/cap))**2)
                    fairness=1+min(2,m.waiting_age_s/60)
                    weight+=(m.queue_veh+.8*m.arrival_rate_vpm*.5+.4*m.waiting_age_s)*receive*fairness
                weights.append(max(.01,weight))
            budget=sum(self.plan(state)[p['id']] for p in phases)
            for p in phases:plan[p['id']]=p['min_green_s']
            remaining=int(budget-sum(plan[p['id']] for p in phases))
            # Bounded weighted allocation with redistribution and deterministic ties.
            allocated=[0]*len(phases)
            while remaining>0:
                eligible=[i for i,p in enumerate(phases) if plan[p['id']]<p['max_green_s']]
                if not eligible:break
                i=max(eligible,key=lambda i:weights[i]/(allocated[i]+1))
                plan[phases[i]['id']]+=1;allocated[i]+=1;remaining-=1
        validate_plan(self.config,plan)
        return plan

    def comparison(self,state,changes,rec_id=''):
        plan={c.phase_id:c.green_s for c in changes}
        if len(plan)!=len(changes):raise ValueError('Duplicate phase')
        for c in changes:
            if c.phase_id not in self.phases or self.phases[c.phase_id]['node_id']!=c.node_id:raise ValueError('Unknown phase/node')
        base=self.rollout(state,self.plan(state),120);candidate=self.rollout(state,plan,120)
        return pb.ComparisonResult(run_id=state.run_id,recommendation_id=rec_id,baseline_max_queue_veh=base['peak'],candidate_max_queue_veh=candidate['peak'],baseline_avg_delay_s=base['delay'],candidate_avg_delay_s=candidate['delay'],initial_time_s=state.simulation_time_s,model_version=MODEL,baseline_spillback_s=base['spill'],candidate_spillback_s=candidate['spill'],baseline_stops_per_vehicle=base['stops'],candidate_stops_per_vehicle=candidate['stops'],horizon_s=120,seed=state.seed)

    def analyze(self,state):
        baseline=self.plan(state);forecast=self.rollout(state,baseline)
        forecasts=[]
        for horizon,(queues,arrivals,etas) in forecast['snapshots'].items():
            for mid,q in queues.items():
                move=self.moves[mid];cap=self.links[move['incoming_link_id']]['storage_capacity_veh'];occupancy=min(1,q/cap)
                f=pb.Forecast(id=f'{state.run_id}-{int(state.simulation_time_s)}-{mid}-{horizon}',run_id=state.run_id,movement_id=mid,horizon_s=horizon,queue_veh=q,occupancy_ratio=occupancy,arrivals_veh=arrivals[mid],risk='critical' if occupancy>=.9 else 'warning' if occupancy>=.75 else 'normal',model_version=MODEL,explanation_facts=[f"Arrivals propagate through {move['incoming_link_id']} using configured travel time and turn ratios",'300-second output is advisory' if horizon==300 else 'Conservation-model simulation forecast'])
                if etas[mid] is not None:f.spillback_eta_s=etas[mid]
                forecasts.append(f)
        agda=self.allocate(state);candidates=[baseline,agda]
        for delta in (-5,5):
            p={pid:max(self.phases[pid]['min_green_s'],min(self.phases[pid]['max_green_s'],g+delta)) for pid,g in agda.items()}
            try:validate_plan(self.config,p);candidates.append(p)
            except ValueError:pass
        scored=sorted([(self.rollout(state,p,120)['cost'],i,p) for i,p in enumerate(candidates)])
        recommendations=[]
        for score,_,plan in scored[:3]:
            rid=str(uuid.uuid5(uuid.NAMESPACE_URL,f'{state.run_id}:{state.simulation_time_s}:{plan}'))
            recommendations.append(pb.Recommendation(id=rid,run_id=state.run_id,timestamp=datetime.now(timezone.utc).isoformat(),priority='warning' if any(f.risk!='normal' for f in forecasts) else 'normal',reason='Bounded network plan selected from equal-state conservation-model rollouts',changes=[pb.TimingChange(node_id=self.phases[pid]['node_id'],phase_id=pid,green_s=g) for pid,g in plan.items()],safety_status='requires_fresh_validation',status='pending',explanation_facts=[f'120-second weighted network cost: {score:.2f}',f'{len(candidates)} bounded candidates evaluated','C6 demand propagates through C3 toward C1; receiving storage limits discharge','Human approval required; virtual signals only']))
        result=pb.Analysis(run_id=state.run_id,simulation_time_s=state.simulation_time_s,forecasts=forecasts,recommendation=recommendations[0],alternatives=recommendations[1:])
        result.comparison.CopyFrom(self.comparison(state,result.recommendation.changes,result.recommendation.id))
        return result
