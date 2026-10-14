import { validateRecord,reminderStartFor,isPlaceholder,pendingItems,canConsult,canProcess,caseRemindersEnabled } from '../dist/engine.js';
import { authenticate,publicUser,validatePerson,hashPassword,logoutCookie } from './auth.mjs';
import { HttpError,json,securityHeaders,readBody,onlyFields,validated,needManager,authReady,needAuthConfiguration,rateLimit } from './http.mjs';
import { publicAccountRoute,securityRoute,accountAdministration } from './accounts.mjs';
import { activityStatement,changeSummary } from './activity.mjs';
import { runReminders } from './scheduler.mjs';
import { pushConfigured,saveSubscription } from './push.mjs';
import { profileRoute } from './profile.mjs';
import { personalRoute,decodePersonal } from './personal.mjs';
import { rankRoute,workCreditStatements,creditStatement } from './rank.mjs';

const fields={
  cases:['name','ownerId','kind','appointment','checks','phone','notes','archived','priority','lifecycle'],
  consultations:['name','ownerId','consultationDate','destination','intervalHours','nextReminder','lastContact','status','phone','notes','archived','priority'],
  tasks:['name','ownerId','dueDate','time','recurrence','doneOn','notes','archived','priority']
};
export const decodeRecord=row=>({...JSON.parse(row.payload),id:row.id,ownerId:row.owner_id,version:row.version,creatorId:row.creator_id??null,creatorName:row.creator_name??null,creatorEmail:row.creator_email??null,createdAt:row.created_at??null});
export function indexFields(type,r) {
  const active=!r.archived&&(type==='consultations'?r.status==='active':type==='cases'?caseRemindersEnabled(r):r.recurrence==='daily'||!r.doneOn);
  return {active:active?1:0,nextDue:type==='consultations'?new Date(r.nextReminder).toISOString():null,startDate:type==='cases'?reminderStartFor(r):type==='tasks'?r.dueDate:null};
}
function cleanInput(type,input) {
  onlyFields(input,[...fields[type],'_version']);
  const result=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='_version'));
  if(result.lastContact!=null) {
    if(typeof result.lastContact!=='string'||!Number.isFinite(Date.parse(result.lastContact)))throw new HttpError('Enter a valid last contact date.');
    result.lastContact=new Date(result.lastContact).toISOString();
  }
  return result;
}
async function readWorkspace(env,user) {
  if(user.status!=='active'||user.must_change_password)return json({user:publicUser(user),people:[publicUser(user)],cases:[],consultations:[],tasks:[],notifications:[],activity:[],personalTasks:[],pushDevices:0,approvalPending:user.status==='pending'});
  const manager=user.role==='manager';
  const consultant=!manager&&canConsult(user);
  const results=await env.DB.batch([
    env.DB.prepare(`SELECT * FROM records ${manager?'':'WHERE owner_id=?'} ORDER BY updated_at DESC`).bind(...(manager?[]:[user.id])),
    env.DB.prepare(`SELECT id,name,email,username,role,staff_type,status,must_change_password,notification_preview FROM users ${manager?'':consultant?"WHERE id=? OR (role='employee' AND staff_type='process' AND status='active')":'WHERE id=?'} ORDER BY name`).bind(...(manager?[]:[user.id])),
    env.DB.prepare(`SELECT d.title,d.message,d.status,d.error,d.created_at AS createdAt FROM deliveries d JOIN records r ON r.id=d.record_id ${manager?'':'WHERE r.owner_id=? AND d.owner_id=r.owner_id'} ORDER BY d.created_at DESC LIMIT 100`).bind(...(manager?[]:[user.id])),
    env.DB.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id=?').bind(user.id),
    env.DB.prepare(`SELECT a.id,a.actor_id AS actorId,a.actor_name AS actorName,a.record_id AS recordId,a.action,a.summary,a.created_at AS createdAt,r.type,r.owner_id AS ownerId,json_extract(r.payload,'$.name') AS recordName FROM activity a LEFT JOIN records r ON r.id=a.record_id ${manager?'':'WHERE r.owner_id=? OR (a.record_id IS NULL AND a.actor_id=?)'} ORDER BY a.created_at DESC,a.id DESC LIMIT 200`).bind(...(manager?[]:[user.id,user.id])),
    env.DB.prepare('SELECT * FROM personal_tasks WHERE user_id=? ORDER BY updated_at DESC').bind(user.id)
  ]);
  const workspace={user:publicUser(user),people:results[1].results.map(row=>{const p=publicUser(row);if(consultant&&row.id!==user.id){delete p.email;delete p.mustChangePassword;delete p.notificationPreview;}return p;}),cases:[],consultations:[],tasks:[],notifications:results[2].results,pushDevices:results[3].results[0].count,activity:results[4].results,personalTasks:results[5].results.map(decodePersonal)};
  for(const row of results[0].results)workspace[row.type].push(decodeRecord(row));
  return json(workspace);
}
async function saveRecord(request,env,user,type,id) {
  if(type==='consultations'&&!canConsult(user))throw new HttpError('Consultant access is required.',403);
  if(type==='cases'&&!canProcess(user))throw new HttpError('Process access is required.',403);
  const input=await readBody(request);
  const existing=id?await env.DB.prepare('SELECT * FROM records WHERE id=? AND type=?').bind(id,type).first():null;
  if(id&&!existing)throw new HttpError('Record not found.',404);
  if(existing&&user.role!=='manager'&&existing.owner_id!==user.id)throw new HttpError('This record is not assigned to you.',403);
  if(existing&&input._version!==existing.version)throw new HttpError('This record changed in another session. Reload and try again.',409);
  const before=existing?decodeRecord(existing):{},record=validated(()=>validateRecord(type,cleanInput(type,input),before));
  if(user.role!=='manager'&&record.ownerId!==user.id)throw new HttpError('You can only assign work to yourself.',403);
  const owner=await env.DB.prepare('SELECT role,staff_type,status FROM users WHERE id=?').bind(record.ownerId).first();
  if(!owner||owner.status!=='active'||(type==='consultations'&&!canConsult(owner))||(type==='cases'&&!canProcess(owner)))throw new HttpError('Choose an active eligible staff member.');
  if(type==='cases'&&Object.hasOwn(input,'ownerId'))record.needsAssignment=false;
  const recordId=id||crypto.randomUUID(),mutation=crypto.randomUUID(),idx=indexFields(type,record),now=new Date().toISOString();
  const payload={...record};delete payload.id;delete payload.version;delete payload.creatorId;delete payload.creatorName;delete payload.creatorEmail;delete payload.createdAt;
  let statement;
  if(existing) {
    statement=env.DB.prepare("UPDATE records SET owner_id=?,payload=?,version=version+1,active=?,next_due=?,start_date=?,updated_at=?,last_scan=NULL,last_mutation_id=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND auth_version=?)").bind(record.ownerId,JSON.stringify(payload),idx.active,idx.nextDue,idx.startDate,now,mutation,recordId,existing.version,record.ownerId,user.id,user.auth_version);
  } else {
    statement=env.DB.prepare("INSERT INTO records(id,type,owner_id,payload,active,next_due,start_date,updated_at,last_mutation_id,creator_id,creator_name,creator_email,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM records WHERE owner_id=?)<1000 AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND auth_version=?)").bind(recordId,type,record.ownerId,JSON.stringify(payload),idx.active,idx.nextDue,idx.startDate,now,mutation,user.id,user.name,user.email,now,record.ownerId,record.ownerId,user.id,user.auth_version);
  }
  const results=await env.DB.batch([statement,activityStatement(env.DB,user,existing?'record.updated':'record.created',changeSummary(type,before,record,input),recordId,{id:recordId,mutation}),...workCreditStatements(env.DB,user,type,before,record,recordId,mutation)]);
  if(!results[0].meta.changes)throw new HttpError(existing?'Record or account access changed. Reload and try again.':'Account access changed or this staff member has reached the 1,000-record limit.',409);
  return json({id:recordId},existing?200:201);
}
async function handoff(request,env,user,id) {
  if(!canConsult(user))throw new HttpError('Consultant access is required.',403);
  const input=await readBody(request);
  onlyFields(input,['kind','appointment','ownerId','notes','_version']);
  if(typeof input.ownerId!=='string'||!input.ownerId||input.ownerId.length>80)throw new HttpError('Choose an active employee for this case.');
  const row=await env.DB.prepare("SELECT * FROM records WHERE id=? AND type='consultations'").bind(id).first();
  if(!row)throw new HttpError('Consultation not found.',404);
  if(user.role!=='manager'&&row.owner_id!==user.id)throw new HttpError('This consultation is not assigned to you.',403);
  const linked=await env.DB.prepare('SELECT case_id FROM handoffs WHERE consultation_id=?').bind(id).first();
  if(linked)return json({id:linked.case_id,alreadyCreated:true});
  if(input._version!==row.version)throw new HttpError('The consultation changed. Reload and try again.',409);
  const consultation=decodeRecord(row);
  if(consultation.archived||consultation.status==='closed')throw new HttpError('Restore an active consultation before handing it off.');
  const owner=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='employee' AND staff_type='process' AND status='active'").bind(input.ownerId).first();
  if(!owner)throw new HttpError('Choose an active employee for this case.');
  const caseId=crypto.randomUUID(),mutation=crypto.randomUUID(),now=new Date().toISOString();
  const record=validated(()=>validateRecord('cases',{name:consultation.name,phone:consultation.phone||'',ownerId:input.ownerId,kind:input.kind,appointment:input.appointment,checks:{},notes:input.notes||'',priority:consultation.priority||'normal',sourceConsultationId:id}));
  const idx=indexFields('cases',record);
  const converted={...consultation,status:'converted',linkedCaseId:caseId};delete converted.id;delete converted.version;delete converted.creatorId;delete converted.creatorName;delete converted.creatorEmail;delete converted.createdAt;
  const results=await env.DB.batch([
    env.DB.prepare("INSERT INTO records(id,type,owner_id,payload,active,start_date,updated_at,last_mutation_id,creator_id,creator_name,creator_email,created_at) SELECT ?,'cases',?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM handoffs WHERE consultation_id=?) AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='employee' AND staff_type='process' AND status='active') AND (SELECT COUNT(*) FROM records WHERE owner_id=?)<1000 AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND auth_version=?)").bind(caseId,record.ownerId,JSON.stringify(record),idx.active,idx.startDate,now,mutation,user.id,user.name,user.email,now,id,row.version,id,record.ownerId,record.ownerId,user.id,user.auth_version),
    env.DB.prepare('UPDATE records SET payload=?,active=0,version=version+1,updated_at=?,last_mutation_id=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM records WHERE id=?)').bind(JSON.stringify(converted),now,mutation,id,row.version,caseId),
    env.DB.prepare('INSERT INTO handoffs(consultation_id,case_id,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=?)').bind(id,caseId,now,caseId),
    activityStatement(env.DB,user,'consultation.handed_off','Consultation handed off to an employee case',id,{id,mutation}),
    activityStatement(env.DB,user,'case.received','Case created from a consultation',caseId,{id:caseId,mutation}),
    creditStatement(env.DB,user,caseId,mutation,'handoff','',3),
    env.DB.prepare("UPDATE deliveries SET status='cancelled',error='Consultation handed off' WHERE record_id=? AND status IN ('pending','failed','sending') AND EXISTS(SELECT 1 FROM records WHERE id=?)").bind(id,caseId)
  ]);
  if(!results[0].meta.changes)throw new HttpError('The consultation or assignment changed. Reload and try again.',409);
  return json({id:caseId},201);
}
async function handleApi(request,env) {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(method!=='GET'&&request.headers.get('Origin')!==url.origin)throw new HttpError('This request must come from the company app.',403);
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')throw new HttpError('Cross-site requests are not allowed.',403);
  if(path==='/api/config'&&method==='GET')return json({production:true,authReady:authReady(env),registrationOpen:env.REGISTRATION_OPEN!=='false',pushReady:pushConfigured(env),pushPublicKey:pushConfigured(env)?env.VAPID_PUBLIC_KEY:null});
  if(!env.DB)throw new HttpError('The database has not been configured.',503);
  const publicResponse=await publicAccountRoute(request,env);if(publicResponse)return publicResponse;
  const user=await authenticate(request,env);if(!user)throw new HttpError('Please sign in.',401);
  if(path==='/api/workspace'&&method==='GET')return readWorkspace(env,user);
  if(method!=='GET')await rateLimit(env.DB,`writes:${user.id}`,120,60000);
  const accountSecurity=await securityRoute(request,env,user);if(accountSecurity)return accountSecurity;
  const profile=await profileRoute(request,env,user);if(profile)return profile;
  if(user.status!=='active')throw new HttpError('Company access is awaiting manager approval.',403);
  if(user.must_change_password)throw new HttpError('Change your initial password before accessing company records.',403);
  const personal=await personalRoute(request,env,user);if(personal)return personal;
  const ranking=await rankRoute(request,env);if(ranking)return ranking;
  const administration=await accountAdministration(request,env,user);if(administration)return administration;
  if(path==='/api/push/subscribe'&&method==='POST') {
    if(!pushConfigured(env))throw new HttpError('Browser push is not configured yet.',503);
    const input=await readBody(request);onlyFields(input,['endpoint','expirationTime','keys']);
    try{await saveSubscription(env.DB,user.id,input,new Date(),user.auth_version);}catch(e){if(/push|notification|browser|devices|account|staff/i.test(e.message))throw new HttpError(e.message);throw e;}
    return json({ok:true});
  }
  if(path==='/api/push/unsubscribe'&&method==='POST') {
    const input=await readBody(request);onlyFields(input,['endpoint']);
    if(typeof input.endpoint!=='string'||input.endpoint.length>2048)throw new HttpError('Invalid notification device.');
    const {sha256}=await import('./auth.mjs');
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(await sha256(input.endpoint),user.id).run();return json({ok:true});
  }
  if(path==='/api/people'&&method==='POST') {
    needManager(user);needAuthConfiguration(env);
    const input=await readBody(request);onlyFields(input,['name','email','role','staffType','password']);
    const person=validated(()=>validatePerson(input)),id=crypto.randomUUID(),mutation=crypto.randomUUID();
    const existing=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(person.email).first();
    if(existing)throw new HttpError('An account with this email already exists.',409);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users(id,name,email,role,staff_type,password_hash,created_at,status,must_change_password,last_mutation_id) VALUES (?,?,?,?,?,?,?,'active',1,?)").bind(id,person.name,person.email,person.role,person.staffType||'process',await hashPassword(person.password,undefined,env.AUTH_PEPPER),new Date().toISOString(),mutation),
      activityStatement(env.DB,user,'account.created',`Staff account created: ${person.name}; initial password must be changed`,null,{table:'users',id,mutation})
    ]);
    return json({ok:true},201);
  }
  const handoffMatch=path.match(/^\/api\/consultations\/([^/]+)\/handoff$/);
  if(handoffMatch&&method==='POST')return handoff(request,env,user,handoffMatch[1]);
  const match=path.match(/^\/api\/(cases|consultations|tasks)(?:\/([^/]+))?$/);
  if(match&&((method==='POST'&&!match[2])||(method==='PATCH'&&match[2])))return saveRecord(request,env,user,match[1],match[2]||null);
  throw new HttpError('Endpoint not found.',404);
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
      url.protocol='https:';return new Response(null,{status:308,headers:{...securityHeaders,Location:url.href,'Cache-Control':'no-store'}});
    }
    if(url.pathname.startsWith('/api/')) {
      try{return await handleApi(request,env);}catch(e){return json({error:e.status?e.message:'The company backend is unavailable. Please try again.'},e.status||500,e.status===401?{'Set-Cookie':logoutCookie(url.protocol==='https:')}:{})}
    }
    const response=await env.ASSETS.fetch(request),headers=new Headers(response.headers);
    for(const [key,value] of Object.entries(securityHeaders))headers.set(key,value);
    if(url.pathname==='/'||url.pathname.endsWith('.html')||url.pathname==='/sw.js')headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  },
  async scheduled(controller,env,ctx) {ctx.waitUntil(runReminders(env,new Date(controller.scheduledTime)));}
};
