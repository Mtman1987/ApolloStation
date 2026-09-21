import {PUBLIC_LOUNGE_ID} from './lounge-room.js';
import {HEARMEOUT_DISCORD_HANDSHAKE_JS} from "./discord-activity-handshake.js";
import type {HearMeOutScreenBroadcast} from "./screen-broadcast.js";
import type {IncomingMessage,ServerResponse} from 'node:http';
import {SpmtApiError} from '@spmt/sdk';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {HearMeOutBroadcastProgram,HearMeOutPartyChannel} from './broadcast-program.js';
import type {HearMeOutRoomBroadcast} from './room-broadcast.js';
import type {HearMeOutSuiteMediaResolverV1} from './suite-action-executor.js';

const browserRequests=new Map<string,{videoId:string;until:number}>();

export function broadcastView(program:HearMeOutBroadcastProgram,configured:boolean,ready=false,epoch?:string,roomId?:string){
  if(!roomId)throw Object.assign(Error('Choose a watch party'),{status:400});
  const session=program.getSession(program.binding.tenantId,roomId);
  const visible=(request:typeof session.current)=>{if(!request)return request;const metadata=request.item.metadata?Object.fromEntries(Object.entries(request.item.metadata).filter(([key])=>key!=='audioPlaybackUrl')):undefined;return {...request,item:{...request.item,...(metadata?{metadata}:{})}};};
  const publicId=program.getRoom(roomId).sourceRoomId===PUBLIC_LOUNGE_ID?PUBLIC_LOUNGE_ID:roomId;
  return {sessionId:roomId,current:visible(session.current),queue:session.queue.map(request=>visible(request)!),playback:session.playback,revision:session.revision,broadcast:{configured,ready,...(epoch?{epoch}:{}),playbackUrl:'/api/watch/sessions/'+encodeURIComponent(publicId)+'/broadcast/index.m3u8'}};
}
function guest(request:IncomingMessage,response:ServerResponse){
  let token=String(request.headers.cookie??'').match(/(?:^|;\s*)hmo_viewer=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token){token=randomBytes(32).toString('hex');const secure=String(request.headers['x-forwarded-proto']??'').startsWith('https')||!/^(localhost|127\.0\.0\.1)(:|$)/.test(String(request.headers.host??''));response.setHeader('set-cookie','hmo_viewer='+token+'; Path=/; HttpOnly; Max-Age=2592000; SameSite='+(secure?'None; Secure; Partitioned':'Lax'));}
  return 'guest:'+createHash('sha256').update(token).digest('hex');
}
export async function handleHearMeOutBroadcastWindow(request:IncomingMessage,response:ServerResponse,url:URL,program:HearMeOutBroadcastProgram,worker:HearMeOutRoomBroadcast|undefined,media:HearMeOutSuiteMediaResolverV1|undefined,clientId='',readOnly=false,hosting?:{guildIds?:string[];authorizeRoom:(request:IncomingMessage,roomId:string)=>Promise<void>},screens?:HearMeOutScreenBroadcast){
  const screenFeed=url.pathname.match(/^\/api\/watch\/sessions\/([^/]+)\/screen\/([a-f0-9-]{36})\/([^/]+)$/);
  const parties=url.pathname==='/api/watch/broadcast/rooms';
  const entry=['/watch','/activity','/activity-lite'].includes(url.pathname)||(url.pathname==='/'&&url.searchParams.has('frame_id'));
  const state=url.pathname==='/api/watch/broadcast/state'||/^\/api\/watch\/sessions\/[^/]+\/state$/.test(url.pathname);
  const feed=!state&&url.pathname.match(/^\/api\/watch\/(?:broadcast|sessions\/[^/]+\/broadcast)\/([^/]+)$/);
  const movieSearch=url.pathname==='/api/watch/broadcast/movies',control=url.pathname==='/api/watch/broadcast/control';
  const defaults=url.pathname==='/api/watch/activity-default',requestVideo=url.pathname==='/api/watch/broadcast/requests';
  const browserMedia=url.pathname.match(/^\/api\/watch\/broadcast\/youtube\/([A-Za-z0-9_-]{11})\/(status|audio|video)$/);
  if(!screenFeed&&!parties&&!entry&&!state&&!feed&&!defaults&&!requestVideo&&!movieSearch&&!browserMedia&&!control)return false;
  try{
    const channel=():HearMeOutPartyChannel|undefined=>{
      const guildId=url.searchParams.get('guildId'),channelId=url.searchParams.get('channelId');
      if(!guildId&&!channelId)return undefined;
      if(!guildId||!channelId||!hosting?.guildIds?.includes(guildId))throw Error('This Discord space is not connected to HearMeOut');
      return {guildId,channelId};
    };
    const sourceRoomId=()=>url.searchParams.get('appRoomId')??undefined;
    const contextualRoom=()=>{const currentChannel=channel();return currentChannel?program.channelRoom(currentChannel):sourceRoomId()?program.hostedRoom(sourceRoomId()!):undefined;};
    const authorizeHost=async(roomId:string)=>{
      const currentChannel=channel();
      if(currentChannel){const hosted=program.channelRoom(currentChannel);if(!hosted||hosted.roomId!==roomId)throw Object.assign(Error('Join the Discord voice channel that hosts this party to control it'),{status:403});program.touchRoom(roomId);return;}
      const source=sourceRoomId();
      if(source){if(!hosting)throw Object.assign(Error('HearMeOut room hosting is unavailable'),{status:403});await hosting.authorizeRoom(request,source);const hosted=program.hostedRoom(source);if(!hosted||hosted.roomId!==roomId)throw Object.assign(Error('This HearMeOut room does not host that party'),{status:403});program.touchRoom(roomId);return;}
      throw Object.assign(Error('Join a HearMeOut room or Discord voice channel to host or control a watch party'),{status:403});
    };
    if(parties){
      const viewer=guest(request,response);program.pruneIdleRooms();
      const currentChannel=channel();
      if(request.method==='GET'){
        const hosted=currentChannel?program.channelRoom(currentChannel):sourceRoomId()?program.hostedRoom(sourceRoomId()!):undefined;
        return send(response,200,{rooms:program.listRooms().map(room=>{
          const session=program.getSession(program.binding.tenantId,room.roomId);
          return {roomId:room.roomId,name:room.name,createdAt:room.createdAt,title:session.current?.item.title??null,mediaType:session.current?.item.type??null,status:session.playback.status,queueLength:session.queue.length,screen:screens?.state(room.roomId)??{active:false,ready:false}};
        }),hostedRoomId:hosted?.roomId??null,canHost:Boolean(currentChannel||sourceRoomId())});
      }
      if(request.method!=='POST')return send(response,405,{error:'Method not allowed'});
      if(readOnly)return send(response,503,{error:'Creating watch parties is unavailable in this preview'});
      if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)return send(response,403,{error:'Invalid request origin'});
      const source=sourceRoomId();if(!currentChannel&&!source)throw Object.assign(Error('Join a HearMeOut room or Discord voice channel to host a watch party'),{status:403});
      const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>4096)throw Error('Request is too large');chunks.push(bytes);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(typeof body?.name!=='string')throw Error('Enter a party name');
      const key=request.headers['idempotency-key'];if(typeof key!=='string'||!key||key.length>200)throw Error('A room request key is required');
      if(source){if(!hosting)throw Error('Room hosting is unavailable');await hosting.authorizeRoom(request,source);}
      const room=program.createRoom({name:body.name,requesterId:viewer,operationId:key,...(source?{sourceRoomId:source}:{}),...(currentChannel?{channel:currentChannel}:{})});
      return send(response,201,{roomId:room.roomId,name:room.name});
    }
    if(defaults){if(request.method!=='GET')return send(response,405,{error:'Method not allowed'});const hosted=contextualRoom();return send(response,200,{sessionId:hosted?.roomId??null,canHost:Boolean(channel()||sourceRoomId())});}
    const alias=url.pathname.match(/^\/api\/watch\/sessions\/([^/]+)\//)?.[1];
    const selected=url.searchParams.get('roomId')??(alias?decodeURIComponent(alias):undefined);
    if(selected&&['main-broadcast','discord-watch-room','discord-music-room'].includes(selected))throw Object.assign(Error('This legacy shared player no longer exists. Choose a room-owned watch party.'),{status:410});
    const roomId=selected===PUBLIC_LOUNGE_ID?(program.hostedRoom(PUBLIC_LOUNGE_ID)?.roomId??selected):(selected??'');
    if(!entry&&!roomId)throw Object.assign(Error('Choose a watch party'),{status:400});
    if(roomId)program.getRoom(roomId);
    if(screenFeed){if(request.method!=='GET'||!screens)return send(response,404,{error:'Screen share not found'});await screens.serve(roomId,screenFeed[2]!,screenFeed[3]!,response);return true;}
    if(control){
      if(request.method!=='POST')return send(response,405,{error:'Method not allowed'});
      if(readOnly)return send(response,503,{error:'Broadcast controls are unavailable in this preview'});
      if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)return send(response,403,{error:'Invalid request origin'});
      await authorizeHost(roomId);
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>4096)throw Error('Request is too large');chunks.push(bytes);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||!['skip','clear'].includes(body.action))throw Error('Choose skip or clear queue');
      if(body.expectedRequestId!==undefined&&typeof body.expectedRequestId!=='string')throw Error('Invalid request reference');
      program.control({tenantId:program.binding.tenantId,userId:guest(request,response),displayName:'Viewer',roles:[]},{roomId,action:body.action,...(body.expectedRequestId?{expectedRequestId:body.expectedRequestId}:{})});
      return send(response,200,{...broadcastView(program,Boolean(worker),false,undefined,roomId),canManage:true,screen:screens?.state(roomId)??{active:false,ready:false}});
    }
    if(browserMedia){
      if(readOnly||!worker)return send(response,503,{error:'Browser media caching is unavailable'});
      await authorizeHost(roomId);
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
      await authorizeHost(roomId);
      const items=await program.searchMovies(url.searchParams.get('q')??'',guest(request,response),media);
      return send(response,200,{items});
    }
    if(requestVideo){
      if(request.method!=='POST')return send(response,405,{error:'Method not allowed'});
      if(readOnly)return send(response,503,{error:'Broadcast requests are unavailable in this preview'});
      if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)return send(response,403,{error:'Invalid request origin'});
      await authorizeHost(roomId);
      const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>4096)throw Error('Request is too large');chunks.push(bytes);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||typeof body.query!=='string')throw Error('Enter a video title or link');
      if(body.lane!==undefined&&body.lane!=='music'&&body.lane!=='movie')throw Error('Choose music or movie');
      if(body.selectedItemId!==undefined&&(body.lane!=='movie'||typeof body.selectedItemId!=='string'||!/^xtream-vod-\d+$/.test(body.selectedItemId)))throw Error('Choose a movie from the search results');
      if(!media)return send(response,503,{error:'The media worker is unavailable'});
      const rawKey=request.headers['idempotency-key'];if(rawKey!==undefined&&(typeof rawKey!=='string'||rawKey.length>200))throw Error('Invalid request key');
      const requesterId=guest(request,response);
      try{await program.request({roomId,requesterId,displayName:typeof body.displayName==='string'?body.displayName.replace(/[\r\n\0]/g,' ').slice(0,120):'Viewer',query:body.query,lane:body.lane??'movie',...(body.browserPlayback===true&&body.browserPrepared!==true?{browserPreparation:true}:{}),...(body.selectedItemId?{selectedItemId:body.selectedItemId}:{}),operationId:rawKey??randomUUID()},media);}catch(error){
        const browserError=error as Error&{code?:string;videoId?:string;title?:string};
        if(browserError.code!=='youtube-browser-required')throw error;
        for(const [key,value] of browserRequests)if(value.until<Date.now())browserRequests.delete(key);
        if(browserRequests.size>=500)browserRequests.delete(browserRequests.keys().next().value!);
        browserRequests.set(requesterId,{videoId:browserError.videoId!,until:Date.now()+15*60*1000});
        return send(response,409,{error:browserError.message,code:browserError.code,videoId:browserError.videoId,title:browserError.title});
      }
      return send(response,201,{...broadcastView(program,Boolean(worker),false,undefined,roomId),canManage:true,screen:screens?.state(roomId)??{active:false,ready:false}});
    }
    if(request.method!=='GET'&&request.method!=='HEAD')return send(response,405,{error:'Method not allowed'});
    if(entry){guest(request,response);response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(renderHearMeOutBroadcastWindow(clientId));return true;}
    if(feed){if(!worker)return send(response,503,{error:'The broadcast worker is unavailable'});await worker.serve(program.binding.tenantId,roomId,'movie',feed[1]!,response);return true;}
    guest(request,response);
    const hosted=contextualRoom();
    return send(response,200,{...broadcastView(program,Boolean(worker),worker?.ready(program.binding.tenantId,roomId,'movie')??false,worker?.epoch(program.binding.tenantId,roomId,'movie'),roomId),canManage:hosted?.roomId===roomId,screen:screens?.state(roomId)??{active:false,ready:false}});
  }catch(error){return send(response,error instanceof SpmtApiError?error.status:(error as {status?:number}).status??400,{error:(error instanceof Error?error.message:String(error)).replace(/((?:token|authorization|secret|password|cookie))\s*[:=]\s*\S+/gi,'$1=[redacted]').slice(0,400)});}
}
function send(response:ServerResponse,status:number,value:unknown){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));return true;}

