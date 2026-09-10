import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SqliteHearMeOutRoomMediaRuntime } from './room-media-core.js';
import { HEARMEOUT_ACTIVITY_ROOM_ID, HEARMEOUT_GLOBAL_WATCH_SESSION_ID, HEARMEOUT_MUSIC_WATCH_SESSION_ID, isHearMeOutDiscordActivityWatchSession, normalizeHearMeOutWatchSessionAlias } from './activity-contract.js';

export interface HearMeOutActivityBinding {
  // Operator configuration, never a tenant id supplied by the iframe.
  tenantId: string;
  clientId: string;
}

export function readHearMeOutActivityState(rooms: SqliteHearMeOutRoomMediaRuntime, binding: HearMeOutActivityBinding | undefined, rawSessionId?: string | null) {
  if (!binding?.tenantId) throw Object.assign(new Error('Discord Activity is not connected to a community yet.'), { status: 503 });
  if (!isHearMeOutDiscordActivityWatchSession(rawSessionId)) throw Object.assign(new Error('This Activity only opens the shared music and movie rooms.'), { status: 403 });
  const room = rooms.getRoom(binding.tenantId, HEARMEOUT_ACTIVITY_ROOM_ID);
  if (!room || room.privacy !== 'public' || !room.systemRoom) throw Object.assign(new Error('The shared Discord Activity room has not been initialized.'), { status: 404 });
  const music = rooms.getSession(binding.tenantId, room.roomId, 'music');
  const movie = rooms.getSession(binding.tenantId, room.roomId, 'movie');
  const defaultId = music.current && (!movie.current || Date.parse(music.playback.updatedAt) > Date.parse(movie.playback.updatedAt))
    ? HEARMEOUT_MUSIC_WATCH_SESSION_ID : HEARMEOUT_GLOBAL_WATCH_SESSION_ID;
  const sessionId = normalizeHearMeOutWatchSessionAlias(rawSessionId, defaultId);
  const session = sessionId === HEARMEOUT_MUSIC_WATCH_SESSION_ID ? music : movie;
  return { sessionId, roomId: room.roomId, current: session.current, queue: session.queue, playback: session.playback, revision: session.revision };
}

export function handleHearMeOutActivityRequest(request: IncomingMessage, response: ServerResponse, url: URL, rooms: SqliteHearMeOutRoomMediaRuntime, binding?: HearMeOutActivityBinding): boolean {
  const entry = ['/activity', '/activity-lite'].includes(url.pathname) || (url.pathname === '/' && Boolean(url.searchParams.get('frame_id')));
  const stateMatch = url.pathname.match(/^\/api\/watch\/sessions\/([^/]+)\/state$/);
  const defaults = url.pathname === '/api/watch/activity-default';
  if (!entry && !stateMatch && !defaults) return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, JSON.stringify({ error: 'Method not allowed' }), 'application/json');
    return true;
  }
  if (entry) {
    // The handshake and error UI must render even with no website session,
    // database binding, or media. Never mount the account login shell here.
    send(response, 200, renderHearMeOutActivity(binding?.clientId ?? ''), 'text/html');
    return true;
  }
  try {
    const state = readHearMeOutActivityState(rooms, binding, stateMatch?.[1] ?? url.searchParams.get('sessionId') ?? url.searchParams.get('session_id'));
    send(response, 200, JSON.stringify(defaults ? { sessionId: state.sessionId } : state), 'application/json');
  } catch (error) {
    const failure = error as Error & { status?: number };
    send(response, failure.status ?? 500, JSON.stringify({ error: failure.message }), 'application/json');
  }
  return true;
}

function send(response: ServerResponse, status: number, body: string, type: string) {
  response.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(body);
}

