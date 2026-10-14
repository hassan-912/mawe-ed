import { validateRecord, reminderStartFor, isPlaceholder, pendingItems } from '../dist/engine.js';
import { authenticate, publicUser, sha256, hashPassword, verifyPassword, validatePerson, randomToken, sessionCookie, logoutCookie } from './auth.mjs';
import { runReminders } from './scheduler.mjs';
import { pushConfigured, saveSubscription } from './push.mjs';

const security = {'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"};
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{...security,'Cache-Control':'no-store',...headers}});
class HttpError extends Error { constructor(message,status=400){super(message);this.status=status;} }
function needManager(user) { if(user.role!=='manager')throw new HttpError('Manager access is required.',403); }
function validate(fn) {try{return fn();}catch(e){throw new HttpError(e.message);}}
function decodeRecord(row) { return {...JSON.parse(row.payload),id:row.id,ownerId:row.owner_id,version:row.version}; }
export function indexFields(type,r) {
  const active=!r.archived && (type==='consultations'?r.status==='active':type==='cases'?!isPlaceholder(r)&&pendingItems(r).length>0:r.recurrence==='daily'||!r.doneOn);
  return {active:active?1:0,nextDue:type==='consultations'?new Date(r.nextReminder).toISOString():null,startDate:type==='cases'?reminderStartFor(r):type==='tasks'?r.dueDate:null};
}
const fields = {
  cases:['name','ownerId','kind','appointment','checks','reminderStart','phone','notes','archived'],
  consultations:['name','ownerId','consultationDate','destination','intervalHours','nextReminder','lastContact','status','phone','notes','archived'],
  tasks:['name','ownerId','dueDate','time','recurrence','doneOn','notes','archived']
};
function cleanInput(type,input) {
  for(const key of Object.keys(input))if(!fields[type].includes(key)&&key!=='_version')throw new HttpError(`Unknown field: ${key}`);
  const clean=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='_version'));
  if(clean.lastContact && !Number.isFinite(Date.parse(clean.lastContact)))throw new HttpError('Invalid last contact date.');
  return clean;
}
async function body(request) {
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError('Use JSON requests.',415);
  // Read through a byte budget so a chunked request cannot allocate unbounded memory.
  const reader=request.body?.getReader();if(!reader)return {};
  let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new HttpError('Request is too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const input=JSON.parse(new TextDecoder().decode(bytes));if(!input||typeof input!=='object'||Array.isArray(input))throw new Error();return input;}catch{throw new HttpError('Enter valid JSON.');}
}
async function handleApi(request,env) {
  const url=new URL(request.url), path=url.pathname, method=request.method, secure=url.protocol==='https:';
  if(method!=='GET' && request.headers.get('Origin')!==url.origin)throw new HttpError('This request must come from the company app.',403);
  if(path==='/api/config' && method==='GET')return json({production:true,pushReady:pushConfigured(env),pushPublicKey:pushConfigured(env)?env.VAPID_PUBLIC_KEY:null});
  if(!env.DB)throw new HttpError('The database has not been configured.',503);
  if(path==='/api/login' && method==='POST') {
    const input=await body(request);
    if(typeof input.email!=='string'||input.email.length>254||typeof input.password!=='string'||input.password.length>128)throw new HttpError('Email or password is incorrect.',401);
    const email=input.email.trim().toLowerCase(),now=Date.now();
    const keys=[await sha256('email:'+email),await sha256('ip:'+(request.headers.get('CF-Connecting-IP')||'local'))];
    // Both dimensions are limited independently; the counter reservation is atomic.
    const reserved=await env.DB.batch(keys.map(key=>env.DB.prepare('INSERT INTO login_limits(key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts').bind(key,now+900000,now,now)));
    if(reserved[0].results[0].attempts>8 || reserved[1].results[0].attempts>30)throw new HttpError('Too many sign-in attempts. Try again in 15 minutes.',429);
    const account=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    const hash=account?.password_hash||'pbkdf2-sha256:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
    if(!await verifyPassword(input.password,hash)||!account)throw new HttpError('Email or password is incorrect.',401);
    const token=randomToken();await env.DB.batch([env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token),account.id,now+604800000),env.DB.prepare('DELETE FROM login_limits WHERE key=?').bind(keys[0])]);
    return json({user:publicUser(account)},200,{'Set-Cookie':sessionCookie(token,secure)});
  }
  const user=await authenticate(request,env);if(!user)throw new HttpError('Please sign in.',401);
  if(path==='/api/logout' && method==='POST') {const cookieName=secure?'__Host-mawid':'mawid';const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();return json({ok:true},200,{'Set-Cookie':logoutCookie(secure)});}
  if(path==='/api/workspace' && method==='GET') {
    const manager=user.role==='manager';const result=await env.DB.batch([
      env.DB.prepare(`SELECT * FROM records ${manager?'':'WHERE owner_id=?'} ORDER BY updated_at DESC`).bind(...(manager?[]:[user.id])),
      env.DB.prepare(`SELECT id,name,email,role FROM users ${manager?'':'WHERE id=?'} ORDER BY name`).bind(...(manager?[]:[user.id])),
      env.DB.prepare(`SELECT title,message,status,error,created_at AS createdAt FROM deliveries ${manager?'':'WHERE owner_id=?'} ORDER BY created_at DESC LIMIT 100`).bind(...(manager?[]:[user.id])),
      env.DB.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id=?').bind(user.id)
    ]);
    const workspace={user:publicUser(user),people:result[1].results.map(publicUser),cases:[],consultations:[],tasks:[],notifications:result[2].results,pushDevices:result[3].results[0].count};
    for(const row of result[0].results)workspace[row.type].push(decodeRecord(row));return json(workspace);
  }
  if(path==='/api/push/subscribe' && method==='POST') {
    if(!pushConfigured(env))throw new HttpError('Browser push is not configured yet.',503);
    const input=await body(request);try{await saveSubscription(env.DB,user.id,input);}catch(e){if(/push|notification|browser|devices|account|staff/i.test(e.message))throw new HttpError(e.message);throw e;}return json({ok:true});
  }
  if(path==='/api/push/unsubscribe' && method==='POST') {
    const input=await body(request);if(typeof input.endpoint!=='string'||input.endpoint.length>2048)throw new HttpError('Invalid subscription.');
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(await sha256(input.endpoint),user.id).run();return json({ok:true});
  }
  if(path==='/api/people' && method==='POST') {
    needManager(user);const raw=await body(request);const input=validate(()=>validatePerson(raw));const exists=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(input.email).first();if(exists)throw new HttpError('An account with this email already exists.',409);
    await env.DB.prepare('INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),input.name,input.email,input.role,await hashPassword(input.password),new Date().toISOString()).run();return json({ok:true},201);
  }
  const match=path.match(/^\/api\/(cases|consultations|tasks)(?:\/([^/]+))?$/);
  if(match && ((method==='POST'&&!match[2])||(method==='PATCH'&&match[2]))) {
    const type=match[1],id=match[2]?decodeURIComponent(match[2]):crypto.randomUUID();if(type==='consultations')needManager(user);
    const input=await body(request),row=match[2]?await env.DB.prepare('SELECT * FROM records WHERE id=? AND type=?').bind(id,type).first():null;
    if(match[2]&&!row)throw new HttpError('Record not found.',404);
    if(row&&user.role!=='manager'&&row.owner_id!==user.id)throw new HttpError('This case is not assigned to you.',403);
    if(row&&input._version!==row.version)throw new HttpError('This record changed in another session. Reload and try again.',409);
    const existing=row?decodeRecord(row):{};const clean=cleanInput(type,input);const r=validate(()=>validateRecord(type,clean,existing));
    if(user.role!=='manager'&&r.ownerId!==user.id)throw new HttpError('You can only assign work to yourself.',403);
    const owner=await env.DB.prepare('SELECT role FROM users WHERE id=?').bind(r.ownerId).first();if(!owner || (type==='consultations'&&owner.role!=='manager'))throw new HttpError('Choose an eligible staff member.');
    const idx=indexFields(type,r);delete r.id;delete r.version;const payload=JSON.stringify(r),now=new Date().toISOString();
    if(row){const updated=await env.DB.prepare('UPDATE records SET owner_id=?,payload=?,version=version+1,active=?,next_due=?,start_date=?,updated_at=?,last_scan=NULL WHERE id=? AND version=?').bind(r.ownerId,payload,idx.active,idx.nextDue,idx.startDate,now,id,row.version).run();if(!updated.meta.changes)throw new HttpError('This record changed in another session. Reload and try again.',409);}
    else await env.DB.prepare('INSERT INTO records(id,type,owner_id,payload,active,next_due,start_date,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,type,r.ownerId,payload,idx.active,idx.nextDue,idx.startDate,now).run();
    return json({id},row?200:201);
  }
  throw new HttpError('Endpoint not found.',404);
}
export default {
  async fetch(request,env) {
    if(new URL(request.url).pathname.startsWith('/api/')) {try{return await handleApi(request,env);}catch(e){return json({error:e.status?e.message:'The company backend is unavailable. Please try again.'},e.status||500);}}
    const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);for(const[k,v]of Object.entries(security))headers.set(k,v);return new Response(response.body,{status:response.status,headers});
  },
  async scheduled(controller,env,ctx) {ctx.waitUntil(runReminders(env,new Date(controller.scheduledTime)));}
};
