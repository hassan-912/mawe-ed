import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,call,login,request,PASSWORD,insert,caseRecord } from './security-fixture.mjs';
import { sha256,hashPassword,verifyPassword,upgradeLegacyHash } from '../server/auth.mjs';
import worker from '../server/worker.mjs';
import { pushFixture } from './push-fixture.mjs';
import { saveSubscription } from '../server/push.mjs';

test('optional username login is case-insensitive, unique, and preserves email login and role checks',async()=>{
  const env=await fixture();try {
    env.DB.raw.prepare("UPDATE users SET username='admin-test' WHERE id='manager'").run();
    const response=await call(env,'login','POST',{email:' ADMIN-TEST ',password:PASSWORD});assert.equal(response.status,200);
    const cookie=response.headers.get('Set-Cookie').split(';')[0],workspace=await(await call(env,'workspace','GET',null,cookie)).json();
    assert.equal(workspace.user.id,'manager');assert.equal(workspace.user.role,'manager');
    assert.equal((await call(env,'login','POST',{email:'manager@test.invalid',password:PASSWORD})).status,200);
    assert.equal((await call(env,'login','POST',{email:'admin-test',password:'incorrect'})).status,401);
    assert.equal((await call(env,'login','POST',{email:'unknown-user',password:PASSWORD})).status,401);
    assert.throws(()=>env.DB.raw.prepare("UPDATE users SET username='ADMIN-TEST' WHERE id='employee'").run(),/UNIQUE/);
    assert.equal((await call(env,'register','POST',{name:'Staff',email:'staff@test.invalid',password:'short@@'})).status,400);
  }finally{env.DB.close();}
});

test('username and email aliases share the same password-attempt limit',async()=>{
  const env=await fixture();try {
    env.DB.raw.prepare("UPDATE users SET username='admin-test' WHERE id='manager'").run();
    for(let i=0;i<8;i++)assert.equal((await call(env,'login','POST',{email:i%2?'manager@test.invalid':'admin-test',password:'incorrect'})).status,401);
    assert.equal((await call(env,'login','POST',{email:'ADMIN-TEST',password:PASSWORD})).status,429);
    assert.equal((await call(env,'login','POST',{email:'manager@test.invalid',password:PASSWORD})).status,429);
  }finally{env.DB.close();}
});

test('login bounds active sessions to twenty and removes expired sessions',async()=>{
  const env=await fixture();try{
    const now=Date.now();
    for(let i=0;i<25;i++)env.DB.raw.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,public_id,auth_version,created_at,last_seen,device_name) VALUES (?,?,?,?,?,?,?,?)').run(`seed-${i}`,'employee',now+3600000,crypto.randomUUID(),0,now-100000+i,now,'Synthetic device');
    env.DB.raw.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,public_id) VALUES (?,?,?,?)').run('expired','employee',0,crypto.randomUUID());
    const cookie=await login(env);assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='employee'").get().n,20);assert.equal(env.DB.raw.prepare("SELECT * FROM sessions WHERE token_hash='expired'").get(),undefined);assert.equal((await call(env,'workspace','GET',null,cookie)).status,200);
    assert.equal((await(await call(env,'security','GET',null,cookie)).json()).sessions.length,20);
  }finally{env.DB.close();}
});

test('a credential change racing with revoke-others cannot terminate new sessions or write a false event',async()=>{
  const env=await fixture();try{
    const cookie=await login(env),batch=env.DB.batch.bind(env.DB);
    env.DB.batch=async statements=>{env.DB.raw.prepare("UPDATE users SET auth_version=auth_version+1 WHERE id='employee'").run();return batch(statements);};
    assert.equal((await call(env,'security/revoke-others','POST',{currentPassword:PASSWORD},cookie)).status,409);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity').get().n,0);
  }finally{env.DB.close();}
});

