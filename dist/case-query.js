import { localParts,validDate,addDays,displayDate } from './engine.js';

export function caseEnteredDate(record) {
  const source=record.sourceImport&&record.sheetDetails?.find(d=>d.sourceLabel==='Timestamp')?.rawValue;
  if(source){const date=String(source).slice(0,10);return validDate(date)?date:null;}
  if(!record.createdAt)return null;
  const instant=new Date(record.createdAt);
  return Number.isFinite(instant.getTime())?localParts(instant).date:null;
}
export function currentWeek(now=new Date()) {
  const date=localParts(now).date,weekday=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7,start=addDays(date,-weekday);
  return {start,end:addDays(start,7),today:date};
}
export function enteredThisWeek(record,now=new Date()) {
  const date=caseEnteredDate(record),week=currentWeek(now);
  return !!date&&date>=week.start&&date<week.end&&date<=week.today;
}
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function matchesCaseSearch(record,query,owner={}) {
  const tokens=normalize(query).split(' ').filter(Boolean);if(!tokens.length)return true;
  const fields=[record.name,record.country,record.destination,record.visaType,record.fileHolder,record.creatorName,record.creatorEmail,record.phone,record.notes,record.sourceImport?.odooId,owner?.name,owner?.username,owner?.email,record.appointment,validDate(record.appointment)?displayDate(record.appointment):'',...(record.sheetDetails||[]).flatMap(d=>[d.value,d.rawValue])];
  const text=normalize(fields.filter(v=>v!=null).join(' '));return tokens.every(token=>text.includes(token));
}
export function caseOutcome(record) {
  const raw=record.outcome??record.sheetDetails?.find(d=>d.sourceLabel==='Case Staus'||d.sourceLabel==='Case Status')?.rawValue;
  const value=normalize(raw);
  if(['accpet','accept','accepted'].includes(value))return 'accepted';
  if(['reject','rejected'].includes(value))return 'rejected';
  if(['cancel','cancelled','canceled'].includes(value))return 'cancelled';
  return 'pending';
}
