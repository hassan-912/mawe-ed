export const PERSONAL_STATUSES = {todo:'To do',in_progress:'In progress',done:'Completed'};
export function validatePersonal(input, existing={}) {
  const task={title:'',notes:'',dueDate:'',priority:'normal',status:'todo',subtasks:[],...existing,...input};
  if(typeof task.title!=='string'||!task.title.trim()||task.title.length>160)throw new Error('Enter a task title of up to 160 characters.');
  task.title=task.title.trim();
  if(typeof task.notes!=='string'||task.notes.length>3000)throw new Error('Notes can contain up to 3,000 characters.');
  if(!['normal','high','urgent'].includes(task.priority))throw new Error('Choose a valid priority.');
  if(!Object.hasOwn(PERSONAL_STATUSES,task.status))throw new Error('Choose a valid task status.');
  if(typeof task.dueDate!=='string'||(task.dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)||!Number.isFinite(Date.parse(task.dueDate))||new Date(task.dueDate).toISOString().slice(0,10)!==task.dueDate)))throw new Error('Enter a valid due date.');
  if(!Array.isArray(task.subtasks)||task.subtasks.length>20||task.subtasks.some(s=>!s||typeof s.title!=='string'||!s.title.trim()||s.title.length>160||typeof s.done!=='boolean'))throw new Error('Add up to 20 steps, each with a title of up to 160 characters.');
  task.subtasks=task.subtasks.map(s=>({title:s.title.trim(),done:s.done}));
  return {title:task.title,notes:task.notes,dueDate:task.dueDate,priority:task.priority,status:task.status,subtasks:task.subtasks};
}
