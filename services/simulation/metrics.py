"""Versioned aggregate traffic metric definitions."""
from __future__ import annotations

METRICS_VERSION = "flow-metrics-v1"


def link_metrics(link, cells, inflow, outflow, flow_window_s=60.0):
    stock = sum(cells)
    storage = float(link["storage_capacity_veh"])
    cell_capacity = storage / len(cells)
    threshold = 0.7 * cell_capacity
    queued = 0.0
    congested_cells = 0
    for value in reversed(cells):
        if value < threshold:
            break
        queued += value
        congested_cells += 1
    density = stock / max(1e-9, link["length_m"] / 1000.0 * link["lanes"])
    jam_density = storage / max(1e-9, link["length_m"] / 1000.0 * link["lanes"])
    speed = link["free_flow_speed_kph"] * max(0.05, 1.0 - density / max(jam_density, 1e-9)) if stock else None
    return {
        "stock": stock,
        "queued": queued,
        "density": density,
        "utilization": min(1.0, stock / storage),
        "receiving": max(0.0, storage - stock),
        "inflow_vpm": inflow * 60.0 / flow_window_s,
        "outflow_vpm": outflow * 60.0 / flow_window_s,
        "queue_length_m": congested_cells * link["length_m"] / len(cells),
        "speed_kph": speed,
    }
