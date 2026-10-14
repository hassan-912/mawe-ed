import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLISTS,readyBy,reminderStartFor,nextCaseStep,caseStatus,employeeReminders,caseMessage,addDays,daysBetween,zonedInstant,localParts,nextFollowup,validateRecord,displayDate,parseDisplayDate } from '../dist/engine.js';
import { scheduledJobs,stillRelevant } from '../server/scheduler.mjs';
const record={id:'a',name:'Ahmed',ownerId:'employee',kind:'schengen_tourism',appointment:'2026-10-18',checks:{Hotel:true,Flight:true}};
const row=(type,r)=>({id:r.id,owner_id:r.ownerId,type,payload:JSON.stringify(r),version:1});
test('file deadline is the embassy date and reminders begin exactly seven days earlier',()=>{assert.equal(readyBy(record),'2026-10-18');assert.equal(reminderStartFor(record),'2026-10-11');assert.equal(caseStatus(record,'2026-10-14'),'In progress');assert.equal(caseStatus(record,'2026-10-18'),'Due today');assert.equal(caseStatus(record,'2026-10-19'),'Overdue');assert.equal(daysBetween('2026-10-14','2026-10-18'),4);});
test('calendar offsets cross months, leap years, and new year correctly',()=>{assert.equal(addDays('2026-01-02',-4),'2025-12-29');assert.equal(addDays('2028-03-02',-4),'2028-02-27');assert.throws(()=>addDays('2026-02-30',-4));});
test('tourism, business, and USA checklists finish with submission to review',()=>{assert.equal(CHECKLISTS.schengen_tourism.length,8);assert.deepEqual(CHECKLISTS.schengen_business,[...CHECKLISTS.schengen_tourism.slice(0,-1),'Conference','Submitted to review']);assert.deepEqual(CHECKLISTS.usa,['Hotel','DS-160 application','US Travel Docs','Submitted to review']);});
test('Cairo slots start at 10:30 and 15:00 only on the start date or later',()=>{assert.equal(employeeReminders(record,new Date('2026-10-14T07:29:00Z')).length,0);assert.equal(employeeReminders(record,new Date('2026-10-14T07:30:00Z')).length,1);assert.equal(employeeReminders(record,new Date('2026-10-14T12:00:00Z')).length,2);assert.equal(employeeReminders(record,new Date('2026-10-09T12:00:00Z')).length,0);});
test('case reminders enroll automatically and disregard obsolete custom start dates',()=>{
  const r={...record,reminderStart:'2026-10-18'};
  assert.equal(reminderStartFor(r),'2026-10-11');
  assert.equal(employeeReminders(r,new Date(zonedInstant('2026-10-11','10:30'))).length,1);
  assert.throws(()=>validateRecord('cases',r),/automatically start seven days/);
  assert.equal(validateRecord('cases',{checks:{Hotel:true}},r).reminderStart,undefined);
});
test('messages show completed work, remaining work, and the next suggested step',()=>{const message=caseMessage(record,'2026-10-14');assert.doesNotMatch(message,/Still needed: Hotel/);assert.match(message,/Completed: Hotel, Flight/);assert.match(message,/Still needed: Application/);assert.match(message,/4 days left until the embassy appointment \(18\/10\/2026\)/);assert.match(message,/Next step: Translation/);});
test('completed, archived, and placeholder cases do not generate preparation messages',()=>{for(const r of [{...record,checks:Object.fromEntries(CHECKLISTS.schengen_tourism.map(x=>[x,true]))},{...record,archived:true},{...record,kind:'canada'},{...record,kind:'uk'}])assert.deepEqual(employeeReminders(r,new Date('2026-10-14T12:00:00Z')),[]);assert.equal(caseStatus({...record,kind:'canada'},'2026-10-14'),'Under processing');});
test('Cairo daylight-saving transitions keep 10:30 wall-clock time',()=>{assert.equal(zonedInstant('2026-10-14','10:30'),'2026-10-14T07:30:00.000Z');assert.equal(zonedInstant('2026-11-02','10:30'),'2026-11-02T08:30:00.000Z');assert.deepEqual(localParts(new Date(zonedInstant('2026-11-02','15:00'))),{date:'2026-11-02',time:'15:00'});});
test('48h follow-ups skip a missed backlog without sending repeated catch-up messages',()=>{const next=nextFollowup({nextReminder:'2026-10-08T07:30:00Z',intervalHours:48},new Date('2026-10-14T07:30:00Z'));assert.equal(next,'2026-10-16T07:30:00.000Z');});
test('checklist validation rejects unrecognized types, nonboolean values, and manual reminder start overrides',()=>{assert.throws(()=>validateRecord('cases',{...record,kind:'toString'}));assert.throws(()=>validateRecord('cases',{...record,checks:{Hotel:'true'}}));assert.throws(()=>validateRecord('cases',{...record,reminderStart:'2026-10-19'}));assert.throws(()=>validateRecord('consultations',{name:'Ahmed',ownerId:'manager',consultationDate:'2026-10-10',status:'active',nextReminder:'2026-10-14T10:30:00Z',intervalHours:0}));});

