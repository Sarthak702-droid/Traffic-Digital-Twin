import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
test('all completed tasks cannot assert acceptance or production readiness',async()=>{
 const plan=JSON.parse(await readFile(new URL('../docs/backlog.json',import.meta.url),'utf8'));
 for(const epic of plan.epics)for(const task of epic.stories){task.status='completed';task.evidence={scope:'historical_implementation'};}
 plan.risks=[{title:'Fixture gate',gate:plan.epics[0].stories[0].id,severity:'high',description:'Required acceptance'}];
 const dom=new JSDOM(await readFile(new URL('./index.html',import.meta.url),'utf8'),{url:'http://localhost/',runScripts:'outside-only'});
 try {
  dom.window.matchMedia=()=>({matches:true});dom.window.fetch=async()=>({ok:true,json:async()=>plan});
  dom.window.eval(await readFile(new URL('./app.js',import.meta.url),'utf8'));
  await new Promise(resolve=>setTimeout(resolve,20));
  const notice=dom.window.document.getElementById('notice').textContent;
  assert.match(notice,/acceptance remains open/);assert.match(notice,/NOT ACCEPTED/);
  dom.window.document.getElementById('review-gaps').click();
  const text=dom.window.document.body.textContent;
  assert.match(text,/acceptance remains open/);
  assert.doesNotMatch(text,/Closed & Verified|100% RESOLVED|production.ready|verified by delivery gates/i);
 } finally {dom.window.close();}
});
