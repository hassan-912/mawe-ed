import { HttpError,json,readBody,onlyFields,validated,rateLimit,requestIp,needAuthConfiguration,needManager } from './http.mjs';
import { publicUser,normalizeEmail,validatePerson,validatePassword,verifyPassword,hashPassword,upgradeLegacyHash,randomToken,sha256,cookieToken,deviceName,sessionCookie,logoutCookie } from './auth.mjs';
import { activityStatement } from './activity.mjs';

export function sessionStatement(DB,account,tokenHash,request,version=account.auth_version) {
  const now=Date.now();
  return DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,public_id,auth_version,created_at,last_seen,device_name) SELECT ?,?,?,?,?,?,?,? FROM users WHERE id=? AND auth_version=? AND status!='disabled'").bind(tokenHash,account.id,now+604800000,crypto.randomUUID(),version,now,now,deviceName(request),account.id,version);
}
export async function publicAccountRoute(request,env) {
  const path=new URL(request.url).pathname,secure=new URL(request.url).protocol==='https:';
  if(request.method!=='POST')return null;
  if(path==='/api/logout') {
    const input=await readBody(request);onlyFields(input,['endpoint']);
    if(input.endpoint!=null&&(typeof input.endpoint!=='string'||input.endpoint.length>2048))throw new HttpError('Invalid notification device.');
    const token=cookieToken(request);
    if(token) {
      const tokenHash=await sha256(token),session=await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=?').bind(tokenHash).first();
      const statements=[env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash)];
      if(session&&input.endpoint)statements.push(env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(await sha256(input.endpoint),session.user_id));
      await env.DB.batch(statements);
    }
    return json({ok:true},200,{'Set-Cookie':logoutCookie(secure)});
  }
  if(path==='/api/register') {
    needAuthConfiguration(env);
    if(env.REGISTRATION_OPEN==='false')throw new HttpError('New registrations are currently closed.',403);
    await rateLimit(env.DB,`registration-ip:${requestIp(request)}`,5,3600000);
    const raw=await readBody(request);onlyFields(raw,['name','email','password']);
    const person=validated(()=>validatePerson({...raw,role:'employee'}));
    const pending=await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE status='pending'").first();
    if(pending.count>=100)throw new HttpError('Registrations are awaiting manager review. Please try again later.',503);
    const id=crypto.randomUUID(),now=new Date().toISOString();
    // Compute for duplicate and new emails alike; responses never reveal which
    // email identifiers already have an account. No public role selection.
    const hash=await hashPassword(person.password,undefined,env.AUTH_PEPPER);
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO users(id,name,email,role,password_hash,created_at,status) SELECT ?,?,?,'employee',?,?,'pending' WHERE (SELECT COUNT(*) FROM users WHERE status='pending')<100").bind(id,person.name,person.email,hash,now),
      env.DB.prepare("INSERT INTO activity(id,actor_id,actor_name,action,summary,created_at) SELECT ?,id,name,'account.registered','Employee account requested',? FROM users WHERE id=?").bind(crypto.randomUUID(),now,id)
    ]);
    return json({message:'If this email is available, your account is ready to sign in. Company access requires manager approval.'},201);
  }
  if(path==='/api/login') {
    needAuthConfiguration(env);
    await rateLimit(env.DB,`login-ip:${requestIp(request)}`,30);
    const raw=await readBody(request);onlyFields(raw,['email','password','endpoint']);
    if(raw.endpoint!=null&&(typeof raw.endpoint!=='string'||raw.endpoint.length>2048))throw new HttpError('Invalid notification device.');
    let email;try{email=normalizeEmail(raw.email);}catch{throw new HttpError('Email or password is incorrect.',401);}
    if(typeof raw.password!=='string'||!raw.password||raw.password.length>128)throw new HttpError('Email or password is incorrect.',401);
    await rateLimit(env.DB,`login-email:${email}`,8);
    const account=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    const dummy='pbkdf2-hmac-sha256:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
    if(!await verifyPassword(raw.password,account?.password_hash||dummy,env.AUTH_PEPPER)||!account||account.status==='disabled')throw new HttpError('Email or password is incorrect.',401);
    const token=randomToken(),tokenHash=await sha256(token),statements=[];
    if(account.password_hash.startsWith('pbkdf2-sha256:'))statements.push(env.DB.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').bind(await upgradeLegacyHash(account.password_hash,env.AUTH_PEPPER),account.id,account.password_hash));
    statements.push(sessionStatement(env.DB,account,tokenHash,request));
    statements.push(env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND (expires_at<=? OR auth_version!=? OR (last_seen>0 AND last_seen<=?))').bind(account.id,Date.now(),account.auth_version,Date.now()-43200000));
    statements.push(env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash!=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? AND token_hash!=? ORDER BY created_at DESC,public_id DESC LIMIT 19)').bind(account.id,tokenHash,account.id,tokenHash));
    statements.push(env.DB.prepare('DELETE FROM login_limits WHERE key=?').bind(await sha256(`login-email:${email}`)));
    const old=cookieToken(request);
    if(old) {
      const oldHash=await sha256(old),oldSession=await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=?').bind(oldHash).first();
      statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(oldHash));
      if(oldSession&&raw.endpoint)statements.push(env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(await sha256(raw.endpoint),oldSession.user_id));
    }
    const result=await env.DB.batch(statements);
    const sessionResult=result[account.password_hash.startsWith('pbkdf2-sha256:')?1:0];
    if(!sessionResult.meta.changes)throw new HttpError('Account access changed. Please sign in again.',401);
    return json({user:publicUser(account)},200,{'Set-Cookie':sessionCookie(token,secure)});
  }
  return null;
}
async function reauthenticate(user,password,env) {
  await rateLimit(env.DB,`reauth:${user.id}`,8);
  if(typeof password!=='string'||password.length>128||!await verifyPassword(password,user.password_hash,env.AUTH_PEPPER))throw new HttpError('Your current password is incorrect.',400);
}
export async function securityRoute(request,env,user) {
  const path=new URL(request.url).pathname,method=request.method;
  if(path==='/api/security'&&method==='GET') {
    const now=Date.now(),results=await env.DB.batch([
      env.DB.prepare('SELECT public_id,created_at,last_seen,device_name,token_hash FROM sessions WHERE user_id=? AND expires_at>? AND auth_version=? AND (last_seen=0 OR last_seen>?) ORDER BY created_at DESC LIMIT 20').bind(user.id,now,user.auth_version,now-43200000),
      env.DB.prepare('SELECT id,created_at FROM push_subscriptions WHERE user_id=? ORDER BY created_at DESC').bind(user.id)
    ]);
    return json({sessions:results[0].results.map(s=>({id:s.public_id,createdAt:s.created_at,lastSeen:s.last_seen,device:s.device_name,current:s.token_hash===user.session_hash})),devices:results[1].results.map(d=>({id:d.id,createdAt:d.created_at})),notificationPreview:!!user.notification_preview});
  }
  if(path==='/api/security/password'&&method==='POST') {
    needAuthConfiguration(env);
    const input=await readBody(request);onlyFields(input,['currentPassword','newPassword']);
    validated(()=>validatePassword(input.newPassword));
    await reauthenticate(user,input.currentPassword,env);
    if(input.currentPassword===input.newPassword)throw new HttpError('Choose a different new password.');
    const hash=await hashPassword(input.newPassword,undefined,env.AUTH_PEPPER),token=randomToken(),newVersion=user.auth_version+1;
    const now=Date.now();
    const results=await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,auth_version=?,must_change_password=0 WHERE id=? AND password_hash=? AND auth_version=? AND status!='disabled'").bind(hash,newVersion,user.id,user.password_hash,user.auth_version),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND auth_version<?').bind(user.id,newVersion),
      env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(user.id,user.id,hash),
      env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,public_id,auth_version,created_at,last_seen,device_name) SELECT ?,?,?,?,?,?,?,? FROM users WHERE id=? AND auth_version=? AND password_hash=? AND status!='disabled'").bind(await sha256(token),user.id,now+604800000,crypto.randomUUID(),newVersion,now,now,deviceName(request),user.id,newVersion,hash),
      env.DB.prepare("INSERT INTO activity(id,actor_id,actor_name,action,summary,created_at) SELECT ?,id,name,'account.password_changed','Password changed; other sessions and notification devices revoked',? FROM users WHERE id=? AND password_hash=?").bind(crypto.randomUUID(),new Date().toISOString(),user.id,hash)
    ]);
    if(!results[0].meta.changes)throw new HttpError('Account access changed. Please sign in again.',409);
    return json({ok:true},200,{'Set-Cookie':sessionCookie(token,new URL(request.url).protocol==='https:')});
  }
  if(path==='/api/security/revoke-others'&&method==='POST') {
    const input=await readBody(request);onlyFields(input,['currentPassword']);
    await reauthenticate(user,input.currentPassword,env);
    const mutation=crypto.randomUUID();
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE users SET last_mutation_id=? WHERE id=? AND password_hash=? AND auth_version=? AND status!='disabled'").bind(mutation,user.id,user.password_hash,user.auth_version),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash!=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND last_mutation_id=?)').bind(user.id,user.session_hash,user.id,mutation),
      activityStatement(env.DB,user,'account.sessions_revoked','Other sign-in sessions revoked',null,{table:'users',id:user.id,mutation})
    ]);
    if(!result[0].meta.changes)throw new HttpError('Account access changed. Please sign in again.',409);
    return json({ok:true});
  }
  const sessionMatch=path.match(/^\/api\/security\/sessions\/([a-f0-9-]{36})$/);
  if(sessionMatch&&method==='DELETE') {
    const own=await env.DB.prepare('SELECT token_hash FROM sessions WHERE public_id=? AND user_id=?').bind(sessionMatch[1],user.id).first();
    if(!own)throw new HttpError('Session not found.',404);
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE public_id=? AND user_id=?').bind(sessionMatch[1],user.id),activityStatement(env.DB,user,'account.session_revoked','Sign-in session revoked')]);
    return json({ok:true,current:own.token_hash===user.session_hash},200,own.token_hash===user.session_hash?{'Set-Cookie':logoutCookie(new URL(request.url).protocol==='https:')}:{});
  }
  const deviceMatch=path.match(/^\/api\/security\/devices\/([a-f0-9]{64})$/);
  if(deviceMatch&&method==='DELETE') {
    const own=await env.DB.prepare('SELECT id FROM push_subscriptions WHERE id=? AND user_id=?').bind(deviceMatch[1],user.id).first();
    if(!own)throw new HttpError('Notification device not found.',404);
    await env.DB.batch([env.DB.prepare('DELETE FROM push_subscriptions WHERE id=? AND user_id=?').bind(deviceMatch[1],user.id),activityStatement(env.DB,user,'account.device_revoked','Notification device disconnected')]);
    return json({ok:true});
  }
  if(path==='/api/security/preferences'&&method==='PATCH') {
    const input=await readBody(request);onlyFields(input,['notificationPreview']);
    if(typeof input.notificationPreview!=='boolean')throw new HttpError('Choose a valid notification preview preference.');
    await env.DB.prepare('UPDATE users SET notification_preview=? WHERE id=?').bind(input.notificationPreview?1:0,user.id).run();return json({ok:true});
  }
  return null;
}
export async function accountAdministration(request,env,user) {
  const match=new URL(request.url).pathname.match(/^\/api\/people\/([^/]+)\/(approve|disable|activate)$/);
  if(!match||request.method!=='POST')return null;
  needManager(user);const input=await readBody(request);onlyFields(input,[]);
  const person=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(match[1]).first();
  if(!person)throw new HttpError('Staff account not found.',404);
  if(person.id===user.id||person.role!=='employee')throw new HttpError('This action is available for employee accounts only.',403);
  const mutation=crypto.randomUUID();
  if(match[2]==='approve'||match[2]==='activate') {
    const expected=match[2]==='approve'?'pending':'disabled';
    if(person.status!==expected)throw new HttpError('The account state changed. Reload and try again.',409);
    const result=await env.DB.batch([env.DB.prepare("UPDATE users SET status='active',last_mutation_id=? WHERE id=? AND status=?").bind(mutation,person.id,expected),activityStatement(env.DB,user,match[2]==='approve'?'account.approved':'account.activated',`${match[2]==='approve'?'Employee membership approved':'Employee membership reactivated'}: ${person.name}`,null,{table:'users',id:person.id,mutation})]);
    if(!result[0].meta.changes)throw new HttpError('The account state changed. Reload and try again.',409);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET status='disabled',auth_version=auth_version+1,last_mutation_id=? WHERE id=?").bind(mutation,person.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(person.id),
      env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=?').bind(person.id),
      env.DB.prepare("UPDATE deliveries SET status='cancelled',error='Account access revoked' WHERE owner_id=? AND status IN ('pending','failed','sending')").bind(person.id),
      activityStatement(env.DB,user,'account.disabled',`Access revoked: ${person.name}; sessions and devices disconnected`,null,{table:'users',id:person.id,mutation})
    ]);
  }
  return json({ok:true});
}
