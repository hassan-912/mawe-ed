import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,call,login,PASSWORD } from './security-fixture.mjs';
import { prepareSheetCases,importRowStatements,assertImportMatches,sheetDate,displaySheetCell,sheetLifecycle } from '../server/sheet-import.mjs';
import { caseStatus,employeeReminders,buildPriorities,caseMessage,zonedInstant } from '../dist/engine.js';
import { scheduledJobs,stillRelevant } from '../server/scheduler.mjs';
import { createCaseViews } from '../dist/case-view.js';

const headers=['Timestamp','Email address','Odoo Id','Client name','Client Phone Num 📞','Contract Date','Process Start Date','Country','Visa Category','Visa Type','Consultant','Follow Up Agent','File Holder','PLAN','Review submission date','Rivison','App. Date','App. Month','Visa Stutas','Case Staus'];
const source=(changes={},row=2)=>({row,values:headers.map(h=>({Timestamp:'2026-04-01T10:00:00','Email address':'employee@test.invalid','Odoo Id':'same-id','Client name':'Synthetic Client','Client Phone Num 📞':'01000000000','Contract Date':'2026-07-01T00:00:00','Process Start Date':'2026-07-20T00:00:00',Country:'Spain','Visa Category':'Schengen','Visa Type':'Tourism',Consultant:'Consultant','Follow Up Agent':'Agent','File Holder':'Salma Ayman',PLAN:'A','Review submission date':null,Rivison:'Reviewer','App. Date':'2026-08-15T00:00:00','App. Month':'2026-08-08T00:00:00','Visa Stutas':'App. Taken','Case Staus':null,...changes})[h])});
const people=[{id:'manager',name:'Admin',email:'manager@test.invalid',role:'manager',staffType:'admin',status:'active'},{id:'employee',name:'Salma Ayman',email:'employee@test.invalid',role:'employee',staffType:'process',status:'active'},{id:'other',name:'Noha Amer',email:'other@test.invalid',role:'employee',staffType:'process',status:'active'}];
const options={sourceId:'synthetic-sheet:gid',sheetTitle:'Synthetic / Data',cutoff:'2026-08-01',people,holderAccounts:{'salma ayman':'employee','noha amer':'other'},now:new Date(zonedInstant('2026-10-15','10:30'))};
const prepare=rows=>prepareSheetCases([{row:1,values:headers},...rows],options);

test('import uses appointment month, retains duplicate Odoo IDs, and preserves holder and submitter separately',async()=>{
  const rows=[source(),source({'Client name':'Second client','File Holder':'noha Amer','App. Date':'05/11/2026\n10:30 am','App. Month':'2026-11-11T00:00:00'},3),source({'App. Month':'2026-07-07T00:00:00','Timestamp':'2026-10-01T10:00:00'},4)];
  const result=await prepare(rows);assert.equal(result.length,2);assert.notEqual(result[0].id,result[1].id);assert.equal(result[0].record.sourceImport.odooId,result[1].record.sourceImport.odooId);
  assert.equal(result[1].record.ownerId,'other');assert.equal(result[1].record.fileHolder,'noha Amer');assert.equal(result[1].creatorId,'employee');assert.equal(result[1].creatorEmail,'employee@test.invalid');assert.equal(result[1].record.appointment,'2026-11-05');
  assert.equal(result[1].record.sheetDetails.length,20);assert.equal(result[1].record.sheetDetails.find(d=>d.sourceLabel==='App. Date').rawValue,'05/11/2026\n10:30 am');assert.equal(result[0].record.sheetDetails.find(d=>d.sourceLabel==='App. Month').value,'August 2026');
});

test('exact missing or unsupported dates and destinations remain truthful and do not schedule preparation reminders',async()=>{
  const result=await prepare([source({'App. Date':null}),source({'App. Date':'معاد الاب'},3),source({Country:'Brazil'},4)]);
  assert.equal(result[0].record.appointment,null);assert.equal(result[1].record.appointment,null);assert.equal(result[2].record.kind,'other');
  const now=options.now;
  for(const p of result){assert.equal(p.index.active,0);assert.deepEqual(employeeReminders(p.record,now),[]);assert.deepEqual(scheduledJobs({id:p.id,type:'cases',owner_id:p.record.ownerId,payload:JSON.stringify(p.record)},now),[]);}
  assert.equal(caseStatus(result[0].record),'Appointment needed');assert.match(caseMessage(result[0].record),/Appointment date not set/);assert.deepEqual(buildPriorities({cases:result.map(p=>p.record)},now),[]);
  assert.equal(stillRelevant({owner_id:'employee'}, {type:'cases',owner_id:'employee',payload:JSON.stringify(result[0].record)},now),false);
});

test('source lifecycle and review dates are preserved without inventing preparation completion',async()=>{
  const result=await prepare([source({'Visa Stutas':'App. Done ','Review submission date':'2026-10-12T00:00:00'}),source({'Case Staus':'Cancel '},3),source({'Visa Stutas':'Hold'},4),source({'Review submission date':'2026-10-22T00:00:00'},5)]);
  assert.equal(sheetLifecycle('App. Taken','Accpet '),'completed');
  for(const p of result.slice(0,3)){assert.equal(p.index.active,0);assert.deepEqual(employeeReminders(p.record,options.now),[]);}
  assert.equal(result[0].record.lifecycle,'completed');assert.equal(result[1].record.lifecycle,'cancelled');assert.equal(result[2].record.lifecycle,'on_hold');
  assert.equal(result[0].record.checks['Submitted to review'],true);assert.equal(result[0].record.checks.Hotel,false);assert.equal(result[3].record.checks['Submitted to review'],false);
  assert.equal(result[3].record.sheetDetails.find(d=>d.sourceLabel==='Review submission date').rawValue,'2026-10-22T00:00:00');
});

