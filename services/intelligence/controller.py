"""Bounded analytical proposals from the same causal aggregate snapshot.

These proposals are not an optimizer or acceptance result. The model evaluates
at most the configured five plans and applies every existing regression guard.
"""
from services.simulation.safety import validate_plan


def coordinated_plan(index, config, state, current, evaluation, policy, horizon_s, check_budget=lambda:None):
    # Propagate only current eligible external rates through declared turns.
    # A bounded number of iterations cannot inspect scenario schedules/seeds.
    flows={edge:evaluation['rates'].get(edge,0.0) for edge in index.links}
    for _ in range(len(index.links)):
        check_budget()
        flows={edge:evaluation['rates'].get(edge,0.0)+sum(
            flows[move['incoming_link_id']]*move['turning_ratio']
            for move in index.movements_by_outgoing.get(edge,[])) for edge in index.links}
    observed={m.movement_id:m for m in state.movements};plan={}
    for node,phases in index.phases_by_node.items():
        check_budget()
        target=policy.get('cycle_s')
        budget=sum(current[p['id']] for p in phases) if target is None else target-sum(p['amber_s']+p['all_red_s'] for p in phases)
        budget=int(max(sum(p['min_green_s'] for p in phases),min(sum(p['max_green_s'] for p in phases),budget)))
        weights=[]
        for phase in phases:
            pressure=0.0
            for mid in phase['movement_ids']:
                move=index.movements[mid];incoming=move['incoming_link_id'];outgoing=move['outgoing_link_id'];ratio=move['turning_ratio']
                queue=observed[mid].queue_veh if mid in observed else 0.0
                need=flows[incoming]*horizon_s*ratio+policy['queue_weight']*(queue+evaluation['backlogs'].get(incoming,0.0)*ratio)
                storage=index.links[outgoing]['storage_capacity_veh']
                receiving=max(policy['receiving_floor'],1-sum(evaluation['cells'][outgoing])/storage)
                saturation=move.get('saturation_capacity_vps',0.5*index.links[incoming]['lanes'])
                if state.HasField('incident') and state.incident.status=='active' and node==state.incident.node_id:
                    saturation*=state.incident.capacity_ratio
                pressure+=need*receiving/max(1e-9,saturation)
            weights.append(max(1e-9,pressure))
            plan[phase['id']]=phase['min_green_s']
        # Capped integer proportional allocation: preserve clearance and phase
        # bounds, including a fully specified cycle for every configured node.
        for _ in range(budget-sum(plan[p['id']] for p in phases)):
            check_budget()
            eligible=[i for i,p in enumerate(phases) if plan[p['id']]<p['max_green_s']]
            best=max(eligible,key=lambda i:(weights[i]/(plan[phases[i]['id']]+1),-i))
            plan[phases[best]['id']]+=1
    validate_plan(config,plan)
    return plan
