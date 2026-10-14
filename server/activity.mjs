import { displayDate } from '../dist/engine.js';
export function activityStatement(DB,user,action,summary,recordId=null,guard=null) {
  const values=[crypto.randomUUID(),user.id,user.name,recordId,action,summary,new Date().toISOString()];
  if(guard) {
    const table=guard.table==='users'?'users':'records';
    return DB.prepare(`INSERT INTO activity(id,actor_id,actor_name,record_id,action,summary,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND last_mutation_id=?)`).bind(...values,guard.id,guard.mutation);
  }
  return DB.prepare('INSERT INTO activity(id,actor_id,actor_name,record_id,action,summary,created_at) VALUES (?,?,?,?,?,?,?)').bind(...values);
}
export function changeSummary(type,before,after,input) {
  const labels=[];
  if(!before.id)return `${type==='cases'?'Client case':type==='consultations'?'Consultation':'Task'} created`;
  if(input.checks){const completed=Object.keys(after.checks||{}).filter(k=>after.checks[k]&&!before.checks?.[k]),reopened=Object.keys(after.checks||{}).filter(k=>!after.checks[k]&&before.checks?.[k]);if(completed.length)labels.push(`Completed: ${completed.join(', ')}`);if(reopened.length)labels.push(`Reopened: ${reopened.join(', ')}`);}
  if(type==='consultations'&&after.lastContact!==before.lastContact&&after.lastContact)labels.push('Follow-up recorded');
  if(before.appointment!==after.appointment)labels.push(`Appointment moved to ${displayDate(after.appointment)}`);
  if(before.ownerId!==after.ownerId)labels.push('Assignment changed');
  if(before.archived!==after.archived)labels.push(after.archived?'Archived':'Restored');
  if(before.status!==after.status)labels.push(`Status changed to ${after.status}`);
  if(before.lifecycle!==after.lifecycle)labels.push(`Case status changed to ${after.lifecycle}`);
  if(before.doneOn!==after.doneOn)labels.push(after.doneOn?'Task completed':'Task reopened');
  if((before.priority||'normal')!==after.priority)labels.push(`Priority changed to ${after.priority}`);
  return labels.length?labels.join(' · '):'Details updated';
}
