"""Shared gRPC boundary validation; no persistence or operator decisions."""
import math
from datetime import datetime

def validate_state(state):
    errors = []
    if state.schema_version != '1.0' or not state.run_id or state.source != 'synthetic':
        errors.append('version, run_id and synthetic source required')
    try:
        stamp = datetime.fromisoformat(state.timestamp.replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            raise ValueError()
    except ValueError:
        errors.append('RFC3339 timestamp required')
    if not math.isfinite(state.simulation_time_s) or state.simulation_time_s < 0:
        errors.append('invalid simulation_time_s')
    ids = set()
    for movement in state.movements:
        if not movement.movement_id or movement.movement_id in ids or not movement.current_phase_id:
            errors.append('unique movement id and phase required')
        ids.add(movement.movement_id)
        for field in ('queue_veh', 'arrival_rate_vpm', 'departure_rate_vpm', 'avg_speed_kph', 'occupancy_ratio', 'downstream_capacity_veh', 'waiting_age_s'):
            value = getattr(movement, field)
            if not math.isfinite(value) or value < 0:
                errors.append(f'{field} must be finite and nonnegative')
        if movement.occupancy_ratio > 1:
            errors.append('occupancy_ratio must be <=1')
    if not state.movements:
        errors.append('at least one movement required')
    return errors