test('import is repeatable without duplicates or overwriting live work, and detects changed source rows',async()=>{
  const env=await fixture();try {
    const prepared=await prepare([source()]);const actor=people[0];
    for(let i=0;i<2;i++)await env.DB.batch(importRowStatements(env.DB,actor,prepared[0],options.now));
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM records').get().n,1);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity').get().n,1);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM work_credits').get().n,0);
    const cookie=await login(env);assert.equal((await call(env,`cases/${prepared[0].id}`,'PATCH',{checks:{Hotel:true},_version:1},cookie)).status,200);
    await env.DB.batch(importRowStatements(env.DB,actor,prepared[0],options.now));
    assert.equal(JSON.parse(env.DB.raw.prepare('SELECT payload FROM records').get().payload).checks.Hotel,true);
    const existing=env.DB.raw.prepare('SELECT * FROM sheet_import_rows').all();assertImportMatches(prepared,existing);
    const changed=await prepare([source({'Country':'France'})]);assert.throws(()=>assertImportMatches(changed,existing),/changed since/);
    assert.throws(()=>importRowStatements(env.DB,people[1],prepared[0]),/administrator/);
  }finally{env.DB.close();}
});

test('each employee sees only assigned imported cases, while admin sees all and can trace import authorship',async()=>{
  const env=await fixture();try {
    const prepared=await prepare([source(),source({'File Holder':'Noha Amer','Email address':'employee@test.invalid','App. Date':null},3)]);
    for(const p of prepared)await env.DB.batch(importRowStatements(env.DB,people[0],p,options.now));
    const employee=await login(env),other=await login(env,'other'),manager=await login(env,'manager');
    for(const [cookie,id] of [[employee,prepared[0].id],[other,prepared[1].id]]){const ws=await(await call(env,'workspace','GET',null,cookie)).json();assert.deepEqual(ws.cases.map(r=>r.id),[id]);assert.equal(ws.activity[0].actorId,'manager');}
    assert.equal((await(await call(env,'workspace','GET',null,manager)).json()).cases.length,2);
    assert.equal((await call(env,`cases/${prepared[1].id}`,'PATCH',{notes:'Not mine',_version:1},employee)).status,403);
    assert.equal((await call(env,`cases/${prepared[1].id}`,'PATCH',{notes:'Own file, no appointment yet',_version:1},other)).status,200);
    assert.equal((await call(env,`cases/${prepared[1].id}`,'PATCH',{appointment:'2026-11-15',_version:2},other)).status,200);
    const row=env.DB.raw.prepare('SELECT * FROM records WHERE id=?').get(prepared[1].id);assert.equal(row.start_date,'2026-11-08');assert.equal(row.active,1);assert.equal(JSON.parse(row.payload).sheetDetails.length,20);
    assert.equal((await call(env,'cases','POST',{name:'Manual',ownerId:'employee',kind:'usa',appointment:null},employee)).status,400);
  }finally{env.DB.close();}
});

test('file-holder usernames support spaces and case-insensitive login while forced password change protects initial accounts',async()=>{
  const env=await fixture();try {
    env.DB.raw.prepare("UPDATE users SET username='Salma Ayman',name='Salma Ayman',must_change_password=1 WHERE id='employee'").run();
    const response=await call(env,'login','POST',{email:'  SALMA   AYMAN  ',password:PASSWORD});assert.equal(response.status,200);const cookie=response.headers.get('Set-Cookie').split(';')[0];
    const ws=await(await call(env,'workspace','GET',null,cookie)).json();assert.equal(ws.user.mustChangePassword,true);assert.equal(ws.user.username,'Salma Ayman');assert.deepEqual(ws.cases,[]);
    assert.equal((await call(env,'cases','POST',{},cookie)).status,403);
  }finally{env.DB.close();}
});

test('imported cards show every source field safely and keep large lists paginated',()=>{
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=Array.from({length:21},(_,i)=>({id:String(i),name:'Synthetic',kind:'usa',ownerId:'employee',appointment:null,lifecycle:'active',checks:{},sourceImport:{odooId:String(i)},fileHolder:'Holder',sheetDetails:[{label:'Source field',value:'<script>unsafe()</script>'}]}));
  const ui=createCaseViews({escape:e,icon:()=>'',dateLabel:()=> 'Not set',person:()=>({name:'Holder'}),records:()=>rows,fileHolderName:r=>r.fileHolder,caseIsUrgent:()=>false,initials:()=>'',state:()=>({portal:'employee',filter:'all',query:'',page:0}),setPage:()=>{},consultCard:()=>''});
  const html=ui.recordPanel(false);assert.match(html,/Showing 1–20 of 21/);assert.equal((html.match(/class="case-card /g)||[]).length,20);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(ui.recordPanel(true),/Your client cases/);
});

test('date extraction preserves actual dates and source text instead of using month placeholders',()=>{
  assert.equal(sheetDate('12/11/2026 معاد الام و الابن'),'2026-11-12');assert.equal(sheetDate('2027-12-09T00:00:00'),'2027-12-09');assert.equal(sheetDate('31/02/2026'),null);assert.equal(sheetDate('معاد الاب'),null);
  assert.equal(displaySheetCell('Timestamp','2026-08-01T15:32:11.000000'),'01/08/2026 15:32:11');assert.equal(displaySheetCell('App. Date','25/10/2026\n09:00 am'),'25/10/2026\n09:00 am');
});