export function renderHearMeOutBroadcastWindow(clientId:string){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HearMeOut watch parties</title><style>html,body{margin:0;width:100%;max-width:100%;overflow-x:hidden;background:#080d18;color:#eef2ff;font:16px system-ui}main:fullscreen{overflow:auto;background:#080d18;max-width:none}main{max-width:1100px;margin:auto;padding:12px}video{display:block;width:100%;aspect-ratio:16/9;max-height:65vh;background:#000}video.video-off{visibility:hidden}nav,form{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}button,input,select{font:inherit;padding:9px;border:1px solid #526179;border-radius:7px;background:#18243b;color:inherit}input[name=query]{flex:1;min-width:200px}#error{color:#fbbf24}#movie-results button{display:block;width:100%;text-align:left;margin:8px 0}h1{font-size:20px}.viewer-controls{position:absolute;z-index:2;inset:auto 12px 12px;max-height:min(70vh,620px);overflow:auto;padding:12px;border:1px solid #526179;border-radius:12px;background:#080d18e8;box-shadow:0 12px 36px #000b;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s ease,transform .18s ease}main:hover .viewer-controls,.viewer-controls:focus-within,.viewer-controls:hover{opacity:1;transform:none;pointer-events:auto}main{position:relative;max-width:none;height:100dvh;padding:0;overflow:hidden}video{height:100%;min-width:0;max-width:100%;max-height:none;object-fit:contain}#view-toggle,#exit-expanded{position:absolute;right:12px;top:12px;z-index:4}#exit-expanded{right:120px}main.controls-hidden .viewer-controls{display:none}main.expanded{position:fixed;inset:0;z-index:9999;width:100%;height:100dvh}@media(hover:none){.viewer-controls{opacity:1;transform:none;pointer-events:auto;max-height:48vh}}@media(prefers-reduced-motion:reduce){.viewer-controls{transition:none}}[hidden]{display:none!important}#party-lobby{box-sizing:border-box;max-width:1100px;margin:auto;padding:clamp(16px,4vw,40px)}#party-lobby h1{font-size:28px}#party-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:12px}.party-card{padding:20px;border:1px solid #526179;border-radius:12px;background:#111d32}.party-card h2{margin:0 0 12px;font-size:20px;overflow-wrap:anywhere}.party-card p{overflow-wrap:anywhere;color:#cbd5e1}.party-card button{width:100%;cursor:pointer}#party-create input{flex:1;min-width:0}#party-error{color:#fbbf24}button:focus-visible,input:focus-visible{outline:2px solid #7dd3fc;outline-offset:3px}</style></head><body><section id="party-lobby"><h1>Watch parties</h1><p>Browse and watch any active party. Hosting is available only from a HearMeOut room or Discord voice channel.</p><form id="party-create"><input name="name" aria-label="Watch party name" placeholder="Name your watch party" maxlength="120" required><button type="submit">Create watch party</button></form><p id="party-context"></p><p id="discord-status" role="status"></p><p id="party-error" role="alert"></p><nav><button id="party-refresh" type="button">Refresh parties</button></nav><div id="party-list" aria-live="polite">Loading watch parties…</div></section><main hidden><video id="player" playsinline></video><button id="view-toggle" aria-pressed="false">Controls</button><button id="exit-expanded" hidden>Exit full view</button><section class="viewer-controls"><nav><button id="party-back" type="button">Watch parties</button><strong id="party-name"></strong><label>Output <select id="output"><option value="program">Movie / music</option><option value="screen">Screen share</option></select></label></nav><p id="status" role="status">Connecting to the broadcast…</p><p id="error" role="alert"></p><p id="playback-error" role="status"></p><nav><button id="audio-toggle" aria-pressed="true">Audio: on</button><button id="video-toggle" aria-pressed="true">Video: on</button><button id="sound">Enable sound</button><input id="volume" type="range" min="0" max="100" value="0" aria-label="Volume on this device"><select id="audio-language" aria-label="Audio language" hidden></select><button id="disconnect">Disconnect</button><button id="retry">Reset player</button><button id="fullscreen">Fullscreen</button><button id="popout">Pop out</button></nav><h2 id="title">Nothing playing</h2><form id="request-form"><select name="lane" aria-label="Request type"><option value="movie">Movie / video</option><option value="music">Music</option></select><input name="query" aria-label="Music or movie request" placeholder="Song, movie title, or media link" maxlength="300" required><button id="request-submit">Request</button></form><section id="movie-results" aria-label="Matching movies" hidden></section><nav id="queue-controls" aria-label="Shared queue controls"><button id="skip" disabled>Skip</button><button id="clear-queue" disabled>Clear queue</button><span>Clear queue keeps the current item playing.</span></nav><ol id="queue"></ol></section></main><script src="/api/hearmeout/playback-source.js"></script><script src="/api/hearmeout/youtube-browser.js"></script><script>const CLIENT_ID='+JSON.stringify(clientId).replace(/</g,'\\u003c')+';'+HEARMEOUT_DISCORD_HANDSHAKE_JS+BROADCAST_WINDOW_JS+'</script></body></html>';
}
export const BROADCAST_WINDOW_JS=String.raw`
(()=>{
  const refinement=document.createElement('style');refinement.textContent='main{background:#000}.viewer-controls{inset:auto 10px 10px;max-height:min(72vh,560px);border:0;border-radius:10px;background:#080d18f2}.controls-hidden .viewer-controls{display:none!important}main:not(.controls-hidden) .viewer-controls{opacity:1;transform:none;pointer-events:auto}main:hover #view-toggle,main:focus-within #view-toggle,#view-toggle:focus-visible{opacity:1;pointer-events:auto}#view-toggle{opacity:0;pointer-events:none;border:0;background:#080d18d9;transition:opacity .16s ease}@media(hover:none){#view-toggle{opacity:1;pointer-events:auto}.viewer-controls{opacity:1;transform:none;pointer-events:auto}}';document.head.append(refinement);
  const preferences={getItem:key=>{try{return localStorage.getItem(key)}catch{return null}},setItem:(key,value)=>{try{localStorage.setItem(key,value)}catch{}}};
  const video=document.getElementById('player'),status=document.getElementById('status'),error=document.getElementById('error'),volume=document.getElementById('volume'),sound=document.getElementById('sound');
  const playbackError=document.getElementById('playback-error'),disconnect=document.getElementById('disconnect'),retry=document.getElementById('retry'),audioToggle=document.getElementById('audio-toggle'),videoToggle=document.getElementById('video-toggle');
  const source=new window.HearMeOutPlaybackSource(video,e=>{playbackError.textContent=e.message},document.getElementById('audio-language'));
  const params=new URLSearchParams(location.search),frameId=params.get('frame_id'),fixedLounge=params.get('roomId')==='system-spacemountainlive-lounge';
  let level=fixedLounge?85:Number(preferences.getItem('hmo-broadcast-volume')||0),lastAudible=level||85,sourceUrl='',busy=false,disposed=false,pendingRequest,requestInFlight=false,lastRevision=-1,playPending,selectedMovie,connected=true,currentRequest='',currentEpoch='',retryAt=0,latestState,controlBusy=false,statePollFailed=false;
  let audioEnabled=fixedLounge||preferences.getItem('hmo-broadcast-audio')!=='off',videoEnabled=preferences.getItem('hmo-broadcast-video')!=='off';
  const movieResults=document.getElementById('movie-results'),requestForm=document.getElementById('request-form'),queueControls=document.getElementById('queue-controls');
  function setVolume(value){level=Math.max(0,Math.min(100,value));if(level)lastAudible=level;video.volume=level/100;volume.value=String(level);sound.textContent=level?'Mute locally':'Enable sound';preferences.setItem('hmo-broadcast-volume',String(level));}
  function setAudioEnabled(value){audioEnabled=Boolean(value);video.muted=!audioEnabled;audioToggle.textContent='Audio: '+(audioEnabled?'on':'off');audioToggle.setAttribute('aria-pressed',String(audioEnabled));preferences.setItem('hmo-broadcast-audio',audioEnabled?'on':'off');}
  function setVideoEnabled(value){videoEnabled=Boolean(value);video.classList.toggle('video-off',!videoEnabled);videoToggle.textContent='Video: '+(videoEnabled?'on':'off');videoToggle.setAttribute('aria-pressed',String(videoEnabled));preferences.setItem('hmo-broadcast-video',videoEnabled?'on':'off');}
  setVolume(level);setAudioEnabled(audioEnabled);setVideoEnabled(videoEnabled);
  const output=document.getElementById('output');let selectedOutput=params.get('output')==='screen'?'screen':'program';output.value=selectedOutput;
  const storage={getItem:key=>{try{return sessionStorage.getItem(key)}catch{return null}},setItem:(key,value)=>{try{sessionStorage.setItem(key,value)}catch{}}};
  let activeParty='',partyName='',lobbyBusy=false,directorySignature='',pendingCreation,hostedRoomId='';
  const lobby=document.getElementById('party-lobby'),playerPane=document.querySelector('main'),partyList=document.getElementById('party-list'),partyError=document.getElementById('party-error'),partyCreate=document.getElementById('party-create');
  playerPane.classList.add('controls-hidden');
  if(fixedLounge){document.getElementById('view-toggle').hidden=true;document.getElementById('party-back').hidden=true;}
  const hostingParams=new URLSearchParams();
  if(params.get('appRoomId'))hostingParams.set('appRoomId',params.get('appRoomId'));
  if(frameId&&params.get('guild_id')&&params.get('channel_id')){hostingParams.set('guildId',params.get('guild_id'));hostingParams.set('channelId',params.get('channel_id'));}
  for(const key of ['guildId','channelId'])if(params.get(key)&&!hostingParams.has(key))hostingParams.set(key,params.get(key));
  const partiesUrl='/api/watch/broadcast/rooms'+(hostingParams.size?'?'+hostingParams:'');
  function showParties(){if(fixedLounge)return;if(params.has('popout')&&localOwner.hearMeOutWatchPopouts[activeParty]===window)delete localOwner.hearMeOutWatchPopouts[activeParty];storage.setItem('hmo-party:'+(params.get('instance_id')||'browser'),'');activeParty='';lastRevision=-1;latestState=undefined;sourceUrl='';source.clear();lobby.hidden=false;playerPane.hidden=true;const next=new URL(location.href);next.searchParams.delete('roomId');history.replaceState(null,'',next);void refreshParties();}
  function watchParty(room){activeParty=room.roomId;storage.setItem('hmo-party:'+ (params.get('instance_id')||'browser'),activeParty);if(params.has('popout'))localOwner.hearMeOutWatchPopouts[activeParty]=window;connected=params.has('popout')||!localOwner.hearMeOutWatchPopouts[activeParty]||localOwner.hearMeOutWatchPopouts[activeParty].closed;disconnect.textContent=connected?'Disconnect':'Watch again';partyName=room.name;lastRevision=-1;latestState=undefined;currentRequest='';currentEpoch='';sourceUrl='';source.clear();error.textContent='';playbackError.textContent='';lobby.hidden=true;playerPane.hidden=false;document.getElementById('party-name').textContent=partyName;const next=new URL(location.href);next.searchParams.set('roomId',activeParty);history.replaceState(null,'',next);void refresh();}
  async function refreshParties(){
    if(lobbyBusy||disposed||activeParty)return;lobbyBusy=true;
    try{const data=await api(partiesUrl);if(activeParty)return;partyError.textContent='';hostedRoomId=data.hostedRoomId||'';partyCreate.hidden=!data.canHost;partyCreate.querySelector('button').textContent=hostedRoomId?'Watch hosted party':'Create watch party';partyCreate.querySelector('input').required=!hostedRoomId;partyCreate.querySelector('input').hidden=Boolean(hostedRoomId);partyCreate.dataset.hostedRoomId=hostedRoomId;
      document.getElementById('party-context').textContent=hostedRoomId?'This voice room already owns one party. Watch it here, or browse another party without changing your voice room.':data.canHost?'Create one shared player for this voice room.':'View-only mode. Join a HearMeOut room or open the Activity from a Discord voice channel to host or control a party.';
      const signature=JSON.stringify(data.rooms);if(signature===directorySignature)return;directorySignature=signature;partyList.replaceChildren();
      if(!data.rooms.length)partyList.textContent='No watch parties are active right now.';
      for(const room of data.rooms){const card=document.createElement('article');card.className='party-card';const name=document.createElement('h2');name.textContent=room.name;const now=document.createElement('p');now.textContent=room.screen?.active?'Sharing: '+room.screen.title:room.title?(room.mediaType==='music'?'Listening: ':'Watching: ')+room.title:'Nothing playing yet';const button=document.createElement('button');button.textContent='Watch party';button.addEventListener('click',()=>watchParty(room));card.append(name,now,button);partyList.append(card);}
    }catch(e){partyError.textContent=e.message;}finally{lobbyBusy=false;}
  }
  document.getElementById('party-refresh').addEventListener('click',refreshParties);
  document.getElementById('party-back').addEventListener('click',showParties);
  partyCreate.addEventListener('submit',async event=>{event.preventDefault();if(event.target.hidden)return;if(event.target.dataset.hostedRoomId){watchParty({roomId:event.target.dataset.hostedRoomId,name:'Your room’s watch party'});return;}const name=event.target.elements.name.value.trim(),button=event.target.querySelector('button');if(button.disabled)return;if(pendingCreation?.name!==name)pendingCreation={name,key:crypto.randomUUID()};button.disabled=true;partyError.textContent='';try{const room=await api(partiesUrl,{method:'POST',headers:{'content-type':'application/json','idempotency-key':pendingCreation.key},body:JSON.stringify({name})});pendingCreation=undefined;hostedRoomId=room.roomId;watchParty(room);}catch(e){if(e.status)pendingCreation=undefined;partyError.textContent=e.message;}finally{button.disabled=false;}});

  const skip=document.getElementById('skip'),clearQueue=document.getElementById('clear-queue'),popout=document.getElementById('popout');
  let localOwner=window;try{if(window.opener?.location.origin===location.origin)localOwner=window.opener;else if(window.top.location.origin===location.origin)localOwner=window.top;}catch{}
  localOwner.hearMeOutWatchPopouts=localOwner.hearMeOutWatchPopouts||{};
  if(!params.has('popout')&&localOwner.hearMeOutWatchPopouts[activeParty]&&!localOwner.hearMeOutWatchPopouts[activeParty].closed){connected=false;disconnect.textContent='Watch again';}
  if(frameId){if(!hostingParams.has('channelId')){partyCreate.hidden=true;partyError.textContent='View-only: reopen the Activity from a server voice channel to host a party.';}popout.hidden=true;}
  window.connectHearMeOutDiscord?.(CLIENT_ID,message=>{document.getElementById('discord-status').textContent=message});
  async function api(path,init){
    if(activeParty&&path.startsWith('/api/watch/broadcast/')&&!path.startsWith('/api/watch/broadcast/rooms')){path+=(path.includes('?')?'&':'?')+'roomId='+encodeURIComponent(activeParty);for(const [key,value] of hostingParams)path+='&'+encodeURIComponent(key)+'='+encodeURIComponent(value);}
    let response;try{response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(init?190000:path.startsWith('/api/watch/broadcast/movies?')?60000:15000),...init});}
    catch(cause){throw Object.assign(Error(init?'The request is taking longer than expected. It may still complete; retry without changing the request.':'The broadcast connection was interrupted. Reconnecting automatically…'),{cause,transient:true});}
    const unavailable=()=>Error('The media service returned an unexpected page'+(response.ok?'':' (HTTP '+response.status+')')+'. Reconnect and retry.');
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
    if(disposed||(state.sessionId!==activeParty&&!(fixedLounge&&activeParty==='system-spacemountainlive-lounge'))||state.revision<lastRevision)return;lastRevision=state.revision;latestState=state;
    const canManage=state.canManage===true;requestForm.hidden=!canManage;queueControls.hidden=!canManage;skip.disabled=!canManage||controlBusy||!state.current;clearQueue.disabled=!canManage||controlBusy||!state.queue.length;
    status.textContent=!connected?'Disconnected on this device. The broadcast continues.':requestInFlight?'Preparing your request…':state.playback.status==='idle'?(canManage?'Nothing playing. Request music or a movie below.':'Nothing playing. You are watching this party in view-only mode.'):'Broadcast: '+state.playback.status;
    document.getElementById('title').textContent=state.current?.item.title||'Nothing playing';
    const queue=document.getElementById('queue');queue.replaceChildren();for(const request of state.queue){const li=document.createElement('li');li.textContent=request.item.title;queue.append(li);}
    if(selectedOutput==='screen'){
      const screen=state.screen||{};retry.disabled=!connected||!screen.active;
      document.getElementById('title').textContent=screen.title||'Screen share';
      status.textContent=!connected?'Disconnected on this device.':screen.active?'Screen share · '+(screen.ready?'Live':'Preparing…'):'No screen is being shared.';
      if(!connected||!screen.active){sourceUrl='';source.clear();currentRequest='';currentEpoch='';return;}
      if(!screen.ready){playbackError.textContent='Preparing the shared screen…';return;}
      if(sourceUrl!==screen.playbackUrl||currentEpoch!==screen.epoch||(source.failed&&Date.now()>=retryAt)){sourceUrl=screen.playbackUrl;currentEpoch=screen.epoch;currentRequest='';retryAt=Date.now()+10000;source.load(sourceUrl,true,true);}
      if(video.readyState>=2)void play();return;
    }
    retry.disabled=!connected||!state.current;
    if(!connected||!state.current){if(sourceUrl){sourceUrl='';source.clear();}currentRequest='';playbackError.textContent='';return;}
    if(!state.broadcast.configured){playbackError.textContent='The broadcast worker is unavailable.';return;}
    if(!state.broadcast.ready){if(!sourceUrl)playbackError.textContent='Preparing the first playable segment…';return;}
    if(sourceUrl!==state.broadcast.playbackUrl||currentRequest!==state.current.requestId||(state.broadcast.epoch&&currentEpoch!==state.broadcast.epoch)||(source.failed&&Date.now()>=retryAt)){
      sourceUrl=state.broadcast.playbackUrl;currentRequest=state.current.requestId;currentEpoch=state.broadcast.epoch||'';retryAt=Date.now()+10000;playbackError.textContent='Connecting to the broadcast…';source.load(sourceUrl,true,true);
    }
    if(video.readyState>=2)void play();
  }
  async function refresh(){
    if(busy||disposed||!activeParty)return;busy=true;
    try{const state=await api('/api/watch/broadcast/state');if(statePollFailed){error.textContent='';statePollFailed=false;}applyState(state);}
    catch(e){statePollFailed=true;if(e.status===404){showParties();return;}error.textContent=e.message;}finally{busy=false;}
  }
  output.addEventListener('change',()=>{selectedOutput=output.value;source.clear();sourceUrl='';currentRequest='';currentEpoch='';playbackError.textContent='';const next=new URL(location.href);next.searchParams.set('output',selectedOutput);history.replaceState(null,'',next);if(latestState)applyState(latestState);});
  audioToggle.addEventListener('click',()=>{setAudioEnabled(!audioEnabled);if(audioEnabled&&level===0)setVolume(lastAudible);void play()});
  videoToggle.addEventListener('click',()=>setVideoEnabled(!videoEnabled));
  sound.addEventListener('click',()=>{if(!audioEnabled)setAudioEnabled(true);setVolume(level?0:lastAudible);void play()});
  volume.addEventListener('input',event=>{if(!audioEnabled&&Number(event.target.value)>0)setAudioEnabled(true);setVolume(Number(event.target.value))});
  retry.addEventListener('click',()=>{source.clear();sourceUrl='';playbackError.textContent='';refresh()});
  function setConnected(value){connected=value;disconnect.textContent=value?'Disconnect':'Watch again';sourceUrl='';currentRequest='';source.clear();playbackError.textContent='';retry.disabled=!value;if(!value)status.textContent='Disconnected on this device. The broadcast continues.';if(latestState)applyState(latestState);else refresh();}
  disconnect.addEventListener('click',()=>{if(!connected&&localOwner.hearMeOutWatchPopouts[activeParty]&&!localOwner.hearMeOutWatchPopouts[activeParty].closed){localOwner.hearMeOutWatchPopouts[activeParty].close();localOwner.hearMeOutWatchPopouts[activeParty]=undefined;}setConnected(!connected);});
  popout.addEventListener('click',()=>{
    const prior=connected;setConnected(false);const existing=localOwner.hearMeOutWatchPopouts[activeParty];if(existing&&!existing.closed){existing.focus();return;}
    const popupUrl=new URL('/watch',location.origin);popupUrl.searchParams.set('popout','1');popupUrl.searchParams.set('roomId',activeParty);popupUrl.searchParams.set('output',selectedOutput);for(const [key,value] of hostingParams)popupUrl.searchParams.set(key,value);
    const popup=window.open(popupUrl.pathname+popupUrl.search,'hmo-watch-'+crypto.randomUUID(),'popup,width=1100,height=800');if(!popup){setConnected(prior);playbackError.textContent='Allow popups for HearMeOut to open this window.';return;}localOwner.hearMeOutWatchPopouts[activeParty]=popup;popup.focus();
  });
  if(params.has('popout'))popout.hidden=true;
  function setExpanded(value){playerPane.classList.toggle('expanded',value);playerPane.classList.toggle('controls-hidden',value);document.getElementById('exit-expanded').hidden=!value;document.getElementById('fullscreen').textContent=value?'Exit full view':'Fullscreen';if(window.parent!==window&&!frameId)window.parent.postMessage({type:'hmo:player-expanded',expanded:value},location.origin);}
  document.getElementById('view-toggle').addEventListener('click',()=>{if(fixedLounge)return;const hidden=playerPane.classList.toggle('controls-hidden');document.getElementById('view-toggle').setAttribute('aria-pressed',String(!hidden));});
  window.addEventListener('message',event=>{if(!fixedLounge&&event.origin===location.origin&&event.data?.type==='hmo:toggle-controls')document.getElementById('view-toggle').click()});
  document.getElementById('exit-expanded').addEventListener('click',async()=>{if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});setExpanded(false);});
  document.getElementById('fullscreen').addEventListener('click',async()=>{if(document.fullscreenElement){await document.exitFullscreen();setExpanded(false);return;}if(playerPane.classList.contains('expanded')){setExpanded(false);return;}setExpanded(true);playbackError.textContent='';try{if(playerPane.requestFullscreen)await playerPane.requestFullscreen();else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();}catch{}});
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)setExpanded(false)});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')setExpanded(false)});
  async function controlQueue(action){if(controlBusy||!latestState||latestState.canManage!==true)return;controlBusy=true;skip.disabled=true;clearQueue.disabled=true;error.textContent='';try{applyState(await api('/api/watch/broadcast/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...(action==='skip'?{expectedRequestId:latestState.current?.requestId}:{})})}));}catch(e){error.textContent=e.message;}finally{controlBusy=false;if(latestState)applyState(latestState);}}
  skip.addEventListener('click',()=>controlQueue('skip'));
  clearQueue.addEventListener('click',()=>controlQueue('clear'));
  requestForm.addEventListener('submit',async event=>{
    event.preventDefault();if(requestInFlight||disposed||latestState?.canManage!==true)return;const query=event.target.elements.query.value.trim(),lane=event.target.elements.lane.value,button=document.getElementById('request-submit');
    const selectedItemId=lane==='movie'&&selectedMovie?.query===query?selectedMovie.itemId:undefined;
    if(pendingRequest?.query!==query||pendingRequest?.lane!==lane||pendingRequest?.selectedItemId!==selectedItemId)pendingRequest={query,lane,selectedItemId,key:crypto.randomUUID()};
    requestInFlight=true;button.disabled=true;error.textContent='';status.textContent='Preparing your request…';
    try{
      if(lane==='movie'&&!/^https?:\/\//i.test(query)&&!selectedItemId){
        status.textContent='Searching movies…';const data=await api('/api/watch/broadcast/movies?q='+encodeURIComponent(query));if(event.target.elements.query.value.trim()!==query||event.target.elements.lane.value!==lane)return;
        movieResults.replaceChildren();movieResults.hidden=false;const heading=document.createElement('p');heading.textContent=data.items.length?'Choose a movie to request:':'No matching movies found. Try another title.';movieResults.append(heading);
        for(const item of data.items){const button=document.createElement('button');button.type='button';button.textContent=item.title+(item.year?' ('+item.year+')':'')+(item.quality?' · '+item.quality:'');button.dataset.movieId=item.itemId;button.addEventListener('click',()=>{if(requestInFlight)return;selectedMovie={query,itemId:item.itemId};event.target.requestSubmit();});movieResults.append(button);}status.textContent='Choose a movie from the results';pendingRequest=undefined;return;
      }
      const submit=(browserPrepared=false)=>api('/api/watch/broadcast/requests',{method:'POST',headers:{'content-type':'application/json','idempotency-key':pendingRequest.key},body:JSON.stringify({query,lane,browserPlayback:true,browserPrepared,...(selectedItemId?{selectedItemId}:{})})});
      let state;try{state=await submit();}catch(e){if(e.code!=='youtube-browser-required')throw e;try{await window.prepareHearMeOutYoutube(e.videoId,lane,message=>{status.textContent=message;});}catch{status.textContent='Starting the shared YouTube source…';}state=await submit(true);}
      pendingRequest=undefined;selectedMovie=undefined;movieResults.replaceChildren();movieResults.hidden=true;if(event.target.elements.query.value.trim()===query&&event.target.elements.lane.value===lane)event.target.reset();error.textContent='';requestInFlight=false;applyState(state);
    }catch(e){if(e.status)pendingRequest=undefined;error.textContent=e.message;status.textContent='Request not completed. You can retry.';}finally{requestInFlight=false;button.disabled=false;}
  });
  requestForm.addEventListener('input',()=>{selectedMovie=undefined;movieResults.replaceChildren();movieResults.hidden=true;});
  video.addEventListener('canplay',()=>{playbackError.textContent='';void play()});video.addEventListener('playing',()=>{playbackError.textContent='';});document.addEventListener('visibilitychange',()=>{if(!document.hidden)source.joinLive()});
  const restoredParty=params.get('roomId')||(frameId?storage.getItem('hmo-party:'+(params.get('instance_id')||'browser')):null);if(restoredParty)watchParty({roomId:restoredParty,name:'Watch party'});else void refreshParties();
  let timer,syncTimer;function resume(){disposed=false;busy=false;clearInterval(timer);clearInterval(syncTimer);timer=setInterval(()=>{if(activeParty)void refresh();else void refreshParties();},1500);syncTimer=setInterval(()=>{if(!document.hidden)source.syncLive()},5000);if(activeParty)void refresh();else void refreshParties();}
  resume();window.addEventListener('pageshow',event=>{if(event.persisted){sourceUrl='';currentEpoch='';resume();}});window.addEventListener('pagehide',()=>{disposed=true;clearInterval(timer);clearInterval(syncTimer);source.clear();sourceUrl='';});
})();`;
