import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,call,login,insert,caseRecord,consultation } from './security-fixture.mjs';
import { buildPriorities,readyBy } from '../dist/engine.js';
import { activityStatement } from '../server/activity.mjs';

test('priority view sorts overdue first and omits finished, archived, and undefined destination workflows',()=>{
  const now=new Date('2026-10-14T08:00:00Z');
  const workspace={cases:[{...caseRecord,id:'soon',appointment:'2026-10-20'},{...caseRecord,id:'overdue',appointment:'2026-10-17'},{...caseRecord,id:'archived',archived:true},{...caseRecord,id:'canada',kind:'canada'},{...caseRecord,id:'ready',checks:{Hotel:true,'DS-160 application':true,'US Travel Docs':true}}],consultations:[{...consultation,id:'followup'}],tasks:[{id:'task',name:'Task',dueDate:'2026-10-14',time:'10:30',recurrence:'once',priority:'urgent'},{id:'finished',name:'Finished',dueDate:'2026-10-14',time:'10:30',recurrence:'once',doneOn:'2026-10-14'}]};
  const priorities=buildPriorities(workspace,now);assert.equal(priorities[0].id,'overdue');assert.equal(priorities.length,4);assert.equal(priorities[1].id,'task');
});
test('manager handoff creates one assigned case, preserves client contact, and stops follow-ups atomically',async()=>{
  const env=await fixture();try{
    insert(env,'consult','consultations',consultation);const manager=await login(env,'manager');
    const response=await call(env,'consultations/consult/handoff','POST',{ownerId:'employee',kind:'schengen_business',appointment:'2026-10-18',notes:'Employee handoff notes',_version:1},manager);assert.equal(response.status,201);const result=await response.json();
    const row=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get(result.id),r=JSON.parse(row.payload),source=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get('consult');assert.equal(row.owner_id,'employee');assert.equal(r.name,consultation.name);assert.equal(r.phone,consultation.phone);assert.equal(r.notes,'Employee handoff notes');assert.equal(readyBy(r),'2026-10-14');assert.equal(source.active,0);assert.equal(JSON.parse(source.payload).status,'converted');assert.equal(r.sourceConsultationId,'consult');
    const retry=await call(env,'consultations/consult/handoff','POST',{ownerId:'employee',kind:'usa',appointment:'2026-10-18',_version:1},manager);assert.equal(retry.status,200);assert.equal((await retry.json()).id,result.id);assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM records WHERE type='cases'").get().n,1);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity').get().n,2);
    const employee=await login(env);assert.equal((await(await call(env,'workspace','GET',null,employee)).json()).cases.length,1);
  }finally{env.DB.close();}
});
test('handoff never copies private consultation notes without an explicit employee note',async()=>{
  const env=await fixture();try{
    insert(env,'consult','consultations',consultation);const manager=await login(env,'manager');const response=await call(env,'consultations/consult/handoff','POST',{ownerId:'employee',kind:'usa',appointment:'2026-10-18',_version:1},manager);const {id}=await response.json();assert.equal(JSON.parse(env.DB.raw.prepare('SELECT payload FROM records WHERE id=?').get(id).payload).notes,'');
  }finally{env.DB.close();}
});
test('employee, inactive-owner, stale-version, and invalid-date handoffs cannot create cases',async()=>{
  const env=await fixture();try{
    insert(env,'consult','consultations',consultation);const employee=await login(env),manager=await login(env,'manager'),input={ownerId:'employee',kind:'usa',appointment:'2026-10-18',_version:1};
    assert.equal((await call(env,'consultations/consult/handoff','POST',input,employee)).status,403);assert.equal((await call(env,'consultations/consult/handoff','POST',{...input,_version:0},manager)).status,409);assert.equal((await call(env,'consultations/consult/handoff','POST',{...input,appointment:'2026-02-30'},manager)).status,400);
    env.DB.raw.prepare("UPDATE users SET status='disabled' WHERE id='employee'").run();assert.equal((await call(env,'consultations/consult/handoff','POST',input,manager)).status,400);assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM records WHERE type='cases'").get().n,0);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity').get().n,0);
  }finally{env.DB.close();}
});
test('record changes and audit history commit together, and conflicting writes leave no success history',async()=>{
  const env=await fixture();try{
    insert(env,'case','cases',caseRecord);const cookie=await login(env);
    assert.equal((await call(env,'cases/case','PATCH',{checks:{Hotel:true},_version:1},cookie)).status,200);const activity=env.DB.raw.prepare('SELECT * FROM activity').get();assert.equal(activity.actor_id,'employee');assert.match(activity.summary,/Completed: Hotel/);assert.doesNotMatch(activity.summary,/Private notes/);
    assert.equal((await call(env,'cases/case','PATCH',{checks:{Hotel:false},_version:1},cookie)).status,409);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity').get().n,1);
  }finally{env.DB.close();}
});
test('a failed mutation nonce cannot insert a forged success history entry',async()=>{
  const env=await fixture();try{
    insert(env,'case','cases',caseRecord);await activityStatement(env.DB,{id:'employee',name:'employee'},'record.updated','Forged success','case',{id:'case',mutation:'wrong-nonce'}).run();assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity').get().n,0);
  }finally{env.DB.close();}
});
test('reassigned case messages and history disappear from the former employee workspace',async()=>{
  const env=await fixture();try{
    insert(env,'case','cases',caseRecord);const employee=await login(env),manager=await login(env,'manager');await call(env,'cases/case','PATCH',{checks:{Hotel:true},_version:1},employee);
    env.DB.raw.prepare('INSERT INTO deliveries(id,dedup_key,record_id,owner_id,title,message,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run('old','old','case','employee','Client name','Private history','sent','2026-10-14');
    assert.equal((await call(env,'cases/case','PATCH',{ownerId:'other',_version:2},manager)).status,200);const before=await(await call(env,'workspace','GET',null,employee)).json();assert.equal(before.cases.length,0);assert.equal(before.notifications.length,0);assert.equal(before.activity.length,0);
    const other=await login(env,'other'),after=await(await call(env,'workspace','GET',null,other)).json();assert.equal(after.cases.length,1);assert.equal(after.activity.length,2);assert.equal(after.notifications.length,0);
  }finally{env.DB.close();}
});
test('priority is validated and stored server-side; SQL-looking names remain literal data',async()=>{
  const env=await fixture();try{
    const cookie=await login(env),name="Client'); DROP TABLE users; --";
    assert.equal((await call(env,'cases','POST',{...caseRecord,name,priority:'urgent'},cookie)).status,201);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);assert.equal(JSON.parse(env.DB.raw.prepare('SELECT payload FROM records').get().payload).priority,'urgent');
    assert.equal((await call(env,'cases','POST',{...caseRecord,priority:'admin'},cookie)).status,400);
  }finally{env.DB.close();}
});
