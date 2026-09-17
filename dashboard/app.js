'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses = {backlog:{label:'Backlog',color:'#9da78f',icon:'◷'},'in-progress':{label:'In progress',color:'#8dbfea',icon:'↗'},ready:{label:'Ready',color:'#c0ed78',icon:'→'},blocked:{label:'Blocked',color:'#efc776',icon:'!'},completed:{label:'Completed',color:'#bba0ee',icon:'✓'}};
  const views = {tasks:['▦','Task list'],kanban:['▤','Kanban board'],epics:['◇','Epic overview'],gaps:['△','Open gaps'],git:['⌘','Git status']};
  const storageKey='traffic-delivery-tracking-v1';
  let tracking={};
  try {tracking=JSON.parse(localStorage.getItem(storageKey)||'{}');if(!tracking||typeof tracking!=='object'||Array.isArray(tracking))tracking={};}catch{}
  const state={view:'tasks',filter:'all',query:'',sort:'order',epic:null,priority:'all'};
  let plan, tasks=[],gitRequest=0,dialogId=null,toastTimer;
  const status = t => {
    const record=tasks.find(task=>task.id===t.id)||t;
    if(record.status==='completed'&&record.evidence)return 'completed';
    return Object.hasOwn(statuses,tracking[t.id])?tracking[t.id]:Object.hasOwn(statuses,record.status)?record.status:'backlog';
  };
  const count = key => tasks.filter(t=>status(t)===key).length;
  function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000);}
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify(tracking));toast('Personal progress saved in this browser');}catch{toast('Storage unavailable. Progress will last for this session only.');}}
  const priorityLabels = {P0:'High priority',P1:'Medium priority',P2:'Low priority'};
  const epicLabel = id => 'EPIC-' + id.replace(/^E/i,'');
  function epicQuery(query){
    const match=query.trim().match(/^(?:(?:epic|e)[\s-]*)?0*(\d+)$/i);
    return match ? 'E'+String(Number(match[1])).padStart(2,'0') : null;
  }
  function filtered(){
    const query=state.query.trim().toLowerCase();
    const searchEpic=epicQuery(query);
    return tasks.filter(t=>
      (state.filter==='all'||status(t)===state.filter)&&
      (state.priority==='all'||t.priority===state.priority)&&
      (!state.epic||state.epic===t.epicId)&&
      (!query||(searchEpic?t.epicId===searchEpic:
        [t.id,t.title,t.userStory,t.owner,t.epicId,epicLabel(t.epicId),t.epicTitle,t.priority,priorityLabels[t.priority],...t.acceptance,...t.sources].join(' ').toLowerCase().includes(query)))
    ).sort((a,b)=>state.sort==='title'?a.title.localeCompare(b.title):state.sort==='priority'?a.priority.localeCompare(b.priority)||a.order-b.order:a.order-b.order);
  }
  function priorityBadge(priority){return `<span class="tag priority" data-priority="${esc(priority)}" title="${esc(plan.priorities[priority].meaning)}">${esc(priorityLabels[priority])} · ${esc(priority)}</span>`;}
  function badge(t){const s=statuses[status(t)];return `<span class="badge" style="--tone:${s.color}">${s.label.toUpperCase()}</span>`;}
  function card(t,i=0){return `<article class="task-card" style="--tone:${statuses[status(t)].color};--i:${Math.min(i,10)}">
    <div class="card-meta"><span class="task-id">${esc(t.id)}</span>${badge(t)}</div>
    <button class="parent-epic" data-epic="${esc(t.epicId)}" title="Show all tasks in ${esc(t.epicTitle)}">${epicLabel(t.epicId)} · Task ${t.epicTaskIndex} of ${t.epicTaskCount}</button>
    <h3><button class="title-button" data-task="${esc(t.id)}">${esc(t.title)}</button></h3>
    <p>${esc(t.userStory)}</p>
    <div class="tags">${priorityBadge(t.priority)}<span class="tag">${t.dependencies.length} ${t.dependencies.length===1?'dependency':'dependencies'}</span></div>
    <details class="card-scope"><summary>${t.acceptance.length} acceptance criteria</summary><ol>${t.acceptance.map(a=>`<li>${esc(a)}</li>`).join('')}</ol></details>
    <div class="owner"><span class="avatar">${esc(t.owner.split(/\s+/).map(w=>w[0]).slice(0,2).join(''))}</span><div><small>RESPONSIBLE TEAM</small><strong>${esc(t.owner)}</strong></div></div>
    <div class="card-bottom"><span>Days ${t.days.join('–')}</span><button data-task="${esc(t.id)}">Open task ↗</button></div></article>`;}
  function empty(){return '<div class="empty"><strong>No matching tasks</strong><br>Try a different epic, keyword, priority or status.<br><button data-reset>Clear filters</button></div>';}
  function renderChrome(){
    const verified=tasks.filter(t=>t.status==='completed'&&t.evidence).length;
    $('notice').querySelector('strong').textContent=verified?'Repository completion recorded':'Start with the foundation';
    $('notice').querySelector('p').textContent=verified?`${verified} tasks completed with repository acceptance evidence. Other task changes are personal tracking.`:'Unverified stories remain proposed. Personal tracking does not verify implementation.';
    document.querySelector('.readiness-foot').textContent=`${verified} repository-verified · personal tracking on this browser`;
    const completed=count('completed'),pct=Math.round(completed/tasks.length*100)||0;
    $('percent').innerHTML=`${pct}<span>%</span>`;$('complete-label').textContent=`${completed} of ${tasks.length} tasks completed`;$('progress').style.width=pct+'%';
    const next=tasks.find(t=>status(t)!=='completed'&&t.dependencies.every(id=>tasks.some(d=>d.id===id&&status(d)==='completed')));
    $('next-task').textContent=next?`Next eligible: ${next.id} · ${next.title}`:'All tasks are tracked as completed. Verify acceptance before release.';
    const metrics=[['all','◎','Total tasks',tasks.length,'#aab99b'],['in-progress','↗','In progress',count('in-progress'),'#8dbfea'],['ready','→','Ready to start',count('ready'),'#c0ed78'],['blocked','!','Blocked / gated',count('blocked'),'#efc776'],['completed','✓','Completed',completed,'#bba0ee']];
    $('metrics').innerHTML=metrics.map(([key,icon,label,n,color])=>`<button class="metric" data-filter="${key}" style="--tone:${color}" aria-label="Show ${label}: ${n}"><span class="metric-icon">${icon}</span><span><strong>${n}</strong><small>${label}</small></span></button>`).join('');
    $('navigation').innerHTML=Object.entries(views).map(([key,[icon,label]])=>`<button class="nav-button ${state.view===key?'active':''}" data-view="${key}" ${state.view===key?'aria-current="page"':''}><span aria-hidden="true">${icon}</span>${label}</button>`).join('');
    $('filters').innerHTML=[['all','All work',tasks.length],...['in-progress','ready','blocked','backlog','completed'].map(k=>[k,statuses[k].label,count(k)])].map(([key,label,n])=>`<button class="filter-button ${state.filter===key?'active':''}" data-filter="${key}" aria-pressed="${state.filter===key}"><span>${label}</span><span>${n}</span></button>`).join('');
  }
  async function render(){
    if(!plan)return;
    renderChrome();const list=filtered();const isTasks=['tasks','kanban','epics'].includes(state.view);
    document.querySelector('.toolbar').hidden=!isTasks;
    $('scope-filters').hidden=!isTasks;
    $('epic-filter').value=state.epic||'all';
    $('priority-filter').value=state.priority;
    const selectedEpic=plan.epics.find(e=>e.id===(state.epic||epicQuery(state.query)));
    $('epic-context').hidden=!isTasks||!selectedEpic;
    $('epic-context').innerHTML=selectedEpic?`<div><span class="eyebrow">${epicLabel(selectedEpic.id)} / TASK BREAKDOWN</span><h3>${esc(selectedEpic.title)}</h3><p>${esc(selectedEpic.why)}</p><span class="subtle">${selectedEpic.stories.length} tasks · ${selectedEpic.stories.filter(t=>t.priority==='P0').length} high priority · ${esc(selectedEpic.owner)} · Days ${selectedEpic.days.join('–')}</span></div><button data-reset>View all tasks ↗</button>`:'';
    $('result-count').textContent=isTasks?list.length:state.view==='gaps'?plan.risks.length:'';
    $('view-title').firstChild.textContent=state.view==='tasks'?(selectedEpic?epicLabel(selectedEpic.id)+' tasks':state.filter==='all'?'All tasks':statuses[state.filter].label)+' ':views[state.view][1]+' ';
    $('view-kicker').textContent={tasks:'THE EXECUTION PLAN',kanban:'WORK IN MOTION',epics:'THE BIG PICTURE',gaps:'DECISIONS BEFORE DELIVERY',git:'REPOSITORY SNAPSHOT'}[state.view];
    $('view-caption').textContent=isTasks?`${list.length} of ${selectedEpic?selectedEpic.stories.length:tasks.length} tasks · ${state.priority==='all'?'All priorities':priorityLabels[state.priority]}`:state.view==='gaps'?'Risks from the delivery plan':'Read-only · on refresh';
    if(state.view==='tasks')$('content').innerHTML=list.length?`<div class="task-grid">${list.map(card).join('')}</div>`:empty();
    if(state.view==='kanban')$('content').innerHTML=`<div class="board">${Object.entries(statuses).map(([key,s])=>{const items=list.filter(t=>status(t)===key);return `<section class="column" style="--tone:${s.color}"><h3>${s.icon} &nbsp; ${s.label} <span class="subtle">${items.length}</span></h3>${items.length?items.map(card).join(''):'<div class="empty">No tasks here</div>'}</section>`;}).join('')}</div>`;
    if(state.view==='epics'){
      const epics=plan.epics.filter(e=>list.some(t=>t.epicId===e.id));
      $('content').innerHTML=epics.length?`<div class="epic-grid">${epics.map(e=>{const done=e.stories.filter(t=>status(t)==='completed').length;return `<article class="epic-card"><div class="card-meta"><span class="task-id">${epicLabel(e.id)}</span>${priorityBadge(e.priority)}</div><h3>${esc(e.title)}</h3><p>${esc(e.why)}</p><span class="subtle">${esc(e.owner)} · ${e.stories.length} tasks · Days ${e.days.join('–')}</span><div class="progress-track"><div style="width:${done/e.stories.length*100}%"></div></div><span class="subtle">${done} / ${e.stories.length} completed</span><div class="epic-task-list">${list.filter(t=>t.epicId===e.id).map(t=>`<button data-task="${esc(t.id)}"><span class="mono">${esc(t.id)}</span><span>${esc(t.title)}</span><span class="mini-priority" data-priority="${esc(t.priority)}">${esc(t.priority)}</span></button>`).join('')}</div><button data-epic="${esc(e.id)}">View all ${e.stories.length} task cards →</button></article>`;}).join('')}</div>`:empty();
    }
    if(state.view==='gaps')$('content').innerHTML=`<div class="gap-grid">${plan.risks.map((r,i)=>`<article class="gap-card"><div class="eyebrow">GAP-${String(i+1).padStart(3,'0')} / PLANNING RISK</div><h3>${esc(r.title)}</h3><p>${esc(r.mitigation)}</p><span class="subtle">${esc(r.owner)} · ${esc(r.gate)}</span></article>`).join('')}</div><h2 style="margin:28px 0 18px">Scope decisions</h2><div class="gap-grid">${plan.decisions.map(d=>`<article class="gap-card"><h3>${esc(d.title)}</h3><p>${esc(d.detail)}</p></article>`).join('')}</div>`;
    if(state.view==='git'){
      const token=++gitRequest;$('content').innerHTML='<div class="empty">Reading Git status…</div>';
      try{const response=await fetch('/api/git');if(!response.ok)throw Error();const git=await response.json();if(state.view!=='git'||token!==gitRequest)return;
        $('content').innerHTML=`<section class="git-panel"><span class="eyebrow">LOCAL REPOSITORY</span><h2>${git.available?esc(git.branch||'Detached HEAD'):'Git status unavailable'}</h2><p>${git.available?`${git.files.length} changed file entries. This snapshot does not verify task completion.`:esc(git.message)}</p>${git.available?`<pre>${esc(git.files.join('\n')||'Working tree is clean.')}</pre>`:''}</section>`;
      }catch{if(state.view==='git'&&token===gitRequest)$('content').innerHTML='<div class="empty">Could not read Git status. Use Refresh to retry.</div>';}
    }
  }
  function openTask(id){
    const t=tasks.find(t=>t.id===id);if(!t)return;dialogId=id;
    const blocked=t.dependencies.filter(id=>!tasks.some(d=>d.id===id&&status(d)==='completed'));
    $('dialog-content').innerHTML=`<div class="dialog-top"><div class="card-meta"><span class="task-id">${esc(t.id)} / ${epicLabel(t.epicId)} · Task ${t.epicTaskIndex} of ${t.epicTaskCount}</span> ${badge(t)}</div><button class="icon-button" data-close aria-label="Close task details">×</button></div><div class="dialog-body"><h2 id="dialog-title">${esc(t.title)}</h2><div class="detail-meta">${priorityBadge(t.priority)}<span class="tag">${esc(t.owner)}</span><span class="tag">Days ${t.days.join('–')}</span></div><h3>OBJECTIVE</h3><p>${esc(t.userStory)}</p><h3>ACCEPTANCE CRITERIA</h3><ol>${t.acceptance.map(a=>`<li>${esc(a)}</li>`).join('')}</ol><h3>DEPENDENCIES</h3>${t.dependencies.length?t.dependencies.map(id=>`<button class="dependency" data-task="${esc(id)}">${esc(id)} · ${esc(statuses[status({id})].label)} ↗</button>`).join(''):'<p>No prerequisite stories. This task can start the foundation.</p>'}${blocked.length?`<p>${blocked.length} prerequisite(s) are not yet tracked as completed.</p>`:''}<h3>REQUIREMENT SOURCES</h3><ul>${t.sources.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><div class="detail-controls"><label for="task-status">${t.evidence?'Repository-verified completion':'Personal task status'}<small>${t.evidence?'Accepted against the recorded implementation checks.':'Saved on this device. Does not modify repository evidence.'}</small></label><select id="task-status" ${t.evidence?'disabled':''}>${Object.entries(statuses).map(([key,s])=>`<option value="${key}" ${status(t)===key?'selected':''}>${s.label}</option>`).join('')}</select></div>${t.evidence?`<p><a href="/evidence/${esc(t.epicId.toLowerCase())}" target="_blank" rel="noopener">Read ${esc(epicLabel(t.epicId))} acceptance evidence ↗</a></p>`:''}<details><summary>View source record</summary><pre class="source-text">${esc(JSON.stringify(plan.epics.find(e=>e.id===t.epicId).stories.find(s=>s.id===id),null,2))}</pre></details></div>`;
    if(!$('task-dialog').open)$('task-dialog').showModal();
    $('dialog-content').querySelector('[data-close]').focus();
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.view){state.view=b.dataset.view;state.epic=null;render();}
    if(b.dataset.filter){state.filter=b.dataset.filter;state.view=['tasks','kanban'].includes(state.view)?state.view:'tasks';render();}
    if(b.dataset.task)openTask(b.dataset.task);
    if(b.dataset.epic){state.epic=b.dataset.epic;state.view='tasks';state.query='';state.filter='all';state.priority='all';$('search').value='';render();}
    if(b.hasAttribute('data-close'))$('task-dialog').close();
    if(b.hasAttribute('data-reset')){state.query='';state.filter='all';state.epic=null;state.priority='all';$('search').value='';render();}
  });
  $('task-dialog').addEventListener('click',e=>{if(e.target===$('task-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  $('task-dialog').addEventListener('change',e=>{if(e.target.id==='task-status'){tracking[dialogId]=e.target.value;persist();render();const meta=$('dialog-content').querySelector('.badge');const t=tasks.find(t=>t.id===dialogId);meta.outerHTML=badge(t);}});
  $('search').addEventListener('input',e=>{state.query=e.target.value;if(epicQuery(state.query))state.epic=null;render();});
  $('epic-filter').addEventListener('change',e=>{state.epic=e.target.value==='all'?null:e.target.value;if(epicQuery(state.query)){state.query='';$('search').value='';}render();});
  $('priority-filter').addEventListener('change',e=>{state.priority=e.target.value;render();});
  $('sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
  $('review-gaps').addEventListener('click',()=>{state.view='gaps';render();});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!$('task-dialog').open){e.preventDefault();state.view='tasks';render();$('search').focus();}});
  let paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function motion(){document.body.classList.toggle('no-motion',paused);$('motion').textContent=paused?'▷':'Ⅱ';$('motion').setAttribute('aria-label',paused?'Enable animations':'Pause animations');$('motion').title=paused?'Enable animations':'Pause animations';}
  $('motion').addEventListener('click',()=>{paused=!paused;motion();});motion();
  async function load(){
    $('refresh').disabled=true;
    try{const response=await fetch('/api/plan');if(!response.ok)throw Error();const incoming=await response.json();if(!Array.isArray(incoming.epics)||!incoming.epics.every(e=>Array.isArray(e.stories)))throw Error();plan=incoming;tasks=plan.epics.flatMap(e=>e.stories.map((t,index)=>({...t,epicId:e.id,epicTitle:e.title,epicTaskIndex:index+1,epicTaskCount:e.stories.length}))).map((t,order)=>({...t,order}));$('epic-filter').innerHTML='<option value="all">All epics</option>'+plan.epics.map(e=>`<option value="${esc(e.id)}">${epicLabel(e.id)} · ${esc(e.title)} (${e.stories.length})</option>`).join('');$('connection').innerHTML='<i></i> Repository plan connected';await render();}
    catch{$('connection').textContent='Repository unavailable';$('view-caption').textContent='Connection failed';$('content').innerHTML='<div class="empty"><strong>Could not load the delivery plan.</strong><br>Start with node dashboard/server.mjs and check the backlog source.<br>Use the refresh button to retry.</div>';toast('Could not refresh repository data');}
    finally{$('refresh').disabled=false;}
  }
  $('refresh').addEventListener('click',()=>load());load();
})();
