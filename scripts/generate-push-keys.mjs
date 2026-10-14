import { createInterface } from 'node:readline/promises';
import { writeFile } from 'node:fs/promises';
const rl=createInterface({input:process.stdin,output:process.stdout});
try {
  const email=(await rl.question('Administrator email for push service contact: ')).trim();
  if(!/^\S+@\S+\.\S+$/.test(email))throw new Error('Enter a valid email.');
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey=await crypto.subtle.exportKey('jwk',keys.privateKey),publicKey=await crypto.subtle.exportKey('raw',keys.publicKey);
  const secrets={VAPID_SUBJECT:`mailto:${email}`,VAPID_PUBLIC_KEY:Buffer.from(publicKey).toString('base64url'),VAPID_PRIVATE_KEY:privateKey.d};
  await writeFile('push-secrets.json',JSON.stringify(secrets,null,2),{mode:0o600,flag:'wx'});
  await writeFile('.dev.vars',Object.entries(secrets).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  console.log('Push keys saved in ignored local files. Upload with: npx wrangler secret bulk push-secrets.json');
  console.log('Keep the private key; changing keys requires staff to subscribe again.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{rl.close();}
