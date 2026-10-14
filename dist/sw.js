self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Push wakes this worker even when the website tab is closed. It does not use
// page timers and does not cache authenticated company records.
self.addEventListener('push',event=>{
  let payload={title:'Mawid',body:'A reminder needs your attention.',tag:'mawid',url:'/?view=notifications'};
  try{if(event.data)payload={...payload,...event.data.json()};}catch{}
  event.waitUntil(self.registration.showNotification(payload.title,{body:payload.body,icon:'/assets/icon-192.png',badge:'/assets/icon-192.png',tag:payload.tag,renotify:false,data:{url:payload.url}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/?view=notifications',self.location.origin);
  if(target.origin!==self.location.origin)return;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){if(new URL(client.url).origin===target.origin){await client.navigate(target.href);return client.focus();}}
    return self.clients.openWindow(target.href);
  }));
});
