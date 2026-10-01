import {describe,it,expect,vi,afterEach} from 'vitest';
import {downloadRunReport} from './run-report';
describe('run report export',()=>{
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()});
 it('rejects another run before creating a download',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({schema_version:'prototype-run-report-v2',run_id:'other'}),{status:200})));
  await expect(downloadRunReport('11111111-1111-4111-8111-111111111111')).rejects.toThrow('requested run');
 });
 it('keeps authentication failure visible and creates no download',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({message:'Sign in required'}),{status:401})));
  await expect(downloadRunReport('11111111-1111-4111-8111-111111111111')).rejects.toThrow('Sign in required');
 });
});