export function renderHearMeOutActivity(clientId: string) {
  const config = JSON.stringify(clientId).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HearMeOut Discord Activity</title>
<style>html,body{margin:0;min-height:100%;background:#080d18;color:#eef2ff;font:16px system-ui}main{max-width:1100px;margin:auto;padding:16px}nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap}button{padding:10px;border:1px solid #526179;border-radius:7px;background:#18243b;color:inherit;cursor:pointer}video{display:block;width:100%;max-height:65vh;background:#000;margin:16px 0}#error{color:#fbbf24}li{padding:6px}h1{font-size:20px}#status{color:#a5b4fc}</style></head><body><main>
<nav><h1>HearMeOut</h1><button data-session="discord-music-room">Music</button><button data-session="discord-watch-room">Movies</button><button id="sound">Enable sound</button><button id="retry">Reconnect</button></nav>
<p id="status" role="status">Connecting to the shared room…</p><p id="error" role="alert"></p><video id="player" playsinline muted></video><h2 id="title">Waiting for a request</h2><p>Requests and playback follow the same room as HearMeOut and Discord commands.</p><ol id="queue"></ol></main><script>
const CLIENT_ID=${config};
${HEARMEOUT_ACTIVITY_BROWSER_JS}
</script></body></html>`;
}

export const HEARMEOUT_ACTIVITY_BROWSER_JS = String.raw`
(() => {
  const params=new URLSearchParams(location.search), status=document.getElementById('status'), error=document.getElementById('error'), video=document.getElementById('player');
  let sessionId=params.get('sessionId')||params.get('session_id')||'', busy=false, currentId='', state=null;
  const frameId=params.get('frame_id');
  if(frameId&&CLIENT_ID){
    let origin='*';try{if(document.referrer)origin=new URL(document.referrer).origin}catch{}
    window.addEventListener('message',event=>{if(event.source!==window.parent||!Array.isArray(event.data))return;if(event.data[1]?.evt==='READY')status.textContent='Discord connected';});
    window.parent.postMessage([0,{v:1,encoding:'json',client_id:CLIENT_ID,frame_id:frameId,sdk_version:'2.5.0'}],origin);
  }
  async function api(path){const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error||'The shared room is unavailable');return data;}
  function mediaUrl(value){const url=new URL(value,location.href);if(/^\/v1\/media\/public\/[A-Za-z0-9_-]{43}$/.test(url.pathname))return url.pathname;return value;}
  function position(playback){return Math.max(0,Number(playback.position||0)+(playback.status==='playing'?Math.max(0,Date.now()-Date.parse(playback.updatedAt))/1000:0));}
  async function refresh(){
    if(busy)return;busy=true;const requested=sessionId;
    try{
      const id=requested||(await api('/api/watch/activity-default')).sessionId;
      const next=await api('/api/watch/sessions/'+encodeURIComponent(id)+'/state');
      if(requested!==sessionId)return;state=next;sessionId=next.sessionId;
      document.getElementById('title').textContent=next.current?.item.title||'Waiting for a request';
      const queue=document.getElementById('queue');queue.replaceChildren();for(const item of next.queue){const li=document.createElement('li');li.textContent=item.item.title;queue.append(li)}
      error.textContent='';status.textContent=next.playback.status==='idle'?'Room ready — request a song in Discord':'Shared room: '+next.playback.status;
      if(!next.current){video.pause();video.removeAttribute('src');currentId='';return}
      if(currentId!==next.current.requestId){currentId=next.current.requestId;video.src=mediaUrl(next.current.item.playbackUrl);video.load()}
      if(video.readyState>=2){const target=position(next.playback);if(Math.abs(video.currentTime-target)>3)video.currentTime=target;if(next.playback.status==='playing')await video.play();else video.pause()}
    }catch(e){status.textContent='Unable to connect';error.textContent=e.message||String(e)}finally{busy=false}
  }
  document.querySelectorAll('[data-session]').forEach(button=>button.addEventListener('click',()=>{sessionId=button.dataset.session;currentId='';refresh()}));
  document.getElementById('retry').addEventListener('click',refresh);
  document.getElementById('sound').addEventListener('click',async()=>{video.muted=!video.muted;document.getElementById('sound').textContent=video.muted?'Enable sound':'Mute locally';if(state?.playback.status==='playing')try{await video.play()}catch(e){error.textContent=e.message}});
  video.addEventListener('canplay',refresh);
  video.addEventListener('error',()=>{error.textContent='This media could not load in Discord. Reconnect to retry the shared source; its queue has been preserved.';currentId='';});
  refresh();const timer=setInterval(refresh,1500);window.addEventListener('pagehide',()=>clearInterval(timer));
})();`;