test('15 November appointment starts on 8 November and counts down 7, 6, 5, 4 days',()=>{
  const r={...record,appointment:'2026-11-15',checks:{}};
  assert.equal(reminderStartFor(r),'2026-11-08');
  assert.deepEqual(employeeReminders(r,new Date(zonedInstant('2026-11-07','15:00'))),[]);
  for(const [date,days] of [['2026-11-08',7],['2026-11-09',6],['2026-11-10',5],['2026-11-11',4]]) {
    assert.equal(employeeReminders(r,new Date(zonedInstant(date,'10:30'))).length,1);
    assert.match(caseMessage(r,date),new RegExp(`${days} days left until the embassy appointment`));
  }
  assert.match(caseMessage(r,'2026-11-08'),/No preparation steps completed yet/);
  assert.match(caseMessage({...r,checks:{Hotel:true,Flight:true}},'2026-11-11'),/Completed: Hotel, Flight/);
});

test('next step advances with the checklist and never suggests completed work',()=>{
  const r={...record,checks:{Hotel:true,Flight:true,Translation:true}};
  assert.equal(nextCaseStep(r),'Aman');
  const complete={...r,checks:Object.fromEntries(CHECKLISTS[r.kind].map(item=>[item,true]))};
  assert.equal(nextCaseStep(complete),null);assert.match(caseMessage(complete,'2026-11-11'),/All preparation steps are complete/);assert.doesNotMatch(caseMessage(complete),/Next step:/);
  assert.equal(nextCaseStep({...r,kind:'canada'}),null);assert.match(caseMessage({...r,kind:'canada'}),/Checklist is not defined/);
});

test('consultation on 14 October first follows up on 16 October in Cairo time',()=>{
  const nextReminder=new Date(Date.parse(zonedInstant('2026-10-14','10:30'))+48*3600000).toISOString();
  const r={id:'consult',name:'Client',ownerId:'consultant',consultationDate:'2026-10-14',intervalHours:48,nextReminder,status:'active'};
  assert.equal(scheduledJobs(row('consultations',r),new Date(zonedInstant('2026-10-16','10:25'))).length,0);
  const [job]=scheduledJobs(row('consultations',r),new Date(zonedInstant('2026-10-16','10:30')));
  assert.match(job.message,/2 days ago/);assert.equal(localParts(new Date(job.nextReminder)).date,'2026-10-18');
});
test('afternoon queue supersedes missed morning jobs',()=>{const jobs=scheduledJobs(row('cases',record),new Date('2026-10-14T12:00:00Z'));assert.equal(jobs.length,1);assert.match(jobs[0].key,/:15:00$/);const job={dedup_key:'a:case:2026-10-14:10:30',owner_id:'employee'};assert.equal(stillRelevant(job,row('cases',record),new Date('2026-10-14T12:00:00Z')),false);});
test('daily tasks reset each date, one-off tasks remain complete',()=>{const t={id:'task',ownerId:'employee',name:'Review',dueDate:'2026-10-13',time:'10:30',recurrence:'daily',doneOn:'2026-10-13'};assert.equal(scheduledJobs(row('tasks',t),new Date('2026-10-14T07:30:00Z')).length,1);assert.equal(scheduledJobs(row('tasks',{...t,recurrence:'once'}),new Date('2026-10-14T07:30:00Z')).length,0);});

test('display dates are unambiguous DD/MM/YYYY and round-trip to ISO calendar dates',()=>{
  for(const date of ['2026-11-02','2028-02-29','2026-12-31'])assert.equal(parseDisplayDate(displayDate(date)),date);
  assert.equal(displayDate('2026-10-17'),'17/10/2026');assert.equal(parseDisplayDate('02/11/2026'),'2026-11-02');
  for(const date of ['11/15/2026','31/04/2026','29/02/2026','2/11/2026','2026-11-02',''])assert.throws(()=>parseDisplayDate(date));
});
