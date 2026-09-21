"""Configuration and plan invariants shared by simulation and intelligence."""
import math


def validate_config(config):
    nodes = {n['id']: n for n in config['nodes']}
    links = {l['id']: l for l in config['links']}
    moves = {m['id']: m for m in config['movements']}
    phases = {p['id']: p for p in config['phases']}
    if len(nodes) != len(config['nodes']) or len(moves) != len(config['movements']) or len(phases) != len(config['phases']):
        raise ValueError('Duplicate configuration IDs')
    for link in links.values():
        values = (link['length_m'], link['lanes'], link['storage_capacity_veh'], link['free_flow_speed_kph'])
        if any(not math.isfinite(v) or v <= 0 for v in values):
            raise ValueError('Invalid link geometry or capacity')
        flow = config.get('flow_model', {})
        cell_length = float(flow.get('cell_length_m', 40))
        wave = float(flow.get('backward_wave_speed_kph', 15))
        dt = float(flow.get('step_s', 1))
        if any(not math.isfinite(v) or v <= 0 for v in (cell_length, wave, dt)):
            raise ValueError('Invalid aggregate flow parameters')
        if dt > cell_length / max(link['free_flow_speed_kph'], wave) * 3.6:
            raise ValueError('Unstable aggregate flow step')
    conflicts = {frozenset(pair) for pair in config['conflicts']}
    for pair in conflicts:
        if len(pair) != 2 or not pair <= moves.keys():
            raise ValueError('Invalid conflict reference')
    covered = set()
    ratios = {}
    for mid, m in moves.items():
        incoming, outgoing = links[m['incoming_link_id']], links[m['outgoing_link_id']]
        if incoming['to_node'] != m['node_id'] or outgoing['from_node'] != m['node_id']:
            raise ValueError('Disconnected movement')
        r = m['turning_ratio']
        if not math.isfinite(r) or not 0 < r <= 1:
            raise ValueError('Invalid turning ratio')
        ratios[m['incoming_link_id']] = ratios.get(m['incoming_link_id'], 0) + r
        for other in moves.values():
            if m['node_id'] == other['node_id'] and m['incoming_link_id'] != other['incoming_link_id'] and frozenset((mid, other['id'])) not in conflicts:
                raise ValueError('Missing protected-approach conflict')
    if any(abs(v-1) > 1e-9 for v in ratios.values()):
        raise ValueError('Turning ratios must sum to one')
    for p in phases.values():
        if nodes[p['node_id']]['kind'] != 'controlled' or not p['movement_ids']:
            raise ValueError('Invalid phase node/movements')
        values = [p[k] for k in ('min_green_s', 'max_green_s', 'amber_s', 'all_red_s', 'pedestrian_clearance_s', 'max_red_s')]
        if any(not math.isfinite(v) or v != int(v) or v <= 0 for v in values) or p['max_green_s'] < p['min_green_s'] or p['all_red_s'] < p['pedestrian_clearance_s']:
            raise ValueError('Invalid phase timing or pedestrian clearance')
        ids = p['movement_ids']
        if len(ids) != len(set(ids)) or any(moves[m]['node_id'] != p['node_id'] for m in ids):
            raise ValueError('Invalid phase movement')
        if any(pair <= set(ids) for pair in conflicts):
            raise ValueError('Conflicting greens')
        covered.update(ids)
    if covered != moves.keys():
        raise ValueError('Unserved movement')
    for scenario in config['scenarios']:
        for key in ('demand_duration_s','base_rate_vps','feeder_rate_vps','surge_rate_vps','surge_start_s','surge_end_s','incident_start_s','incident_end_s','emergency_depart_s','recovery_cycles'):
            if not math.isfinite(scenario[key]) or scenario[key]<0:
                raise ValueError('Invalid scenario timing or demand')
        if scenario['surge_end_s']<=scenario['surge_start_s'] or scenario['incident_end_s']<=scenario['incident_start_s'] or scenario['demand_duration_s']<=0 or max(scenario['base_rate_vps'],scenario['feeder_rate_vps'],scenario['surge_rate_vps'])<=0 or not 0<=scenario['capacity_ratio']<=1:
            raise ValueError('Invalid scenario bounds')
    validate_plan(config, default_plan(config))


def default_plan(config):
    return {p['id']: max(p['min_green_s'], min(30, p['max_green_s'])) for p in config['phases']}


def validate_plan(config, plan):
    phases = {p['id']: p for p in config['phases']}
    if plan.keys() != phases.keys():
        raise ValueError('A complete configured phase plan is required')
    for pid, green in plan.items():
        p = phases[pid]
        if not math.isfinite(green) or green != int(green) or not p['min_green_s'] <= green <= p['max_green_s']:
            raise ValueError('Green outside configured integer bounds')
        cycle = sum(plan[q['id']] + q['amber_s'] + q['all_red_s'] for q in phases.values() if q['node_id'] == p['node_id'])
        if cycle - green > p['max_red_s']:
            raise ValueError('Maximum cross-traffic wait exceeded')


