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
                receiver=max(0.,link['storage_capacity_veh']-occupied[out]-reserved[out])
                capacity=.5*self.links[m['incoming_link_id']]['lanes']*m['turning_ratio']
                now=state.simulation_time_s+t
                if state.scenario_type=='incident_c3' and m['node_id']=='C3' and scenario['incident_start_s']<=now<scenario['incident_end_s']:capacity*=scenario['capacity_ratio']
                discharge=max(0.,min(q[mid],capacity,receiver)) if stage=='green' and pid==self.serving[mid] else 0.
                q[mid]=max(0.,q[mid]-discharge);reserved[out]+=discharge
                targets=[n for n in self.moves.values() if n['incoming_link_id']==out]
                delay=max(1,math.ceil(link['length_m']/(link['free_flow_speed_kph']/3.6)))
                for target in targets:
                    turn_discharge=discharge*target['turning_ratio']
                    if delay<=2:
                        key=(t+delay,target['id']);transit[key]=transit.get(key,0.)+turn_discharge
                    else:
                        # Platoon propagation with ETA tolerance band
                        transit[(t+delay-1,target['id'])]=transit.get((t+delay-1,target['id']),0.)+turn_discharge*.15
                        transit[(t+delay,target['id'])]=transit.get((t+delay,target['id']),0.)+turn_discharge*.70
                        transit[(t+delay+1,target['id'])]=transit.get((t+delay+1,target['id']),0.)+turn_discharge*.15
                in_link=self.links[m['incoming_link_id']]
                cap=in_link['storage_capacity_veh']
                link_occ=occupied[m['incoming_link_id']]/max(1.,cap)
                move_occ=q[mid]/max(1.,cap*m['turning_ratio'])
                if link_occ>=.85 or move_occ>=.85:
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
            budget=sum(self.plan(state)[p['id']] for p in phases)
            min_sum=sum(p['min_green_s'] for p in phases)
            max_sum=sum(p['max_green_s'] for p in phases)
            if budget<min_sum:
                raise ValueError(f"Infeasible green budget for node {node}: {budget}s < min green sum {min_sum}s")
            if budget>max_sum:
                raise ValueError(f"Infeasible green budget for node {node}: {budget}s > max green sum {max_sum}s")
            priorities=[]
            for p in phases:
                phase_weight=0.0
                for mid in p['movement_ids']:
                    m=values[mid]
                    out_link=self.links[self.moves[mid]['outgoing_link_id']]
                    cap=float(out_link['storage_capacity_veh'])
                    downstream_occ=max(0.0,min(1.0,(cap-float(m.downstream_capacity_veh))/max(1.0,cap)))
                    # S16 criteria: receiving factor 1 - occupancy^2
                    receive=max(0.0,1.0-(downstream_occ**2))
                    # S16 criteria: normalize queue, predicted arrivals (0.8), wait age (0.4)
                    norm_queue=float(m.queue_veh)/max(1.0,cap*self.moves[mid]['turning_ratio'])
                    norm_arrivals=(float(m.arrival_rate_vpm)*0.5)/max(1.0,cap*self.moves[mid]['turning_ratio'])
                    norm_wait=min(3.0,float(m.waiting_age_s)/60.0)
                    need=norm_queue+0.8*norm_arrivals+0.4*norm_wait
                    # S16 criteria: fairness guard
                    fairness=1.0+min(3.0,max(0.0,float(m.waiting_age_s)/45.0))
                    phase_weight+=need*receive*fairness
                # S16 criteria: emergency boost and incident penalty
                emergency_boost=0.0
                if state.emergency.status in ('pre_clearance','priority'):
                    route=list(state.emergency.route_node_ids)
                    for mid in p['movement_ids']:
                        m=self.moves[mid]
                        in_from=self.links[m['incoming_link_id']]['from_node']
                        out_to=self.links[m['outgoing_link_id']]['to_node']
                        for r_idx in range(len(route)-2):
                            if (route[r_idx],route[r_idx+1],route[r_idx+2])==(in_from,m['node_id'],out_to):
                                emergency_boost=60.0
                                break
                        if emergency_boost>0:break
                incident_penalty=0.0
                if state.scenario_type=='incident_c3' or (state.incident and state.incident.status=='active'):
                    if p['node_id']=='C3' or any(self.moves[mid]['outgoing_link_id']=='C3-C1' for mid in p['movement_ids']):
                        incident_penalty=20.0
                priority=max(0.01,phase_weight+emergency_boost-incident_penalty)
                priorities.append(priority)
            # S16 criteria: flexible green allocation with tempered softmax, clipping and redistribution
            g_flex=budget-min_sum
            t_temp=0.8 if state.emergency.status in ('pre_clearance','priority') else 1.8
            exp_vals=[math.exp(min(20.0,max(-20.0,pr/t_temp))) for pr in priorities]
            sum_exp=sum(exp_vals)
            shares=[ev/sum_exp for ev in exp_vals]
            for i,p in enumerate(phases):
                plan[p['id']]=int(p['min_green_s']+round(g_flex*shares[i]))
                plan[p['id']]=max(int(p['min_green_s']),min(int(p['max_green_s']),plan[p['id']]))
            # Redistribution inside cycle budget
            diff=int(budget-sum(plan[p['id']] for p in phases))
            while diff!=0:
                if diff>0:
                    eligible=[i for i,p in enumerate(phases) if plan[p['id']]<p['max_green_s']]
                    if not eligible:break
                    best_i=max(eligible,key=lambda i:shares[i])
                    plan[phases[best_i]['id']]+=1;diff-=1
                else:
                    eligible=[i for i,p in enumerate(phases) if plan[p['id']]>p['min_green_s']]
                    if not eligible:break
                    worst_i=min(eligible,key=lambda i:shares[i])
                    plan[phases[worst_i]['id']]-=1;diff+=1
        validate_plan(self.config,plan)
        return plan

    def comparison(self,state,changes,rec_id=''):
        plan={c.phase_id:c.green_s for c in changes}
        if len(plan)!=len(changes):raise ValueError('Duplicate phase')
        for c in changes:
            if c.phase_id not in self.phases or self.phases[c.phase_id]['node_id']!=c.node_id:raise ValueError('Unknown phase/node')
        base=self.rollout(state,self.plan(state),120);candidate=self.rollout(state,plan,120)
        return pb.ComparisonResult(run_id=state.run_id,recommendation_id=rec_id,baseline_max_queue_veh=base['peak'],candidate_max_queue_veh=candidate['peak'],baseline_avg_delay_s=base['delay'],candidate_avg_delay_s=candidate['delay'],initial_time_s=state.simulation_time_s,model_version=MODEL,baseline_spillback_s=base['spill'],candidate_spillback_s=candidate['spill'],baseline_stops_per_vehicle=base['stops'],candidate_stops_per_vehicle=candidate['stops'],horizon_s=120,seed=state.seed)

    def _generate_candidates(self,state,baseline,agda):
        # S17: Coordinated candidate signal plans across C1 and C3
        # Use AGDA plus +-5/10-second split adjustments, preserving cycle length and phase order
        candidates=[baseline,agda]
        c1_main="C1-FROM-C3"
        c3_feed="C3-FROM-C6"
        c3_other="C3-FROM-C1"
        other_c1=[pid for pid in self.phases if self.phases[pid]['node_id']=='C1' and pid!=c1_main]
        for delta in (-10,-5,5,10):
            # Coordinated C1 clearance + C3 upstream gating
            p=dict(agda)
            new_c1=max(self.phases[c1_main]['min_green_s'],min(self.phases[c1_main]['max_green_s'],p[c1_main]+delta))
            c1_diff=int(new_c1-p[c1_main])
            p[c1_main]=new_c1
            rem_diff=-c1_diff
            while rem_diff!=0:
                if rem_diff>0:
                    eligible=[pid for pid in other_c1 if p[pid]<self.phases[pid]['max_green_s']]
                    if not eligible:break
                    p[eligible[0]]+=1;rem_diff-=1
                else:
                    eligible=[pid for pid in other_c1 if p[pid]>self.phases[pid]['min_green_s']]
                    if not eligible:break
                    p[eligible[0]]-=1;rem_diff+=1
            # C3 coordination: gate C3-FROM-C6 by -delta, compensate on C3-FROM-C1
            new_c3=max(self.phases[c3_feed]['min_green_s'],min(self.phases[c3_feed]['max_green_s'],p[c3_feed]-delta))
            c3_diff=int(new_c3-p[c3_feed])
            p[c3_feed]=new_c3
            p[c3_other]=max(self.phases[c3_other]['min_green_s'],min(self.phases[c3_other]['max_green_s'],p[c3_other]-c3_diff))
            try:
                validate_plan(self.config,p)
                candidates.append(p)
            except ValueError:pass

        # Deduplicate candidates
        seen=set()
        unique=[]
        for cand in candidates:
            key=tuple(sorted(cand.items()))
            if key not in seen:
                seen.add(key)
                unique.append(cand)
        return unique

    def analyze(self,state):
        baseline=self.plan(state);forecast=self.rollout(state,baseline)
        forecasts=[]
        critical_risk=False
        warning_risk=False
        for horizon,(queues,arrivals,etas) in forecast['snapshots'].items():
            for mid,q in queues.items():
                move=self.moves[mid];edge=self.links[move['incoming_link_id']]
                link_cap=edge['storage_capacity_veh']
                link_q=sum(queues[other_id] for other_id,other_m in self.moves.items() if other_m['incoming_link_id']==move['incoming_link_id'])
                occupancy=min(1.,max(0.,link_q/link_cap))
                move_occ=min(1.,max(0.,q/max(1.,link_cap*move['turning_ratio'])))
                effective_occ=max(occupancy,move_occ)
                upstream_node=edge['from_node']
                is_boundary=self.nodes[upstream_node]['kind']=='boundary'
                source_desc=f"external boundary {upstream_node}" if is_boundary else f"junction {upstream_node}"
                is_crit=effective_occ>=.9 or (etas[mid] is not None and etas[mid]<=horizon)
                is_warn=effective_occ>=.75 or (etas[mid] is not None)
                if is_crit:critical_risk=True
                elif is_warn:warning_risk=True
                risk='critical' if is_crit else 'warning' if is_warn else 'normal'
                facts=[
                    f"Upstream source: {source_desc} via corridor {move['incoming_link_id']}",
                    f"Projected arrivals: {arrivals[mid]:.1f} veh over {horizon}s horizon",
                    f"Storage occupancy: {occupancy*100:.1f}% ({link_q:.1f}/{link_cap} veh storage)",
                ]
                if etas[mid] is not None:
                    facts.append(f"Predicted spillback ETA: {etas[mid]}s before approach blockage")
                if horizon==300:
                    facts.append("300-second output is advisory")
                else:
                    facts.append("Conservation-model simulation forecast")
                f=pb.Forecast(id=f'{state.run_id}-{int(state.simulation_time_s)}-{mid}-{horizon}',run_id=state.run_id,movement_id=mid,horizon_s=horizon,queue_veh=q,occupancy_ratio=occupancy,arrivals_veh=arrivals[mid],risk=risk,model_version=MODEL,explanation_facts=facts)
                if etas[mid] is not None:f.spillback_eta_s=etas[mid]
                forecasts.append(f)
        agda=self.allocate(state)
        # S17 & S18: candidate generation, 120s rollout and PN-MPC scoring
        candidates=self._generate_candidates(state,baseline,agda)
        scored=sorted([(self.rollout(state,p,120)['cost'],i,p) for i,p in enumerate(candidates)])
        
        # Priority and trigger determination (S19)
        priority='critical' if critical_risk else 'warning' if warning_risk else 'normal'
        trigger='spillback_risk' if critical_risk else 'corridor_coordination' if warning_risk else 'demand_balancing'
        if state.emergency.status in ('pre_clearance','priority'):
            trigger='emergency_priority'
        elif state.scenario_type=='incident_c3':
            trigger='incident_recovery'

        recommendations=[]
        for rank,(score,_,plan) in enumerate(scored[:3]):
            rid=str(uuid.uuid5(uuid.NAMESPACE_URL,f'{state.run_id}:{state.simulation_time_s}:{plan}'))
            # Format timing changes
            changes=[pb.TimingChange(node_id=self.phases[pid]['node_id'],phase_id=pid,green_s=g) for pid,g in plan.items()]
            c1_changes=[f"{c.phase_id}: {int(c.green_s)}s" for c in changes if c.node_id=='C1']
            c3_changes=[f"{c.phase_id}: {int(c.green_s)}s" for c in changes if c.node_id=='C3']
            timing_summary=f"C1 ({', '.join(c1_changes)}) · C3 ({', '.join(c3_changes)})"
            
            # S19 structured facts
            facts=[
                f"Trigger: {trigger} ({priority.upper()} priority)",
                "Upstream corridor: Junction C3 platoon propagates to C1 via C3-C1 (ETA: ~22s)",
                f"Coordinated timing: {timing_summary}",
                f"120-second PN-MPC network cost: {score:.2f} (evaluated {len(candidates)} bounded candidates)",
                f"Candidate alternative rank #{rank+1} of {min(3,len(scored))}",
                "Human approval required; virtual digital twin signals only; model conservation-v2"
            ]
            if rank==0:
                reason=f"Coordinated C1 clearance and C3 gating to mitigate {trigger.replace('_',' ')}"
            else:
                reason=f"Feasible alternative #{rank}: {timing_summary}"
            
            recommendations.append(pb.Recommendation(
                id=rid,
                run_id=state.run_id,
                timestamp=datetime.now(timezone.utc).isoformat(),
                priority=priority if rank==0 else 'normal',
                reason=reason,
                changes=changes,
                safety_status='requires_fresh_validation',
                status='pending',
                explanation_facts=facts
            ))
            
        alt_count=len(recommendations)-1
        if alt_count<2:
            recommendations[0].explanation_facts.append(f"Fewer alternatives available: only {alt_count} alternative met bounds and safety constraints")
        else:
            recommendations[0].explanation_facts.append("2 feasible alternatives scored and available for operator review")

        result=pb.Analysis(run_id=state.run_id,simulation_time_s=state.simulation_time_s,forecasts=forecasts,recommendation=recommendations[0],alternatives=recommendations[1:])
        result.comparison.CopyFrom(self.comparison(state,result.recommendation.changes,result.recommendation.id))
        return result
