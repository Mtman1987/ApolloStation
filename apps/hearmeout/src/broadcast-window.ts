import type {IncomingMessage,ServerResponse} from 'node:http';
import {SpmtApiError} from '@spmt/sdk';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {HEARMEOUT_SINGLE_PROGRAM_ID,type HearMeOutBroadcastProgram} from './broadcast-program.js';
import type {HearMeOutRoomBroadcast} from './room-broadcast.js';
import type {HearMeOutSuiteMediaResolverV1} from './suite-action-executor.js';

export function broadcastView(program:HearMeOutBroadcastProgram,configured:boolean){
  const session=program.getSession();
  return {sessionId:HEARMEOUT_SINGLE_PROGRAM_ID,current:session.current,queue:session.queue,playback:session.playback,revision:session.revision,broadcast:{configured,playbackUrl:'/api/watch/broadcast/index.m3u8'}};
}
function guest(request:IncomingMessage,response:ServerResponse){
  let token=String(request.headers.cookie??'').match(/(?:^|;\s*)hmo_viewer=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token){token=randomBytes(32).toString('hex');const secure=String(request.headers['x-forwarded-proto']??'').startsWith('https')||!/^(localhost|127\.0\.0\.1)(:|$)/.test(String(request.headers.host??''));response.setHeader('set-cookie','hmo_viewer='+token+'; Path=/; HttpOnly; Max-Age=2592000; SameSite='+(secure?'None; Secure; Partitioned':'Lax'));}
  return 'guest:'+createHash('sha256').update(token).digest('hex');
}
export async function handleHearMeOutBroadcastWindow(request:IncomingMessage,response:ServerResponse,url:URL,program:HearMeOutBroadcastProgram,worker:HearMeOutRoomBroadcast|undefined,media:HearMeOutSuiteMediaResolverV1|undefined,clientId='',readOnly=false){
  const entry=['/watch','/activity','/activity-lite'].includes(url.pathname)||(url.pathname==='/'&&url.searchParams.has('frame_id'));
  const state=url.pathname==='/api/watch/broadcast/state'||/^\/api\/watch\/sessions\/[^/]+\/state$/.test(url.pathname);
  const feed=!state&&url.pathname.match(/^\/api\/watch\/(?:broadcast|sessions\/[^/]+\/broadcast)\/([^/]+)$/);
  const defaults=url.pathname==='/api/watch/activity-default',requestVideo=url.pathname==='/api/watch/broadcast/requests';
  if(!entry&&!state&&!feed&&!defaults&&!requestVideo)return false;
  try{
    if(requestVideo){
      if(request.method!=='POST')return send(response,405,{error:'Method not allowed'});
      if(readOnly)return send(response,503,{error:'Broadcast requests are unavailable in this preview'});
      if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)return send(response,403,{error:'Invalid request origin'});
      const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>4096)throw Error('Request is too large');chunks.push(bytes);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||typeof body.query!=='string')throw Error('Enter a video title or link');
      if(body.lane!==undefined&&body.lane!=='music'&&body.lane!=='movie')throw Error('Choose music or movie');
      if(!media)return send(response,503,{error:'The media worker is unavailable'});
      const rawKey=request.headers['idempotency-key'];if(rawKey!==undefined&&(typeof rawKey!=='string'||rawKey.length>200))throw Error('Invalid request key');
      await program.request({requesterId:guest(request,response),displayName:typeof body.displayName==='string'?body.displayName.replace(/[\r\n\0]/g,' ').slice(0,120):'Viewer',query:body.query,lane:body.lane??'movie',operationId:rawKey??randomUUID()},media);
      return send(response,201,broadcastView(program,Boolean(worker)));
    }
    if(request.method!=='GET'&&request.method!=='HEAD')return send(response,405,{error:'Method not allowed'});
    if(entry){guest(request,response);response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(renderHearMeOutBroadcastWindow(clientId));return true;}
    if(feed){if(!worker)return send(response,503,{error:'The broadcast worker is unavailable'});await worker.serve(program.binding.tenantId,HEARMEOUT_SINGLE_PROGRAM_ID,'movie',feed[1]!,response);return true;}
    guest(request,response);
    return send(response,200,defaults?{sessionId:HEARMEOUT_SINGLE_PROGRAM_ID}:broadcastView(program,Boolean(worker)));
  }catch(error){return send(response,error instanceof SpmtApiError?error.status:400,{error:(error instanceof Error?error.message:String(error)).replace(/((?:token|authorization|secret|password|cookie))\s*[:=]\s*\S+/gi,'$1=[redacted]').slice(0,400)});}
}
function send(response:ServerResponse,status:number,value:unknown){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));return true;}