class SafetyViolation(ValueError):
    """Raised when a signal plan or runtime phase state breaches the safety envelope."""
    pass


def validate_runtime_safety(config, signal_states, active_plan=None):
    """Runtime invariant validator for signal phase progression and permissions."""
    conflicts = {frozenset(pair) for pair in config.get('conflicts', [])}
    phases_by_id = {p['id']: p for p in config['phases']}

    permitted_movements = set()
    for s in signal_states:
        phase = phases_by_id.get(s.phase_id)
        if not phase:
            raise SafetyViolation(f"Unknown phase ID {s.phase_id} in signal state")
        if s.indication == 'green':
            if s.remaining_s < 0 or s.remaining_s > phase['max_green_s']:
                raise SafetyViolation(f"Green remaining time {s.remaining_s}s outside allowed range for phase {s.phase_id}")
            for mid in s.permitted_movement_ids:
                if mid not in phase['movement_ids']:
                    raise SafetyViolation(f"Movement {mid} permitted outside its configured phase {s.phase_id}")
                permitted_movements.add(mid)
        elif s.indication == 'amber':
            if s.remaining_s < 0 or s.remaining_s > phase['amber_s']:
                raise SafetyViolation(f"Amber remaining time {s.remaining_s}s exceeds configured amber {phase['amber_s']}s for phase {s.phase_id}")
            if s.permitted_movement_ids:
                raise SafetyViolation(f"Green movements permitted during amber indication on node {s.node_id}")
        elif s.indication == 'all_red':
            if s.remaining_s < 0 or s.remaining_s > phase['all_red_s']:
                raise SafetyViolation(f"All-red remaining time {s.remaining_s}s exceeds configured all-red {phase['all_red_s']}s for phase {s.phase_id}")
            if phase['all_red_s'] < phase['pedestrian_clearance_s']:
                raise SafetyViolation(f"All-red interval {phase['all_red_s']}s violates minimum pedestrian clearance {phase['pedestrian_clearance_s']}s")
            if s.permitted_movement_ids:
                raise SafetyViolation(f"Green movements permitted during all-red clearance on node {s.node_id}")
        else:
            raise SafetyViolation(f"Invalid signal indication {s.indication} on node {s.node_id}")

    for pair in conflicts:
        if pair <= permitted_movements:
            raise SafetyViolation(f"Conflicting movements permitted simultaneously: {pair}")

    if active_plan:
        validate_plan(config, active_plan)


class Signals:
    """Plans take effect at all-red boundaries; never truncate an active green."""
    def __init__(self, config):
        self.config = config
        self.plan = default_plan(config)
        self.pending = dict(self.plan)
        self.nodes = {}
        for p in config['phases']:
            self.nodes.setdefault(p['node_id'], []).append(p)
        self.state = {n: [0, 'green', self.plan[ps[0]['id']]] for n, ps in self.nodes.items()}
        self.priority = {}
        self.recovering = False
        self.last_served = {p['id']: 0 for p in config['phases']}
        self.tick = 0

    def apply(self, plan):
        validate_plan(self.config, plan)
        self.pending = dict(plan)

    def snapshot(self):
        """Return every scheduler field needed for deterministic continuation."""
        return {
            'plan': dict(self.plan),
            'pending': dict(self.pending),
            'state': {node: list(value) for node, value in self.state.items()},
            'priority': dict(self.priority),
            'recovering': bool(self.recovering),
            'last_served': dict(self.last_served),
            'tick': int(self.tick),
        }

    def restore(self, snapshot):
        self.plan = dict(snapshot['plan'])
        self.pending = dict(snapshot['pending'])
        self.state = {node: list(value) for node, value in snapshot['state'].items()}
        self.priority = dict(snapshot['priority'])
        self.recovering = bool(snapshot['recovering'])
        self.last_served = dict(snapshot['last_served'])
        self.tick = int(snapshot['tick'])

    def advance(self):
        self.tick += 1
        for node, state in self.state.items():
            state[2] -= 1
            if state[2] > 0:
                continue
            index, stage, _ = state
            phases = self.nodes[node]
            p = phases[index]
            if stage == 'green':
                self.last_served[p['id']] = self.tick
                state[:] = [index, 'amber', p['amber_s']]
            elif stage == 'amber':
                state[:] = [index, 'all_red', p['all_red_s']]
            else:
                for q in phases:
                    self.plan[q['id']] = self.pending[q['id']]
                index = (index + 1) % len(phases)
                target = self.priority.get(node)
                overdue = max(phases, key=lambda q: self.tick-self.last_served[q['id']])
                if self.recovering or self.tick-self.last_served[overdue['id']] >= overdue['max_red_s']-overdue['max_green_s']:
                    index = phases.index(overdue)
                elif target and target != p['id']:
                    index = next(i for i, q in enumerate(phases) if q['id'] == target)
                state[:] = [index, 'green', self.plan[phases[index]['id']]]
