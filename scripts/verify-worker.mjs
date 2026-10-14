import { execFileSync } from 'node:child_process';
import { writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashPassword } from '../server/auth.mjs';
import assert from 'node:assert/strict';
const wrangler=path.resolve('node_modules/wrangler/bin/wrangler.js');
const origin=process.argv[2]||'http://127.0.0.1:8787';
const target=new URL(origin);if(!['127.0.0.1','localhost'].includes(target.hostname))throw new Error('Verification runs against local development only.');
const scratch=await mkdtemp(path.join(tmpdir(),'mawid-local-verification-'));
const execute=file=>execFileSync(process.execPath,[wrangler,'d1','execute','mawid','--local','--file',file],{stdio:'pipe'});
const request=async(endpoint,method='GET',input,cookie)=>fetch(`${origin}/api/${endpoint}`,{method,headers:{'Content-Type':'application/json',...(method!=='GET'?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})},...(input?{body:JSON.stringify(input)}:{})});
try {
  execute('server/schema.sql');
  const sql=path.join(scratch,'seed.sql'),hash=await hashPassword('Local-test-password-123');
  await writeFile(sql,`DELETE FROM records WHERE owner_id='local-verification'; DELETE FROM users WHERE id='local-verification'; INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES ('local-verification','Local Verification','local-verification@test.invalid','manager','${hash}','2026-10-14T00:00:00Z');`);
  execute(sql);
  assert.equal((await request('config')).status,200);
  const signedIn=await request('login','POST',{email:'local-verification@test.invalid',password:'Local-test-password-123'});assert.equal(signedIn.status,200);const cookie=signedIn.headers.get('Set-Cookie').split(';')[0];
  const created=await request('cases','POST',{name:'Verification client',ownerId:'local-verification',kind:'usa',appointment:'2026-10-18',checks:{}},cookie);assert.equal(created.status,201);
  const response=await request('workspace','GET',null,cookie);const workspace=await response.json();assert.equal(response.status,200);const client=workspace.cases.find(r=>r.ownerId==='local-verification');assert.ok(client);assert.equal(workspace.pushDevices,0);
  const changed=await request(`cases/${client.id}`,'PATCH',{checks:{Hotel:true},_version:1},cookie);assert.equal(changed.status,200);
  const updated=await(await request('workspace','GET',null,cookie)).json();assert.equal(updated.cases.find(r=>r.id===client.id).checks.Hotel,true);
  console.log('Workers/D1 local runtime: login, authenticated workspace, case creation, and checklist update passed. No real messages were sent.');
}finally {
  const cleanup=path.join(scratch,'cleanup.sql');await writeFile(cleanup,"DELETE FROM records WHERE owner_id='local-verification'; DELETE FROM users WHERE id='local-verification';");
  try{execute(cleanup);}finally{
    const resolved=path.resolve(scratch),base=path.resolve(tmpdir());
    if(!resolved.startsWith(base+path.sep)||!path.basename(resolved).startsWith('mawid-local-verification-'))throw new Error('Unexpected verification directory; cleanup stopped.');
    await rm(resolved,{recursive:true,force:true});
  }
}
