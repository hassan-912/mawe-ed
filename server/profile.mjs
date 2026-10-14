import { HttpError,json,securityHeaders } from './http.mjs';
import { activityStatement } from './activity.mjs';

export const PHOTO_LIMIT=128*1024;
async function readPhoto(request) {
  const mime=request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if(!['image/jpeg','image/png','image/webp'].includes(mime))throw new HttpError('Choose a JPG, PNG, or WebP photo.',415);
  const reader=request.body?.getReader();if(!reader)throw new HttpError('Choose a photo.');
  const chunks=[];let length=0;
  while(true) {
    const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;
    if(length>PHOTO_LIMIT){await reader.cancel();throw new HttpError('The resized photo must be smaller than 128 KB.',413);}
    chunks.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const starts=signature=>signature.every((value,index)=>bytes[index]===value);
  const valid=mime==='image/png'?length>=24&&starts([137,80,78,71,13,10,26,10]):
    mime==='image/jpeg'?length>=4&&starts([255,216,255])&&bytes[length-2]===255&&bytes[length-1]===217:
    length>=12&&starts([82,73,70,70])&&bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80;
  if(!valid)throw new HttpError('This file is not a valid JPG, PNG, or WebP photo.');
  return {mime,bytes};
}

export async function profileRoute(request,env,user) {
  const path=new URL(request.url).pathname;
  if(path!=='/api/profile/photo')return null;
  if(request.method==='GET') {
    const photo=await env.DB.prepare('SELECT mime,image FROM profile_photos WHERE user_id=?').bind(user.id).first();
    if(!photo)throw new HttpError('No profile photo uploaded yet.',404);
    return new Response(new Uint8Array(photo.image),{headers:{...securityHeaders,'Content-Type':photo.mime,'Cache-Control':'no-store','Content-Disposition':'inline'}});
  }
  if(request.method==='PUT') {
    const {mime,bytes}=await readPhoto(request),version=crypto.randomUUID(),mutation=crypto.randomUUID();
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE users SET profile_photo_version=?,last_mutation_id=? WHERE id=? AND auth_version=? AND status!='disabled'").bind(version,mutation,user.id,user.auth_version),
      env.DB.prepare("INSERT INTO profile_photos(user_id,mime,image,updated_at) SELECT ?,?,?,? FROM users WHERE id=? AND profile_photo_version=? AND auth_version=? AND status!='disabled' ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime,image=excluded.image,updated_at=excluded.updated_at").bind(user.id,mime,bytes.buffer,new Date().toISOString(),user.id,version,user.auth_version),
      activityStatement(env.DB,user,'account.photo_updated','Profile photo updated',null,{table:'users',id:user.id,mutation})
    ]);
    if(!result[0].meta.changes)throw new HttpError('Account access changed. Please sign in again.',409);
    return json({photoUrl:`/api/profile/photo?v=${version}`});
  }
  throw new HttpError('Method not allowed.',405);
}
