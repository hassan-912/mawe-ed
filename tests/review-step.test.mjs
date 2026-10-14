import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CHECKLISTS,caseStatus,caseMessage,nextCaseStep,employeeReminders,zonedInstant } from '../dist/engine.js';
import { fixture,call,login,caseRecord } from './security-fixture.mjs';

test('fully prepared files continue reminders until submitted to review',()=>{
  for(const kind of ['schengen_tourism','schengen_business','usa']) {
    const record={...caseRecord,kind,checks:Object.fromEntries(CHECKLISTS[kind].filter(step=>step!=='Submitted to review').map(step=>[step,true]))};
    const now=new Date(zonedInstant('2026-10-17','15:00'));
    assert.equal(nextCaseStep(record),'Submitted to review');assert.notEqual(caseStatus(record,'2026-10-17'),'Ready');
    assert.match(caseMessage(record,'2026-10-17'),/Still needed: Submitted to review/);assert.equal(employeeReminders(record,now).length,2);
    record.checks['Submitted to review']=true;assert.equal(caseStatus(record,'2026-10-17'),'Ready');assert.equal(nextCaseStep(record),null);assert.deepEqual(employeeReminders(record,now),[]);
  }
});

test('review submission persists, is attributed to the acting employee, and can be reopened',async()=>{
  const env=await fixture();try {
    const cookie=await login(env),input={...caseRecord,checks:Object.fromEntries(CHECKLISTS[caseRecord.kind].map(step=>[step,step!=='Submitted to review']))};
    const created=await call(env,'cases','POST',input,cookie);assert.equal(created.status,201);const {id}=await created.json();
    const checks={...input.checks,'Submitted to review':true};
    assert.equal((await call(env,`cases/${id}`,'PATCH',{checks,_version:1},cookie)).status,200);
    let row=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get(id);assert.equal(row.active,0);assert.equal(JSON.parse(row.payload).checks['Submitted to review'],true);
    const workspace=await(await call(env,'workspace','GET',null,cookie)).json();
    assert.equal(workspace.cases[0].creatorEmail,'employee@test.invalid');assert.ok(workspace.activity.some(a=>a.actorId==='employee'&&a.summary==='Completed: Submitted to review'));
    assert.equal((await call(env,`cases/${id}`,'PATCH',{checks:{...checks,'Submitted to review':false},_version:2},cookie)).status,200);
    row=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get(id);assert.equal(row.active,1);assert.equal(JSON.parse(row.payload).checks.Hotel,true);
    assert.equal((await call(env,`cases/${id}`,'PATCH',{checks:{...checks,'Submitted to review':'yes'},_version:3},cookie)).status,400);
  }finally{env.DB.close();}
});

test('review migration preserves preparation, assignments, and existing review marks while updating schedule state',()=>{
  const db=new DatabaseSync(':memory:');try {
    for(const file of ['schema.sql','migrations/0002_accounts_and_history.sql'])db.exec(readFileSync(new URL(`../server/${file}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES ('employee','Staff','staff@test.invalid','employee','hash','2026-10-15')");
    for(const [id,kind,archived,submitted] of [['prepared','usa',false,undefined],['archived','schengen_tourism',true,undefined],['submitted','usa',false,true],['placeholder','canada',false,undefined]]) {
      const payload={...caseRecord,kind,archived,checks:{Hotel:true,'DS-160 application':true,'US Travel Docs':true,...(submitted?{'Submitted to review':true}:{})}};
      db.prepare("INSERT INTO records(id,type,owner_id,payload,active,start_date,updated_at) VALUES (?,'cases','employee',?,0,'2026-10-11','2026-10-15')").run(id,JSON.stringify(payload));
    }
    db.exec("INSERT INTO deliveries(id,dedup_key,record_id,owner_id,title,message,status,created_at) VALUES ('pending','prepared:case:2026-10-17:10:30','prepared','employee','Old','Old completed checklist','pending','2026-10-17')");
    db.exec(readFileSync(new URL('../server/migrations/0010_case_review_step.sql',import.meta.url),'utf8'));
    const row=db.prepare("SELECT * FROM records WHERE id='prepared'").get();assert.equal(row.active,1);assert.equal(row.version,2);assert.equal(row.owner_id,'employee');assert.equal(row.start_date,'2026-10-11');assert.equal(JSON.parse(row.payload).checks.Hotel,true);assert.equal(JSON.parse(row.payload).checks['Submitted to review'],false);
    assert.equal(db.prepare("SELECT active FROM records WHERE id='archived'").get().active,0);
    const submitted=db.prepare("SELECT * FROM records WHERE id='submitted'").get();assert.equal(submitted.version,1);assert.equal(JSON.parse(submitted.payload).checks['Submitted to review'],true);
    assert.equal(db.prepare("SELECT version FROM records WHERE id='placeholder'").get().version,1);
    assert.equal(db.prepare('SELECT status FROM deliveries').get().status,'cancelled');
  }finally{db.close();}
});
