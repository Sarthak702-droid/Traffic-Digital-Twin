import { expect, it } from 'vitest';
import { observationQuery } from './observation-query';
it('uses the authoritative run for boundary observations and an explicit session for independent display',()=>{
 const frame={run_id:'run',demand_source:'video_profile'} as any;
 expect(observationQuery('CAM-01','cached_observations',frame,{'CAM-01':'link'},{'CAM-01':'draft'})).toContain('run_id=run');
 expect(observationQuery('CAM-04','cached_observations',frame,{'CAM-01':'link'},{'CAM-04':'display'})).toContain('source_session_id=display');
 expect(observationQuery('CAM-01','cached_observations',{...frame,demand_source:'seeded'},{'CAM-01':'link'},{'CAM-01':'draft'})).not.toContain('run_id=');
});
