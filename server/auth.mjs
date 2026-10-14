const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
const unhex = value => new Uint8Array(value.match(/.{2}/g).map(byte=>parseInt(byte,16)));
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async text => hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
async function passwordBits(password,salt) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256);
  return hex(bits);
}
async function pepperHash(bits,salt,pepper) {
  if(typeof pepper!=='string'||!/^[a-f0-9]{64}$/i.test(pepper))throw new Error('Account security configuration is missing.');
  const key=await crypto.subtle.importKey('raw',unhex(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(`mawid-password-v2\0${salt}\0${bits}`)));
}
export async function hashPassword(password,salt=hex(crypto.getRandomValues(new Uint8Array(16))),pepper) {
  const bits=await passwordBits(password,salt);
  return `${pepper?'pbkdf2-hmac-sha256':'pbkdf2-sha256'}:100000:${salt}:${pepper?await pepperHash(bits,salt,pepper):bits}`;
}
export async function upgradeLegacyHash(stored,pepper) {
  const [,iterations,salt,bits]=stored.split(':');
  return `pbkdf2-hmac-sha256:${iterations}:${salt}:${await pepperHash(bits,salt,pepper)}`;
}
export async function verifyPassword(password, stored,pepper) {
  const pieces = stored.split(':');
  if(pieces.length!==4 || !['pbkdf2-sha256','pbkdf2-hmac-sha256'].includes(pieces[0]) || pieces[1]!=='100000' || !/^[a-f0-9]{32}$/.test(pieces[2]) || !/^[a-f0-9]{64}$/.test(pieces[3])) return false;
  if(pieces[0]==='pbkdf2-hmac-sha256'&&!pepper)return false;
  const calculated = await hashPassword(password,pieces[2],pieces[0]==='pbkdf2-hmac-sha256'?pepper:undefined);
  let diff=0;for(let i=0;i<calculated.length;i++) diff|=calculated.charCodeAt(i)^stored.charCodeAt(i);
  return diff===0;
}
export function validatePerson(input) {
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160)throw new Error('Enter a valid staff name.');
  const email=normalizeEmail(input.email);
  if(!['manager','employee'].includes(input.role))throw new Error('Choose a valid staff role.');
  if(input.staffType!=null&&!['process','consultant'].includes(input.staffType))throw new Error('Choose Consultant or Process.');
  validatePassword(input.password);
  return {...input,name:input.name.trim(),email};
}
export function normalizeEmail(value) {
  if(typeof value!=='string')throw new Error('Enter a valid email.');
  const email=value.trim().toLowerCase();
  if(email.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email))throw new Error('Enter a valid email.');
  return email;
}
export function normalizeLogin(value) {
  if(typeof value!=='string')throw new Error('Enter an email or username.');
  const identifier=value.trim().toLowerCase().replace(/\s+/g,' ');
  if(identifier.includes('@'))return normalizeEmail(identifier);
  if(!/^[a-z0-9][a-z0-9 ._-]{2,63}$/.test(identifier))throw new Error('Enter a valid email or username.');
  return identifier;
}
export function validatePassword(value) {
  if(typeof value!=='string'||value.length<15||value.length>128||/^(.)\1+$/su.test(value)||['passwordpassword','123456789012345','qwertyuiopasdfgh'].includes(value.toLowerCase()))throw new Error('Use a unique password with 15–128 characters.');
}
export function publicUser(row) { return {id:row.id,name:row.name,email:row.email,username:row.username||null,role:row.role,staffType:row.role==='manager'?'admin':row.staff_type||'process',status:row.status,mustChangePassword:!!row.must_change_password,notificationPreview:!!row.notification_preview,photoUrl:row.profile_photo_version?`/api/profile/photo?v=${row.profile_photo_version}`:null}; }
export const sessionCookie = (token, secure = true) => `${secure?'__Host-':''}mawid=${token}; Path=/; HttpOnly; SameSite=Strict; ${secure?'Secure; ':''}Max-Age=604800`;
export const logoutCookie = (secure = true) => `${secure?'__Host-':''}mawid=; Path=/; HttpOnly; SameSite=Strict; ${secure?'Secure; ':''}Max-Age=0`;
export async function authenticate(request,env) {
  const secure=new URL(request.url).protocol==='https:';
  const cookieName=secure?'__Host-mawid':'mawid';
  const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!token || !/^[a-f0-9]{64}$/.test(token))return null;
  const now=Date.now(),tokenHash=await sha256(token);
  const account=await env.DB.prepare("SELECT u.*,s.public_id AS session_id,s.token_hash AS session_hash,s.last_seen FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND s.auth_version=u.auth_version AND u.status!='disabled' AND (s.last_seen=0 OR s.last_seen>?)").bind(tokenHash,now,now-43200000).first();
  if(account&&account.last_seen<now-60000)await env.DB.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').bind(now,tokenHash).run();
  return account;
}
export function cookieToken(request) {
  const name=new URL(request.url).protocol==='https:'?'__Host-mawid':'mawid';
  const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
  return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
}
export function deviceName(request) {
  const ua=request.headers.get('User-Agent')||'';
  const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Browser';
  const os=/iPhone|iPad/.test(ua)?'iOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac OS/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'device';
  return `${browser} on ${os}`;
}
