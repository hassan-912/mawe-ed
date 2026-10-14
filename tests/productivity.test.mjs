import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fixture,call,login,insert,caseRecord,consultation } from './security-fixture.mjs';
import { readRank } from '../server/rank.mjs';
import { localParts,zonedInstant } from '../dist/engine.js';
import { validatePersonal } from '../dist/personal.js';

test('case creator is authenticated and remains unchanged after reassignment and another employee edit',async()=>{
  const env=await fixture();try {
    const manager=await login(env,'manager'),employee=await login(env);
    const created=await call(env,'cases','POST',caseRecord,manager);assert.equal(created.status,201);const {id}=await created.json();
    assert.equal((await call(env,`cases/${id}`,'PATCH',{checks:{Hotel:true},_version:1},employee)).status,200);
    assert.equal((await call(env,`cases/${id}`,'PATCH',{ownerId:'other',_version:2},manager)).status,200);
    const other=await login(env,'other'),workspace=await(await call(env,'workspace','GET',null,other)).json();
    assert.equal(workspace.cases[0].creatorId,'manager');assert.equal(workspace.cases[0].creatorName,'manager');assert.equal(workspace.cases[0].creatorEmail,'manager@test.invalid');assert.equal(workspace.cases[0].ownerId,'other');
    assert.ok(workspace.activity.some(a=>a.actorId==='employee'&&a.actorName==='employee'&&a.summary==='Completed: Hotel'));
    assert.ok(workspace.activity.some(a=>a.actorId==='manager'&&a.action==='record.created'));
    assert.equal((await(await call(env,'workspace','GET',null,employee)).json()).cases.length,0);
    for(const input of [{creatorId:'other'},{creatorName:'Fake creator'},{creatorEmail:'fake@test.invalid'}])assert.equal((await call(env,`cases/${id}`,'PATCH',{...input,_version:3},manager)).status,400);
    const payload=JSON.parse(env.DB.raw.prepare('SELECT payload FROM records WHERE id=?').get(id).payload);assert.equal(payload.creatorName,undefined);
  }finally{env.DB.close();}
});

test('handoff creator is the consultant creating the file rather than its assigned process employee',async()=>{
  const env=await fixture();try {
    env.DB.raw.prepare("UPDATE users SET staff_type='consultant' WHERE id='other'").run();
    const manager=await login(env,'manager'),other=await login(env,'other');
    const r=await call(env,'consultations','POST',{...consultation,ownerId:'other'},manager);const {id}=await r.json();
    const h=await call(env,`consultations/${id}/handoff`,'POST',{ownerId:'employee',kind:'usa',appointment:'2026-11-15',_version:1},other);assert.equal(h.status,201);
    const row=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get((await h.json()).id);
    assert.equal(row.creator_id,'other');assert.equal(row.creator_name,'other');assert.equal(row.owner_id,'employee');
    assert.equal(env.DB.raw.prepare('SELECT creator_id FROM records WHERE id=?').get(id).creator_id,'manager');
  }finally{env.DB.close();}
});

