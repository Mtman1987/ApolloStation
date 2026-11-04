/** Discord's detached Activity talks to the host window's opener, not the
 * detached window itself. Keep the public player usable during reconnection. */
export const HEARMEOUT_DISCORD_HANDSHAKE_JS=String.raw`
window.connectHearMeOutDiscord=function(clientId,onStatus){
 const params=new URLSearchParams(location.search),frameId=params.get('frame_id');
 if(!frameId||!clientId)return;
 let ready=false,attempts=0,target,origin='*',timer;
 try{if(document.referrer)origin=new URL(document.referrer).origin}catch{}
 function handshake(){
  if(ready||attempts++>=15){clearInterval(timer);if(!ready)onStatus('Discord is reconnecting. The player remains available.');return;}
  target=window.parent;try{target=window.parent.opener||window.parent}catch{}
  const payload={v:1,encoding:'json',client_id:clientId,frame_id:frameId};
  if(params.get('platform')!=='mobile'||Number((params.get('mobile_app_version')||'').split('.')[0])>=250)payload.sdk_version='2.5.0';
  try{target.postMessage([0,payload],origin)}catch{onStatus('Discord connection is unavailable. Reopen this Activity to reconnect.');}
 }
 window.addEventListener('message',event=>{
  if(event.source!==target||origin!=='*'&&event.origin!==origin||!Array.isArray(event.data))return;
  if(event.data[0]===1&&event.data[1]?.evt==='READY'){ready=true;clearInterval(timer);onStatus('');}
  else if(event.data[0]===2){ready=false;onStatus('Discord disconnected. Reopen the Activity to reconnect.');}
 });
 function restart(){clearInterval(timer);ready=false;attempts=0;handshake();timer=setInterval(handshake,1000);}
 window.addEventListener('pageshow',event=>{if(event.persisted)restart()});
 window.addEventListener('pagehide',()=>clearInterval(timer));
 restart();
};`;
