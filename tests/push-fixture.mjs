export async function pushFixture() {
  const vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateJwk=await crypto.subtle.exportKey('jwk',vapid.privateKey),publicRaw=await crypto.subtle.exportKey('raw',vapid.publicKey);
  const client=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const clientRaw=new Uint8Array(await crypto.subtle.exportKey('raw',client.publicKey)),auth=crypto.getRandomValues(new Uint8Array(16));
  return {env:{VAPID_SUBJECT:'mailto:admin@test.invalid',VAPID_PUBLIC_KEY:Buffer.from(publicRaw).toString('base64url'),VAPID_PRIVATE_KEY:privateJwk.d},subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/test-only',expirationTime:null,keys:{p256dh:Buffer.from(clientRaw).toString('base64url'),auth:Buffer.from(auth).toString('base64url')}},async decrypt(body){
    const bytes=new Uint8Array(body),salt=bytes.slice(0,16),length=bytes[20],serverRaw=bytes.slice(21,21+length);
    const server=await crypto.subtle.importKey('raw',serverRaw,{name:'ECDH',namedCurve:'P-256'},false,[]);
    const shared=await crypto.subtle.deriveBits({name:'ECDH',public:server},client.privateKey,256);
    const enc=new TextEncoder();const hkdf=async(ikm,salt,info,n)=>{const key=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,n*8);};
    const info=new Uint8Array([...enc.encode('WebPush: info\0'),...clientRaw,...serverRaw]);
    const ikm=await hkdf(shared,auth,info,32),cek=await hkdf(ikm,salt,enc.encode('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(ikm,salt,enc.encode('Content-Encoding: nonce\0'),12);
    const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']);const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},aes,bytes.slice(21+length)));
    let last=plain.length-1;while(plain[last]===0)last--;if(plain[last]!==2)throw new Error('Invalid push padding');return JSON.parse(new TextDecoder().decode(plain.slice(0,last)));
  }};
}
