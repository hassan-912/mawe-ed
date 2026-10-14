const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
const unhex = value => new Uint8Array(value.match(/.{2}/g).map(byte=>parseInt(byte,16)));
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async text => hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
export async function hashPassword(password, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2-sha256:100000:${salt}:${hex(bits)}`;
}
export async function verifyPassword(password, stored) {
  const pieces = stored.split(':');
  if(pieces.length!==4 || pieces[0]!=='pbkdf2-sha256' || pieces[1]!=='100000' || !/^[a-f0-9]{32}$/.test(pieces[2]) || !/^[a-f0-9]{64}$/.test(pieces[3])) return false;
  const calculated = await hashPassword(password,pieces[2]);
  let diff=0;for(let i=0;i<calculated.length;i++) diff|=calculated.charCodeAt(i)^stored.charCodeAt(i);
  return diff===0;
}
export function validatePerson(input) {
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160)throw new Error('Enter a valid staff name.');
  if(typeof input.email!=='string'||input.email.length>254||!/^\S+@\S+\.\S+$/.test(input.email))throw new Error('Enter a valid email.');
  if(!['manager','employee'].includes(input.role))throw new Error('Choose a valid staff role.');
  if(typeof input.password!=='string'||input.password.length<12||input.password.length>128)throw new Error('Use a password with 12–128 characters.');
  return {...input,name:input.name.trim(),email:input.email.trim().toLowerCase()};
}
export function publicUser(row) { return {id:row.id,name:row.name,email:row.email,role:row.role}; }
export const sessionCookie = (token, secure = true) => `${secure?'__Host-':''}mawid=${token}; Path=/; HttpOnly; SameSite=Strict; ${secure?'Secure; ':''}Max-Age=604800`;
export const logoutCookie = (secure = true) => `${secure?'__Host-':''}mawid=; Path=/; HttpOnly; SameSite=Strict; ${secure?'Secure; ':''}Max-Age=0`;
export async function authenticate(request,env) {
  const secure=new URL(request.url).protocol==='https:';
  const cookieName=secure?'__Host-mawid':'mawid';
  const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!token || !/^[a-f0-9]{64}$/.test(token))return null;
  return env.DB.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha256(token),Date.now()).first();
}
