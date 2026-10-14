import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('auth and push key generators work in either order and preserve existing secrets',async()=>{
  for(const order of [['generate-auth-key.mjs','generate-push-keys.mjs'],['generate-push-keys.mjs','generate-auth-key.mjs']]){
    const folder=await mkdtemp(path.join(tmpdir(),'mawid-setup-test-'));
    try{
      const run=name=>execFileSync(process.execPath,[path.resolve('scripts',name)],{cwd:folder,input:'synthetic-admin@example.test\n',encoding:'utf8',stdio:['pipe','pipe','pipe']});
      for(const name of order)run(name);
      const auth=JSON.parse(await readFile(path.join(folder,'auth-secrets.json'),'utf8')),push=JSON.parse(await readFile(path.join(folder,'push-secrets.json'),'utf8')),before=await readFile(path.join(folder,'.dev.vars'),'utf8');
      assert.equal((before.match(/^AUTH_PEPPER=/gm)||[]).length,1);assert.ok(before.includes(`AUTH_PEPPER=${auth.AUTH_PEPPER}`));assert.ok(before.includes(`VAPID_PRIVATE_KEY=${push.VAPID_PRIVATE_KEY}`));
      for(const name of order)assert.throws(()=>run(name));
      assert.equal(await readFile(path.join(folder,'.dev.vars'),'utf8'),before);
    }finally{
      if(!folder.startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(folder).startsWith('mawid-setup-test-'))throw new Error('Unexpected cleanup target');
      await rm(folder,{recursive:true,force:true});
    }
  }
});
