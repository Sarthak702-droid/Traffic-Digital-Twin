import json

def main():
    with open('packages/scenario-config/c1-c6.json') as f:
        graph = json.load(f)
    
    boundaries = {n['id'] for n in graph['nodes'] if n['kind'] == 'boundary'}
    boundary_links = {l['id'] for l in graph['links'] if l['from_node'] in boundaries}
    boundary_movements = {m['id'] for m in graph['movements'] if m['incoming_link_id'] in boundary_links}
    
    boundary_phases = {}
    for p in graph['phases']:
        if any(m in boundary_movements for m in p['movement_ids']):
            boundary_phases[p['id']] = p['node_id']
            
    print("Boundary phases mapped to nodes:", boundary_phases)

main()
