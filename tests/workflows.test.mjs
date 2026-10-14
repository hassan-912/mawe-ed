import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fixture,call,login,insert,caseRecord,consultation,PASSWORD } from './security-fixture.mjs';
import { runReminders } from '../server/scheduler.mjs';
import { pushFixture } from './push-fixture.mjs';
import { saveSubscription } from '../server/push.mjs';
import { CHECKLISTS,zonedInstant } from '../dist/engine.js';

test('consultant registration remains pending and cannot request administrator privileges',async()=>{
  const env=await fixture();try {
    const input={name:'New Consultant',email:'consultant@test.invalid',password:PASSWORD,staffType:'consultant'};
    assert.equal((await call(env,'register','POST',input)).status,201);
    const account=env.DB.raw.prepare("SELECT * FROM users WHERE email='consultant@test.invalid'").get();
    assert.equal(account.role,'employee');assert.equal(account.staff_type,'consultant');assert.equal(account.status,'pending');
    const cookie=await login(env,'consultant');
    assert.equal((await call(env,'consultations','POST',{...consultation,ownerId:account.id},cookie)).status,403);
    assert.equal((await call(env,'register','POST',{...input,email:'invalid@test.invalid',staffType:'admin'})).status,400);
    const manager=await login(env,'manager');
    assert.equal((await call(env,`people/${account.id}/approve`,'POST',{staffType:'consultant'},manager)).status,200);
    assert.equal((await call(env,'consultations','POST',{...consultation,ownerId:account.id},cookie)).status,201);
    assert.equal((await call(env,'people','POST',{},cookie)).status,403);
  }finally{env.DB.close();}
});

test('consultants can edit only their own consultations and cannot create process files or administer the team',async()=>{
  const env=await fixture();try {
    env.DB.raw.prepare("UPDATE users SET staff_type='consultant' WHERE id='other'").run();
    insert(env,'own-consultation','consultations',{...consultation,ownerId:'other'});
    insert(env,'private-consultation','consultations',consultation);
    insert(env,'process-file','cases',caseRecord);
    const cookie=await login(env,'other'),workspace=await(await call(env,'workspace','GET',null,cookie)).json();
    assert.equal(workspace.user.staffType,'consultant');assert.equal(workspace.user.role,'employee');
    assert.deepEqual(workspace.consultations.map(r=>r.id),['own-consultation']);assert.equal(workspace.cases.length,0);
    const directory=workspace.people.find(p=>p.id==='employee');assert.ok(directory);assert.equal(directory.email,undefined);
    assert.equal((await call(env,'consultations/own-consultation','PATCH',{notes:'Updated consultation',_version:1},cookie)).status,200);
    assert.equal((await call(env,'consultations/private-consultation','PATCH',{notes:'Not mine',_version:1},cookie)).status,403);
    assert.equal((await call(env,'consultations','POST',{...consultation,ownerId:'manager'},cookie)).status,403);
    assert.equal((await call(env,'cases','POST',{...caseRecord,ownerId:'other'},cookie)).status,403);
    assert.equal((await call(env,'people/employee/disable','POST',{},cookie)).status,403);
    assert.equal((await call(env,'people','POST',{},cookie)).status,403);
  }finally{env.DB.close();}
});

test('consultants hand off their own clients to process staff without seeing the resulting file or exposing private notes',async()=>{
  const env=await fixture();try {
    env.DB.raw.prepare("UPDATE users SET staff_type='consultant' WHERE id='other'").run();
    insert(env,'own','consultations',{...consultation,ownerId:'other'});
    insert(env,'foreign','consultations',consultation);
    const cookie=await login(env,'other'),input={ownerId:'employee',kind:'schengen_tourism',appointment:'2026-11-15',_version:1};
    assert.equal((await call(env,'consultations/foreign/handoff','POST',input,cookie)).status,403);
    assert.equal((await call(env,'consultations/own/handoff','POST',{...input,ownerId:'other'},cookie)).status,400);
    const response=await call(env,'consultations/own/handoff','POST',input,cookie);assert.equal(response.status,201);
    const {id}=await response.json(),record=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get(id);
    assert.equal(record.start_date,'2026-11-08');assert.equal(JSON.parse(record.payload).notes,'');
    assert.equal(env.DB.raw.prepare("SELECT active FROM records WHERE id='own'").get().active,0);
    const repeat=await call(env,'consultations/own/handoff','POST',input,cookie);assert.equal((await repeat.json()).id,id);
    const workspace=await(await call(env,'workspace','GET',null,cookie)).json();assert.equal(workspace.cases.length,0);
    assert.equal((await call(env,`cases/${id}`,'PATCH',{checks:{Hotel:true},_version:1},cookie)).status,403);
    const process=await login(env);assert.equal((await(await call(env,'workspace','GET',null,process)).json()).cases[0].id,id);
    assert.equal((await call(env,'consultations','POST',{...consultation,ownerId:'employee'},process)).status,403);
  }finally{env.DB.close();}
});

