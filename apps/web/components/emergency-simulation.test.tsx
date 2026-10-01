import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import config from '../../../packages/scenario-config/c1-c6.json';
import {networkSchema} from '@/lib/api';
import {EmergencySimulation} from './emergency-simulation';
import type {TrafficState} from '../../../packages/contracts/typescript/events';
afterEach(cleanup);
const network=networkSchema.parse(config);
const frame={scenario_type:'ambulance_corridor',simulation_time_s:45,signals:[{node_id:'C3',indication:'all_red',remaining_s:2}],movements:[],links:[],cells:[],emergency:{status:'pre_clearance',route_node_ids:['C6','C3','C1','C2'],eta_s:[0,12,35,55],recovery_cycles_remaining:1}} as unknown as TrafficState;
it('shows configured route stops, live signal state and modeled arrival without inventing boundary signals',()=>{
 const select=vi.fn();render(<EmergencySimulation network={network} frame={frame} onSelect={select}/>);
 expect(screen.getByRole('list',{name:'Virtual emergency route'})).toHaveTextContent('C6');
 expect(screen.getByText('All red · 2 s')).toBeInTheDocument();
 expect(screen.getByText('ETA 12 s')).toBeInTheDocument();
 expect(screen.getAllByText('Boundary · no signal')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'Inspect route stop C3'}));expect(select).toHaveBeenCalledWith('C3');
});
it('does not claim emergency progress or ETA from a different active scenario',()=>{
 render(<EmergencySimulation network={network} frame={{...frame,scenario_type:'peak_surge'}} onSelect={()=>{}}/>);
 expect(screen.getByText('Not scheduled')).toBeInTheDocument();
 expect(screen.queryByText('ETA 12 s')).not.toBeInTheDocument();
 expect(screen.getAllByText('ETA unavailable')).toHaveLength(4);
});
it('follows the configured three-junction route instead of embedding C1/C3 assignments',()=>{
 const custom={...network,scenarios:network.scenarios.map(s=>s.id==='ambulance_corridor'?{...s,route_node_ids:['C6','C3','C1','C7','C2']}:s),nodes:[...network.nodes,{...network.nodes.find(n=>n.id==='C1')!,id:'C7',name:'Third junction',x:900,y:700}]};
 render(<EmergencySimulation network={custom} frame={null} onSelect={()=>{}}/>);
 expect(screen.getByRole('button',{name:'Inspect route stop C7'})).toBeInTheDocument();
});
