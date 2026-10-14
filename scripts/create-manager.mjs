import { createInterface } from 'node:readline/promises';
import { writeFile } from 'node:fs/promises';
import { validatePerson,hashPassword } from '../server/auth.mjs';
const rl=createInterface({input:process.stdin,output:process.stdout});
let password='';
try {
  const name=await rl.question('Manager name: '),email=await rl.question('Manager email: ');
  console.log('Enter an initial password with at least 12 characters (input hidden):');
  // Do not echo passwords or include them in process arguments/history.
  if(!process.stdin.isTTY)throw new Error('Run this script in an interactive terminal.');
  rl.close();process.stdin.setRawMode(true);process.stdin.resume();
  password=await new Promise((resolve,reject)=>{
    const onData=chunk=>{for(const char of chunk.toString()){if(char==='\u0003'){process.stdin.off('data',onData);reject(new Error('Cancelled.'));return;}if(char==='\r'||char==='\n'){process.stdin.off('data',onData);resolve(password);return;}if(char==='\u007f'||char==='\b')password=password.slice(0,-1);else if(char>=' ')password+=char;}};process.stdin.on('data',onData);
  });
  process.stdin.setRawMode(false);process.stdin.pause();
  const person=validatePerson({name,email,password,role:'manager'});const hash=await hashPassword(password);password='';
  const quote=value=>`'${value.replaceAll("'","''")}'`;
  const sql=`INSERT INTO users(id,name,email,role,password_hash,created_at) VALUES (${[crypto.randomUUID(),person.name,person.email,'manager',hash,new Date().toISOString()].map(quote).join(',')});\n`;
  await writeFile('bootstrap-manager.sql',sql,{mode:0o600});console.log('\nCreated bootstrap-manager.sql with a salted password hash. Apply it with Wrangler, then delete the file.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();rl.close();}
