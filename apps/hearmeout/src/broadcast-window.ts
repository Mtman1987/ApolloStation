import type {IncomingMessage,ServerResponse} from 'node:http';
import {SpmtApiError} from '@spmt/sdk';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {HEARMEOUT_SINGLE_PROGRAM_ID,type HearMeOutBroadcastProgram} from './broadcast-program.js';
import type {HearMeOutRoomBroadcast} from './room-broadcast.js';
import type {HearMeOutSuiteMediaResolverV1} from './suite-action-executor.js';

const browserRequests=new Map<string,{videoId:string;until:number}>();

export function broadcastView(program:HearMeOutBroadcastProgram,configured:boolean){
  const session=program.getSession();
  const visible=(request:typeof session.current)=>{if(!request)return request;const metadata=request.item.metadata?Object.fromEntries(Object.entries(request.item.metadata).filter(([key])=>key!=='audioPlaybackUrl')):undefined;return {...request,item:{...request.item,...(metadata?{metadata}:{})}};};
  return {sessionId:HEARMEOUT_SINGLE_PROGRAM_ID,current:visible(session.current),queue:session.queue.map(request=>visible(request)!),playback:session.playback,revision:session.revision,broadcast:{configured,playbackUrl:'/api/watch/broadcast/index.m3u8'}};
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
  const movieSearch=url.pathname==='/api/watch/broadcast/movies',control=url.pathname==='/api/watch/broadcast/control';
  const defaults=url.pathname==='/api/watch/activity-default',requestVideo=url.pathname==='/api/watch/broadcast/requests';
  const browserMedia=url.pathname.match(/^\/api\/watch\/broadcast\/youtube\/([A-Za-z0-9_-]{11})\/(status|audio|video)$/);
  if(!entry&&!state&&!feed&&!defaults&&!requestVideo&&!movieSearch&&!browserMedia&&!control)return false;
  try{
    if(control){
      if(request.method!=='POST')return send(response,405,{error:'Method not allowed'});
      if(readOnly)return send(response,503,{error:'Broadcast controls are unavailable in this preview'});
      if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)return send(response,403,{error:'Invalid request origin'});
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>4096)throw Error('Request is too large');chunks.push(bytes);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||!['skip','clear'].includes(body.action))throw Error('Choose skip or clear queue');
      if(body.expectedRequestId!==undefined&&typeof body.expectedRequestId!=='string')throw Error('Invalid request reference');
      program.control({tenantId:program.binding.tenantId,userId:guest(request,response),displayName:'Viewer',roles:[]},{action:body.action,...(body.expectedRequestId?{expectedRequestId:body.expectedRequestId}:{})});
      return send(response,200,broadcastView(program,Boolean(worker)));
    }
    if(browserMedia){
      if(readOnly||!worker)return send(response,503,{error:'Browser media caching is unavailable'});
      const requester=guest(request,response),pending=browserRequests.get(requester);
      if(!pending||pending.until<Date.now()||pending.videoId!==browserMedia[1])return send(response,409,{error:'Retry your music or video request first'});
      if(browserMedia[2]==='status'){
        if(request.method!=='GET')return send(response,405,{error:'Method not allowed'});
        return send(response,200,await worker.browserCache(browserMedia[1]!));
      }
      if(request.method!=='POST')return send(response,405,{error:'Method not allowed'});
      if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)return send(response,403,{error:'Invalid request origin'});
      if(request.headers['content-type']!=='application/octet-stream')return send(response,400,{error:'Expected downloaded media bytes'});
      const chunks:Buffer[]=[];let bytes=0;
      for await(const chunk of request){const part=Buffer.from(chunk);bytes+=part.length;if(bytes>200*1024*1024)return send(response,413,{error:'This media track is too large to cache'});chunks.push(part);}
      return send(response,200,await worker.browserCache(browserMedia[1]!,browserMedia[2] as 'audio'|'video',Buffer.concat(chunks)));
    }
    if(movieSearch){
      if(request.method!=='GET')return send(response,405,{error:'Method not allowed'});
      if(readOnly||!media)return send(response,503,{error:'The IPTV movie search is unavailable'});
      const items=await program.searchMovies(url.searchParams.get('q')??'',guest(request,response),media);
      return send(response,200,{items});
    }
    if(requestVideo){
      if(request.method!=='POST')return send(response,405,{error:'Method not allowed'});
      if(readOnly)return send(response,503,{error:'Broadcast requests are unavailable in this preview'});
      if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)return send(response,403,{error:'Invalid request origin'});
      const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>4096)throw Error('Request is too large');chunks.push(bytes);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||typeof body.query!=='string')throw Error('Enter a video title or link');
      if(body.lane!==undefined&&body.lane!=='music'&&body.lane!=='movie')throw Error('Choose music or movie');
      if(body.selectedItemId!==undefined&&(body.lane!=='movie'||typeof body.selectedItemId!=='string'||!/^xtream-vod-\d+$/.test(body.selectedItemId)))throw Error('Choose a movie from the search results');
      if(!media)return send(response,503,{error:'The media worker is unavailable'});
      const rawKey=request.headers['idempotency-key'];if(rawKey!==undefined&&(typeof rawKey!=='string'||rawKey.length>200))throw Error('Invalid request key');
      const requesterId=guest(request,response);
      try{await program.request({requesterId,displayName:typeof body.displayName==='string'?body.displayName.replace(/[\r\n\0]/g,' ').slice(0,120):'Viewer',query:body.query,lane:body.lane??'movie',...(body.browserPlayback===true&&body.browserPrepared!==true?{browserPreparation:true}:{}),...(body.selectedItemId?{selectedItemId:body.selectedItemId}:{}),operationId:rawKey??randomUUID()},media);}catch(error){
        const browserError=error as Error&{code?:string;videoId?:string;title?:string};
        if(browserError.code!=='youtube-browser-required')throw error;
        for(const [key,value] of browserRequests)if(value.until<Date.now())browserRequests.delete(key);
        if(browserRequests.size>=500)browserRequests.delete(browserRequests.keys().next().value!);
        browserRequests.set(requesterId,{videoId:browserError.videoId!,until:Date.now()+15*60*1000});
        return send(response,409,{error:browserError.message,code:browserError.code,videoId:browserError.videoId,title:browserError.title});
      }
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
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HearMeOut broadcast</title><style>html,body{margin:0;background:#080d18;color:#eef2ff;font:16px system-ui}main:fullscreen{overflow:auto;background:#080d18;max-width:none}main{max-width:1100px;margin:auto;padding:12px}video{display:block;width:100%;aspect-ratio:16/9;max-height:65vh;background:#000}video.video-off{visibility:hidden}nav,form{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}button,input,select{font:inherit;padding:9px;border:1px solid #526179;border-radius:7px;background:#18243b;color:inherit}input[name=query]{flex:1;min-width:200px}#error{color:#fbbf24}#movie-results button{display:block;width:100%;text-align:left;margin:8px 0}h1{font-size:20px}</style></head><body><main><h1>HearMeOut</h1><p id="status" role="status">Connecting to the broadcast…</p><p id="error" role="alert"></p><p id="playback-error" role="status"></p><video id="player" playsinline></video><nav><button id="audio-toggle" aria-pressed="true">Audio: on</button><button id="video-toggle" aria-pressed="true">Video: on</button><button id="sound">Enable sound</button><input id="volume" type="range" min="0" max="100" value="0" aria-label="Volume on this device"><select id="audio-language" aria-label="Audio language" hidden></select><button id="disconnect">Disconnect</button><button id="retry">Reset player</button><button id="fullscreen">Fullscreen</button><button id="popout">Pop out</button><span id="discord-window-hint" hidden>Use Discord’s Pop Out control to detach this Activity.</span></nav><h2 id="title">Nothing playing</h2><form id="request-form"><select name="lane" aria-label="Request type"><option value="movie">Movie / video</option><option value="music">Music</option></select><input name="query" aria-label="Music or movie request" placeholder="Song, movie title, or media link" maxlength="300" required><button id="request-submit">Request</button></form><section id="movie-results" aria-label="Matching movies" hidden></section><nav aria-label="Shared queue controls"><button id="skip" disabled>Skip</button><button id="clear-queue" disabled>Clear queue</button><span>Clear queue keeps the current item playing.</span></nav><ol id="queue"></ol></main><script src="/api/hearmeout/playback-source.js"></script><script src="/api/hearmeout/youtube-browser.js"></script><script>const CLIENT_ID='+JSON.stringify(clientId).replace(/</g,'\\u003c')+';'+BROADCAST_WINDOW_JS+'</script></body></html>';
}
export const BROADCAST_WINDOW_JS=String.raw`
(()=>{
  const video=document.getElementById('player'),status=document.getElementById('status'),error=document.getElementById('error'),volume=document.getElementById('volume'),sound=document.getElementById('sound');
  const playbackError=document.getElementById('playback-error'),disconnect=document.getElementById('disconnect'),retry=document.getElementById('retry'),audioToggle=document.getElementById('audio-toggle'),videoToggle=document.getElementById('video-toggle');
  const source=new window.HearMeOutPlaybackSource(video,e=>{playbackError.textContent=e.message},document.getElementById('audio-language'));
  let level=Number(localStorage.getItem('hmo-broadcast-volume')||0),lastAudible=level||85,sourceUrl='',busy=false,disposed=false,pendingRequest,requestInFlight=false,lastRevision=-1,playPending,selectedMovie,connected=true,currentRequest='',retryAt=0,latestState,controlBusy=false;
  let audioEnabled=localStorage.getItem('hmo-broadcast-audio')!=='off',videoEnabled=localStorage.getItem('hmo-broadcast-video')!=='off';
  const movieResults=document.getElementById('movie-results');
  function setVolume(value){level=Math.max(0,Math.min(100,value));if(level)lastAudible=level;video.volume=level/100;volume.value=String(level);sound.textContent=level?'Mute locally':'Enable sound';localStorage.setItem('hmo-broadcast-volume',String(level));}
  function setAudioEnabled(value){audioEnabled=Boolean(value);video.muted=!audioEnabled;audioToggle.textContent='Audio: '+(audioEnabled?'on':'off');audioToggle.setAttribute('aria-pressed',String(audioEnabled));localStorage.setItem('hmo-broadcast-audio',audioEnabled?'on':'off');}
  function setVideoEnabled(value){videoEnabled=Boolean(value);video.classList.toggle('video-off',!videoEnabled);videoToggle.textContent='Video: '+(videoEnabled?'on':'off');videoToggle.setAttribute('aria-pressed',String(videoEnabled));localStorage.setItem('hmo-broadcast-video',videoEnabled?'on':'off');}
  setVolume(level);setAudioEnabled(audioEnabled);setVideoEnabled(videoEnabled);
  const params=new URLSearchParams(location.search),frameId=params.get('frame_id');
  const skip=document.getElementById('skip'),clearQueue=document.getElementById('clear-queue'),popout=document.getElementById('popout');
  let localOwner=window;try{if(window.top.location.origin===location.origin)localOwner=window.top;}catch{}
  if(!params.has('popout')&&localOwner.hearMeOutWatchPopout&&!localOwner.hearMeOutWatchPopout.closed){connected=false;disconnect.textContent='Watch again';}
  if(frameId){popout.hidden=true;document.getElementById('discord-window-hint').hidden=false;}
  if(frameId&&CLIENT_ID){let origin='*';try{if(document.referrer)origin=new URL(document.referrer).origin}catch{}window.parent.postMessage([0,{v:1,encoding:'json',client_id:CLIENT_ID,frame_id:frameId,sdk_version:'2.5.0'}],origin);}
  async function api(path,init){
    const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(init?190000:path.startsWith('/api/watch/broadcast/movies?')?60000:15000),...init});
    const unavailable=()=>Error('The media service returned an unexpected page'+(response.ok?'':' (HTTP '+response.status+')')+'. Reconnect and retry.');
    // An edge/login page cannot tell us whether the request reached the worker.
    // Keep the same operation key when retrying an unconfirmed response.
    if(!/application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw unavailable();}
    let data;try{data=await response.json();}catch{throw unavailable();}
    if(!response.ok)throw Object.assign(Error(data?.error||data?.message||'Broadcast unavailable'),{status:response.status,code:data?.code,videoId:data?.videoId});return data;
  }
  function play(){
    if(disposed||!connected||!sourceUrl)return Promise.resolve();
    if(playPending)return playPending;
    playPending=video.play().catch(e=>{if(disposed||!sourceUrl||e.name==='AbortError')return;if(e.name==='NotAllowedError')status.textContent='Tap Enable sound to watch';else error.textContent=e.message;}).finally(()=>{playPending=undefined});
    return playPending;
  }
  function applyState(state){
    if(disposed||state.revision<lastRevision)return;lastRevision=state.revision;latestState=state;
    skip.disabled=controlBusy||!state.current;clearQueue.disabled=controlBusy||!state.queue.length;
    status.textContent=!connected?'Disconnected on this device. The broadcast continues.':requestInFlight?'Preparing your request…':state.playback.status==='idle'?'Nothing playing. Request music or a movie below.':'Broadcast: '+state.playback.status;
    document.getElementById('title').textContent=state.current?.item.title||'Nothing playing';
    const queue=document.getElementById('queue');queue.replaceChildren();for(const request of state.queue){const li=document.createElement('li');li.textContent=request.item.title;queue.append(li);}
    retry.disabled=!connected||!state.current;
    if(!connected||!state.current){if(sourceUrl){sourceUrl='';source.clear();}currentRequest='';playbackError.textContent='';return;}
    if(!state.broadcast.configured){playbackError.textContent='The broadcast worker is unavailable.';return;}
    if(sourceUrl!==state.broadcast.playbackUrl||currentRequest!==state.current.requestId||(source.failed&&Date.now()>=retryAt)){
      sourceUrl=state.broadcast.playbackUrl;currentRequest=state.current.requestId;retryAt=Date.now()+10000;playbackError.textContent='Connecting to the broadcast…';source.load(sourceUrl,true,true);
    }
    if(video.readyState>=2)void play();
  }
  async function refresh(){
    if(busy||disposed)return;busy=true;
    try{
      applyState(await api('/api/watch/broadcast/state'));
    }catch(e){error.textContent=e.message;}finally{busy=false;}
  }
  audioToggle.addEventListener('click',()=>{setAudioEnabled(!audioEnabled);if(audioEnabled&&level===0)setVolume(lastAudible);void play()});
  videoToggle.addEventListener('click',()=>setVideoEnabled(!videoEnabled));
  sound.addEventListener('click',()=>{if(!audioEnabled)setAudioEnabled(true);setVolume(level?0:lastAudible);void play()});
  volume.addEventListener('input',event=>{if(!audioEnabled&&Number(event.target.value)>0)setAudioEnabled(true);setVolume(Number(event.target.value))});
  retry.addEventListener('click',()=>{source.clear();sourceUrl='';playbackError.textContent='';refresh()});
  function setConnected(value){
    connected=value;disconnect.textContent=value?'Disconnect':'Watch again';sourceUrl='';currentRequest='';source.clear();playbackError.textContent='';retry.disabled=!value;
    if(!value)status.textContent='Disconnected on this device. The broadcast continues.';
    if(latestState)applyState(latestState);else refresh();
  }
  disconnect.addEventListener('click',()=>{
    if(!connected&&localOwner.hearMeOutWatchPopout&&!localOwner.hearMeOutWatchPopout.closed){localOwner.hearMeOutWatchPopout.close();localOwner.hearMeOutWatchPopout=undefined;}
    setConnected(!connected);
  });
  popout.addEventListener('click',()=>{
    const prior=connected;setConnected(false);
    const existing=localOwner.hearMeOutWatchPopout;
    if(existing&&!existing.closed){existing.focus();return;}
    const popup=window.open('/watch?popout=1','hmo-watch-'+crypto.randomUUID(),'popup,width=1100,height=800');
    if(!popup){setConnected(prior);playbackError.textContent='Allow popups for HearMeOut to open this window.';return;}
    localOwner.hearMeOutWatchPopout=popup;popup.focus();
  });
  if(params.has('popout'))popout.hidden=true;
  document.getElementById('fullscreen').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.querySelector('main').requestFullscreen)await document.querySelector('main').requestFullscreen();else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();else throw Error('Fullscreen unavailable');}
    catch{playbackError.textContent=frameId?'Use Discord’s fullscreen control for this Activity.':'Fullscreen is unavailable in this window.';}
  });
  async function controlQueue(action){
    if(controlBusy||!latestState)return;controlBusy=true;skip.disabled=true;clearQueue.disabled=true;error.textContent='';
    try{applyState(await api('/api/watch/broadcast/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...(action==='skip'?{expectedRequestId:latestState.current?.requestId}:{})})}));}
    catch(e){error.textContent=e.message;}finally{controlBusy=false;if(latestState)applyState(latestState);}
  }
  skip.addEventListener('click',()=>controlQueue('skip'));
  clearQueue.addEventListener('click',()=>controlQueue('clear'));
  document.getElementById('request-form').addEventListener('submit',async event=>{
    event.preventDefault();if(requestInFlight||disposed)return;const query=event.target.elements.query.value.trim(),lane=event.target.elements.lane.value,button=document.getElementById('request-submit');
    const selectedItemId=lane==='movie'&&selectedMovie?.query===query?selectedMovie.itemId:undefined;
    if(pendingRequest?.query!==query||pendingRequest?.lane!==lane||pendingRequest?.selectedItemId!==selectedItemId)pendingRequest={query,lane,selectedItemId,key:crypto.randomUUID()};
    requestInFlight=true;button.disabled=true;error.textContent='';status.textContent='Preparing your request…';
    try{
      if(lane==='movie'&&!/^https?:\/\//i.test(query)&&!selectedItemId){
        status.textContent='Searching movies…';
        const data=await api('/api/watch/broadcast/movies?q='+encodeURIComponent(query));
        if(event.target.elements.query.value.trim()!==query||event.target.elements.lane.value!==lane)return;
        movieResults.replaceChildren();movieResults.hidden=false;
        const heading=document.createElement('p');heading.textContent=data.items.length?'Choose a movie to request:':'No matching movies found. Try another title.';movieResults.append(heading);
        for(const item of data.items){const button=document.createElement('button');button.type='button';button.textContent=item.title+(item.year?' ('+item.year+')':'')+(item.quality?' · '+item.quality:'');button.dataset.movieId=item.itemId;button.addEventListener('click',()=>{if(requestInFlight)return;selectedMovie={query,itemId:item.itemId};event.target.requestSubmit();});movieResults.append(button);}
        status.textContent='Choose a movie from the results';pendingRequest=undefined;return;
      }
      const submit=(browserPrepared=false)=>api('/api/watch/broadcast/requests',{method:'POST',headers:{'content-type':'application/json','idempotency-key':pendingRequest.key},body:JSON.stringify({query,lane,browserPlayback:true,browserPrepared,...(selectedItemId?{selectedItemId}:{})})});
      let state;try{state=await submit();}catch(e){
        if(e.code!=='youtube-browser-required')throw e;
        try{await window.prepareHearMeOutYoutube(e.videoId,lane,message=>{status.textContent=message;});}
        catch{status.textContent='Starting the shared YouTube source…';}
        state=await submit(true);
      }pendingRequest=undefined;selectedMovie=undefined;movieResults.replaceChildren();movieResults.hidden=true;if(event.target.elements.query.value.trim()===query&&event.target.elements.lane.value===lane)event.target.reset();error.textContent='';requestInFlight=false;applyState(state);}
    catch(e){if(e.status)pendingRequest=undefined;error.textContent=e.message;status.textContent='Request not completed. You can retry.';}finally{requestInFlight=false;button.disabled=false;}
  });
  document.getElementById('request-form').addEventListener('input',()=>{selectedMovie=undefined;movieResults.replaceChildren();movieResults.hidden=true;});
  video.addEventListener('canplay',()=>{playbackError.textContent='';void play()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)source.joinLive()});
  refresh();const timer=setInterval(refresh,1500);window.addEventListener('pagehide',()=>{disposed=true;clearInterval(timer);source.clear()});
})();`;
