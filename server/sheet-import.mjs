import { CHECKLISTS,validDate,displayDate,validateRecord,localParts } from '../dist/engine.js';
import { indexFields } from './worker.mjs';
import { sha256 } from './auth.mjs';

export const holderKey=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
export function sheetDate(value) {
  const text=String(value??'').trim(),iso=text.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  if(iso&&validDate(iso[1]))return iso[1];
  const match=text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
  if(!match)return null;
  const date=`${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  return validDate(date)?date:null;
}
const SCHENGEN=new Set(['germany','spain','france','italy','netherlands','belgium','norwy','norway','greece','czechs','czech republic','finland','sweden','portugal','austria','slovakia','switzerland']);
export function sheetKind(country,type) {
  const key=holderKey(country);
  if(key==='usa')return 'usa';if(key==='canada')return 'canada';if(key==='uk')return 'uk';
  return SCHENGEN.has(key)?holderKey(type)==='business'?'schengen_business':'schengen_tourism':'other';
}
export function sheetLifecycle(visaStatus,outcome) {
  const status=holderKey(visaStatus),result=holderKey(outcome);
  if(result==='cancel')return 'cancelled';
  if(['accpet','accept','accepted','reject','rejected'].includes(result)||status==='app. done')return 'completed';
  return status==='hold'?'on_hold':'active';
}
const friendlyLabels={'Odoo Id':'Odoo ID','Client name':'Client name','Client Phone Num 📞':'Client phone','App. Date':'Appointment (source)','App. Month':'Appointment month','Rivison':'Reviewer','Visa Stutas':'Visa status','Case Staus':'Case outcome','Email address':'Submitting employee email','PLAN':'Plan'};
export function displaySheetCell(label,value) {
  if(value==null||String(value).trim()==='')return 'Not provided';
  const text=String(value),date=sheetDate(value);
  if(label==='App. Month'&&date)return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
  if(/^\d{4}-\d{2}-\d{2}T/.test(text)&&date)return label==='Timestamp'?`${displayDate(date)} ${text.slice(11,19)}`:displayDate(date);
  return text;
}

export async function prepareSheetCases(sourceRows,{sourceId,sheetTitle,cutoff,people,holderAccounts,now=new Date()}) {
  if(!validDate(cutoff)||!sourceId||!sheetTitle||!Array.isArray(sourceRows)||!sourceRows.length)throw new Error('A source, worksheet, and valid cutoff date are required.');
  const headers=sourceRows[0].values.map(v=>String(v||'').trim());
  const required=['Timestamp','Email address','Odoo Id','Client name','Client Phone Num 📞','Country','Visa Type','File Holder','Review submission date','App. Date','App. Month','Visa Stutas','Case Staus'];
  for(const label of required)if(headers.indexOf(label)<0||headers.indexOf(label)!==headers.lastIndexOf(label))throw new Error(`Missing or duplicate column: ${label}`);
  const get=(row,label)=>row.values[headers.indexOf(label)]??null;
  const prepared=[],asOf=localParts(now).date,seenRows=new Set();
  for(const row of sourceRows.slice(1)) {
    const month=sheetDate(get(row,'App. Month'));
    if(!month||month.slice(0,7)<cutoff.slice(0,7))continue;
    if(!Number.isInteger(row.row)||row.row<2||seenRows.has(row.row))throw new Error('Source row numbers must be distinct.');seenRows.add(row.row);
    const holder=String(get(row,'File Holder')||'').trim(),ownerId=holderAccounts[holderKey(holder)];
    const owner=people.find(p=>p.id===ownerId&&p.role==='employee'&&p.staffType==='process'&&p.status==='active');
    if(!owner)throw new Error(`No active Process account for file holder on source row ${row.row}.`);
    const email=String(get(row,'Email address')||'').trim().toLowerCase(),creator=people.find(p=>p.email.toLowerCase()===email);
    const country=String(get(row,'Country')||'').trim(),visaType=String(get(row,'Visa Type')||'').trim(),kind=sheetKind(country,visaType);
    const appointment=sheetDate(get(row,'App. Date')),reviewDate=sheetDate(get(row,'Review submission date'));
    const sourceHash=await sha256(JSON.stringify(row.values)),id=`sheet_${(await sha256(`${sourceId}:${row.row}`)).slice(0,40)}`;
    const sourceImport={sourceId,sheetTitle,sheetRow:row.row,sourceHash,cutoff,odooId:String(get(row,'Odoo Id')),importedAt:now.toISOString()};
    const sheetDetails=headers.map((label,index)=>({label:friendlyLabels[label]||label,value:displaySheetCell(label,row.values[index]),sourceLabel:label,rawValue:row.values[index]??null}));
    const record=validateRecord('cases',{
      name:String(get(row,'Client name')||'').trim(),ownerId,kind,appointment,
      checks:Object.fromEntries(CHECKLISTS[kind].map(item=>[item,item==='Submitted to review'&&!!reviewDate&&reviewDate<=asOf])),
      phone:String(get(row,'Client Phone Num 📞')??'').trim(),notes:'',priority:'normal',archived:false,
      country,visaType,fileHolder:holder,lifecycle:sheetLifecycle(get(row,'Visa Stutas'),get(row,'Case Staus')),
      sheetDetails,sourceImport
    },{sourceImport});
    prepared.push({id,record,index:indexFields('cases',record),creatorId:creator?.id||null,creatorName:creator?.name||email,creatorEmail:email,sourceHash,sourceRow:row.row});
  }
  return prepared;
}

export function importRowStatements(DB,actor,prepared,now=new Date()) {
  if(actor.role!=='manager'||actor.status!=='active')throw new Error('An active administrator is required for a sheet import.');
  const {id,record,index,creatorId,creatorName,creatorEmail,sourceHash,sourceRow}=prepared,sourceId=record.sourceImport.sourceId,stamp=now.toISOString();
  // Import is separate from staff work: no historical bulk-import rank points.
  return [
    DB.prepare("INSERT OR IGNORE INTO records(id,type,owner_id,payload,active,next_due,start_date,updated_at,last_mutation_id,creator_id,creator_name,creator_email,created_at) VALUES (?,'cases',?,?,?,?,?,?,?,?,?,?,?)").bind(id,record.ownerId,JSON.stringify(record),index.active,index.nextDue,index.startDate,stamp,sourceHash,creatorId,creatorName,creatorEmail,record.sheetDetails.find(d=>d.sourceLabel==='Timestamp')?.rawValue||null),
    DB.prepare("INSERT OR IGNORE INTO sheet_import_rows(source_id,sheet_row,source_hash,record_id,imported_at) SELECT ?,?,?,?,? FROM records WHERE id=? AND last_mutation_id=?").bind(sourceId,sourceRow,sourceHash,id,stamp,id,sourceHash),
    DB.prepare("INSERT OR IGNORE INTO activity(id,actor_id,actor_name,record_id,action,summary,created_at) SELECT ?,?,?,?,'record.imported',?,? FROM sheet_import_rows WHERE source_id=? AND sheet_row=? AND source_hash=? AND record_id=?")
      .bind(`import_${id}`,actor.id,actor.name,id,`Imported from ${record.sourceImport.sheetTitle}, row ${sourceRow}`,stamp,sourceId,sourceRow,sourceHash,id)
  ];
}

export function assertImportMatches(prepared,existingRows) {
  const existing=new Map(existingRows.map(row=>[`${row.source_id}:${row.sheet_row}`,row]));
  for(const p of prepared) {
    const previous=existing.get(`${p.record.sourceImport.sourceId}:${p.sourceRow}`);
    if(previous&&(previous.source_hash!==p.sourceHash||previous.record_id!==p.id))throw new Error(`Source row ${p.sourceRow} changed since the import. Reconcile it before importing again.`);
  }
}
