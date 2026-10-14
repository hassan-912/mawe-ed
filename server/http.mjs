import { sha256 } from './auth.mjs';
export class HttpError extends Error {
  constructor(message,status=400) { super(message);this.status=status; }
}
export const securityHeaders={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'same-origin',
  'X-Frame-Options':'DENY',
  'Strict-Transport-Security':'max-age=31536000',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
export const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{...securityHeaders,'Cache-Control':'no-store',...headers}});
export function validated(fn) { try {return fn();}catch(e){throw new HttpError(e.message);} }
export function onlyFields(value,allowed) {
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new HttpError('The request contains unsupported fields.');
}
export async function readBody(request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new HttpError('Use JSON requests.',415);
  const reader=request.body?.getReader();if(!reader)return {};
  const chunks=[];let size=0;
  while(true) {
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;if(size>16384){await reader.cancel();throw new HttpError('Request is too large.',413);}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
    return value;
  }catch{throw new HttpError('Enter valid JSON.');}
}
export const requestIp=request=>request.headers.get('CF-Connecting-IP')||'local';
export async function rateLimit(DB,key,limit,period=900000,now=Date.now()) {
  const result=await DB.prepare('INSERT INTO login_limits(key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts').bind(await sha256(key),now+period,now,now).all();
  if(result.results[0].attempts>limit)throw new HttpError('Too many requests. Please try again later.',429);
}
export function needManager(user) { if(user.role!=='manager')throw new HttpError('Manager access is required.',403); }
export function authReady(env) { return typeof env.AUTH_PEPPER==='string'&&/^[a-f0-9]{64}$/i.test(env.AUTH_PEPPER); }
export function needAuthConfiguration(env) { if(!authReady(env))throw new HttpError('Account sign-in is awaiting administrator security configuration.',503); }
