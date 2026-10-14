import { createInterface } from 'node:readline/promises';
import { writeFile,readFile } from 'node:fs/promises';
import { validatePerson,hashPassword } from '../server/auth.mjs';
const rl=createInterface({input:process.stdin,output:process.stdout});
let password='';
try {
  let pepper=process.env.AUTH_PEPPER;
  if(!pepper){try{pepper=(await readFile('.dev.vars','utf8')).match(/^AUTH_PEPPER=([a-f0-9]{64})\r?$/mi)?.[1];}catch{}}
  if(!pepper)throw new Error('Run npm run auth:key before creating the manager.');
  const name=await rl.question('Manager name: '),email=await rl.question('Manager email: ');
  console.log('Enter an initial password with at least 15 characters (input hidden):');
  // Do not echo passwords or include them in process arguments/history.
  if(!process.stdin.isTTY)throw new Error('Run this script in an interactive terminal.');
  rl.close();process.stdin.setRawMode(true);process.stdin.resume();
  password=await new Promise((resolve,reject)=>{
    const onData=chunk=>{for(const char of chunk.toString()){if(char==='\u0003'){process.stdin.off('data',onData);reject(new Error('Cancelled.'));return;}if(char==='\r'||char==='\n'){process.stdin.off('data',onData);resolve(password);return;}if(char==='\u007f'||char==='\b')password=password.slice(0,-1);else if(char>=' ')password+=char;}};process.stdin.on('data',onData);
  });
  process.stdin.setRawMode(false);process.stdin.pause();
  const person=validatePerson({name,email,password,role:'manager'});const hash=await hashPassword(password,undefined,pepper);password='';
  const quote=value=>`'${value.replaceAll("'","''")}'`;
  const sql=`INSERT INTO users(id,name,email,role,password_hash,created_at,status) VALUES (${[crypto.randomUUID(),person.name,person.email,'manager',hash,new Date().toISOString(),'active'].map(quote).join(',')});\n`;
  await writeFile('bootstrap-manager.sql',sql,{mode:0o600,flag:'wx'});console.log('\nCreated bootstrap-manager.sql with a salted password hash. Apply it with Wrangler, then delete the file.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();rl.close();}
