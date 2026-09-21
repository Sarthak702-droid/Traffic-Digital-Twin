"""Causal boundary-demand forecast based only on the supplied observation."""

FORECAST_VERSION = "recent-flow-v1"


def boundary_rates(state, index):
    links = {value.link_id: value for value in state.links}
    rates = {}
    for edge in index.boundary_inputs:
        observed = links.get(edge)
        if observed is not None:
            rates[edge] = max(0.0, observed.inflow_vpm / 60.0)
            continue
        movements = [m for m in state.movements if index.movements[m.movement_id]['incoming_link_id'] == edge]
        rates[edge] = max(0.0, sum(m.arrival_rate_vpm for m in movements) / 60.0)
    return rates
