import json
import os
from pathlib import Path

# Load config
config = json.loads(Path('packages/scenario-config/c1-c6.json').read_text())
route = next((s['route_node_ids'] for s in config['scenarios'] if s['id'] == 'peak_surge'), [])

nodes = {n['id']: n for n in config['nodes']}
controlled = [node for node in route if nodes[node]['kind'] == 'controlled']
links = {l['id']: l for l in config['links']}
moves = {m['id']: m for m in config['movements']}
phases = {p['id']: p for p in config['phases']}

print("Route:", route)
print("Controlled:", controlled)

corridor_phases = {}
for i in range(1, len(route)):
    if route[i] in controlled:
        link = next((l for l in links.values() if l['from_node']==route[i-1] and l['to_node']==route[i]), None)
        print(f"Step {i}, from {route[i-1]} to {route[i]}, link: {link['id'] if link else None}")
        if link:
            for p in phases.values():
                if p['node_id'] == route[i]:
                    for mid in p['movement_ids']:
                        if moves[mid]['incoming_link_id'] == link['id']:
                            corridor_phases[route[i]] = p['id']
                            break

print("Corridor phases:", corridor_phases)