test('administrators can create consultant accounts but cannot assign process files to them',async()=>{
  const env=await fixture();try {
    const manager=await login(env,'manager');
    const response=await call(env,'people','POST',{name:'Consultant',email:'created@test.invalid',role:'employee',staffType:'consultant',password:PASSWORD},manager);
    assert.equal(response.status,201);const account=env.DB.raw.prepare("SELECT * FROM users WHERE email='created@test.invalid'").get();
    assert.equal(account.staff_type,'consultant');assert.equal(account.must_change_password,1);
    assert.equal((await call(env,'cases','POST',{...caseRecord,ownerId:account.id},manager)).status,400);
    assert.equal((await call(env,'consultations','POST',{...consultation,ownerId:account.id},manager)).status,201);
  }finally{env.DB.close();}
});

test('changing a paused staff workflow requires reassigning existing client records first',async()=>{
  const env=await fixture();try {
    insert(env,'file','cases',caseRecord);const manager=await login(env,'manager');
    assert.equal((await call(env,'people/employee/disable','POST',{},manager)).status,200);
    assert.equal((await call(env,'people/employee/activate','POST',{staffType:'consultant'},manager)).status,409);
    assert.equal(env.DB.raw.prepare("SELECT status FROM users WHERE id='employee'").get().status,'disabled');
    assert.equal((await call(env,'cases/file','PATCH',{ownerId:'other',_version:1},manager)).status,200);
    assert.equal((await call(env,'people/employee/activate','POST',{staffType:'consultant'},manager)).status,200);
  }finally{env.DB.close();}
});

test('scheduled encrypted pushes use the seven-day window and update progress on successive days',async()=>{
  const env=await fixture(),push=await pushFixture();try {
    Object.assign(env,push.env);await saveSubscription(env.DB,'employee',push.subscription);
    const r={...caseRecord,kind:'schengen_tourism',appointment:'2026-11-15',checks:{}};
    insert(env,'november-file','cases',r);const received=[];
    const send=async(_url,options)=>{received.push(await push.decrypt(options.body));return new Response(null,{status:201});};
    const run=date=>runReminders(env,new Date(zonedInstant(date,'10:30')),send);
    await run('2026-11-07');assert.equal(received.length,0);
    await run('2026-11-08');await run('2026-11-08');assert.equal(received.length,1);
    assert.match(received[0].body,/7 days left/);assert.match(received[0].body,/No preparation steps completed yet/);assert.match(received[0].body,/Next step: Translation/);
    const cookie=await login(env);
    assert.equal((await call(env,'cases/november-file','PATCH',{checks:{Hotel:true,Flight:true},_version:1},cookie)).status,200);
    await run('2026-11-09');assert.match(received[1].body,/6 days left/);assert.match(received[1].body,/Completed: Hotel, Flight/);
    assert.equal((await call(env,'cases/november-file','PATCH',{checks:{Hotel:true,Flight:true,Translation:true},_version:2},cookie)).status,200);
    await run('2026-11-10');assert.match(received[2].body,/5 days left/);assert.match(received[2].body,/Next step: Aman/);
    assert.equal((await call(env,'cases/november-file','PATCH',{checks:Object.fromEntries(CHECKLISTS[r.kind].map(item=>[item,true])),_version:3},cookie)).status,200);
    await run('2026-11-11');assert.equal(received.length,3);
  }finally{env.DB.close();}
});

