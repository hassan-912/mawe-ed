import { CHECKLISTS, DESTINATIONS, ZONE, today, addDays, daysBetween, readyBy, reminderStartFor, pendingItems, caseStatus, isPlaceholder, zonedInstant, localParts, caseMessage, validateRecord, buildPriorities } from './engine.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const paths = {
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  folder:'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  check:'m5 12 4 4L19 6', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  tasks:'M9 5h11 M9 12h11 M9 19h11 M3 5h1 M3 12h1 M3 19h1',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 4-3 1-1 4H9l-1-4-3-1-2-4 2-5 3-1Z',
  calendar:'M8 2v4 M16 2v4 M3 9h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  plus:'M12 5v14 M5 12h14', arrow:'M5 12h14 m-5-5 5 5-5 5', search:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  close:'m6 6 12 12 M6 18 18 6', leaf:'M20 3C6 2 2 9 5 15s12 9 15-12Z M5 20 16 8',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M19 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-4',
  shield:'m12 3 8 3v6c0 5-8 10-8 10S4 17 4 12V6l8-3Z m-4 9 3 3 5-6',
  chat:'M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-1l-5 2 2-5a9 9 0 1 1 16-5Z',
  edit:'m16 3 5 5-12 12-6 1 1-6L16 3Z M13 6l5 5'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(paths[name] || paths.bell).split(' M').map((p,i) => `<path d="${i ? 'M' : ''}${p}"/>`).join('')}</svg>`;
const initials = name => escape(name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase());
const dateLabel = value => new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' }).format(new Date(`${value}T12:00:00Z`));
const instantLabel = value => new Intl.DateTimeFormat('en-GB', { timeZone:ZONE, day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(value));
let pushConnected = false;
let sessionGeneration = 0;
let mode = 'demo', portal = 'employee', view = 'overview', filter = 'all', query = '', user, data, config = {};
const storageKey = 'mawid-demo-v1';
const demoPeople = [{ id:'sara', name:'Sara Hassan', role:'employee', email:'sara@example.test' }, { id:'omar', name:'Omar Mahmoud', role:'manager', email:'omar@example.test' }];
function seed() {
  const d = today();
  return { people: demoPeople, cases:[
    { id:'ahmed', name:'Ahmed Mostafa', ownerId:'sara', phone:'', kind:'schengen_tourism', appointment:addDays(d,4), checks:{Hotel:true,Flight:true,Aman:true}, notes:'Tourism consultation completed. Waiting for the final application and supporting documents.', archived:false },
    { id:'nour', name:'Nour Adel', ownerId:'sara', phone:'', kind:'usa', appointment:addDays(d,6), checks:{Hotel:true}, notes:'Confirm DS-160 details before final submission.', archived:false },
    { id:'salma', name:'Salma Ibrahim', ownerId:'sara', phone:'', kind:'schengen_business', appointment:addDays(d,9), checks:{Hotel:true,Flight:true,Application:true,Aman:true,'Travel plan':true,Translation:true}, notes:'Conference invitation is still pending.', archived:false },
    { id:'youssef', name:'Youssef Ali', ownerId:'sara', phone:'', kind:'schengen_tourism', appointment:addDays(d,11), checks:Object.fromEntries(CHECKLISTS.schengen_tourism.map(x=>[x,true])), notes:'All preparation items complete.', archived:false }
  ], consultations:[
    { id:'c-ahmed', name:'Ahmed Mostafa', ownerId:'omar', consultationDate:addDays(d,-5), destination:'Italy · Schengen', intervalHours:48, nextReminder:new Date(Date.now()-7200000).toISOString(), status:'active', notes:'Recommended Italy for a first tourism trip. Follow up on whether he wants to proceed.', phone:'' },
    { id:'c-mariam', name:'Mariam Tarek', ownerId:'omar', consultationDate:addDays(d,-3), destination:'Canada', intervalHours:48, nextReminder:new Date(Date.now()-3600000).toISOString(), status:'active', notes:'Discussed travel options and the document requirements.', phone:'' },
    { id:'c-khaled', name:'Khaled Sami', ownerId:'omar', consultationDate:addDays(d,-1), destination:'USA', intervalHours:72, nextReminder:new Date(Date.now()+172800000).toISOString(), status:'active', notes:'Prefers a follow-up after three days.', phone:'' }
  ], tasks:[
    { id:'t1', name:'Check tomorrow’s appointments', ownerId:'sara', dueDate:d, time:'09:30', recurrence:'daily', doneOn:d, notes:'' },
    { id:'t2', name:'Review outstanding translations', ownerId:'sara', dueDate:d, time:'12:00', recurrence:'daily', doneOn:'', notes:'' },
    { id:'t3', name:'Confirm Ahmed’s hotel details', ownerId:'sara', dueDate:d, time:'14:00', recurrence:'once', doneOn:'', notes:'' },
    { id:'t4', name:'Review today’s consultations', ownerId:'omar', dueDate:d, time:'16:00', recurrence:'daily', doneOn:'', notes:'' }
  ], notifications:[], activity:[] };
}
function loadDemo() { try { const stored = JSON.parse(localStorage.getItem(storageKey)); return stored && Array.isArray(stored.cases) && Array.isArray(stored.consultations) && Array.isArray(stored.tasks) && Array.isArray(stored.people) && Array.isArray(stored.notifications) ? stored : seed(); } catch { return seed(); } }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(()=>$('#toast').classList.remove('show'),4000); }
async function api(url, options = {}) {
  const generation=sessionGeneration;
  const res = await fetch(`/api/${url}`, { credentials:'same-origin', ...options, headers:{ 'Content-Type':'application/json', ...options.headers } });
  if(generation!==sessionGeneration)throw new Error('The account session changed. Please try again.');
  if(!res.headers.get('content-type')?.includes('application/json'))throw new Error('The workspace connection failed. Please reload.');
  const json = await res.json();
  if(generation!==sessionGeneration)throw new Error('The account session changed. Please try again.');
  if (!res.ok) { if (res.status === 401 && user) { clearSession(); login('Your session ended. Please sign in again.'); } throw new Error(json.error || 'The request could not be saved.'); } return json;
}
async function reload() { data = await api('workspace'); user = data.user; }
function person(id) { return data.people.find(p=>p.id===id); }
function records(type) { return data[type].filter(r=>user.role==='manager' || r.ownerId===user.id); }
function tasks() { return records('tasks').filter(t=>!t.archived && (t.recurrence==='once' || t.dueDate<=today())); }
function taskDone(t) { return t.recurrence==='daily' ? t.doneOn===today() : !!t.doneOn; }
function activeCases() { return records('cases').filter(r=>!r.archived); }
function activeConsults() { return records('consultations').filter(r=>!r.archived && r.status==='active'); }
function dueConsults() { return activeConsults().filter(r=>Date.parse(r.nextReminder)<=Date.now()); }
function dueCases() { return activeCases().filter(r=>!isPlaceholder(r) && pendingItems(r).length && readyBy(r)<=today()); }
async function saveRecord(type, input, id) {
  const existing = id && data[type].find(r=>r.id===id);
  const record = validateRecord(type,input,existing||{});
  if (mode==='live') { await api(`${type}${id ? `/${encodeURIComponent(id)}` : ''}`, { method:id ? 'PATCH':'POST', body:JSON.stringify({...input,...(id?{_version:existing.version}:{})}) }); await reload(); }
  else {
    const recordId=id||crypto.randomUUID();
    if(id)data[type]=data[type].map(r=>r.id===id?{...record,id}:r);else data[type].push({...record,id:recordId});
    let summary=id?'Details updated':'Record created';
    if(input.checks){const changed=Object.keys(input.checks).filter(k=>input.checks[k]!==!!existing?.checks?.[k]);summary=changed.map(k=>`${input.checks[k]?'Completed':'Reopened'}: ${k}`).join(' · ')||summary;}
    if(input.priority&&input.priority!==(existing?.priority||'normal'))summary=`Priority changed to ${input.priority}`;
    demoActivity(id?'record.updated':'record.created',summary,recordId,type,record);
    localStorage.setItem(storageKey,JSON.stringify(data));
  }
  render();
}
const navNames = () => [{id:'overview',name:'Overview',icon:'grid'},{id:'today',name:'Today’s priorities',icon:'clock'},{id:'records',name:portal==='manager'?'Consultations':'Client cases',icon:portal==='manager'?'chat':'folder'},{id:'tasks',name:'Everyday tasks',icon:'tasks'},{id:'notifications',name:'Reminders',icon:'bell'},{id:'activity',name:'Activity history',icon:'tasks'},{id:'settings',name:'Settings & team',icon:'settings'}];
function render() {
  if (!user) return;
  if(mode==='live'&&(user.status!=='active'||user.mustChangePassword))return restrictedAccount();
  const nav = navNames(); const active = nav.find(n=>n.id===view); const d = new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="assets/mawid-mark.svg" alt="" width="43" height="43"><div><div class="brand-title">Maw‘id</div><small>A little ahead, always.</small></div></div><div><p class="portal-label eyebrow">Your workspace</p><div class="portal-switch" aria-label="Choose portal"><button data-portal="employee" class="${portal==='employee'?'active':''}" aria-pressed="${portal==='employee'}">Employee</button><button data-portal="manager" class="${portal==='manager'?'active':''}" aria-pressed="${portal==='manager'}" ${mode==='live' && user.role!=='manager'?'disabled':''}>Manager</button></div></div><nav class="nav" aria-label="Main navigation">${nav.map(n=>`<button data-view="${n.id}" class="${view===n.id?'active':''}" ${view===n.id?'aria-current="page"':''}>${icon(n.icon)}<span>${n.name}</span>${n.id==='notifications' ? `<span class="count">${portal==='manager'?dueConsults().length:dueCases().length}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><p class="quote">Small reminders.<br>Thoughtful follow-through.</p><div class="company"><img class="company-logo" src="assets/company-logo.svg" alt="Company MG logo"><div><strong>Your company workspace</strong><small>Powered by Maw‘id</small></div></div></div></aside><section class="workspace"><header class="topbar"><div class="breadcrumb">${icon('grid')}<span>${portal==='manager'?'Manager':'Employee'} portal</span><span>/</span><strong>${active.name}</strong></div><div class="header-actions"><span class="time-zone">${icon('clock')} Cairo time</span><button class="bell-btn" data-view="notifications" aria-label="Open reminders">${icon('bell')}<span class="dot"></span></button><div class="profile"><div class="avatar">${initials(user.name)}</div><div><strong>${escape(user.name)}</strong><small>${escape(user.role==='manager'?'Consultation manager':'Case specialist')}</small></div></div></div></header><main class="content" id="main" tabindex="-1">${mode==='demo'?`<div class="demo-banner"><span>Interactive demo · sample clients · saved on this device · phone messages are not active</span><button class="text-btn" data-view="settings">About this demo ${icon('arrow')}</button></div>`:''}<div class="page-heading"><div><p class="eyebrow">${escape(d)}</p><h1>${view==='overview'?'A little ahead, always.':escape(active.name)}</h1><p>${subtitle()}</p></div>${['overview','records','tasks'].includes(view)?`<button class="btn" data-action="new" data-type="${view==='tasks'?'tasks':portal==='manager'?'consultations':'cases'}">${icon('plus')} ${view==='tasks'?'New task':portal==='manager'?'New consultation':'New client case'}</button>`:''}</div>${content()}<footer class="footer"><span>${icon('leaf')} A calmer way to keep things moving.</span><span>Maw‘id · ${mode==='demo'?'Preview workspace':'Company workspace'} · Africa/Cairo</span></footer></main></section></div>`;
  bind();
}
function subtitle() { return {overview:portal==='employee'?'Your clients, their deadlines, and a clear plan for today.':'Keep every consultation moving toward the next conversation.',records:portal==='employee'?'Prepare every case four days ahead of the embassy appointment.':'Remember the people behind every consultation.',tasks:'Make room for the everyday and the unexpected.',notifications:'Know who needs attention and exactly what is still missing.',today:'What needs attention first, across clients and tasks.',activity:'A clear record of who changed what and when.',settings:'Your team, your rhythm, your reminder preferences.'}[view]; }
function metric(label,value,foot,ico,extra='') { return `<div class="metric ${extra}"><div class="metric-top">${label}${icon(ico)}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`; }
function metrics() {
  if (portal==='manager') return `<div class="metrics">${metric('Active consultations',activeConsults().length,'People to keep in touch with','people')}${metric('Follow-ups due',dueConsults().length,'A conversation worth having','chat','warn')}${metric('Default interval','48h','Customize for each client','clock')}${metric('Tasks today',tasks().filter(t=>!taskDone(t)).length,'Keep your day moving','tasks','accent')}</div>`;
  const cs=activeCases(); return `<div class="metrics">${metric('Active client cases',cs.length,'Every client, thoughtfully prepared','folder')}${metric('Need attention',dueCases().length,'At the preparation deadline','clock','warn')}${metric('Ready to submit',cs.filter(r=>caseStatus(r)==='Ready').length,'All checklist items complete','check')}${metric('Tasks today',tasks().filter(t=>!taskDone(t)).length,'A little focus goes a long way','tasks','accent')}</div>`;
}
function content() {
  if(view==='overview') return `${metrics()}<div class="dashboard-grid">${recordPanel(true)}<aside class="rail">${schedulePanel()}${miniTasks()}<div class="daily-note">${icon('leaf')}<p>A prepared case.<br>A little peace of mind.</p></div></aside></div>`;
  if(view==='records') return `${recordPanel(false)}${portal==='employee'?`<div class="placeholder-options">${['Canada','UK'].map(n=>`<div class="placeholder-box"><h3>${n}</h3><span class="badge neutral">Under processing</span><p>Case tracking is available. Checklists and automatic preparation reminders will be enabled when the workflow is defined.</p></div>`).join('')}</div>`:''}`;
  if(view==='today') return todayPanel();
  if(view==='activity') return activityPanel();
  if(view==='tasks') return tasksPanel();
  if(view==='notifications') return notificationsPanel();
  return settingsPanel();
}
function schedulePanel() { return `<section class="schedule"><div class="schedule-icon">${icon('bell')}</div><p class="eyebrow">Your reminder rhythm</p><h2>${portal==='employee'?'Twice a day.<br>Nothing slips away.':'One conversation.<br>Every two days.'}</h2>${portal==='employee'?`<div class="schedule-item"><strong>10:30</strong><div><p>Morning check-in</p><span class="badge">Incomplete items only</span></div></div><div class="schedule-item"><strong>15:00</strong><div><p>Afternoon follow-through</p><span class="badge">Incomplete items only</span></div></div><p class="note">Starts four days before the preparation deadline, eight days before the appointment. Stops when every item is complete. Both times are in Cairo.</p>`:`<div class="schedule-item"><strong>48h</strong><div><p>Default follow-up interval</p><span class="badge">Adjust for each client</span></div></div><p class="note">Record the last conversation, choose the next reminder, or snooze when a client needs more time.</p>`}</section>`; }
function miniTasks() { const list=tasks().slice(0,3);return `<section class="panel"><div class="panel-head"><h2>Little things for today</h2>${icon('tasks')}</div><div class="rail-body">${list.map(t=>`<div class="task-mini"><input type="checkbox" id="mini-${escape(t.id)}" data-task="${escape(t.id)}" ${taskDone(t)?'checked':''}><label for="mini-${escape(t.id)}" class="${taskDone(t)?'done':''}">${escape(t.name)}<small>${t.recurrence==='daily'?'Every day':dateLabel(t.dueDate)} · ${escape(t.time)}</small></label></div>`).join('') || '<p class="small muted">Your day is clear.</p>'}<div class="mini-footer"><p>${tasks().filter(taskDone).length} of ${tasks().length} complete</p><button class="text-btn" data-view="tasks">All tasks ${icon('arrow')}</button></div></div></section>`; }
function recordPanel(compact) {
  const type=portal==='manager'?'consultations':'cases';
  let list=records(type).filter(r=>filter==='archived'?r.archived:!r.archived);
  if(filter==='attention') list=list.filter(r=>portal==='manager'?r.status==='active' && Date.parse(r.nextReminder)<=Date.now():pendingItems(r).length && readyBy(r)<=today());
  if(filter==='ready') list=list.filter(r=>portal==='manager'?r.status!=='active':caseStatus(r)==='Ready');
  list=list.filter(r=>`${r.name} ${r.destination||DESTINATIONS[r.kind]||''}`.toLowerCase().includes(query.toLowerCase()));
  list.sort((a,b)=>portal==='manager'?Date.parse(a.nextReminder)-Date.parse(b.nextReminder):a.appointment.localeCompare(b.appointment));
  const total=list.length; if(compact) list=list.slice(0,4);
  return `<section class="panel"><div class="panel-head"><div><h2>${portal==='employee'?'Your client cases':'Client follow-ups'} <span class="muted small">(${total})</span></h2><p>${portal==='employee'?'A clear view of what’s ready and what needs you.':'A timely conversation makes all the difference.'}</p></div>${compact?'<button class="text-btn" data-view="records">View all '+icon('arrow')+'</button>':''}</div><div class="toolbar"><div class="tabs" aria-label="Filter records">${[['all','All'],['attention','Needs attention'],['ready',portal==='manager'?'Closed':'Ready'],...(!compact?[['archived','Archived']]:[])].map(([id,name])=>`<button data-filter="${id}" class="${filter===id?'active':''}" aria-pressed="${filter===id}">${name}</button>`).join('')}</div><label class="search">${icon('search')}<input id="search" type="search" aria-label="Search clients" placeholder="Search clients…" value="${escape(query)}"></label></div><div class="case-list">${list.map(r=>portal==='manager'?consultCard(r):caseCard(r)).join('') || `<div class="empty">${icon('check')}<h3>${query?'No matching clients':'All clear here'}</h3><p>${query?'Try another name or destination.':'Add a client or choose another filter to see their progress.'}</p></div>`}</div></section>`;
}
function caseCard(r) {
  const pending=pendingItems(r), count=CHECKLISTS[r.kind].length, status=caseStatus(r), urgent=['Overdue','Due today'].includes(status), progress=count?Math.round((count-pending.length)/count*100):0;
  return `<article class="case-card ${urgent?'urgent':''}"><div class="case-top"><div class="client-info"><div class="avatar">${initials(r.name)}</div><div><h3>${escape(r.name)}</h3><small>${escape(DESTINATIONS[r.kind])} ${r.kind.startsWith('schengen')?`· ${r.kind.endsWith('business')?'Business':'Tourism'}`:''} · ${escape(person(r.ownerId)?.name||'Assigned staff')}</small></div></div><span class="badge ${status==='Overdue'?'danger':urgent||status==='Due soon'?'warn':isPlaceholder(r)?'neutral':''}">${status}</span></div><div class="date-line"><span>${icon('calendar')} Embassy <strong>${dateLabel(r.appointment)}</strong></span><span>${icon('clock')} Ready by <strong>${dateLabel(readyBy(r))}</strong></span></div>${count?`<div class="case-progress"><div class="progress" role="progressbar" aria-label="${escape(r.name)} checklist completion" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><div style="width:${progress}%"></div></div><span>${count-pending.length} / ${count} complete</span></div>`:''}<div class="card-bottom"><p class="missing">${isPlaceholder(r)?'Checklist is under processing':pending.length?`<strong>Still needed</strong> · ${escape(pending.slice(0,3).join(', '))}${pending.length>3?` +${pending.length-3}`:''}`:'Every item is ready. You’re all set.'}</p><button class="text-btn" data-action="detail" data-type="cases" data-id="${escape(r.id)}">Open case ${icon('arrow')}</button></div></article>`;
}
function consultCard(r) { const ago=daysBetween(r.consultationDate,today()), due=Date.parse(r.nextReminder)<=Date.now() && r.status==='active'; return `<article class="case-card ${due?'urgent':''}"><div class="case-top"><div class="client-info"><div class="avatar">${initials(r.name)}</div><div><h3>${escape(r.name)}</h3><small>${escape(r.destination||'Destination to be decided')} · ${escape(person(r.ownerId)?.name||'Manager')}</small></div></div><span class="badge ${due?'warn':r.status!=='active'?'neutral':''}">${r.archived?'Archived':r.status==='active'?(due?'Follow-up due':'Scheduled'):r.status==='converted'?'Moved forward':'Closed'}</span></div><div class="date-line"><span>${icon('calendar')} Consultation <strong>${dateLabel(r.consultationDate)}</strong></span><span>${icon('clock')} ${ago<0?`In ${-ago} days`:`${ago} day${ago===1?'':'s'} ago`}</span></div><p class="small muted">${escape(r.notes||'Add a note about the conversation.')}</p><div class="card-bottom"><p class="missing">Every <strong>${r.intervalHours} hours</strong> · Next ${instantLabel(r.nextReminder)}</p><button class="text-btn" data-action="detail" data-type="consultations" data-id="${escape(r.id)}">Follow up ${icon('arrow')}</button></div></article>`; }
function tasksPanel() { return `<section class="panel"><div class="panel-head"><div><h2>Your everyday & exceptional tasks</h2><p>Daily tasks reset each Cairo day. One-off tasks stay complete.</p></div></div>${records('tasks').filter(t=>!t.archived).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.time.localeCompare(b.time)).map(t=>`<div class="task-row"><label><input type="checkbox" data-task="${escape(t.id)}" ${taskDone(t)?'checked':''}><span><strong class="${taskDone(t)?'done':''}">${escape(t.name)}</strong><small>${t.recurrence==='daily'?'Every day from '+dateLabel(t.dueDate):dateLabel(t.dueDate)} · ${escape(t.time)} · ${escape(person(t.ownerId)?.name||'Staff')}</small></span></label><div class="task-tools"><span class="badge neutral">${t.recurrence==='daily'?'Daily':'One-off'}</span><button class="text-btn" data-action="edit" data-type="tasks" data-id="${escape(t.id)}">Edit ${icon('edit')}</button></div></div>`).join('') || '<div class="empty"><h3>Make space for your day</h3><p>Add an everyday task or an exceptional one-off reminder.</p></div>'}</section>`; }
function notificationsPanel() {
  const cs=portal==='employee'?dueCases():dueConsults();
  return `<div class="dashboard-grid"><div><section class="panel"><div class="panel-head"><div><h2>Needs your attention</h2><p>${mode==='demo'?'Message previews. No notifications have been sent.':'Current reminders and unfinished work.'}</p></div></div>${cs.map(r=>`<article class="notification"><h3>${escape(r.name)}</h3><p>${escape(portal==='employee'?caseMessage(r):`Consultation: ${dateLabel(r.consultationDate)} (${daysBetween(r.consultationDate,today())} days ago).\nFollow up about ${r.destination||'the recommended destination'}.`)}</p><button class="text-btn" data-action="detail" data-type="${portal==='employee'?'cases':'consultations'}" data-id="${escape(r.id)}">Open ${icon('arrow')}</button></article>`).join('') || '<div class="empty"><h3>You’re ahead of things.</h3><p>There are no due client reminders right now.</p></div>'}</section><section class="panel" style="margin-top:20px"><div class="panel-head"><div><h2>Delivery history</h2><p>Push-service acceptance and delivery failures appear here. Acceptance does not confirm the phone displayed the notification.</p></div></div>${data.notifications.length?data.notifications.map(n=>`<article class="notification"><h3>${escape(n.title||'Reminder')} <span class="badge ${n.status==='failed'?'danger':''}">${escape(n.status==='sent'?'Accepted by push service':n.status)}</span></h3><small>${instantLabel(n.createdAt)}${n.error?' · '+escape(n.error):''}</small><p>${escape(n.message)}</p></article>`).join(''):'<div class="empty"><h3>No messages sent yet</h3><p>Connect the production app and enable notifications on each staff member’s phone.</p></div>'}</section></div><aside class="rail">${schedulePanel()}</aside></div>`;
}
function settingsPanel() {
  return `<div class="settings-grid"><section class="panel settings-card">${pushSettings()}</section><section class="panel settings-card">${teamSettings()}</section><section class="panel settings-card"><h2>Reminder timing</h2><p>For an appointment on 18 October 2026, the preparation deadline is 14 October 2026.</p><div class="deadline-preview">${icon('calendar')}<span>18 Oct appointment ${icon('arrow')} <strong>14 Oct ready by</strong></span></div><p>By default reminders start four days before that preparation date, so this example starts on 10 October. You can choose an earlier start for each case. Messages show the preparation countdown and the embassy countdown separately.</p><p>Canada and UK remain under processing. No unknown checklist is treated as complete.</p></section><section class="panel settings-card"><h2>${mode==='demo'?'Your demo data':'Your workspace data'}</h2><p>${mode==='demo'?'Changes stay in this browser. They are not shared with your team. Use sample information here.':'Data is stored in the company database. Employees can access their assigned cases and tasks; managers oversee the team.'}</p><button class="btn secondary" data-action="export">Export ${mode==='demo'?'demo':'accessible'} data</button>${mode==='demo'?'<button class="text-btn" data-action="reset">Reset sample workspace</button>':''}</section></div>`;
}
function bind() {
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;filter='all';query='';render();});
  document.querySelectorAll('[data-portal]').forEach(b=>b.onclick=()=>{portal=b.dataset.portal;if(mode==='demo')user=data.people.find(p=>p.role===portal);view='overview';filter='all';query='';render();});
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});
  $('#search')?.addEventListener('input',e=>{query=e.target.value;const start=e.target.selectionStart;render();$('#search').focus();try{$('#search').setSelectionRange(start,start);}catch{}});
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset));
  document.querySelectorAll('[data-task]').forEach(b=>b.onchange=async()=>{const t=data.tasks.find(t=>t.id===b.dataset.task);b.disabled=true;try{await saveRecord('tasks',{doneOn:b.checked?today():''},t.id);toast(b.checked?'Task completed.':'Task reopened.');}catch(e){render();toast(e.message);}});
}
async function action(d) {
  if(d.action==='new'||d.action==='edit') return recordForm(d.type,d.id);
  if(d.action==='detail') return detail(d.type,d.id);
  if(d.action==='preview-message') { const r=activeCases()[0]; modal('A phone reminder','Preview only · no message is sent',`<div class="reminder-preview">${escape(r?caseMessage(r):'Your reminder will appear here when a case has unfinished items.')}</div>`); }
  if(d.action==='new-person') return personForm();
  if(d.action==='security') return securityDialog();
  if(d.action==='account-preview') return login();
  if(d.action==='membership') return membershipAction(d.id,d.operation);
  if(d.action==='enable-push') return enablePush();
  if(d.action==='disable-push') return disablePush();
  if(d.action==='logout') return signOut();
  if(d.action==='export') { const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`mawid-${mode}-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Workspace exported.'); }
  if(d.action==='reset') { modal('Reset sample workspace','Your changes to sample data will be removed.','<p class="small muted">Restore the original sample clients, consultations, and tasks?</p>','<button class="btn secondary" data-close>Keep changes</button><button class="btn" id="confirm-reset">Reset sample data</button>');$('#confirm-reset').onclick=()=>{data=seed();localStorage.setItem(storageKey,JSON.stringify(data));user=data.people.find(p=>p.role===portal);$('#modal').close();render();toast('Sample workspace restored.');}; }
}
function modal(title,subtitle,body,footer='<button class="btn secondary" data-close>Close</button>') {
  const m=$('#modal');m.innerHTML=`<div class="modal-head"><div><h2 id="modal-title">${escape(title)}</h2><small>${escape(subtitle)}</small></div><button class="close" aria-label="Close dialog" data-close>${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-footer"><span></span><div class="right">${footer}</div></div>`;m.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>m.close());if(!m.open)m.showModal();
}
function field(label,name,value='',type='text',extra='') { return `<div class="field ${extra}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${escape(value)}" ${type==='text'?'maxlength="160"':''} required></div>`; }
function ownerOptions(type,id) { return data.people.filter(p=>(p.status||'active')==='active'&&(type==='consultations'?p.role==='manager':true)).map(p=>`<option value="${escape(p.id)}" ${p.id===id?'selected':''}>${escape(p.name)}</option>`).join(''); }
function recordForm(type,id) {
  const r=id?data[type].find(r=>r.id===id):{}, owner=r.ownerId||user.id;
  let fields=field(type==='tasks'?'Task title':'Client name','name',r.name,'text','full');
  fields+=`<div class="field full"><label for="f-priority">Priority</label><select id="f-priority" name="priority">${['normal','high','urgent'].map(v=>`<option value="${v}" ${(r.priority||'normal')===v?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></div>`;
  fields+=`<div class="field full"><label for="f-ownerId">Assigned ${type==='consultations'?'manager':'staff member'}</label><select id="f-ownerId" name="ownerId" ${user.role!=='manager'?'disabled':''}>${ownerOptions(type,owner)}</select></div>`;
  if(type==='cases')fields+=`<div class="field"><label for="f-kind">Destination / purpose</label><select name="kind" id="f-kind">${[['schengen_tourism','Schengen · Tourism'],['schengen_business','Schengen · Business'],['usa','USA'],['canada','Canada · Under processing'],['uk','UK · Under processing']].map(([v,l])=>`<option value="${v}" ${r.kind===v?'selected':''}>${l}</option>`).join('')}</select></div>${field('Embassy appointment','appointment',r.appointment||addDays(today(),4),'date')}<div class="field full"><label for="f-reminderStart">Start reminders (optional)</label><input id="f-reminderStart" type="date" name="reminderStart" value="${escape(r.reminderStart||'')}"><small>Default: four days before the preparation deadline. Choose your own start on or before that deadline.</small></div>`;
  if(type==='consultations') { const next=r.nextReminder?localParts(new Date(r.nextReminder)):null;fields+=field('Consultation date','consultationDate',r.consultationDate||today(),'date')+field('Recommended destination','destination',r.destination||'To be decided')+`<div class="field"><label for="f-intervalHours">Reminder interval (hours)</label><input name="intervalHours" id="f-intervalHours" type="number" min="1" max="720" value="${r.intervalHours||48}" required><small>48 hours by default.</small></div><div class="field"><label for="f-status">Follow-up status</label><select id="f-status" name="status">${[['active','Active'],['converted','Moved forward'],['closed','Closed']].map(([v,l])=>`<option value="${v}" ${r.status===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field full"><label for="f-next">Next reminder (Cairo time)</label><input id="f-next" name="next" type="datetime-local" value="${next?`${next.date}T${next.time}`:''}" ${id?'required':''}><small>Leave empty on a new consultation to schedule from the consultation date at 10:30 plus the interval.</small></div>`; }
  if(type==='tasks') fields+=field('Date / start date','dueDate',r.dueDate||today(),'date')+field('Reminder time (Cairo)','time',r.time||'10:30','time')+`<div class="field full"><label for="f-recurrence">Frequency</label><select id="f-recurrence" name="recurrence"><option value="once" ${r.recurrence==='once'?'selected':''}>Exceptional · One-off</option><option value="daily" ${r.recurrence==='daily'?'selected':''}>Every day</option></select></div>`;
  if(type!=='tasks') fields+=`<div class="field full"><label for="f-phone">Client phone (optional)</label><input id="f-phone" name="phone" type="tel" maxlength="40" value="${escape(r.phone||'')}"><small>Reminders go to staff, not to the client.</small></div>`;
  fields+=`<div class="field full"><label for="f-notes">Notes (optional)</label><textarea name="notes" id="f-notes" maxlength="3000">${escape(r.notes||'')}</textarea></div>`;
  modal(`${id?'Edit':'New'} ${type==='cases'?'client case':type==='tasks'?'task':'consultation'}`,'Thoughtfully organized, right from the start.',`<form id="record-form"><div class="fields">${fields}</div>${type==='cases'?'<div id="date-preview" class="deadline-preview"></div>':''}<div class="error" id="form-error" role="alert"></div></form>`,`<button class="btn secondary" data-close>Cancel</button><button class="btn" form="record-form" type="submit">${id?'Save changes':'Create '+(type==='cases'?'case':type==='tasks'?'task':'consultation')}</button>`);
  if(type==='cases'){const preview=()=>{try{$('#date-preview').innerHTML=icon('calendar')+`<span>Preparation deadline: <strong>${dateLabel(addDays($('#f-appointment').value,-4))}</strong><br>Reminders from ${dateLabel(addDays($('#f-appointment').value,-8))} · 10:30 & 15:00</span>`;}catch{$('#date-preview').textContent='Choose a valid appointment date.';}};$('#f-appointment').onchange=preview;preview();}
  $('#record-form').onsubmit=async e=>{e.preventDefault();const button=$('[form="record-form"]');button.disabled=true;try{const input=Object.fromEntries(new FormData(e.target));input.ownerId=user.role==='manager'?input.ownerId:user.id;if(type==='consultations'){input.intervalHours=Number(input.intervalHours);if(input.next){const[d,t]=input.next.split('T');input.nextReminder=zonedInstant(d,t);}else input.nextReminder=new Date(Date.parse(zonedInstant(input.consultationDate,'10:30'))+input.intervalHours*3600000).toISOString();delete input.next;}if(type==='cases')input.checks=Object.fromEntries((CHECKLISTS[input.kind]||[]).map(k=>[k,!!r.checks?.[k]]));if(type==='tasks')input.doneOn=r.doneOn||'';await saveRecord(type,input,id);$('#modal').close();toast(id?'Changes saved.':'Added to your workspace.');}catch(e){showError('form-error',e.message);button.disabled=false;}};
}
function detail(type,id) {
  const r=data[type].find(r=>r.id===id);if(!r)return;
  if(type==='cases') {
    const items=CHECKLISTS[r.kind];modal(r.name,`${DESTINATIONS[r.kind]} · ${r.kind.endsWith('business')?'Business':r.kind.startsWith('schengen')?'Tourism':'Visa preparation'}`,`<div class="date-line"><span>${icon('calendar')} Embassy <strong>${dateLabel(r.appointment)}</strong></span><span>${icon('clock')} Ready by <strong>${dateLabel(readyBy(r))}</strong></span></div>${items.length?`<p class="small muted">Check off each item as it is completed. Changes save immediately.</p><div class="checklist">${items.map((x,i)=>`<label class="check-item"><input type="checkbox" data-check="${i}" ${r.checks?.[x]?'checked':''} ${r.archived?'disabled':''}><span>${escape(x)}</span></label>`).join('')}</div><div class="detail-section"><h3>Phone reminder preview</h3><div class="reminder-preview" id="case-message">${escape(caseMessage(r))}</div></div>`:'<div class="notice">Under processing. Checklist and preparation notifications will be enabled once this workflow is defined.</div>'}<div class="detail-section"><h3>Notes</h3><p class="small muted">${escape(r.notes||'No notes yet.')}</p></div>${recordActivity(id)}<div class="error" id="detail-error" role="alert"></div>`,`<button class="danger-btn" id="archive-record">${r.archived?'Restore case':'Archive case'}</button><button class="btn secondary" id="edit-record">Edit details</button><button class="btn" data-close>Done</button>`);
    document.querySelectorAll('[data-check]').forEach(b=>b.onchange=async()=>{const inputs=[...document.querySelectorAll('[data-check]')];inputs.forEach(x=>x.disabled=true);try{const latest=data.cases.find(x=>x.id===id);const checks={...latest.checks,[items[Number(b.dataset.check)]]:b.checked};await saveRecord('cases',{checks},id);$('#case-message').textContent=caseMessage(data.cases.find(x=>x.id===id));toast('Checklist saved.');}catch(e){b.checked=!b.checked;showError('detail-error',e.message);}finally{inputs.forEach(x=>x.disabled=false);}});
  } else {
    modal(r.name,`Consultation · ${dateLabel(r.consultationDate)} · ${daysBetween(r.consultationDate,today())} days ago`,`<p class="small muted">${escape(r.destination||'Destination not set')}</p><div class="deadline-preview">${icon('clock')}<span>Next reminder <strong>${instantLabel(r.nextReminder)}</strong><br>Every ${r.intervalHours} hours · Cairo time</span></div><p class="small muted">${escape(r.notes||'No consultation notes yet.')}</p><div class="detail-actions"><button class="btn" id="contacted" ${r.status!=='active'||r.archived?'disabled':''}>${icon('check')} Followed up today</button><button class="btn secondary" id="snooze" ${r.status!=='active'||r.archived?'disabled':''}>Snooze 24 hours</button></div>${!r.archived&&r.status!=='closed'?`<div class="detail-actions"><button class="btn secondary" id="handoff-consultation">${icon('folder')} ${r.linkedCaseId?'Open employee case':'Hand off to employee'}</button></div>`:''}<div class="detail-section"><h3>Next step</h3><p class="small muted">“Followed up today” starts a new ${r.intervalHours}-hour interval. Change the status to “Moved forward” or “Closed” to stop repeating reminders.</p></div>${recordActivity(id)}<div class="error" id="detail-error" role="alert"></div>`,`<button class="danger-btn" id="archive-record">${r.archived?'Restore consultation':'Archive'}</button><button class="btn secondary" id="edit-record">Edit schedule & status</button>`);
    $('#handoff-consultation')?.addEventListener('click',()=>r.linkedCaseId?detail('cases',r.linkedCaseId):handoffForm(id));
    $('#contacted').onclick=()=>updateDetail({lastContact:new Date().toISOString(),nextReminder:new Date(Date.now()+r.intervalHours*3600000).toISOString()},'Follow-up recorded.');
    $('#snooze').onclick=()=>updateDetail({nextReminder:new Date(Date.now()+86400000).toISOString()},'Snoozed for 24 hours.');
  }
  async function updateDetail(input,message) {const buttons=[...$('#modal').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await saveRecord(type,input,id);$('#modal').close();toast(message);}catch(e){showError('detail-error',e.message);buttons.forEach(b=>b.disabled=false);}}
  $('#edit-record').onclick=()=>recordForm(type,id);
  $('#archive-record').onclick=()=>updateDetail({archived:!r.archived},r.archived?'Restored to your workspace.':'Archived. Reminders stopped.');
}
function personForm() {
  modal('Add staff member','Invite a colleague to their own workspace.',`<form id="person-form"><div class="fields">${field('Full name','name','','text','full')}${field('Email','email','','email','full')}<div class="field full"><label for="f-role">Role</label><select id="f-role" name="role"><option value="employee">Employee</option><option value="manager">Manager</option></select></div><div class="field full"><label for="f-password">Initial password</label><input id="f-password" name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required><small>At least 15 characters. The staff member will choose their own password at first sign-in. Share privately with the staff member.</small></div></div><div class="error" id="person-error" role="alert"></div></form>`,'<button class="btn secondary" data-close>Cancel</button><button class="btn" type="submit" form="person-form">Create account</button>');
  $('#person-form').onsubmit=async e=>{e.preventDefault();const b=$('[form="person-form"]');b.disabled=true;try{await api('people',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});await reload();render();$('#modal').close();toast('Staff account created.');}catch(e){showError('person-error',e.message);b.disabled=false;}};
}
function login(message='') {
  if($('#modal').open)$('#modal').close();
  $('#app').innerHTML=`<main class="login">${accountBrand()}<h1>Your company workspace.</h1><p>Sign in to see your clients, tasks, and reminders.</p>${mode==='demo'?'<div class="notice">This is the preview. Real registration and sign-in use the company backend after deployment. Credentials are not collected or saved here.</div>':!config.authReady?'<div class="notice">The administrator needs to configure account security before sign-in is available.</div>':''}<form id="login-form"><div class="fields">${field('Email','email','','email','full')}<div class="field full"><label for="f-password">Password</label><input id="f-password" name="password" type="password" autocomplete="current-password" required maxlength="128"></div></div><div class="error" id="login-error" role="alert">${escape(message)}</div><button class="btn" type="submit" ${mode!=='live'||!config.authReady?'disabled':''}>Sign in ${icon('arrow')}</button></form><div class="account-links"><button class="text-btn" id="open-registration">Create an account</button>${mode==='demo'?'<button class="text-btn" id="return-demo">Explore the preview</button>':''}</div><p class="small muted">New staff accounts need manager approval before accessing company clients.</p></main>`;
  $('#f-email').autocomplete='username';
  $('#open-registration').onclick=registration;
  $('#return-demo')?.addEventListener('click',()=>{user=data.people.find(p=>p.role===portal);view='overview';render();});
  $('#login-form').onsubmit=async e=>{e.preventDefault();if(mode!=='live'||!config.authReady)return;const b=e.target.querySelector('button');b.disabled=true;try{const endpoint=await disconnectLocalPush();await api('login',{method:'POST',body:JSON.stringify({...Object.fromEntries(new FormData(e.target)),...(endpoint?{endpoint}:{})})});sessionGeneration++;await reload();await readPushState();portal=user.role;view=requestedView();render();}catch(e){showError('login-error',e.message);b.disabled=false;}};
}
function registration() {
  const disabled=mode!=='live'||!config.authReady||!config.registrationOpen;
  $('#app').innerHTML=`<main class="login">${accountBrand()}<h1>Make room for your work.</h1><p>Create your staff account. A manager will review your company access.</p>${mode==='demo'?'<div class="notice">Account creation requires the deployed company backend. This preview does not save credentials.</div>':!config.authReady?'<div class="notice">Account registration is awaiting administrator security configuration.</div>':!config.registrationOpen?'<div class="notice">New registrations are currently closed. Contact your manager.</div>':''}<form id="registration-form"><div class="fields">${field('Full name','name','','text','full')}${field('Email','email','','email','full')}<div class="field full"><label for="f-password">Password</label><input id="f-password" name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required><small>Use a unique passphrase with at least 15 characters.</small></div><div class="field full"><label for="confirm-password">Confirm password</label><input id="confirm-password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></div></div><div class="error" id="registration-error" role="alert"></div><button class="btn" ${disabled?'disabled':''}>Create account ${icon('arrow')}</button></form><div class="account-links"><button class="text-btn" id="back-to-login">Already have an account? Sign in</button></div><p class="small muted">Registration creates an employee account. Manager access is granted by your company administrator.</p></main>`;
  $('#f-name').autocomplete='name';$('#f-email').autocomplete='email';
  $('#back-to-login').onclick=()=>login();
  $('#registration-form').onsubmit=async e=>{e.preventDefault();if(disabled)return;const b=e.target.querySelector('button');if($('#f-password').value!==$('#confirm-password').value)return showError('registration-error','The passwords do not match.');b.disabled=true;try{const result=await api('register',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});login(result.message);}catch(e){showError('registration-error',e.message);b.disabled=false;}};
}
function accountBrand() {return '<div class="brand"><img src="assets/mawid-mark.svg" alt="" width="43" height="43"><div><div class="brand-title">Maw‘id</div><small>A little ahead, always.</small></div></div>';}
function clearSession() {sessionGeneration++;user=null;data=null;pushConnected=false;if($('#modal').open)$('#modal').close();}
function showError(id,message) {const el=document.getElementById(id);if(el)el.textContent=message;else toast(message);}
async function signOut() {
  try {
    const reg=pushSupported()?await navigator.serviceWorker.getRegistration('/'):null,sub=reg?await reg.pushManager.getSubscription():null;
    await api('logout',{method:'POST',body:JSON.stringify(sub?{endpoint:sub.endpoint}:{})});
    clearSession();login();
    try{await disconnectLocalPush();}catch{toast('Signed out. Check notification permissions on this device.');}
  }catch(e){toast('Sign-out could not be confirmed. Please retry while connected.');}
}
function restrictedAccount() {
  $('#app').innerHTML=`<main class="login">${accountBrand()}<h1>${user.mustChangePassword?'Choose your own password.':'Your account is ready.'}</h1><p>${user.mustChangePassword?'Change the initial password shared by your manager before opening company records.':'Your company access is awaiting manager approval. Your account does not have access to client records yet.'}</p><p class="small muted">Signed in as ${escape(user.name)} · ${escape(user.email)}</p><div class="form-actions"><button class="btn secondary" id="restricted-signout">Sign out</button><button class="btn" id="restricted-security">${user.mustChangePassword?'Change password':'Account security'}</button></div>${!user.mustChangePassword?'<button class="text-btn" id="check-approval">Check approval status</button>':''}</main>`;
  $('#restricted-signout').onclick=signOut;$('#restricted-security').onclick=securityDialog;
  $('#check-approval')?.addEventListener('click',async()=>{try{await reload();render();}catch(e){toast(e.message);}});
}
function requestedView() { return new URLSearchParams(location.search).get('view')==='notifications'?'notifications':'overview'; }
function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function pushSettings() {
  return `<h2>Phone notifications</h2><p>Free browser push can reach your phone even when the website tab is closed.</p>${mode==='demo'?`<div class="notice">Phone delivery is not active in this demo. The production app includes browser push, a service worker, and an installable phone app.</div><button class="btn secondary" data-action="preview-message">${icon('bell')} Preview a notification</button>`:`${!config.pushReady?'<div class="notice">The administrator needs to configure push keys before phone delivery can start.</div>':''}${!pushSupported()?'<div class="notice">This browser does not expose phone push. On iPhone, add this app to your Home Screen and open it from there.</div>':''}<button class="btn ${pushConnected?'secondary':''}" data-action="${pushConnected?'disable-push':'enable-push'}">${icon('bell')} ${pushConnected?'Turn off on this device':'Enable on this device'}</button><p>${pushConnected?'This device is connected.':'This device is not connected.'} ${data.pushDevices||0} notification device(s) on your account.</p>`}<ul><li>Android: open in Chrome or Edge and allow notifications.</li><li>iPhone/iPad: add to Home Screen, open the app, then enable notifications.</li><li>Managers: 48-hour default, customizable per client.</li><li>Employees: 10:30 and 15:00, Cairo time, starting before the preparation deadline.</li></ul><p>Notifications follow your phone’s permission, battery, network, and Focus settings. Force-stopping a browser or disabling notifications can prevent delivery.</p>`;
}
async function readPushState() {
  pushConnected=false;
  if(!pushSupported())return;
  const reg=await navigator.serviceWorker.getRegistration('/');
  const sub=reg&&await reg.pushManager.getSubscription();
  if(!sub)return;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint))),b=>b.toString(16).padStart(2,'0')).join('');
  const security=await api('security');pushConnected=security.devices.some(d=>d.id===hash);
}
async function enablePush() {
  if(mode!=='live'||!config.pushReady)return toast('The production push keys need to be configured first.');
  if(!pushSupported())return toast('Add to Home Screen on iPhone, or use a browser that supports push.');
  if(Notification.permission==='denied')return toast('Notifications are blocked. Allow them in your browser’s site settings.');
  // Permission is requested only after a staff member taps Enable.
  const permission=await Notification.requestPermission();
  if(permission!=='granted')return toast('Notifications were not enabled.');
  try {
    await navigator.serviceWorker.register('/sw.js',{scope:'/'});
    const reg=await navigator.serviceWorker.ready;
    const encoded=config.pushPublicKey.replaceAll('-','+').replaceAll('_','/');
    const key=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await api('push/subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});
    await reload();await readPushState();render();toast('Phone notifications enabled. They work with the tab closed.');
  }catch(e){toast(e.message||'Notifications could not be connected.');}
}
async function disablePush(showToast=true) {
  if(mode!=='live'||!pushSupported())return;
  try {
    const reg=await navigator.serviceWorker.getRegistration('/');
    const sub=reg && await reg.pushManager.getSubscription();
    if(sub){await api('push/unsubscribe',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe();}
    pushConnected=false;
    if(showToast){await reload();render();toast('Notifications turned off on this device.');}
  }catch(e){toast(e.message);if(!showToast)throw e;}
}

async function start() {
  try {
    const response=await fetch('/api/config',{cache:'no-store'});
    const isJson=response.headers.get('content-type')?.includes('application/json');
    if(response.ok && isJson) {config=await response.json();if(config.production){mode='live';try{await reload();await readPushState();portal=user.role;view=requestedView();render();}catch(e){login(e.message==='Please sign in.'?'':e.message);}return;}}
    if(response.status>=500 || (isJson && !response.ok))throw new Error('The company backend is unavailable. Please try again.');
    data=loadDemo();data.activity||=[];user=data.people.find(p=>p.role==='employee');render();
  } catch(e) {$('#app').innerHTML=`<main class="login"><h1>Workspace unavailable</h1><p>${escape(e.message)}</p><button class="btn" id="retry">Try again</button></main>`;$('#retry').onclick=start;}
}
start();

function todayPanel() {
  const items=buildPriorities({cases:records('cases'),consultations:records('consultations'),tasks:records('tasks')});
  return `<section class="panel"><div class="panel-head"><div><h2>A clear plan for today</h2><p>Overdue work first, then due reminders and upcoming preparation.</p></div><span class="badge neutral">${items.length} items</span></div>${items.map(item=>`<article class="priority-row"><div><span class="eyebrow muted">${escape(item.type==='cases'?'Client case':item.type==='consultations'?'Consultation':'Task')}</span><h3>${escape(item.name)}</h3><p>${escape(item.description)}${item.missing.length?' · '+escape(item.missing.slice(0,3).join(', ')):''}</p></div><div class="priority-actions"><span class="badge ${item.priority==='urgent'?'danger':item.priority==='high'?'warn':'neutral'}">${escape(item.priority)}</span><button class="text-btn" data-action="${item.type==='tasks'?'edit':'detail'}" data-type="${item.type}" data-id="${escape(item.id)}">Open ${icon('arrow')}</button></div></article>`).join('')||'<div class="empty"><h3>You’re ahead of things.</h3><p>No urgent or upcoming work needs your attention.</p></div>'}</section>`;
}
function demoActivity(action,summary,recordId=null,type=null,record=null) {
  data.activity||=[];
  data.activity.unshift({id:crypto.randomUUID(),actorId:user.id,actorName:user.name,recordId,recordName:record?.name||'',type,summary,action,createdAt:new Date().toISOString()});
  data.activity=data.activity.slice(0,200);
}
function visibleActivity() {
  const entries=data.activity||[];
  if(mode==='live'||user.role==='manager')return entries;
  return entries.filter(a=>a.recordId?[...data.cases,...data.consultations,...data.tasks].some(r=>r.id===a.recordId&&r.ownerId===user.id):a.actorId===user.id);
}
function activityRows(entries) {
  return entries.map(a=>`<article class="activity-row"><div class="activity-dot" aria-hidden="true"></div><div><h3>${escape(a.summary)}</h3><p>${escape(a.actorName)}${a.recordName?' · '+escape(a.recordName):''}</p><small class="muted">${instantLabel(a.createdAt)} · Cairo time</small></div></article>`).join('');
}
function activityPanel() {
  const entries=visibleActivity();
  return `<section class="panel"><div class="panel-head"><div><h2>Your workspace activity</h2><p>${mode==='demo'?'Sample changes saved in this browser.':'Server-written history of successful changes to accessible records.'}</p></div></div><div class="activity-list">${activityRows(entries)||'<div class="empty"><h3>A fresh page.</h3><p>Checklist, deadline, assignment, and handoff changes will appear here.</p></div>'}</div></section>`;
}
function recordActivity(id) {
  const entries=visibleActivity().filter(a=>a.recordId===id).slice(0,5);
  return entries.length?`<section class="detail-section"><h3>Recent activity</h3>${activityRows(entries)}</section>`:'';
}
function teamSettings() {
  const manager=user.role==='manager';
  return `<h2>Your team</h2><p>${mode==='demo'?'Sample accounts for exploring both portals.':'New registrations need approval. Verify the staff member’s identity before granting company access.'}</p><div class="people-list">${data.people.map(p=>`<div class="person"><div><strong class="small">${escape(p.name)}</strong><small class="muted">${escape(p.email||'')}</small><span class="badge ${(p.status||'active')==='pending'?'warn':(p.status||'active')==='disabled'?'danger':'neutral'}">${escape(p.role)} · ${escape(p.status||'active')}</span></div>${manager&&p.role==='employee'&&p.id!==user.id?`<button class="text-btn" data-action="membership" data-id="${escape(p.id)}" data-operation="${p.status==='pending'?'approve':p.status==='disabled'?'activate':'disable'}">${p.status==='pending'?'Approve':p.status==='disabled'?'Restore access':'Pause access'}</button>`:''}</div>`).join('')}</div>${mode==='live'&&manager?'<button class="btn secondary" data-action="new-person">Add staff member</button>':''}<div class="account-links"><button class="text-btn" data-action="${mode==='live'?'security':'account-preview'}">${icon('shield')} ${mode==='live'?'Account security':'Account sign-in & registration'}</button>${mode==='live'?'<button class="text-btn" data-action="logout">Sign out</button>':''}</div>`;
}
async function membershipAction(id,operation) {
  const p=person(id);if(!p||user.role!=='manager')return;
  modal(operation==='approve'?'Approve company access':operation==='activate'?'Restore company access':'Pause company access',p.name,`<p class="small muted">${escape(p.email)}</p><div class="notice">${operation==='disable'?'This employee will be signed out and their phone reminders will stop. Their records remain available for reassignment.':'Confirm this person belongs to your company. Email ownership has not been verified automatically.'}</div><form id="membership-form">${operation==='disable'?'':'<label class="check-item"><input type="checkbox" required><span>I have verified this staff member’s identity.</span></label>'}<div class="error" id="membership-error" role="alert"></div></form>`,`<button class="btn secondary" data-close>Cancel</button><button class="btn" form="membership-form">${operation==='disable'?'Pause access':'Confirm access'}</button>`);
  $('#membership-form').onsubmit=async e=>{e.preventDefault();const b=$('[form="membership-form"]');b.disabled=true;try{if(mode==='live'){await api(`people/${encodeURIComponent(id)}/${operation}`,{method:'POST',body:'{}'});await reload();}else{p.status=operation==='disable'?'disabled':'active';demoActivity('account.membership_changed','Employee membership changed');localStorage.setItem(storageKey,JSON.stringify(data));}$('#modal').close();render();toast('Company access updated.');}catch(e){showError('membership-error',e.message);b.disabled=false;}};
}
function handoffForm(id) {
  const r=data.consultations.find(c=>c.id===id);if(!r||user.role!=='manager')return;
  const employees=data.people.filter(p=>p.role==='employee'&&(p.status||'active')==='active');
  modal('Hand off to an employee',r.name,`<form id="handoff-form"><p class="small muted">Create one assigned case and stop repeating consultation follow-ups. Consultation notes stay with managers; add only the notes the employee needs.</p><div class="fields" style="margin-top:18px"><div class="field full"><label for="handoff-owner">Assigned employee</label><select id="handoff-owner" name="ownerId" required>${employees.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('')}</select></div><div class="field"><label for="handoff-kind">Destination / purpose</label><select id="handoff-kind" name="kind"><option value="schengen_tourism">Schengen · Tourism</option><option value="schengen_business">Schengen · Business</option><option value="usa">USA</option><option value="canada">Canada · Under processing</option><option value="uk">UK · Under processing</option></select></div><div class="field"><label for="handoff-date">Embassy appointment</label><input id="handoff-date" type="date" name="appointment" value="${addDays(today(),8)}" required></div><div class="field full"><label for="handoff-notes">Notes for the employee (optional)</label><textarea id="handoff-notes" name="notes" maxlength="3000"></textarea></div></div>${!employees.length?'<div class="notice">Approve or create an active employee before handing off a case.</div>':''}<div class="deadline-preview" id="handoff-dates"></div><div class="error" id="handoff-error" role="alert"></div></form>`,'<button class="btn secondary" data-close>Cancel</button><button class="btn" type="submit" form="handoff-form" '+(!employees.length?'disabled':'')+'>Create employee case</button>');
  const updateDates=()=>{try{$('#handoff-dates').textContent=`Ready by ${dateLabel(addDays($('#handoff-date').value,-4))} · Reminders from ${dateLabel(addDays($('#handoff-date').value,-8))}`;}catch{$('#handoff-dates').textContent='Choose a valid date.';}};$('#handoff-date').onchange=updateDates;updateDates();
  $('#handoff-form').onsubmit=async e=>{
    e.preventDefault();const b=$('[form="handoff-form"]');b.disabled=true;
    try {
      const input=Object.fromEntries(new FormData(e.target));let caseId;
      if(mode==='live'){const result=await api(`consultations/${encodeURIComponent(id)}/handoff`,{method:'POST',body:JSON.stringify({...input,_version:r.version})});caseId=result.id;await reload();}
      else {
        caseId=r.linkedCaseId;
        if(!caseId){caseId=crypto.randomUUID();const c=validateRecord('cases',{...input,name:r.name,phone:r.phone||'',checks:{},priority:r.priority||'normal',sourceConsultationId:id});data.cases.push({...c,id:caseId});r.status='converted';r.linkedCaseId=caseId;demoActivity('consultation.handed_off','Consultation handed off to an employee case',id,'consultations',r);demoActivity('case.received','Case created from a consultation',caseId,'cases',c);localStorage.setItem(storageKey,JSON.stringify(data));}
      }
      portal='employee';view='records';filter='all';query='';render();detail('cases',caseId);toast('Employee case created. Consultation follow-ups stopped.');
    }catch(e){showError('handoff-error',e.message);b.disabled=false;}
  };
}
async function securityDialog() {
  if(mode!=='live')return login();
  try {
    const state=await api('security');
    modal('Account security','Your password, sign-in sessions, and notification devices.',`<section><h3>Change password</h3><form id="password-form"><div class="fields" style="margin-top:12px"><div class="field full"><label for="security-current">Current password</label><input id="security-current" type="password" name="currentPassword" autocomplete="current-password" maxlength="128" required></div><div class="field full"><label for="security-new">New password</label><input id="security-new" type="password" name="newPassword" autocomplete="new-password" minlength="15" maxlength="128" required></div></div><p class="small muted" style="margin-top:10px">Changing your password signs out other sessions and disconnects existing notification devices. Re-enable this phone after the change.</p><div class="error" id="password-error" role="alert"></div><button class="btn">Change password</button></form></section><section class="detail-section"><h3>Sign-in sessions</h3>${state.sessions.map(s=>`<div class="security-row"><div><strong class="small">${escape(s.device)} ${s.current?'<span class="badge">This session</span>':''}</strong><small class="muted">${s.createdAt?instantLabel(new Date(s.createdAt).toISOString()):'Signed in before the security upgrade'}</small></div>${!s.current&&s.id?`<button class="text-btn" data-session="${escape(s.id)}">Sign out</button>`:''}</div>`).join('')}<form id="revoke-form"><div class="field"><label for="revoke-password">Current password to sign out all other sessions</label><input id="revoke-password" type="password" name="currentPassword" autocomplete="current-password" maxlength="128" required></div><div class="error" id="revoke-error" role="alert"></div><button class="btn secondary">Sign out other sessions</button></form></section><section class="detail-section"><h3>Notification devices</h3>${state.devices.map((d,i)=>`<div class="security-row"><div><strong class="small">Notification device ${i+1}</strong><small class="muted">Connected ${instantLabel(d.createdAt)}</small></div><button class="text-btn" data-device="${escape(d.id)}">Disconnect</button></div>`).join('')||'<p class="small muted">No devices connected yet.</p>'}<label class="check-item"><input type="checkbox" id="notification-preview" ${state.notificationPreview?'checked':''}><span>Show client names and missing items in notifications</span></label><p class="small muted">Turn off previews for a generic reminder on the lock screen. Free-form client notes are never included.</p></section>`);
    $('#password-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('security/password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});sessionGeneration++;try{await disconnectLocalPush();}catch{}await reload();$('#modal').close();render();toast('Password changed. Other sessions and devices disconnected.');}catch(e){showError('password-error',e.message);b.disabled=false;}};
    $('#revoke-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('security/revoke-others',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});$('#modal').close();toast('Other sign-in sessions ended.');}catch(e){showError('revoke-error',e.message);b.disabled=false;}};
    $('#notification-preview').onchange=async e=>{const b=e.target;b.disabled=true;try{await api('security/preferences',{method:'PATCH',body:JSON.stringify({notificationPreview:b.checked})});await reload();render();toast('Notification privacy preference saved.');}catch(e){b.checked=!b.checked;toast(e.message);}finally{b.disabled=false;}};
    document.querySelectorAll('[data-session]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api(`security/sessions/${encodeURIComponent(b.dataset.session)}`,{method:'DELETE',body:'{}'});return securityDialog();}catch(e){b.disabled=false;toast(e.message);}});
    document.querySelectorAll('[data-device]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api(`security/devices/${encodeURIComponent(b.dataset.device)}`,{method:'DELETE',body:'{}'});await readPushState();await reload();render();return securityDialog();}catch(e){b.disabled=false;toast(e.message);}});
  }catch(e){toast(e.message);}
}
async function disconnectLocalPush() {
  if(!pushSupported())return null;
  const reg=await navigator.serviceWorker.getRegistration('/');if(!reg)return null;
  const sub=await reg.pushManager.getSubscription(),endpoint=sub?.endpoint||null;
  if(sub)await sub.unsubscribe();
  if(reg.getNotifications){for(const n of await reg.getNotifications())n.close();}
  pushConnected=false;return endpoint;
}
