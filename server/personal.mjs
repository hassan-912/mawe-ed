import { validatePersonal } from '../dist/personal.js';
import { HttpError,json,readBody,onlyFields,validated } from './http.mjs';

export const decodePersonal=row=>({...JSON.parse(row.payload),id:row.id,version:row.version,updatedAt:row.updated_at});
export async function personalRoute(request,env,user) {
  const match=new URL(request.url).pathname.match(/^\/api\/personal-tasks(?:\/([^/]+))?$/);
  if(!match)return null;
  const id=match[1],method=request.method;
  if(method==='GET'&&!id){const rows=await env.DB.prepare('SELECT * FROM personal_tasks WHERE user_id=? ORDER BY updated_at DESC').bind(user.id).all();return json({tasks:rows.results.map(decodePersonal)});}
  if(!((method==='POST'&&!id)||(['PATCH','DELETE'].includes(method)&&id)))throw new HttpError('Endpoint not found.',404);
  // Even administrators can only read and change their own personal list.
  const row=id?await env.DB.prepare('SELECT * FROM personal_tasks WHERE id=? AND user_id=?').bind(id,user.id).first():null;
  if(id&&!row)throw new HttpError('Personal task not found.',404);
  const input=await readBody(request);
  onlyFields(input,method==='DELETE'?['_version']:['title','notes','dueDate','priority','status','subtasks','_version']);
  if(row&&input._version!==row.version)throw new HttpError('This task changed in another session. Reload and try again.',409);
  const accountGuard="EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND must_change_password=0 AND auth_version=?)";
  let statement,taskId=id||crypto.randomUUID();
  if(method==='DELETE')statement=env.DB.prepare(`DELETE FROM personal_tasks WHERE id=? AND user_id=? AND version=? AND ${accountGuard}`).bind(id,user.id,row.version,user.id,user.auth_version);
  else {
    const {_version,...patch}=input,task=validated(()=>validatePersonal(patch,row?JSON.parse(row.payload):{})),payload=JSON.stringify(task),now=new Date().toISOString();
    statement=row
      ?env.DB.prepare(`UPDATE personal_tasks SET payload=?,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=? AND ${accountGuard}`).bind(payload,now,id,user.id,row.version,user.id,user.auth_version)
      :env.DB.prepare(`INSERT INTO personal_tasks(id,user_id,payload,updated_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM personal_tasks WHERE user_id=?)<1000 AND ${accountGuard}`).bind(taskId,user.id,payload,now,user.id,user.id,user.auth_version);
  }
  const result=await statement.run();
  if(!result.meta.changes)throw new HttpError('Your account or task changed, or your list has reached 1,000 tasks. Reload and try again.',409);
  return json({id:taskId},row?200:201);
}
