import {describe,it,expect} from 'vitest';
import {buildScenarioInput,videoInputReady} from './run-input';
const mapping={'CAM-01':'C2-C1','CAM-02':'C4-C1'};
const clips=[{camera_id:'CAM-01',source_session_id:'one',status:'cached_valid',config_hash:'config'},
 {camera_id:'CAM-02',source_session_id:'two',status:'cached_valid',config_hash:'config'}];
describe('operator run input',()=>{
 it('requires every declared camera and compatible validated artifacts',()=>{
  expect(videoInputReady(mapping,clips,{'CAM-01':'one'})).toBe(false);
  expect(videoInputReady(mapping,clips,{'CAM-01':'one','CAM-02':'two'})).toBe(true);
  expect(videoInputReady(mapping,[clips[0],{...clips[1],config_hash:'other'}],{'CAM-01':'one','CAM-02':'two'})).toBe(false);
  expect(videoInputReady(mapping,[clips[0],{...clips[1],status:'degraded'}],{'CAM-01':'one','CAM-02':'two'})).toBe(false);
 });
 it('sends selected sessions for all scenarios and excludes them from seeded runs',()=>{
  expect(buildScenarioInput('video_profile',{'CAM-01':'one'})).toEqual({demand_source:'video_profile',source_sessions:{'CAM-01':'one'}});
  expect(buildScenarioInput('seeded',{'CAM-01':'one'})).toEqual({demand_source:'seeded'});
 });
});

it('rejects an internally compatible batch that belongs to an older active configuration',()=>{
 const clips=[{camera_id:'CAM-01',source_session_id:'old',config_hash:'v4',status:'cached_valid'}];
 expect(videoInputReady({'CAM-01':'boundary'},clips,{'CAM-01':'old'},'v5')).toBe(false);
});