export function renderHearMeOutBroadcastWindow(clientId:string){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HearMeOut broadcast</title><style>html,body{margin:0;background:#080d18;color:#eef2ff;font:16px system-ui}main{max-width:1100px;margin:auto;padding:12px}video{display:block;width:100%;aspect-ratio:16/9;max-height:65vh;background:#000}nav,form{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}button,input,select{font:inherit;padding:9px;border:1px solid #526179;border-radius:7px;background:#18243b;color:inherit}input[name=query]{flex:1;min-width:200px}#error{color:#fbbf24}h1{font-size:20px}</style></head><body><main><h1>HearMeOut</h1><p id="status" role="status">Connecting to the broadcast…</p><p id="error" role="alert"></p><video id="player" playsinline></video><nav><button id="sound">Enable sound</button><input id="volume" type="range" min="0" max="100" value="0" aria-label="Volume on this device"><select id="audio-language" aria-label="Audio language" hidden></select><button id="retry">Reconnect</button></nav><h2 id="title">Nothing playing</h2><form id="request-form"><select name="lane" aria-label="Request type"><option value="movie">Movie / video</option><option value="music">Music</option></select><input name="query" aria-label="Music or movie request" placeholder="Song, movie title, or media link" maxlength="300" required><button id="request-submit">Request</button></form><ol id="queue"></ol></main><script src="/api/hearmeout/playback-source.js"></script><script>const CLIENT_ID='+JSON.stringify(clientId).replace(/</g,'\\u003c')+';'+BROADCAST_WINDOW_JS+'</script></body></html>';
}
export const BROADCAST_WINDOW_JS=String.raw`
(()=>{
  const video=document.getElementById('player'),status=document.getElementById('status'),error=document.getElementById('error'),volume=document.getElementById('volume'),sound=document.getElementById('sound');
  const source=new window.HearMeOutPlaybackSource(video,e=>{error.textContent=e.message},document.getElementById('audio-language'));
  let level=Number(localStorage.getItem('hmo-broadcast-volume')||0),lastAudible=level||85,sourceUrl='',busy=false,disposed=false,pendingRequest,requestInFlight=false,lastRevision=-1,playPending;
  function setVolume(value){level=Math.max(0,Math.min(100,value));if(level)lastAudible=level;video.volume=level/100;volume.value=String(level);sound.textContent=level?'Mute locally':'Enable sound';localStorage.setItem('hmo-broadcast-volume',String(level));}
  setVolume(level);
  const params=new URLSearchParams(location.search),frameId=params.get('frame_id');
  if(frameId&&CLIENT_ID){let origin='*';try{if(document.referrer)origin=new URL(document.referrer).origin}catch{}window.parent.postMessage([0,{v:1,encoding:'json',client_id:CLIENT_ID,frame_id:frameId,sdk_version:'2.5.0'}],origin);}
  async function api(path,init){const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(init?190000:15000),...init}),data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||data.message||'Broadcast unavailable'),{status:response.status});return data;}
  function play(){
    if(disposed||!sourceUrl)return Promise.resolve();
    if(playPending)return playPending;
    playPending=video.play().catch(e=>{if(disposed||!sourceUrl||e.name==='AbortError')return;if(e.name==='NotAllowedError')status.textContent='Tap Enable sound to watch';else error.textContent=e.message;}).finally(()=>{playPending=undefined});
    return playPending;
  }
  function applyState(state){
    if(disposed||state.revision<lastRevision)return;lastRevision=state.revision;
    status.textContent=requestInFlight?'Preparing your request…':state.playback.status==='idle'?'Nothing playing. Request music or a movie below.':'Broadcast: '+state.playback.status;
    document.getElementById('title').textContent=state.current?.item.title||'Nothing playing';
    const queue=document.getElementById('queue');queue.replaceChildren();for(const request of state.queue){const li=document.createElement('li');li.textContent=request.item.title;queue.append(li);}
    if(!state.current){if(sourceUrl){sourceUrl='';source.clear();}return;}
    if(!state.broadcast.configured){error.textContent='The broadcast worker is unavailable.';return;}
    if(sourceUrl!==state.broadcast.playbackUrl){sourceUrl=state.broadcast.playbackUrl;source.load(sourceUrl,true,true);}
    if(video.readyState>=2)void play();
  }
  async function refresh(){
    if(busy||disposed)return;busy=true;
    try{
      applyState(await api('/api/watch/broadcast/state'));
    }catch(e){error.textContent=e.message;}finally{busy=false;}
  }
  sound.addEventListener('click',()=>{setVolume(level?0:lastAudible);void play()});
  volume.addEventListener('input',event=>setVolume(Number(event.target.value)));
  document.getElementById('retry').addEventListener('click',()=>{source.clear();sourceUrl='';error.textContent='';refresh()});
  document.getElementById('request-form').addEventListener('submit',async event=>{
    event.preventDefault();if(requestInFlight||disposed)return;const query=event.target.elements.query.value.trim(),lane=event.target.elements.lane.value,button=document.getElementById('request-submit');
    if(pendingRequest?.query!==query||pendingRequest?.lane!==lane)pendingRequest={query,lane,key:crypto.randomUUID()};
    requestInFlight=true;button.disabled=true;error.textContent='';status.textContent='Preparing your request…';
    try{const state=await api('/api/watch/broadcast/requests',{method:'POST',headers:{'content-type':'application/json','idempotency-key':pendingRequest.key},body:JSON.stringify({query,lane})});pendingRequest=undefined;if(event.target.elements.query.value.trim()===query&&event.target.elements.lane.value===lane)event.target.reset();error.textContent='';requestInFlight=false;applyState(state);}
    catch(e){if(e.status)pendingRequest=undefined;error.textContent=e.message;}finally{requestInFlight=false;button.disabled=false;}
  });
  video.addEventListener('canplay',()=>{void play()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)source.joinLive()});
  refresh();const timer=setInterval(refresh,1500);window.addEventListener('pagehide',()=>{disposed=true;clearInterval(timer);source.clear()});
})();`;
