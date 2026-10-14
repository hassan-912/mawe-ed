import { localParts, reminderStartFor, pendingItems, isPlaceholder, employeeReminders, caseMessage, nextFollowup, daysBetween, displayDate,caseRemindersEnabled } from '../dist/engine.js';
import { pushConfigured,sendWebPush } from './push.mjs';

function consultationMessage(r,date) {
  const days=daysBetween(r.consultationDate,date);
  return `Mawid • Follow up with ${r.name}\nConsultation: ${displayDate(r.consultationDate)} (${days} day${days===1?'':'s'} ago).\nRecommended: ${r.destination||'destination to be decided'}.\nAsk whether the client wants to move forward.`;
}
export function scheduledJobs(row,now) {
  const r={...JSON.parse(row.payload),id:row.id,ownerId:row.owner_id};const {date,time}=localParts(now);
  if(r.archived)return [];
  if(row.type==='consultations') {
    if(r.status!=='active'||Date.parse(r.nextReminder)>now.getTime())return [];
    return [{key:`${r.id}:consult:${r.nextReminder}`,title:`Follow up · ${r.name}`,message:consultationMessage(r,date),nextReminder:nextFollowup(r,now)}];
  }
  if(row.type==='cases') {
    // A missed morning slot is superseded by the afternoon message, rather than
    // sending two stale reminders together after an outage.
    return employeeReminders(r,now).slice(-1).map(slot=>({key:`${r.id}:case:${slot.date}:${slot.slot}`,title:`Prepare case · ${r.name}`,message:caseMessage(r,date)}));
  }
  if(row.type==='tasks') {
    const due=r.recurrence==='daily'?r.dueDate<=date && r.time<=time && r.doneOn!==date : !r.doneOn && `${r.dueDate}T${r.time}`<=`${date}T${time}`;
    if(!due)return [];
    return [{key:`${r.id}:task:${r.recurrence==='daily'?date:r.dueDate}:${r.time}`,title:`Task · ${r.name}`,message:`Mawid • ${r.name}\n${r.recurrence==='daily'?'Everyday task':`One-off task due ${displayDate(r.dueDate)}`} at ${r.time}, Cairo time.\nOpen your workspace and mark it complete when done.`}];
  }
  return [];
}
export function stillRelevant(job,row,now) {
  if(!row || row.owner_id!==job.owner_id)return false;
  if(row.user_status&&row.user_status!=='active')return false;
  if(row.must_change_password)return false;
  const r=JSON.parse(row.payload);const {date,time}=localParts(now);
  if(r.archived)return false;
  if(row.type==='cases') {
    if(!caseRemindersEnabled(r)||date<reminderStartFor(r))return false;
    const latest=employeeReminders({...r,id:row.id},now).slice(-1)[0];
    return latest && job.dedup_key===`${row.id}:case:${latest.date}:${latest.slot}`;
  }
  if(row.type==='consultations')return r.status==='active' && (!r.lastContact || Date.parse(r.lastContact)<=Date.parse(job.created_at)) && (!row.updated_at || row.updated_at<=job.created_at) && Date.parse(job.created_at)>=Date.parse(r.consultationDate);
  if(row.type==='tasks') {
    const expected=`${row.id}:task:${r.recurrence==='daily'?date:r.dueDate}:${r.time}`;
    return job.dedup_key===expected && (r.recurrence==='daily'?r.doneOn!==date && r.dueDate<=date && r.time<=time:!r.doneOn && `${r.dueDate}T${r.time}`<=`${date}T${time}`);
  }
  return false;
}
export async function runReminders(env,now=new Date(),send=fetch) {
  if(!env.DB)return {configured:false};
  const {date,time}=localParts(now),instant=now.toISOString(),epoch=now.getTime();
  // Authentication state must expire even before phone push is configured.
  if(time==='03:00')await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(epoch),env.DB.prepare('DELETE FROM login_limits WHERE expires_at<?').bind(epoch),env.DB.prepare("DELETE FROM deliveries WHERE created_at<? AND status IN ('sent','cancelled','failed')").bind(new Date(epoch-90*86400000).toISOString())]);
  if(!pushConfigured(env))return {configured:false};
  const slot=time>='15:00'?'15:00':time>='10:30'?'10:30':null;
  const slotInstant=slot?`${date}T${slot}`:'',scanMark=`${date}T${time}`;
  // Already-scanned cases wait for the next daily slot, so a large set of
  // unchanged cases does not repeatedly occupy the free plan's query budget.
  const {results:rows}=await env.DB.prepare("SELECT * FROM records WHERE active=1 AND owner_id IN (SELECT id FROM users WHERE status='active' AND must_change_password=0) AND ((type='consultations' AND next_due<=?) OR (type='cases' AND start_date<=? AND ?!='' AND (last_scan IS NULL OR last_scan<?)) OR (type='tasks' AND start_date<=? AND ((json_extract(payload,'$.recurrence')='daily' AND json_extract(payload,'$.time')<=? AND COALESCE(json_extract(payload,'$.doneOn'),'')!=? AND (last_scan IS NULL OR substr(last_scan,1,10)!=?)) OR (json_extract(payload,'$.recurrence')='once' AND (start_date<? OR json_extract(payload,'$.time')<=?) AND last_scan IS NULL)))) ORDER BY last_scan ASC LIMIT 6").bind(instant,date,slotInstant,slotInstant,date,time,date,date,date,time).all();
  // One batch transaction per record prevents a follow-up from advancing without
  // also recording its durable notification. Version predicates handle races.
  for(const row of rows) {
    const jobs=scheduledJobs(row,now);
    const statements=jobs.map(job=>env.DB.prepare("INSERT OR IGNORE INTO deliveries(id,dedup_key,record_id,owner_id,title,message,status,available_at,created_at) SELECT ?,?,?,?,?,?,'pending',?,? FROM records WHERE id=? AND version=?").bind(crypto.randomUUID(),job.key,row.id,row.owner_id,job.title,job.message,epoch,instant,row.id,row.version));
    if(jobs[0]?.nextReminder) statements.push(env.DB.prepare("UPDATE records SET payload=json_set(payload,'$.nextReminder',?),next_due=?,version=version+1,updated_at=?,last_scan=? WHERE id=? AND version=?").bind(jobs[0].nextReminder,jobs[0].nextReminder,instant,scanMark,row.id,row.version));
    else statements.push(env.DB.prepare('UPDATE records SET last_scan=? WHERE id=? AND version=?').bind(scanMark,row.id,row.version));
    await env.DB.batch(statements);
  }
  const {results:queue}=await env.DB.prepare("SELECT * FROM deliveries WHERE attempts<5 AND ((status IN ('pending','failed') AND available_at<=?) OR (status='sending' AND lease_until<?)) ORDER BY created_at LIMIT 3").bind(epoch,epoch).all();
  let sent=0,failed=0;
  for(const job of queue) {
    const lease=crypto.randomUUID();const claimed=await env.DB.prepare("UPDATE deliveries SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND attempts<5 AND ((status IN ('pending','failed') AND available_at<=?) OR (status='sending' AND lease_until<?))").bind(lease,epoch+300000,job.id,epoch,epoch).run();
    if(!claimed.meta.changes)continue;
    const row=await env.DB.prepare('SELECT r.*,u.status AS user_status,u.must_change_password,u.notification_preview FROM records r JOIN users u ON u.id=r.owner_id WHERE r.id=?').bind(job.record_id).first();
    if(!stillRelevant(job,row,now)) {await env.DB.prepare("UPDATE deliveries SET status='cancelled',error='Reminder superseded or work completed' WHERE id=? AND lease_token=?").bind(job.id,lease).run();continue;}
    let error='';const r=JSON.parse(row.payload);let message=job.message;
    if(row.type==='cases')message=caseMessage({...r,id:row.id},date);
    else if(row.type==='consultations')message=consultationMessage(r,date);
    const {results:subscriptions}=await env.DB.prepare('SELECT s.* FROM push_subscriptions s LEFT JOIN push_receipts p ON p.subscription_id=s.id AND p.delivery_id=? WHERE s.user_id=? AND p.delivery_id IS NULL LIMIT 3').bind(job.id,job.owner_id).all();
    // A receipt is saved for each device, so retrying another device does not
    // send again to phones whose push service already accepted the message.
    if(!subscriptions.length) {
      const accepted=await env.DB.prepare('SELECT 1 AS accepted FROM push_receipts WHERE delivery_id=? LIMIT 1').bind(job.id).first();
      if(!accepted)error='No notification device connected';
    }
    for(const sub of subscriptions) {
      try {
        const response=await sendWebPush(env,JSON.parse(sub.subscription),row.notification_preview?job.title:'Reminder due',row.notification_preview?message:'Open your Mawid workspace to review an assigned reminder.',job.dedup_key,send);
        if(response.status===404||response.status===410) {await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(sub.id).run();error='Notification subscription expired; enable notifications again';}
        else if(!response.ok)error=response.status===429?'Push service rate limit; will retry':'Push service unavailable; will retry';
        else await env.DB.prepare('INSERT OR IGNORE INTO push_receipts(delivery_id,subscription_id,accepted_at) VALUES (?,?,?)').bind(job.id,sub.id,instant).run();
      }catch{error='Phone delivery unavailable; will retry';}
    }
    if(error) {failed++;await env.DB.prepare("UPDATE deliveries SET status='failed',error=?,available_at=?,message=?,lease_until=NULL WHERE id=? AND lease_token=?").bind(error,epoch+Math.min(3600000,900000*2**job.attempts),message,job.id,lease).run();}
    else {sent++;await env.DB.prepare("UPDATE deliveries SET status='sent',error=NULL,sent_at=?,message=?,lease_until=NULL WHERE id=? AND lease_token=?").bind(instant,message,job.id,lease).run();}
  }
  return {configured:true,sent,failed};
}
