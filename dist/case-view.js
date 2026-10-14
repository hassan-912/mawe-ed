import { CHECKLISTS,DESTINATIONS,caseStatus,pendingItems,isPlaceholder,isCaseActive,caseRemindersEnabled,reminderStartFor,today,validDate } from './engine.js';
import { enteredThisWeek,matchesCaseSearch } from './case-query.js';

export function createCaseViews(h) {
  const {escape:e,icon,dateLabel,person,records,fileHolderName,caseIsUrgent}=h;
  function caseFacts(r) {
    const fields=r.sourceImport&&Array.isArray(r.sheetDetails)?r.sheetDetails.map(d=>[d.label,d.value]):[
      ['File holder',fileHolderName(r)],['File holder email',r.creatorEmail||'Email not recorded'],...(r.phone?[['Client phone',r.phone]]:[]),...(r.notes?[['Notes',r.notes]]:[])
    ];
    return `<dl class="case-facts">${fields.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
  }
  function caseCard(r) {
    const pending=pendingItems(r),count=(CHECKLISTS[r.kind]||[]).length,status=caseStatus(r),urgent=caseIsUrgent(r),progress=count?Math.round((count-pending.length)/count*100):0;
    const statusNote=!isCaseActive(r)?`Case ${status.toLowerCase()}.`:isPlaceholder(r)?'Checklist is under processing':pending.length?`<strong class="needed-label">Still needed</strong><span class="needed-items">${pending.map(step=>`<span>${e(step)}</span>`).join('')}</span>`:'Every item is ready. You’re all set.';
    return `<article class="case-card ${urgent?'urgent':''}"><div class="case-top"><div class="client-info"><div class="avatar">${h.initials(r.name)}</div><div><h3>${e(r.name)}</h3><small>${e(r.country||DESTINATIONS[r.kind])} · ${e(r.visaType||(r.kind.endsWith('business')?'Business':r.kind.startsWith('schengen')?'Tourism':'Visa preparation'))} · ${e(fileHolderName(r))}</small></div></div><span class="badge ${urgent?'danger':!isCaseActive(r)||isPlaceholder(r)?'neutral':''}">${urgent?'<span class="attention-dot" aria-hidden="true"></span>Urgent · ':''}${e(status)}</span></div><div class="date-line"><span>${icon('calendar')} Embassy <strong>${dateLabel(r.appointment)}</strong></span><span>${icon('clock')} File due <strong>${dateLabel(r.appointment)}</strong></span></div>${count&&isCaseActive(r)?`<div class="case-progress"><div class="progress" role="progressbar" aria-label="${e(r.name)} checklist completion" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><div style="width:${progress}%"></div></div><span>${count-pending.length} / ${count} complete</span></div>`:''}<div class="card-bottom"><p class="missing">${statusNote}</p><div class="case-actions"><button class="text-btn overview-toggle" data-case-overview="${e(r.id)}" aria-expanded="false" aria-controls="case-overview-${e(r.id)}">Overview <span aria-hidden="true">⌄</span></button><button class="text-btn" data-action="detail" data-type="cases" data-id="${e(r.id)}">Open case ${icon('arrow')}</button></div></div><div class="case-overview" id="case-overview-${e(r.id)}" aria-hidden="true" inert><div>${caseFacts(r)}</div></div></article>`;
  }
  function recordPanel(compact) {
    const {portal,filter,query,page,weekOnly=false}=h.state(),consultant=portal==='manager',type=consultant?'consultations':'cases';
    let list=records(type).filter(r=>filter==='archived'?r.archived:!r.archived);
    const needsAttention=r=>consultant?r.status==='active'&&Date.parse(r.nextReminder)<=Date.now():caseRemindersEnabled(r)&&(reminderStartFor(r)<=today()||r.priority==='urgent');
    if(filter==='attention')list=list.filter(needsAttention);
    if(filter==='ready')list=list.filter(r=>consultant?r.status!=='active':caseStatus(r)==='Ready');
    if(filter==='completed')list=list.filter(r=>['completed','cancelled'].includes(r.lifecycle));
    if(filter==='appointment')list=list.filter(r=>isCaseActive(r)&&!validDate(r.appointment));
    list=list.filter(r=>matchesCaseSearch(r,query,person(r.ownerId))&&(!weekOnly||enteredThisWeek(r)));
    list.sort((a,b)=>consultant?Date.parse(a.nextReminder)-Date.parse(b.nextReminder):Number(isCaseActive(b))-Number(isCaseActive(a))||(a.appointment||'9999').localeCompare(b.appointment||'9999')||a.name.localeCompare(b.name));
    const total=list.length,pages=Math.max(1,Math.ceil(total/20)),current=Math.min(page,pages-1),hasAttention=records(type).some(needsAttention);h.setPage(current);
    const shown=compact?list.slice(0,4):list.slice(current*20,(current+1)*20);
    const filters=[['all','All'],['attention','Needs attention'],['ready',consultant?'Closed':'Ready'],...(!consultant?[['appointment','Appointment needed'],['completed','Completed']]:[]),...(!compact?[['archived','Archived']]:[])];
    return `<section class="panel"><div class="panel-head"><div><h2>${consultant?'Client follow-ups':'Your client cases'} <span class="muted small">(${total})</span></h2><p>${consultant?'A timely conversation makes all the difference.':'A clear view of what’s ready and what needs you.'}</p></div>${compact?`<button class="text-btn" data-view="records">View all ${icon('arrow')}</button>`:''}</div><div class="toolbar"><div class="tabs" aria-label="Filter records">${filters.map(([id,name])=>`<button data-filter="${id}" class="${filter===id?'active':''} ${id==='attention'&&hasAttention?'attention-active':''}" aria-pressed="${filter===id}">${id==='attention'&&hasAttention?'<span class="attention-dot" aria-hidden="true"></span>':''}${name}</button>`).join('')}</div>${consultant?'<label class="search">'+icon('search')+'<input id="search" type="search" aria-label="Search clients" placeholder="Search clients…" value="'+e(query)+'"></label>':''}</div><div class="case-list">${shown.map(r=>consultant?h.consultCard(r):caseCard(r)).join('')||`<div class="empty">${icon('check')}<h3>${query?'No matching clients':'All clear here'}</h3><p>${query?'Try another name, file holder, or Odoo ID.':'Add a client or choose another filter to see their progress.'}</p></div>`}</div>${!compact&&total>20?`<div class="case-pagination"><button class="btn secondary" data-record-page="${current-1}" ${current===0?'disabled':''}>Previous</button><span>Showing ${current*20+1}–${Math.min((current+1)*20,total)} of ${total}</span><button class="btn secondary" data-record-page="${current+1}" ${current===pages-1?'disabled':''}>Next</button></div>`:''}</section>`;
  }
  return {caseFacts,caseCard,recordPanel};
}
