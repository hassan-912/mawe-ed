export const ZONE = 'Africa/Cairo';
export const CHECKLISTS = Object.freeze({
  schengen_tourism: ['Hotel', 'Flight', 'Application', 'Aman', 'Travel plan', 'Motivation letter', 'Translation'],
  schengen_business: ['Hotel', 'Flight', 'Application', 'Aman', 'Travel plan', 'Motivation letter', 'Translation', 'Conference'],
  usa: ['Hotel', 'DS-160 application', 'US Travel Docs'],
  canada: [], uk: []
});
export const DESTINATIONS = { schengen_tourism: 'Schengen', schengen_business: 'Schengen', usa: 'USA', canada: 'Canada', uk: 'UK' };
export function localParts(now = new Date(), zone = ZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export const today = () => localParts().date;
export function validDate(value) {
  return typeof value === 'string' && /^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function addDays(date, amount) {
  if (!validDate(date)) throw new Error('Enter a valid date.');
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10);
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
export const readyBy = record => addDays(record.appointment, -4);
export const reminderStartFor = record => record.reminderStart || addDays(readyBy(record), -4);
export const pendingItems = record => (CHECKLISTS[record.kind] || []).filter(item => !record.checks?.[item]);
export const isPlaceholder = record => ['canada', 'uk'].includes(record.kind);
export function caseStatus(record, date = today()) {
  if (record.archived) return 'Archived';
  if (isPlaceholder(record)) return 'Under processing';
  if (!pendingItems(record).length) return 'Ready';
  const days = daysBetween(date, readyBy(record));
  return days < 0 ? 'Overdue' : days === 0 ? 'Due today' : days <= 2 ? 'Due soon' : 'In progress';
}
// Convert a wall-clock date in Cairo to an instant, recalculating the offset for DST.
export function zonedInstant(date, time, zone = ZONE) {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter a valid date and time.');
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(guess), zone);
    const observed = Date.parse(`${p.date}T${p.time}:00Z`);
    guess += target - observed;
  }
  const actual = localParts(new Date(guess), zone);
  if (actual.date !== date || actual.time !== time) throw new Error('This time does not exist during the daylight-saving change. Choose another time.');
  return new Date(guess).toISOString();
}
export function nextFollowup(record, now = new Date()) {
  const base = Date.parse(record.nextReminder);
  const step = record.intervalHours * 3600000;
  return new Date(base + Math.max(1, Math.floor((now.getTime() - base) / step) + 1) * step).toISOString();
}
export function employeeReminders(record, now = new Date()) {
  if (record.archived || isPlaceholder(record) || !pendingItems(record).length) return [];
  const { date, time } = localParts(now);
  const start = reminderStartFor(record);
  if (date < start) return [];
  return ['10:30', '15:00'].filter(slot => slot <= time).map(slot => ({ key: `${record.id}:${date}:${slot}`, slot, date }));
}
export function caseMessage(record, date = today()) {
  const remaining = daysBetween(date, readyBy(record));
  const timing = remaining > 0 ? `${remaining} day${remaining === 1 ? '' : 's'} left until the preparation deadline` : remaining === 0 ? 'Preparation is due today' : `Preparation is ${Math.abs(remaining)} day${remaining === -1 ? '' : 's'} overdue`;
  const embassyDays = daysBetween(date, record.appointment);
  const embassyTiming = embassyDays >= 0 ? `${embassyDays} day${embassyDays === 1 ? '' : 's'} left` : `${Math.abs(embassyDays)} day${embassyDays === -1 ? '' : 's'} ago`;
  return `Maw‘id • ${record.name}\nStill needed: ${pendingItems(record).join(', ')}.\n${timing} (${readyBy(record)}).\nEmbassy appointment: ${record.appointment} (${embassyTiming}).`;
}
export function validateRecord(type, input, existing = {}) {
  const r = { ...existing, ...input };
  const string = (key, max = 160) => { if (typeof r[key] !== 'string' || !r[key].trim() || r[key].length > max) throw new Error(`Enter a valid ${key}.`); r[key] = r[key].trim(); };
  string('name'); string('ownerId', 80);
  r.priority = r.priority ?? 'normal';
  if (!['normal','high','urgent'].includes(r.priority)) throw new Error('Choose a valid priority.');
  if (r.notes != null && (typeof r.notes !== 'string' || r.notes.length > 3000)) throw new Error('Notes must be under 3,000 characters.');
  if (r.phone != null && (typeof r.phone !== 'string' || r.phone.length > 40)) throw new Error('Enter a valid phone number.');
  if (r.archived != null && typeof r.archived !== 'boolean') throw new Error('Invalid archive state.');
  if (type === 'cases') {
    if (!Object.hasOwn(CHECKLISTS,r.kind) || !validDate(r.appointment)) throw new Error('Choose a destination and valid appointment date.');
    if (r.reminderStart != null && typeof r.reminderStart !== 'string') throw new Error('Enter a valid reminder start.');
    if (r.reminderStart && (!validDate(r.reminderStart) || r.reminderStart > readyBy(r))) throw new Error('Reminders must start on or before the preparation deadline.');
    if (r.checks != null && (typeof r.checks !== 'object' || Array.isArray(r.checks))) throw new Error('Invalid checklist.');
    const allowed = CHECKLISTS[r.kind];
    r.checks = Object.fromEntries(allowed.map(item => { const value = r.checks?.[item] ?? false; if (typeof value !== 'boolean') throw new Error('Checklist values must be true or false.'); return [item, value]; }));
  } else if (type === 'consultations') {
    if (!validDate(r.consultationDate)) throw new Error('Enter a valid consultation date.');
    if (!Number.isInteger(r.intervalHours) || r.intervalHours < 1 || r.intervalHours > 720) throw new Error('The reminder interval must be 1–720 hours.');
    if (!['active', 'converted', 'closed'].includes(r.status)) throw new Error('Choose a valid follow-up status.');
    if (typeof r.nextReminder !== 'string' || !Number.isFinite(Date.parse(r.nextReminder))) throw new Error('Enter a valid next reminder.');
    r.nextReminder = new Date(r.nextReminder).toISOString();
    if (r.destination != null && (typeof r.destination !== 'string' || r.destination.length > 160)) throw new Error('Enter a valid destination.');
  } else if (type === 'tasks') {
    if (!['daily', 'once'].includes(r.recurrence) || !validDate(r.dueDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) throw new Error('Choose a valid task schedule.');
    if (r.doneOn != null && typeof r.doneOn !== 'string') throw new Error('Invalid completion date.');
    if (r.doneOn && !validDate(r.doneOn)) throw new Error('Invalid completion date.');
    r.doneOn = r.doneOn || '';
  } else throw new Error('Unknown record type.');
  return r;
}
export function buildPriorities(workspace,now=new Date()) {
  const {date,time}=localParts(now),items=[];
  const priorityWeight={urgent:0,high:1,normal:2};
  for(const r of workspace.cases||[]) {
    if(r.archived||isPlaceholder(r)||!pendingItems(r).length)continue;
    const due=readyBy(r),days=daysBetween(date,due);
    if(days>7&&r.priority!=='urgent')continue;
    items.push({type:'cases',id:r.id,name:r.name,priority:r.priority||'normal',dueDate:due,rank:days<0?0:days===0?1:3,description:days<0?`Preparation ${-days} day(s) overdue`:days===0?'Preparation due today':`Prepare within ${days} day(s)`,missing:pendingItems(r)});
  }
  for(const r of workspace.consultations||[]) {
    if(r.archived||r.status!=='active')continue;
    const due=localParts(new Date(r.nextReminder)).date,isDue=Date.parse(r.nextReminder)<=now.getTime();
    if(!isDue&&due!==date&&r.priority!=='urgent')continue;
    items.push({type:'consultations',id:r.id,name:r.name,priority:r.priority||'normal',dueDate:due,rank:isDue?1:3,description:isDue?'Follow-up due':'Follow-up scheduled today',missing:[]});
  }
  for(const r of workspace.tasks||[]) {
    if(r.archived||r.dueDate>date||(r.recurrence==='daily'?r.doneOn===date:!!r.doneOn))continue;
    const due=r.recurrence==='daily'?date:r.dueDate;
    items.push({type:'tasks',id:r.id,name:r.name,priority:r.priority||'normal',dueDate:due,rank:due<date?0:r.time<=time?1:2,description:due<date?'Task overdue':`Today at ${r.time}`,missing:[]});
  }
  return items.sort((a,b)=>a.rank-b.rank||priorityWeight[a.priority]-priorityWeight[b.priority]||a.dueDate.localeCompare(b.dueDate)||a.name.localeCompare(b.name));
}
