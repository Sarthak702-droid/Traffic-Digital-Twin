"""Compile the configured graph into a SUMO network; no UI geometry constants."""
import hashlib
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def binary(name):
    # 1. Check relative to sys.executable (e.g. inside activated venv)
    path = Path(sys.executable).parent / name
    if path.exists():
        return str(path)
    # 2. When running Python 3.13, prioritize Python 3.13 runtime binaries
    if sys.version_info[:2] == (3, 13):
        flatpak_bin = Path.home() / ".var/app/com.visualstudio.code/data/python/bin" / name
        if flatpak_bin.exists():
            return str(flatpak_bin)
    # 3. Check repo .venv/bin directly (Python 3.12)
    venv_bin = ROOT / ".venv/bin" / name
    if venv_bin.exists():
        return str(venv_bin)
    # 4. Check user bin fallback
    flatpak_bin = Path.home() / ".var/app/com.visualstudio.code/data/python/bin" / name
    if flatpak_bin.exists():
        return str(flatpak_bin)
    import shutil
    result = shutil.which(name)
    if not result:
        raise RuntimeError(f'{name} missing; install services/requirements.lock')
    return result

def compile_network(config, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    net = directory / f'{digest[:16]}.net.xml'
    if net.exists():
        return net
    nodes = ET.Element('nodes')
    for node in config['nodes']:
        ET.SubElement(nodes, 'node', id=node['id'], x=str(node['x']), y=str(-node['y']), type='traffic_light' if node['kind']=='controlled' else 'priority')
    edges = ET.Element('edges')
    for link in config['links']:
        ET.SubElement(edges, 'edge', id=link['id'], **{'from':link['from_node'],'to':link['to_node'],'length':str(link['length_m']),'numLanes':str(link['lanes']),'speed':str(link['free_flow_speed_kph']/3.6)})
    connections = ET.Element('connections')
    links = {l['id']:l for l in config['links']}
    for move in config['movements']:
        for lane in range(min(links[move['incoming_link_id']]['lanes'], links[move['outgoing_link_id']]['lanes'])):
            ET.SubElement(connections,'connection',**{'from':move['incoming_link_id'],'to':move['outgoing_link_id'],'fromLane':str(lane),'toLane':str(lane)})
    for name,tree in [('nodes',nodes),('edges',edges),('connections',connections)]:
        ET.ElementTree(tree).write(directory/f'{name}.xml',encoding='utf-8')
    subprocess.run([binary('netconvert'),'--node-files',str(directory/'nodes.xml'),'--edge-files',str(directory/'edges.xml'),'--connection-files',str(directory/'connections.xml'),'--output-file',str(net),'--no-turnarounds','true','--no-warnings','true'],check=True,capture_output=True,timeout=15)
    return net

def boundary_routes(config):
    boundaries={n['id'] for n in config['nodes'] if n['kind']=='boundary'}
    adjacency={n['id']:[] for n in config['nodes']}
    for link in config['links']:
        adjacency[link['from_node']].append((link['to_node'],link['id']))
    routes=[]
    def visit(start,node,seen,edges):
        if edges and node in boundaries:
            routes.append(edges)
            return
        for destination,edge in sorted(adjacency[node]):
            if destination not in seen:
                visit(start,destination,seen|{destination},edges+[edge])
    for node in sorted(boundaries):
        visit(node,node,{node},[])
    return routes

def write_demand(config, scenario_id, seed, directory):
    import random
    rng=random.Random(seed)
    scenario=next(s for s in config['scenarios'] if s['id']==scenario_id)
    route_root=ET.Element('routes')
    ET.SubElement(route_root,'vType',id='car',vClass='passenger',sigma='0.5',length='5',minGap='2.5')
    ET.SubElement(route_root,'vType',id='ambulance',vClass='emergency',sigma='0',length='5',minGap='2.5',speedFactor='1')
    routes=boundary_routes(config)
    for i,edges in enumerate(routes):ET.SubElement(route_root,'route',id=f'route-{i}',edges=' '.join(edges))
    # Arrival process is per boundary approach. Routing draws the configured
    # conditional turn at every controlled junction, rather than one flow per path.
    route_index = {tuple(edges): i for i, edges in enumerate(routes)}
    links = {l['id']: l for l in config['links']}
    boundaries = {n['id'] for n in config['nodes'] if n['kind'] == 'boundary'}
    by_incoming = {}
    for m in config['movements']:
        by_incoming.setdefault(m['incoming_link_id'], []).append(m)
    demand=[]
    for edge, link in sorted(links.items()):
        if link['from_node'] not in boundaries:
            continue
        t=0.0
        feeder=link['from_node']==scenario['route_node_ids'][0]
        ceiling=max(scenario['base_rate_vps'],scenario['feeder_rate_vps'],scenario['surge_rate_vps'])
        while True:
            t += rng.expovariate(ceiling)
            if t >= scenario['demand_duration_s']:
                break
            rate = scenario['base_rate_vps']
            if feeder:
                rate = scenario['surge_rate_vps'] if scenario['surge_start_s'] <= t < scenario['surge_end_s'] else scenario['feeder_rate_vps']
            if rng.random() > rate/ceiling:
                continue
            path=[edge]
            while links[path[-1]]['to_node'] not in boundaries:
                choices=by_incoming[path[-1]]
                move=rng.choices(choices,weights=[m['turning_ratio'] for m in choices])[0]
                path.append(move['outgoing_link_id'])
                if len(path)>len(links):
                    raise ValueError('Cyclic route is unsupported by demo routing')
            demand.append((round(t,3),route_index[tuple(path)],'car'))
    if scenario_id=='ambulance_corridor':
        emergency_edges=[a+'-'+b for a,b in zip(scenario['route_node_ids'],scenario['route_node_ids'][1:])]
        demand.append((scenario['emergency_depart_s'],routes.index(emergency_edges),'ambulance'))
    for index,(depart,route,vtype) in enumerate(sorted(demand)):
        ET.SubElement(route_root,'vehicle',id='ambulance' if vtype=='ambulance' else f'veh-{index}',type=vtype,route=f'route-{route}',depart=str(depart),departLane='best',departSpeed='max')
    path=Path(directory)/'demand.rou.xml'
    ET.ElementTree(route_root).write(path,encoding='utf-8')
    return path
