import { CHECKLISTS,localParts,addDays,zonedInstant } from '../dist/engine.js';
import { HttpError,json } from './http.mjs';

export function workCreditStatements(DB,user,type,before,after,recordId,mutation,now=new Date()) {
  const day=localParts(now).date,credits=[];
  if(!before.id&&type!=='tasks')credits.push(['created','',1]);
  if(type==='cases')for(const item of CHECKLISTS[after.kind]||[])if(after.checks?.[item]&&!before.checks?.[item])credits.push(['checklist',item,5]);
  if(type==='consultations'&&after.lastContact&&after.lastContact!==before.lastContact)credits.push(['followup',day,5]);
  if(type==='tasks'&&after.doneOn&&after.doneOn!==before.doneOn)credits.push(['task',after.recurrence==='daily'?day:'once',3]);
  return credits.map(([kind,item,points])=>creditStatement(DB,user,recordId,mutation,kind,item,points,now));
}
export function creditStatement(DB,user,recordId,mutation,kind,item,points,now=new Date()) {
  return DB.prepare("INSERT OR IGNORE INTO work_credits(credit_key,record_id,actor_id,kind,item,work_day,points,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND last_mutation_id=?)")
    .bind(`${recordId}:${kind}:${item}`,recordId,user.id,kind,item,localParts(now).date,points,now.toISOString(),recordId,mutation);
}
export async function readRank(env,period='day',now=new Date()) {
  if(!['day','week'].includes(period))throw new HttpError('Choose today or this week.');
  const end=localParts(now).date;
  const weekday=(new Date(end+'T12:00:00Z').getUTCDay()+6)%7;
  const start=period==='week'?addDays(end,-weekday):end;
  const results=await env.DB.batch([
    env.DB.prepare("SELECT id,name,staff_type AS staffType FROM users WHERE role='employee' AND status='active' ORDER BY name,id"),
    env.DB.prepare(`SELECT w.actor_id AS actorId,w.kind,w.points,w.created_at AS createdAt FROM work_credits w JOIN records r ON r.id=w.record_id
      WHERE w.created_at>=? AND w.created_at<? AND (
        w.kind NOT IN ('checklist','task') OR
        (w.kind='checklist' AND json_extract(r.payload,'$.checks.'||json_quote(w.item))=1) OR
        (w.kind='task' AND COALESCE(json_extract(r.payload,'$.doneOn'),'')!='')
      )`).bind(zonedInstant(start,'00:00'),zonedInstant(addDays(end,1),'00:00'))
  ]);
  for(const unit of results[1].results)unit.workDay=localParts(new Date(unit.createdAt)).date;
  const byActor=new Map();
  for(const unit of results[1].results){if(!byActor.has(unit.actorId))byActor.set(unit.actorId,[]);byActor.get(unit.actorId).push(unit);}
  const rows=results[0].results.map(p=>{const units=byActor.get(p.id)||[],activeDays=new Set(units.map(w=>w.workDay)).size;return {...p,workPoints:units.reduce((n,w)=>n+w.points,0),activeDays,completedSteps:units.filter(w=>w.kind==='checklist').length,followups:units.filter(w=>w.kind==='followup').length,tasksCompleted:units.filter(w=>w.kind==='task').length,filesCreated:units.filter(w=>w.kind==='created').length,handoffs:units.filter(w=>w.kind==='handoff').length,score:units.reduce((n,w)=>n+w.points,0)+activeDays};});
  rows.sort((a,b)=>b.score-a.score||b.workPoints-a.workPoints||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  let position=0,previous=null;
  rows.forEach((r,i)=>{if(previous!==r.score)position=i+1;r.position=r.score?position:null;previous=r.score;});
  return {period,start,end,rows};
}
export async function rankRoute(request,env) {
  if(new URL(request.url).pathname!=='/api/rank')return null;
  if(request.method!=='GET')throw new HttpError('Endpoint not found.',404);
  return json(await readRank(env,new URL(request.url).searchParams.get('period')||'day'));
}
