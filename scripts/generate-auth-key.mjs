import { readFile,writeFile } from 'node:fs/promises';
let current='';try{current=await readFile('.dev.vars','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
if(/^AUTH_PEPPER=/m.test(current))throw new Error('An auth pepper already exists. It was preserved; do not rotate it without a password-reset plan.');
const pepper=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
await writeFile('auth-secrets.json',JSON.stringify({AUTH_PEPPER:pepper},null,2),{mode:0o600,flag:'wx'});
await writeFile('.dev.vars',current.trimEnd()+(current?'\n':'')+`AUTH_PEPPER=${pepper}\n`,{mode:0o600});
console.log('Account security key saved in ignored local files. Upload with: npx wrangler secret bulk auth-secrets.json');
console.log('Keep this key private and backed up. The key value was not printed.');
