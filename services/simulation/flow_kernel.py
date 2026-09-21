"""Pure finite-capacity cell transmission kernel."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class KernelResult:
    admitted: dict
    junction_flows: dict
    exited: dict
    internal_flows: dict


def step_cells(index, cells, backlogs, external, permissions, capacity_ratios, dt=1.0):
    """Advance all cells simultaneously and conserve every unit of aggregate mass."""
    old = {edge: tuple(values) for edge, values in cells.items()}
    delta = {edge: [0.0] * len(values) for edge, values in old.items()}
    internal = {}
    send_last, receive_first = {}, {}
    for edge, values in old.items():
        link = index.links[edge]
        cell_cap = float(link["storage_capacity_veh"]) / len(values)
        free_fraction = min(1.0, link["free_flow_speed_kph"] / 3.6 * dt / (link["length_m"] / len(values)))
        capacity = float(link.get("discharge_capacity_vps", 0.5 * link["lanes"])) * dt
        for i in range(len(values) - 1):
            flow = min(values[i] * free_fraction, capacity, max(0.0, cell_cap - values[i + 1]))
            delta[edge][i] -= flow
            delta[edge][i + 1] += flow
            internal[(edge, i)] = flow
        send_last[edge] = min(values[-1] * free_fraction, capacity)
        receive_first[edge] = max(0.0, min(cell_cap - values[0], capacity))

    # Boundary admission shares the same first-cell receiving constraint.
    admitted = {}
    for edge in index.boundary_inputs:
        available = receive_first[edge]
        offered = backlogs.get(edge, 0.0) + external.get(edge, 0.0)
        value = min(offered, available)
        backlogs[edge] = offered - value
        delta[edge][0] += value
        receive_first[edge] -= value
        admitted[edge] = value

    # Strict FIFO per incoming approach. Receiver capacity is shared across merges.
    junction = {}
    receiver_remaining = dict(receive_first)
    for incoming, movements in sorted(index.movements_by_incoming.items()):
        allowed = [m for m in movements if m["id"] in permissions]
        if not allowed:
            continue
        release = send_last[incoming]
        for movement in allowed:
            ratio = movement["turning_ratio"]
            output = movement["outgoing_link_id"]
            movement_cap = float(movement.get("saturation_capacity_vps", 0.5 * index.links[incoming]["lanes"])) * dt
            movement_cap *= capacity_ratios.get(movement["id"], 1.0)
            if ratio > 0:
                release = min(release, receiver_remaining[output] / ratio, movement_cap / ratio)
        release = max(0.0, release)
        delta[incoming][-1] -= release
        for movement in allowed:
            value = release * movement["turning_ratio"]
            output = movement["outgoing_link_id"]
            delta[output][0] += value
            receiver_remaining[output] -= value
            junction[movement["id"]] = value

    # Terminal stock exits only through the modeled final cell.
    exited = {}
    for edge in index.boundary_outputs:
        value = send_last[edge]
        delta[edge][-1] -= value
        exited[edge] = value

    for edge, values in cells.items():
        cap = float(index.links[edge]["storage_capacity_veh"]) / len(values)
        for i in range(len(values)):
            values[i] = min(cap, max(0.0, old[edge][i] + delta[edge][i]))
    return KernelResult(admitted, junction, exited, internal)
