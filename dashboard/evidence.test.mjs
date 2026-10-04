import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readEvidence} from './evidence.mjs';
test('allowlist and canonical containment reject traversal and symlink escape',async()=>{
 const root=await mkdtemp(join(tmpdir(),'evidence-'));
 try {
  await mkdir(join(root,'reports'));await writeFile(join(root,'reports','ok.json'),'{}');
  assert.equal((await readEvidence(root,'report',{'report':'reports/ok.json'})).content,'{}');
  for(const target of ['../secret','%2e%2e%2fsecret','%252e%252e%252fsecret','/etc/passwd','reports/unknown']) await assert.rejects(readEvidence(root,target,{}),e=>e.status===403);
  await symlink('/etc/passwd',join(root,'reports','escape'));
  await assert.rejects(readEvidence(root,'escape',{'escape':'reports/escape'}),e=>e.status===403);
 } finally {await rm(root,{recursive:true,force:true});}
});
