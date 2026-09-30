import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {ActionRail} from './action-rail';
import {networkSchema} from '@/lib/api';
import config from '../../../packages/scenario-config/c1-c6.json';
afterEach(cleanup);
it('blocks an incomplete next video run without blocking reset of the active seeded run',()=>{
 const mutation={mutate:vi.fn(),reset:vi.fn(),isPending:false,isError:false,error:null,isSuccess:false};
 const props={network:networkSchema.parse(config),frame:{run_id:'seeded',movements:[],signals:[],simulation_time_s:1},analysis:null,
 scenarioID:'peak_surge',setScenarioID:vi.fn(),seed:'1101',setSeed:vi.fn(),dbReady:true,liveFresh:true,
 prepareMutation:mutation,resetMutation:mutation,onSimulate:vi.fn(),onApprove:vi.fn(),onModify:vi.fn(),onReject:vi.fn(),decisionPending:false,
 startReady:false} as any;
 render(<ActionRail {...props}/>);
 expect(screen.getByRole('button',{name:'Start simulation'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Reset same seed'})).toBeEnabled();
});

import {EmergencyCorridorPanel} from './emergency-corridor-panel';
it('blocks emergency launch with incomplete input but preserves reset of the active emergency',()=>{
 render(<EmergencyCorridorPanel network={networkSchema.parse(config)} frame={{scenario_type:'ambulance_corridor',emergency:{status:'scheduled',route_node_ids:['C6','C3','C1','C2'],eta_s:[1,2,3,4],recovery_cycles_remaining:1},signals:[],movements:[]} as any} canOperate startReady={false} pending={false} locked={false} onLaunch={vi.fn()} onReset={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'Start virtual emergency'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Reset same seed'})).toBeEnabled();
});
