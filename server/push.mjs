import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sha256 } from './auth.mjs';
export const pushConfigured = env => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
function bytes(value) {
  if(typeof value!=='string'||value.length>128||!/^[-_a-zA-Z0-9]+$/.test(value))throw new Error('Invalid push encryption key.');
  try{return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}catch{throw new Error('Invalid push encryption key.');}
}
export async function validateSubscription(input) {
  if(typeof input.endpoint!=='string'||input.endpoint.length>2048)throw new Error('Invalid push endpoint.');
  let url;try{url=new URL(input.endpoint);}catch{throw new Error('Invalid push endpoint.');}
  const host=url.hostname;
  const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com');
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||!allowed)throw new Error('Unsupported push service. Use Chrome, Edge, Firefox, or Safari.');
  const publicKey=bytes(input.keys?.p256dh),auth=bytes(input.keys?.auth);
  if(publicKey.length!==65||publicKey[0]!==4||auth.length!==16)throw new Error('Invalid push encryption key.');
  try{await crypto.subtle.importKey('raw',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{throw new Error('Invalid push encryption key.');}
  return {endpoint:url.href,expirationTime:null,keys:{p256dh:input.keys.p256dh,auth:input.keys.auth}};
}
export async function saveSubscription(DB,userId,input,now=new Date(),authVersion=0) {
  const subscription=await validateSubscription(input),id=await sha256(subscription.endpoint);
  const existing=await DB.prepare('SELECT user_id FROM push_subscriptions WHERE id=?').bind(id).first();
  if(existing&&existing.user_id!==userId)throw new Error('This browser belongs to another staff account. Sign out of that account and turn off its notifications first.');
  const result=await DB.prepare("INSERT INTO push_subscriptions(id,user_id,endpoint,subscription,created_at) SELECT ?,?,?,?,? WHERE ((SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?)<3 OR EXISTS(SELECT 1 FROM push_subscriptions WHERE id=? AND user_id=?)) AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND must_change_password=0 AND auth_version=?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription WHERE push_subscriptions.user_id=excluded.user_id").bind(id,userId,subscription.endpoint,JSON.stringify(subscription),now.toISOString(),userId,id,userId,userId,authVersion).run();
  if(!result.meta.changes)throw new Error('Up to three devices can receive reminders per account. Turn off an old device first.');
  await DB.prepare("UPDATE deliveries SET attempts=0,available_at=0 WHERE owner_id=? AND status='failed' AND error='No notification device connected'").bind(userId).run();
  return id;
}
export async function sendWebPush(env,subscription,title,message,key,send=fetch,ttl=3600) {
  let payload=JSON.stringify({title:`Maw‘id · ${title}`,body:message,tag:key,url:'/?view=notifications'});
  while(new TextEncoder().encode(payload).length>3500){message=message.slice(0,Math.floor(message.length*.8))+'…';payload=JSON.stringify({title:`Maw‘id · ${title}`,body:message,tag:key,url:'/?view=notifications'});}
  const request=await buildPushPayload({data:payload,options:{ttl}},{...subscription},{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
  return send(subscription.endpoint,{...request,redirect:'error',signal:AbortSignal.timeout(10000)});
}