test('migration preserves existing accounts and custom reminder dates while replacing default starts and stale queued messages',()=>{
  const db=new DatabaseSync(':memory:');try {
    for(const file of ['schema.sql','migrations/0002_accounts_and_history.sql'])db.exec(readFileSync(new URL(`../server/${file}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES ('manager','Admin','admin@test.invalid','manager','hash','2026-10-14'),('employee','Process','staff@test.invalid','employee','hash','2026-10-14')");
    for(const [id,reminderStart] of [['default',''],['custom','2026-11-05']])db.prepare("INSERT INTO records(id,type,owner_id,payload,start_date,last_scan,updated_at) VALUES (?,'cases','employee',?,'2026-11-07','2026-11-07T10:30','2026-10-14')").run(id,JSON.stringify({...caseRecord,appointment:'2026-11-15',reminderStart}));
    db.exec("INSERT INTO deliveries(id,dedup_key,record_id,owner_id,title,message,status,created_at) VALUES ('old','default:case:2026-11-08:10:30','default','employee','Old','Old countdown','pending','2026-11-08')");
    db.exec(readFileSync(new URL('../server/migrations/0003_staff_workflows.sql',import.meta.url),'utf8'));
    assert.equal(db.prepare("SELECT role FROM users WHERE id='manager'").get().role,'manager');
    assert.equal(db.prepare("SELECT staff_type FROM users WHERE id='employee'").get().staff_type,'process');
    assert.equal(db.prepare("SELECT start_date FROM records WHERE id='default'").get().start_date,'2026-11-08');
    assert.equal(db.prepare("SELECT start_date FROM records WHERE id='custom'").get().start_date,'2026-11-05');
    assert.equal(db.prepare("SELECT last_scan FROM records WHERE id='default'").get().last_scan,null);
    const delivery=db.prepare('SELECT * FROM deliveries').get();assert.equal(delivery.status,'cancelled');assert.match(delivery.dedup_key,/:previous-rules$/);
  }finally{db.close();}
});

test('case creation and appointment changes persist automatic starts and reject independent start overrides',async()=>{
  const env=await fixture();try {
    const cookie=await login(env);
    const response=await call(env,'cases','POST',{...caseRecord,appointment:'2026-11-15'},cookie);assert.equal(response.status,201);
    const {id}=await response.json();let row=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get(id);
    assert.equal(row.start_date,'2026-11-08');assert.equal(row.active,1);
    assert.equal((await call(env,`cases/${id}`,'PATCH',{appointment:'2026-12-02',_version:1},cookie)).status,200);
    row=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get(id);assert.equal(row.start_date,'2026-11-25');
    assert.equal((await call(env,`cases/${id}`,'PATCH',{reminderStart:'2026-11-30',_version:2},cookie)).status,400);
    assert.equal(env.DB.raw.prepare('SELECT start_date FROM records WHERE id=?').get(id).start_date,'2026-11-25');
  }finally{env.DB.close();}
});

test('automatic-start migration preserves client data while removing old manual schedules',()=>{
  const db=new DatabaseSync(':memory:');try {
    for(const file of ['schema.sql','migrations/0002_accounts_and_history.sql','migrations/0003_staff_workflows.sql','migrations/0004_login_usernames.sql'])db.exec(readFileSync(new URL(`../server/${file}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES ('employee','Staff','staff@test.invalid','employee','hash','2026-10-15')");
    const payload={...caseRecord,appointment:'2026-11-15',checks:{Hotel:true},reminderStart:'2026-11-14'};
    db.prepare("INSERT INTO records(id,type,owner_id,payload,start_date,updated_at) VALUES ('file','cases','employee',?,'2026-11-14','2026-10-15')").run(JSON.stringify(payload));
    db.exec(readFileSync(new URL('../server/migrations/0005_automatic_case_reminders.sql',import.meta.url),'utf8'));
    const row=db.prepare('SELECT * FROM records').get(),after=JSON.parse(row.payload);
    assert.equal(row.start_date,'2026-11-08');assert.equal(row.version,2);assert.equal(row.owner_id,'employee');
    assert.equal(after.name,payload.name);assert.equal(after.appointment,payload.appointment);assert.equal(after.notes,payload.notes);assert.deepEqual(after.checks,payload.checks);assert.equal(after.reminderStart,undefined);
  }finally{db.close();}
});
