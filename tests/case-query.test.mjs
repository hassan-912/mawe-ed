import test from 'node:test';
import assert from 'node:assert/strict';
import { caseEnteredDate,currentWeek,enteredThisWeek,matchesCaseSearch,caseOutcome } from '../dist/case-query.js';
import { outcomeStats,renderOutcomes } from '../dist/outcomes.js';
import { fixture,call,login } from './security-fixture.mjs';

test('week filter uses the source entry date, never the appointment or import date',()=>{
  const now=new Date('2026-10-15T09:00:00Z'),r={sourceImport:{importedAt:now.toISOString()},appointment:'2026-10-15',sheetDetails:[{sourceLabel:'Timestamp',rawValue:'2026-08-01T13:00:00'}]};
  assert.deepEqual(currentWeek(now),{start:'2026-10-12',end:'2026-10-19',today:'2026-10-15'});
  assert.equal(enteredThisWeek(r,now),false);
  r.sheetDetails[0].rawValue='2026-10-12T00:00:00';assert.equal(enteredThisWeek(r,now),true);
  r.sheetDetails[0].rawValue='2026-10-11T23:59:59';assert.equal(enteredThisWeek(r,now),false);
  r.sheetDetails[0].rawValue='2026-10-16T00:00:00';assert.equal(enteredThisWeek(r,now),false);
  assert.equal(caseEnteredDate({createdAt:'2026-10-11T22:30:00Z'}),'2026-10-12');
  assert.equal(enteredThisWeek({appointment:'2026-10-15'},now),false);
});
test('search matches all requested identifiers and source values with combined terms',()=>{
  const r={name:'Synthetic Client',creatorEmail:'submitter@example.test',sheetDetails:[{value:'10597',rawValue:'10597'},{value:'Reviewer Name'}]},owner={username:'Salma Ayman',email:'holder@example.test'};
  for(const q of ['CLIENT','submitter@example.test','salma ayman','holder@example.test','10597','reviewer 10597'])assert.equal(matchesCaseSearch(r,q,owner),true,q);
  assert.equal(matchesCaseSearch(r,'someone else',owner),false);
});
test('outcome rates exclude undecided and cancelled files and handle source spelling',()=>{
  const source=v=>({sheetDetails:[{sourceLabel:'Case Staus',rawValue:v}]});
  const rows=[source('Accpet '),source('Reject'),source('Reject'),source('Cancel'),source(null),source('App. Done')],s=outcomeStats(rows);
  assert.equal(s.decided,3);assert.ok(Math.abs(s.acceptanceRate-100/3)<1e-10);assert.ok(Math.abs(s.rejectionRate-200/3)<1e-10);assert.equal(s.pending,2);assert.equal(s.cancelled,1);
  assert.equal(outcomeStats([]).acceptanceRate,null);assert.equal(caseOutcome({...source('Reject'),outcome:'accepted'}),'accepted');
  const html=renderOutcomes({cases:[{...source('Accpet'),name:'Only my client'}],escape:String});assert.match(html,/100.0%/);assert.match(html,/1 cases in this view/);
});
test('server captures immutable creation dates and rejects caller spoofing',async()=>{
  const env=await fixture();try{const cookie=await login(env),input={name:'Synthetic file',ownerId:'employee',kind:'schengen_tourism',appointment:'2026-11-15',checks:{}};
    const response=await call(env,'cases','POST',input,cookie);assert.equal(response.status,201);const {id}=await response.json();
    let workspace=await (await call(env,'workspace','GET',null,cookie)).json(),r=workspace.cases.find(r=>r.id===id);assert.ok(Number.isFinite(Date.parse(r.createdAt)));
    const created=r.createdAt;assert.equal((await call(env,`cases/${id}`,'PATCH',{notes:'Changed',_version:r.version},cookie)).status,200);
    workspace=await (await call(env,'workspace','GET',null,cookie)).json();assert.equal(workspace.cases.find(r=>r.id===id).createdAt,created);
    assert.equal((await call(env,'cases','POST',{...input,createdAt:'2026-01-01'},cookie)).status,400);
  }finally{env.DB.close();}
});
