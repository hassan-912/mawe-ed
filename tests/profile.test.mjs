import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.mjs';
import { fixture,call,login } from './security-fixture.mjs';
import { PHOTO_LIMIT } from '../server/profile.mjs';

const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI2UAAAAASUVORK5CYII=','base64'));
function upload(env,cookie,bytes=png,mime='image/png',path='profile/photo',origin='https://mawid.test') {
  return worker.fetch(new Request(`https://mawid.test/api/${path}`,{method:'PUT',headers:{Origin:origin,'Content-Type':mime,Cookie:cookie},body:bytes}),env);
}

test('profile photo upload persists across sign-ins and replacement changes the photo version',async()=>{
  const env=await fixture();try {
    const cookie=await login(env),saved=await upload(env,cookie);assert.equal(saved.status,200);
    const first=await saved.json();assert.match(first.photoUrl,/^\/api\/profile\/photo\?v=/);
    const received=await call(env,'profile/photo','GET',null,cookie);assert.equal(received.status,200);
    assert.equal(received.headers.get('Content-Type'),'image/png');assert.equal(received.headers.get('Cache-Control'),'no-store');assert.equal(received.headers.get('X-Content-Type-Options'),'nosniff');
    assert.deepEqual(new Uint8Array(await received.arrayBuffer()),png);
    await call(env,'logout','POST',{},cookie);assert.equal((await call(env,'profile/photo')).status,401);
    const nextCookie=await login(env),workspace=await(await call(env,'workspace','GET',null,nextCookie)).json();
    assert.equal(workspace.user.photoUrl,first.photoUrl);
    const jpeg=Uint8Array.from([255,216,255,224,0,2,255,217]),replaced=await upload(env,nextCookie,jpeg,'image/jpeg');assert.equal(replaced.status,200);
    assert.notEqual((await replaced.json()).photoUrl,first.photoUrl);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM profile_photos WHERE user_id='employee'").get().n,1);
    assert.equal(env.DB.raw.prepare("SELECT mime FROM profile_photos WHERE user_id='employee'").get().mime,'image/jpeg');
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='account.photo_updated'").get().n,2);
  }finally{env.DB.close();}
});

test('photos are private to the authenticated account and upload destinations cannot target another user',async()=>{
  const env=await fixture();try {
    const employee=await login(env),other=await login(env,'other'),manager=await login(env,'manager');
    assert.equal((await upload(env,employee)).status,200);
    assert.equal((await call(env,'profile/photo?user_id=employee','GET',null,other)).status,404);
    assert.equal((await call(env,'profile/photo?user_id=employee','GET',null,manager)).status,404);
    assert.equal((await upload(env,other,png,'image/png','profile/photo?user_id=employee')).status,200);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM profile_photos').get().n,2);
    assert.equal((await upload(env,employee,png,'image/png','profile/photo','https://other.test')).status,403);
    env.DB.raw.prepare("UPDATE users SET status='disabled' WHERE id='employee'").run();
    assert.equal((await call(env,'profile/photo','GET',null,employee)).status,401);
  }finally{env.DB.close();}
});

test('invalid, executable, and oversized images are rejected without replacing the saved photo',async()=>{
  const env=await fixture();try {
    const cookie=await login(env);await upload(env,cookie);
    const version=env.DB.raw.prepare("SELECT profile_photo_version FROM users WHERE id='employee'").get().profile_photo_version;
    assert.equal((await upload(env,cookie,new TextEncoder().encode('<svg onload="alert(1)"/>'),'image/svg+xml')).status,415);
    assert.equal((await upload(env,cookie,new TextEncoder().encode('<html>not a photo</html>'))).status,400);
    assert.equal((await upload(env,cookie,new Uint8Array(PHOTO_LIMIT+1))).status,413);
    assert.equal(env.DB.raw.prepare("SELECT profile_photo_version FROM users WHERE id='employee'").get().profile_photo_version,version);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='account.photo_updated'").get().n,1);
  }finally{env.DB.close();}
});

test('an account revocation racing a photo upload cannot save a photo or record a false success',async()=>{
  const env=await fixture();try {
    const cookie=await login(env),batch=env.DB.batch.bind(env.DB);
    env.DB.batch=async statements=>{env.DB.raw.prepare("UPDATE users SET auth_version=auth_version+1 WHERE id='employee'").run();return batch(statements);};
    assert.equal((await upload(env,cookie)).status,409);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM profile_photos').get().n,0);
    assert.equal(env.DB.raw.prepare("SELECT profile_photo_version FROM users WHERE id='employee'").get().profile_photo_version,null);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM activity').get().n,0);
  }finally{env.DB.close();}
});
