"""Configuration and plan invariants shared by simulation and intelligence."""
import math
import json
from pathlib import Path


def validate_config(config):
    nodes = {n['id']: n for n in config['nodes']}
    links = {l['id']: l for l in config['links']}
    cameras = json.loads((Path(__file__).resolve().parents[2] / 'packages/camera-config/cameras.json').read_text())['cameras']
    mapping = config.get('camera_boundary_links')
    boundary_inputs = {link_id for link_id, link in links.items() if nodes[link['from_node']]['kind'] == 'boundary'}
    if not isinstance(mapping, dict) or set(mapping.values()) != boundary_inputs or len(set(mapping.values())) != len(mapping):
        raise ValueError('Every external boundary input requires exactly one camera assignment')
    for camera_id, link_id in mapping.items():
        camera = cameras.get(camera_id)
        if not camera or camera['network_role'] != 'external_boundary_input' or not camera['injects_boundary_mass']:
            raise ValueError('Internal or unknown camera cannot inject boundary mass')
        if camera.get('boundary_link_id') != link_id:
            raise ValueError('Camera and network boundary assignments disagree')
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
        if scenario['id'] == 'incident_c3' and (scenario.get('incident_node_id') not in nodes or nodes[scenario['incident_node_id']]['kind'] != 'controlled'):
            raise ValueError('Incident must name a controlled node')
        route = scenario['route_node_ids']
        if len(route) < 2 or any(not any(link['from_node'] == a and link['to_node'] == b for link in links.values()) for a, b in zip(route, route[1:])):
            raise ValueError('Disconnected scenario route')
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


def activation_rejection(scheduler, cells, links, moves):
    """Return the virtual boundary reason shared by execution and projection."""
    if scheduler.priority or scheduler.recovering:
        return 'Emergency protection active at activation boundary'
    for node, phases in scheduler.nodes.items():
        offset=scheduler.offsets[node]
        for phase in phases:
            if scheduler.tick-scheduler.last_served[phase['id']]+offset > phase['max_red_s']:
                return 'Maximum red service debt would be exceeded by activation offset'
    for move in moves.values():
        edge=move['outgoing_link_id']
        if links[edge]['storage_capacity_veh']-sum(cells[edge]) <= 1e-9:
            return 'Downstream storage unavailable at activation boundary'
    return None


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
    """Activate a complete corridor plan after every node reaches clearance."""
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
        self.activate_not_before = 0
        self.offsets = {node: 0 for node in self.nodes}
        self.release_at = {}
        self.waiting = set()
        self.requested_at = None
        self.applied_at = None
        self.rejected_reason = None

    def apply(self, plan, activate_not_before=0, offsets=None):
        validate_plan(self.config, plan)
        if not math.isfinite(activate_not_before) or not 0 <= activate_not_before <= self.tick + 300:
            raise ValueError('Activation must be within the next 300 simulation seconds')
        offsets = offsets or {}
        if set(offsets) - set(self.nodes):
            raise ValueError('Unknown offset node')
        for node, value in offsets.items():
            if not math.isfinite(value) or value < 0 or value != int(value):
                raise ValueError('Offsets must be nonnegative whole seconds')
            if value > min(p['max_red_s'] for p in self.nodes[node]):
                raise ValueError('Offset exceeds configured maximum red')
        if self.requested_at is not None:
            raise ValueError('A corridor plan is already pending')
        self.pending = dict(plan)
        self.activate_not_before = int(math.ceil(activate_not_before))
        self.offsets = {node: int(offsets.get(node, 0)) for node in self.nodes}
        self.requested_at = self.tick
        self.applied_at = None
        self.rejected_reason = None

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
            'activate_not_before': self.activate_not_before,
            'offsets': dict(self.offsets),
            'release_at': dict(self.release_at),
            'waiting': sorted(self.waiting),
            'requested_at': self.requested_at,
            'applied_at': self.applied_at,
            'rejected_reason': self.rejected_reason,
        }

    def restore(self, snapshot):
        self.plan = dict(snapshot['plan'])
        self.pending = dict(snapshot['pending'])
        self.state = {node: list(value) for node, value in snapshot['state'].items()}
        self.priority = dict(snapshot['priority'])
        self.recovering = bool(snapshot['recovering'])
        self.last_served = dict(snapshot['last_served'])
        self.tick = int(snapshot['tick'])
        self.activate_not_before = snapshot.get('activate_not_before', 0)
        self.offsets = dict(snapshot.get('offsets', {}))
        self.release_at = dict(snapshot.get('release_at', {}))
        self.waiting = set(snapshot.get('waiting', []))
        self.requested_at = snapshot.get('requested_at')
        self.applied_at = snapshot.get('applied_at')
        self.rejected_reason = snapshot.get('rejected_reason')

    def _next_green(self, node, state):
        index = state[0]
        phases = self.nodes[node]
        p = phases[index]
        index = (index + 1) % len(phases)
        target = self.priority.get(node)
        overdue = max(phases, key=lambda q: self.tick-self.last_served[q['id']])
        if self.recovering or self.tick-self.last_served[overdue['id']] >= overdue['max_red_s']-overdue['max_green_s']:
            index = phases.index(overdue)
        elif target and target != p['id']:
            index = next(i for i, q in enumerate(phases) if q['id'] == target)
        state[:] = [index, 'green', self.plan[phases[index]['id']]]

    def advance(self, activation_guard=None):
        self.tick += 1
        if self.requested_at is not None and self.tick >= self.activate_not_before:
            longest = max(sum(self.plan[p['id']] + p['amber_s'] + p['all_red_s'] for p in ps) for ps in self.nodes.values())
            if self.tick - max(self.requested_at, self.activate_not_before) > longest + max(self.offsets.values()):
                self.pending = dict(self.plan)
                self.requested_at = None
                self.rejected_reason = 'No corridor-wide safe boundary within one cycle'
                self.waiting.clear()
        for node, state in self.state.items():
            if node in self.release_at:
                if self.tick < self.release_at[node]:
                    state[2] = 1
                    continue
                del self.release_at[node]
                self._next_green(node, state)
                continue
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
                if self.requested_at is not None and self.tick >= self.activate_not_before:
                    self.waiting.add(node)
                    state[2] = 1
                else:
                    self.waiting.discard(node)
                    self._next_green(node, state)
        if self.requested_at is not None and len(self.waiting) == len(self.nodes):
            rejection = activation_guard() if activation_guard else None
            if rejection:
                self.pending = dict(self.plan)
                self.requested_at = None
                self.waiting.clear()
                self.rejected_reason = rejection
            else:
                self.plan = dict(self.pending)
                self.applied_at = self.tick
                self.requested_at = None
                self.waiting.clear()
                for node, state in self.state.items():
                    offset = self.offsets[node]
                    if offset:
                        self.release_at[node] = self.tick + offset
                        state[2] = 1
                    else:
                        self._next_green(node, state)
