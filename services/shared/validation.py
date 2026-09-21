"""Shared gRPC boundary validation; no persistence or operator decisions."""
import math
from datetime import datetime

def validate_state(state):
    errors = []
    if state.schema_version not in ('1.0', '1.1') or not state.run_id or state.source != 'synthetic':
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
    link_ids = set()
    for link in state.links:
        if not link.link_id or link.link_id in link_ids:
            errors.append('unique link_id required')
        link_ids.add(link.link_id)
        for field in ('stock_veh', 'queued_veh_estimate', 'density_veh_per_km_lane', 'storage_utilization_ratio', 'receiving_storage_veh', 'inflow_vpm', 'outflow_vpm', 'flow_window_s', 'queue_length_m_estimate'):
            value = getattr(link, field)
            if not math.isfinite(value) or value < 0:
                errors.append(f'{field} must be finite and nonnegative')
        if link.storage_utilization_ratio > 1:
            errors.append('storage_utilization_ratio must be <=1')
        if link.HasField('mean_speed_kph') and (not math.isfinite(link.mean_speed_kph) or link.mean_speed_kph < 0):
            errors.append('mean_speed_kph must be finite and nonnegative')
        if link.speed_status not in ('modeled', 'measured', 'unavailable'):
            errors.append('invalid speed_status')
    if state.schema_version == '1.1':
        if not state.links or not state.engine_kind or not state.model_version or not state.metrics_version or not state.config_hash:
            errors.append('aggregate link state and provenance required')
        rhs = sum(link.stock_veh for link in state.links) + state.boundary_backlog_veh + state.cumulative_boundary_exits_veh
        if abs(state.cumulative_demand_veh-rhs) > 1e-6:
            errors.append('aggregate conservation residual exceeds tolerance')
    return errors