test('creator migration uses creation history and keeps unknown authors honest',()=>{
  const db=new DatabaseSync(':memory:');try {
    for(const file of ['schema.sql','migrations/0002_accounts_and_history.sql'])db.exec(readFileSync(new URL(`../server/${file}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES ('old','Original employee','old@test.invalid','employee','hash','2026-10-01'),('new','New employee','new@test.invalid','employee','hash','2026-10-01')");
    for(const id of ['known','unknown','handoff'])db.prepare("INSERT INTO records(id,type,owner_id,payload,updated_at) VALUES (?,'cases','new',?,'2026-10-15')").run(id,JSON.stringify({...caseRecord,ownerId:'new',checks:{Hotel:true}}));
    db.exec("INSERT INTO activity VALUES ('create','old','Original employee','known','record.created','Client case created','2026-10-01'),('edit','new','New employee','known','record.updated','Assignment changed','2026-10-15'),('handoff','old','Original employee','handoff','case.received','Case created from a consultation','2026-10-02')");
    db.exec(readFileSync(new URL('../server/migrations/0007_record_creators.sql',import.meta.url),'utf8'));
    assert.equal(db.prepare("SELECT creator_name FROM records WHERE id='known'").get().creator_name,'Original employee');
    assert.equal(db.prepare("SELECT creator_id FROM records WHERE id='handoff'").get().creator_id,'old');
    const row=db.prepare("SELECT * FROM records WHERE id='unknown'").get();assert.equal(row.creator_id,null);assert.equal(row.creator_name,null);assert.equal(row.owner_id,'new');assert.equal(JSON.parse(row.payload).checks.Hotel,true);
  }finally{db.close();}
});

test('personal tasks persist fields and are private even from administrators, exports, and shared activity',async()=>{
  const env=await fixture();try {
    const employee=await login(env),manager=await login(env,'manager'),other=await login(env,'other');
    const response=await call(env,'personal-tasks','POST',{title:'Private plan',notes:'Private note',dueDate:'2026-11-15',priority:'urgent',subtasks:[{title:'First step',done:false}]},employee);assert.equal(response.status,201);
    const {id}=await response.json();
    for(const cookie of [manager,other]) {
      assert.deepEqual((await(await call(env,'personal-tasks','GET',null,cookie)).json()).tasks,[]);
      assert.deepEqual((await(await call(env,'workspace','GET',null,cookie)).json()).personalTasks,[]);
      assert.equal((await call(env,`personal-tasks/${id}`,'PATCH',{title:'Not mine',_version:1},cookie)).status,404);
      assert.equal((await call(env,`personal-tasks/${id}`,'DELETE',{_version:1},cookie)).status,404);
    }
    assert.equal((await call(env,`personal-tasks/${id}`,'PATCH',{status:'in_progress',subtasks:[{title:'First step',done:true}],_version:1},employee)).status,200);
    assert.equal((await call(env,`personal-tasks/${id}`,'PATCH',{status:'done',_version:1},employee)).status,409);
    const task=(await(await call(env,'workspace','GET',null,employee)).json()).personalTasks[0];
    assert.equal(task.title,'Private plan');assert.equal(task.notes,'Private note');assert.equal(task.priority,'urgent');assert.equal(task.dueDate,'2026-11-15');assert.equal(task.subtasks[0].done,true);assert.equal(task.version,2);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity').get().n,0);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM work_credits').get().n,0);
    assert.equal((await call(env,`personal-tasks/${id}`,'DELETE',{_version:2},employee)).status,200);
    assert.deepEqual((await(await call(env,'personal-tasks','GET',null,employee)).json()).tasks,[]);
    assert.equal((await call(env,'personal-tasks','POST',{title:'Admin private plan'},manager)).status,201);
  }finally{env.DB.close();}
});

test('personal tasks enforce bounded, validated inputs and active account access',async()=>{
  const env=await fixture();try {
    const cookie=await login(env);
    for(const input of [{title:''},{title:'x',userId:'other'},{title:'x',status:'invalid'},{title:'x',priority:'invalid'},{title:'x',dueDate:'2026-02-30'},{title:'x',notes:'x'.repeat(3001)},{title:'x',subtasks:Array.from({length:21},()=>({title:'x',done:false}))},{title:'x',subtasks:[{title:'x',done:'yes'}]}])assert.equal((await call(env,'personal-tasks','POST',input,cookie)).status,400);
    assert.equal((await call(env,'personal-tasks','POST',{title:'x'})).status,401);
    env.DB.raw.prepare("UPDATE users SET status='pending' WHERE id='employee'").run();assert.equal((await call(env,'personal-tasks','GET',null,cookie)).status,403);
    env.DB.raw.prepare("UPDATE users SET status='active',must_change_password=1 WHERE id='employee'").run();assert.equal((await call(env,'personal-tasks','POST',{title:'x'},cookie)).status,403);
    assert.deepEqual((await(await call(env,'workspace','GET',null,cookie)).json()).personalTasks,[]);
    assert.equal(validatePersonal({title:'  Clear plan  '}).title,'Clear plan');
  }finally{env.DB.close();}
});

test('rank counts real work once, excludes admin work and private tasks, and respects reopened steps',async()=>{
  const env=await fixture();try {
    const cookie=await login(env),manager=await login(env,'manager');
    insert(env,'file','cases',{...caseRecord,kind:'schengen_tourism'});
    assert.equal((await call(env,'cases/file','PATCH',{checks:{Hotel:true,Flight:true},_version:1},cookie)).status,200);
    let rank=await readRank(env),row=rank.rows.find(r=>r.id==='employee');assert.equal(row.score,11);assert.equal(row.completedSteps,2);assert.equal(row.activeDays,1);assert.equal(row.position,1);assert.ok(!rank.rows.some(r=>r.id==='manager'));
    assert.equal((await call(env,'cases/file','PATCH',{checks:{Hotel:false,Flight:true},_version:2},cookie)).status,200);
    assert.equal((await readRank(env)).rows.find(r=>r.id==='employee').score,6);
    assert.equal((await call(env,'cases/file','PATCH',{checks:{Hotel:true,Flight:true},_version:3},cookie)).status,200);
    assert.equal((await call(env,'cases/file','PATCH',{notes:'Updated notes',_version:4},cookie)).status,200);
    assert.equal((await call(env,'personal-tasks','POST',{title:'Personal completion',status:'done'},cookie)).status,201);
    assert.equal((await call(env,'cases','POST',{...caseRecord,name:'Admin-created file',checks:{Hotel:true}},manager)).status,201);
    rank=await readRank(env);row=rank.rows.find(r=>r.id==='employee');assert.equal(row.score,11);assert.equal(row.completedSteps,2);
    const shared={name:'Shared work',ownerId:'employee',dueDate:localParts().date,time:'10:30',recurrence:'once',doneOn:''};
    const created=await call(env,'tasks','POST',shared,cookie);const {id}=await created.json();
    for(const [version,doneOn] of [[1,localParts().date],[2,''],[3,localParts().date]])assert.equal((await call(env,`tasks/${id}`,'PATCH',{doneOn,_version:version},cookie)).status,200);
    assert.equal((await readRank(env)).rows.find(r=>r.id==='employee').score,14);
    const publicRank=await(await call(env,'rank?period=week','GET',null,cookie)).json();assert.equal(publicRank.rows[0].name,'employee');assert.equal(JSON.stringify(publicRank).includes('Private notes'),false);assert.equal(JSON.stringify(publicRank).includes('Synthetic Client'),false);
    assert.equal((await call(env,'rank?period=invalid','GET',null,cookie)).status,400);
    assert.equal((await call(env,'rank','GET')).status,401);
    assert.equal((await call(env,'rank','GET',null,manager)).status,200);
  }finally{env.DB.close();}
});

test('follow-ups earn credit once per client per Cairo day and snoozing earns none',async()=>{
  const env=await fixture();try {
    env.DB.raw.prepare("UPDATE users SET staff_type='consultant' WHERE id='other'").run();
    insert(env,'consult','consultations',{...consultation,ownerId:'other'});const cookie=await login(env,'other');
    assert.equal((await call(env,'consultations/consult','PATCH',{lastContact:new Date().toISOString(),_version:1},cookie)).status,200);
    assert.equal((await call(env,'consultations/consult','PATCH',{lastContact:new Date(Date.now()+1000).toISOString(),_version:2},cookie)).status,200);
    assert.equal((await call(env,'consultations/consult','PATCH',{nextReminder:new Date(Date.now()+86400000).toISOString(),_version:3},cookie)).status,200);
    const row=(await readRank(env)).rows.find(r=>r.id==='other');assert.equal(row.followups,1);assert.equal(row.score,6);
    const activities=(await(await call(env,'workspace','GET',null,cookie)).json()).activity;assert.ok(activities.some(a=>a.summary==='Follow-up recorded'&&a.actorId==='other'));
  }finally{env.DB.close();}
});

test('daily and weekly rank use Cairo boundaries, Monday weeks, stable ties, and no passive visit points',async()=>{
  const env=await fixture();try {
    insert(env,'one','cases',caseRecord);insert(env,'two','cases',{...caseRecord,ownerId:'other'});
    const put=(key,id,actor,date)=>env.DB.raw.prepare("INSERT INTO work_credits VALUES (?,?,?,'created','',?,1,?)").run(key,id,actor,date,zonedInstant(date,'23:59'));
    put('before-week','one','employee','2026-10-11');put('week','one','employee','2026-10-12');put('day','one','employee','2026-10-15');put('tie','two','other','2026-10-15');
    const now=new Date(zonedInstant('2026-10-15','23:59'));const day=await readRank(env,'day',now),week=await readRank(env,'week',now);
    assert.equal(day.start,'2026-10-15');assert.equal(day.rows.find(r=>r.id==='employee').score,2);assert.equal(day.rows.find(r=>r.id==='other').position,1);
    assert.equal(week.start,'2026-10-12');assert.equal(week.rows.find(r=>r.id==='employee').score,4);
    assert.equal((await readRank(env,'day',new Date(zonedInstant('2026-10-16','00:00')))).rows[0].score,0);
    const cookie=await login(env);await call(env,'workspace','GET',null,cookie);await call(env,'rank','GET',null,cookie);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM work_credits').get().n,4);
  }finally{env.DB.close();}
});

test('rank migration recovers exact completed items once and preserves client records',()=>{
  const db=new DatabaseSync(':memory:');try {
    for(const file of ['schema.sql','migrations/0002_accounts_and_history.sql'])db.exec(readFileSync(new URL(`../server/${file}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES ('employee','Staff','staff@test.invalid','employee','hash','2026-10-15')");
    db.prepare("INSERT INTO records(id,type,owner_id,payload,updated_at) VALUES ('file','cases','employee',?,'2026-10-15')").run(JSON.stringify({...caseRecord,checks:{Hotel:true,Flight:true,'Travel plan':true}}));
    const put=(id,summary,time)=>db.prepare("INSERT INTO activity VALUES (?,'employee','Staff','file','record.updated',?,?)").run(id,summary,time);
    put('first','Completed: Hotel, Travel plan · Appointment moved to 15/11/2026','2026-10-14T23:00:00Z');put('repeat','Completed: Hotel','2026-10-15T00:00:00Z');put('reopen','Reopened: Flight','2026-10-15T01:00:00Z');
    db.exec(readFileSync(new URL('../server/migrations/0008_personal_tasks_and_rank.sql',import.meta.url),'utf8'));
    assert.deepEqual(db.prepare('SELECT item FROM work_credits ORDER BY item').all().map(r=>r.item),['Hotel','Travel plan']);
    assert.equal(db.prepare("SELECT created_at FROM work_credits WHERE item='Hotel'").get().created_at,'2026-10-14T23:00:00Z');assert.equal(JSON.parse(db.prepare('SELECT payload FROM records').get().payload).checks.Flight,true);
  }finally{db.close();}
});

test('personal task writes recheck account access at commit time',async()=>{
  const env=await fixture();try {
    const cookie=await login(env),created=await call(env,'personal-tasks','POST',{title:'Original private task'},cookie),{id}=await created.json();
    const prepare=env.DB.prepare.bind(env.DB);
    env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('UPDATE personal_tasks')){const run=statement.run;statement.run=async()=>{env.DB.raw.prepare("UPDATE users SET status='disabled' WHERE id='employee'").run();return run();};}return statement;};
    assert.equal((await call(env,`personal-tasks/${id}`,'PATCH',{title:'Revoked write',_version:1},cookie)).status,409);
    const row=env.DB.raw.prepare('SELECT * FROM personal_tasks WHERE id=?').get(id);assert.equal(row.version,1);assert.equal(JSON.parse(row.payload).title,'Original private task');
  }finally{env.DB.close();}
});

test('historical file creation and handoff credits use the original actor only once',()=>{
  const db=new DatabaseSync(':memory:');try {
    for(const file of ['schema.sql','migrations/0002_accounts_and_history.sql','migrations/0008_personal_tasks_and_rank.sql'])db.exec(readFileSync(new URL(`../server/${file}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES ('employee','Staff','staff@test.invalid','employee','hash','2026-10-15')");
    for(const [id,type] of [['file','cases'],['handoff','cases'],['task','tasks']])db.prepare('INSERT INTO records(id,type,owner_id,payload,updated_at) VALUES (?, ?,\'employee\',?,\'2026-10-15\')').run(id,type,JSON.stringify(caseRecord));
    const put=(id,record,action,date)=>db.prepare("INSERT INTO activity VALUES (?,'employee','Staff',?,?,'Created',?)").run(id,record,action,date);
    put('first','file','record.created','2026-10-15T07:00:00Z');put('repeat','file','record.created','2026-10-15T08:00:00Z');put('hand','handoff','case.received','2026-10-15T09:00:00Z');put('task','task','record.created','2026-10-15T10:00:00Z');
    db.exec(readFileSync(new URL('../server/migrations/0009_rank_creation_history.sql',import.meta.url),'utf8'));
    const rows=db.prepare('SELECT * FROM work_credits ORDER BY created_at').all();assert.equal(rows.length,2);assert.equal(rows[0].created_at,'2026-10-15T07:00:00Z');assert.equal(rows[0].points,1);assert.equal(rows[1].kind,'handoff');assert.equal(rows[1].points,3);
  }finally{db.close();}
});
