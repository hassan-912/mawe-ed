import { database } from './d1.mjs';
import { hashPassword } from '../server/auth.mjs';
import worker,{indexFields} from '../server/worker.mjs';
export const PASSWORD='Synthetic-test-passphrase-123';
export async function fixture() {
  const DB=database(),env={DB,AUTH_PEPPER:'b'.repeat(64)},hash=await hashPassword(PASSWORD);
  for(const [id,role]of [['manager','manager'],['employee','employee'],['other','employee']])DB.raw.prepare('INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES (?,?,?,?,?,?)').run(id,id,`${id}@test.invalid`,role,hash,'2026-10-01T00:00:00Z');
  return env;
}
export function request(path,method='GET',input,cookie,headers={}) {
  return new Request(`https://mawid.test/api/${path}`,{method,headers:{'Content-Type':'application/json',...(method!=='GET'?{Origin:'https://mawid.test'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(input!=null?{body:JSON.stringify(input)}:{})});
}
export const call=(env,path,method='GET',input,cookie,headers={})=>worker.fetch(request(path,method,input,cookie,headers),env);
export async function login(env,id='employee',password=PASSWORD) {const r=await call(env,'login','POST',{email:`${id}@test.invalid`,password});if(r.status!==200)throw new Error(`Login failed: ${r.status}`);return r.headers.get('Set-Cookie').split(';')[0];}
export function insert(env,id,type,payload) {
  const idx=indexFields(type,payload);
  env.DB.raw.prepare('INSERT INTO records(id,type,owner_id,payload,active,next_due,start_date,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,type,payload.ownerId,JSON.stringify(payload),idx.active,idx.nextDue,idx.startDate,'2026-10-01T00:00:00Z');
}
export const caseRecord={name:'Synthetic Client',ownerId:'employee',kind:'usa',appointment:'2026-10-18',checks:{},notes:'Private notes',priority:'high'};
export const consultation={name:'Consultation Client',ownerId:'manager',consultationDate:'2026-10-10',intervalHours:48,nextReminder:'2026-10-14T07:30:00.000Z',status:'active',phone:'+201000000000',notes:'Private manager-only discussion',priority:'high'};
