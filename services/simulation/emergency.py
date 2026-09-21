"""Authorized aggregate emergency request lifecycle; no tracked vehicle object."""

def route_free_flow_eta(route, links):
    elapsed, values = 0.0, [0.0]
    for start, end in zip(route, route[1:]):
        link = links[f"{start}-{end}"]
        elapsed += link["length_m"] / (link["free_flow_speed_kph"] / 3.6)
        values.append(elapsed)
    return values


def lifecycle(tick, scenario, links):
    route = scenario["route_node_ids"]
    depart = scenario["emergency_depart_s"]
    travel = route_free_flow_eta(route, links)
    eta = [max(0.0, depart + value - tick) for value in travel]
    arrival = depart + travel[-1]
    if tick < max(0, depart - 20): return "scheduled", eta, scenario["recovery_cycles"]
    if tick < depart: return "pre_clearance", eta, scenario["recovery_cycles"]
    if tick < arrival: return "priority", eta, scenario["recovery_cycles"]
    remaining = max(0, scenario["recovery_cycles"] - int((tick - arrival) // 70))
    return ("recovery" if remaining else "complete"), [0.0] * len(route), remaining