test('registration creates only a pending employee and duplicate responses do not enumerate accounts',async()=>{
  const env=await fixture();try{
    const input={name:'New Staff',email:'New@test.invalid',password:PASSWORD};
    const first=await call(env,'register','POST',input),second=await call(env,'register','POST',input);
    assert.equal(first.status,201);assert.equal(second.status,201);assert.deepEqual(await first.json(),await second.json());
    const user=env.DB.raw.prepare('SELECT * FROM users WHERE email=?').get('new@test.invalid');assert.equal(user.status,'pending');assert.equal(user.role,'employee');assert.match(user.password_hash,/^pbkdf2-hmac-sha256:/);
    assert.equal((await call(env,'register','POST',{...input,email:'role@test.invalid',role:'manager'})).status,400);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE role='manager'").get().n,1);
  }finally{env.DB.close();}
});
test('pending staff can sign in but receive no company records or team information',async()=>{
  const env=await fixture();try{
    insert(env,'secret','cases',caseRecord);await call(env,'register','POST',{name:'Pending',email:'pending@test.invalid',password:PASSWORD});const cookie=await login(env,'pending');
    const workspace=await(await call(env,'workspace','GET',null,cookie)).json();assert.equal(workspace.approvalPending,true);assert.equal(workspace.cases.length,0);assert.equal(workspace.people.length,1);
    assert.equal((await call(env,'cases','POST',{...caseRecord,ownerId:workspace.user.id},cookie)).status,403);
    assert.equal((await call(env,'people','POST',{},cookie)).status,403);
    assert.equal((await call(env,'push/subscribe','POST',{},cookie)).status,403);
  }finally{env.DB.close();}
});
test('approval grants staff membership without manager privileges and can be reversed safely',async()=>{
  const env=await fixture();try{
    await call(env,'register','POST',{name:'New Staff',email:'new@test.invalid',password:PASSWORD});const id=env.DB.raw.prepare('SELECT id FROM users WHERE email=?').get('new@test.invalid').id,manager=await login(env,'manager'),employee=await login(env);
    assert.equal((await call(env,`people/${id}/approve`,'POST',{},employee)).status,403);
    assert.equal((await call(env,`people/${id}/approve`,'POST',{},manager)).status,200);
    const newCookie=await login(env,'new');assert.equal((await(await call(env,'workspace','GET',null,newCookie)).json()).user.status,'active');
    assert.equal((await call(env,`people/${id}/disable`,'POST',{},manager)).status,200);assert.equal((await call(env,'workspace','GET',null,newCookie)).status,401);
    assert.equal((await call(env,`people/${id}/activate`,'POST',{},manager)).status,200);assert.equal(env.DB.raw.prepare('SELECT role FROM users WHERE id=?').get(id).role,'employee');
    assert.equal((await call(env,'people/manager/disable','POST',{},manager)).status,403);
  }finally{env.DB.close();}
});
test('initial passwords must be changed before company data is available',async()=>{
  const env=await fixture();try{
    const manager=await login(env,'manager');assert.equal((await call(env,'people','POST',{name:'Created Staff',email:'created@test.invalid',role:'employee',password:PASSWORD},manager)).status,201);
    const cookie=await login(env,'created');const workspace=await(await call(env,'workspace','GET',null,cookie)).json();assert.equal(workspace.user.mustChangePassword,true);assert.equal(workspace.cases.length,0);
    assert.equal((await call(env,'cases','POST',{...caseRecord,ownerId:workspace.user.id},cookie)).status,403);
    const changed=await call(env,'security/password','POST',{currentPassword:PASSWORD,newPassword:'My-unique-new-passphrase-789'},cookie);assert.equal(changed.status,200);const fresh=changed.headers.get('Set-Cookie').split(';')[0];assert.equal((await(await call(env,'workspace','GET',null,fresh)).json()).user.mustChangePassword,false);
  }finally{env.DB.close();}
});
test('password changes require the current secret and revoke all older sessions and push subscriptions',async()=>{
  const env=await fixture();try{
    const first=await login(env),second=await login(env);const p=await pushFixture();await saveSubscription(env.DB,'employee',p.subscription);
    assert.equal((await call(env,'security/password','POST',{currentPassword:'wrong',newPassword:'My-unique-new-passphrase-789'},first)).status,400);
    const changed=await call(env,'security/password','POST',{currentPassword:PASSWORD,newPassword:'My-unique-new-passphrase-789'},first);assert.equal(changed.status,200);
    const current=changed.headers.get('Set-Cookie').split(';')[0];assert.equal((await call(env,'workspace','GET',null,first)).status,401);assert.equal((await call(env,'workspace','GET',null,second)).status,401);assert.equal((await call(env,'workspace','GET',null,current)).status,200);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n,0);
    assert.equal((await call(env,'login','POST',{email:'employee@test.invalid',password:PASSWORD})).status,401);
  }finally{env.DB.close();}
});
test('expired and unknown cookies can always be cleared through logout',async()=>{
  const env=await fixture();try{
    const cookie=await login(env);env.DB.raw.prepare('UPDATE sessions SET expires_at=0').run();const result=await call(env,'logout','POST',{},cookie);assert.equal(result.status,200);assert.match(result.headers.get('Set-Cookie'),/Max-Age=0/);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);const anonymous=await call(env,'logout','POST',{});assert.equal(anonymous.status,200);assert.match(anonymous.headers.get('Set-Cookie'),/Max-Age=0/);
  }finally{env.DB.close();}
});
test('security listings expose public identifiers, never token verifiers or subscription endpoints',async()=>{
  const env=await fixture();try{
    const cookie=await login(env),p=await pushFixture();await saveSubscription(env.DB,'employee',p.subscription);const result=await call(env,'security','GET',null,cookie),text=await result.text();
    assert.doesNotMatch(text,/token_hash|password_hash|endpoint|session_hash|p256dh/);const security=JSON.parse(text);assert.equal(security.sessions[0].current,true);assert.equal(security.devices.length,1);
    const other=await login(env,'other');assert.equal((await call(env,`security/sessions/${security.sessions[0].id}`,'DELETE',{},other)).status,404);assert.equal((await call(env,`security/devices/${security.devices[0].id}`,'DELETE',{},other)).status,404);
  }finally{env.DB.close();}
});
test('other-session revocation preserves the current session and requires password verification',async()=>{
  const env=await fixture();try{
    const first=await login(env),second=await login(env);assert.equal((await call(env,'security/revoke-others','POST',{currentPassword:'wrong'},first)).status,400);
    assert.equal((await call(env,'security/revoke-others','POST',{currentPassword:PASSWORD},first)).status,200);assert.equal((await call(env,'workspace','GET',null,first)).status,200);assert.equal((await call(env,'workspace','GET',null,second)).status,401);
  }finally{env.DB.close();}
});
test('idle, expired, and administratively revoked sessions are rejected',async()=>{
  const env=await fixture();try{
    let cookie=await login(env);env.DB.raw.prepare('UPDATE sessions SET last_seen=?').run(Date.now()-43200001);assert.equal((await call(env,'workspace','GET',null,cookie)).status,401);
    cookie=await login(env);env.DB.raw.prepare("UPDATE users SET auth_version=auth_version+1 WHERE id='employee'").run();assert.equal((await call(env,'workspace','GET',null,cookie)).status,401);
    cookie=await login(env);env.DB.raw.prepare("UPDATE users SET status='disabled' WHERE id='employee'").run();assert.equal((await call(env,'workspace','GET',null,cookie)).status,401);
  }finally{env.DB.close();}
});
test('peppered hashes require the correct server secret; legacy hashes upgrade at successful login',async()=>{
  const env=await fixture();try{
    const hash=await hashPassword(PASSWORD,undefined,env.AUTH_PEPPER);assert.equal(await verifyPassword(PASSWORD,hash,env.AUTH_PEPPER),true);assert.equal(await verifyPassword(PASSWORD,hash,'c'.repeat(64)),false);assert.equal(await verifyPassword(PASSWORD,hash),false);
    const old=env.DB.raw.prepare("SELECT password_hash FROM users WHERE id='employee'").get().password_hash;await login(env);assert.equal(env.DB.raw.prepare("SELECT password_hash FROM users WHERE id='employee'").get().password_hash,await upgradeLegacyHash(old,env.AUTH_PEPPER));
    delete env.AUTH_PEPPER;assert.equal((await call(env,'register','POST',{name:'Nobody',email:'nobody@test.invalid',password:PASSWORD})).status,503);assert.equal((await call(env,'login','POST',{email:'employee@test.invalid',password:PASSWORD})).status,503);
  }finally{env.DB.close();}
});
test('anonymous rate limits run before expensive hashing and invalid identifiers do not create account limiter rows',async()=>{
  const env=await fixture();try{
    assert.equal((await call(env,'login','POST',{email:'not/a/username',password:PASSWORD})).status,401);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM login_limits').get().n,1);
    for(let i=0;i<5;i++)await call(env,'register','POST',{name:'Invalid',email:'invalid',password:PASSWORD});assert.equal((await call(env,'register','POST',{name:'Invalid',email:'invalid',password:PASSWORD})).status,429);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);
  }finally{env.DB.close();}
});
test('malformed, oversized, cross-site, and privileged-field authentication requests are rejected',async()=>{
  const env=await fixture();try{
    assert.equal((await call(env,'login','POST',{email:'employee@test.invalid',password:PASSWORD},null,{'Sec-Fetch-Site':'cross-site'})).status,403);
    assert.equal((await call(env,'login','POST',{email:'employee@test.invalid',password:PASSWORD,role:'manager'})).status,400);
    const bad=new Request('https://mawid.test/api/register',{method:'POST',headers:{Origin:'https://mawid.test','Content-Type':'application/json'},body:'{bad'});assert.equal((await worker.fetch(bad,env)).status,400);
    const huge=request('register','POST',{name:'a'.repeat(17000),email:'long@test.invalid',password:PASSWORD});assert.equal((await worker.fetch(huge,env)).status,413);
    const insecure=new Request('http://mawid.test/api/config');const redirect=await worker.fetch(insecure,env);assert.equal(redirect.status,308);assert.equal(redirect.headers.get('Location'),'https://mawid.test/api/config');
  }finally{env.DB.close();}
});
test('switching accounts removes the previous account device using the previous cookie only',async()=>{
  const env=await fixture();try{
    const old=await login(env),p=await pushFixture();await saveSubscription(env.DB,'employee',p.subscription);const changed=await call(env,'login','POST',{email:'other@test.invalid',password:PASSWORD,endpoint:p.subscription.endpoint},old);assert.equal(changed.status,200);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n,0);
  }finally{env.DB.close();}
});
