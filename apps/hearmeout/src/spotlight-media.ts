import type {IncomingMessage, ServerResponse} from 'node:http';
import type {HearMeOutSpotlightBridge} from './spotlight-media-bridge.js';

function send(response: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8') {
  response.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  response.end(body);
  return true;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  return send(response, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

export async function handleSpotlightMedia(request: IncomingMessage, response: ServerResponse, url: URL, bridge?: HearMeOutSpotlightBridge) {
  if (url.pathname === '/spotlight-media') {
    if (request.method !== 'GET') return sendJson(response, 405, {error: 'method_not_allowed'});
    return send(response, 200, renderSpotlightControl(Boolean(bridge)));
  }
  if (url.pathname === '/spotlight-media/player') {
    if (request.method !== 'GET') return sendJson(response, 405, {error: 'method_not_allowed'});
    return send(response, 200, renderSpotlightPlayer());
  }
  if (url.pathname === '/api/spotlight-media/status') {
    if (request.method !== 'GET') return sendJson(response, 405, {error: 'method_not_allowed'});
    if (!bridge) return sendJson(response, 503, {error: 'Spotlight source is unavailable'});
    try { return sendJson(response, 200, await bridge.status()); }
    catch (error) { return sendJson(response, Number((error as {status?: number}).status || 502), {error: error instanceof Error ? error.message : String(error)}); }
  }
  if (url.pathname === '/api/spotlight-media/start') {
    if (request.method !== 'POST') return sendJson(response, 405, {error: 'method_not_allowed'});
    if (!bridge) return sendJson(response, 503, {error: 'Spotlight source is unavailable'});
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return sendJson(response, 403, {error: 'Invalid request origin'});
    try { return sendJson(response, 200, await bridge.start()); }
    catch (error) { return sendJson(response, Number((error as {status?: number}).status || 502), {error: error instanceof Error ? error.message : String(error)}); }
  }
  if (url.pathname === '/api/spotlight-media/consent') {
    if (request.method !== 'POST') return sendJson(response, 405, {error: 'method_not_allowed'});
    if (!bridge) return sendJson(response, 503, {error: 'Spotlight source is unavailable'});
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return sendJson(response, 403, {error: 'Invalid request origin'});
    try { return sendJson(response, 200, await bridge.consent()); }
    catch (error) { return sendJson(response, Number((error as {status?: number}).status || 502), {error: error instanceof Error ? error.message : String(error)}); }
  }
  const media = url.pathname.match(/^\/api\/spotlight-media\/broadcast\/(index\.m3u8|spotlight_\d{6}\.ts)$/);
  if (media) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, {error: 'method_not_allowed'});
    if (!bridge) return sendJson(response, 503, {error: 'Spotlight source is unavailable'});
    try {
      const upstream = await bridge.media(media[1]!, typeof request.headers.range === 'string' ? request.headers.range : undefined);
      const bytes = request.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await upstream.arrayBuffer());
      const headers: Record<string,string> = {
        'content-type': upstream.headers.get('content-type') || (media[1]!.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t'),
        'cache-control': media[1]!.endsWith('.m3u8') ? 'no-store' : 'public, max-age=120, immutable',
        'x-content-type-options': 'nosniff',
      };
      for (const name of ['content-range','accept-ranges']) {
        const value = upstream.headers.get(name); if (value) headers[name] = value;
      }
      headers['content-length'] = String(bytes.byteLength);
      response.writeHead(upstream.status, headers); response.end(bytes); return true;
    } catch (error) {
      return sendJson(response, Number((error as {status?: number}).status || 503), {error: error instanceof Error ? error.message : String(error)});
    }
  }
  return false;
}

function renderSpotlightControl(configured: boolean) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight source control</title><style>
html,body{margin:0;background:#071025;color:#edf7ff;font:16px system-ui}main{max-width:900px;margin:0 auto;padding:24px}button{padding:12px 18px;border:0;border-radius:10px;background:#69e8ff;color:#031120;font:800 16px system-ui;cursor:pointer}button:disabled{opacity:.55;cursor:default}p{color:#bdcae6;line-height:1.5}.preview{margin-top:18px;aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden}.preview iframe{width:100%;height:100%;border:0}#status{font-weight:700}
</style></head><body><main><h1>Spotlight source</h1><p>This controls the one persistent Twitch player. Press Start once. The Lounge and OBS only watch its shared output and never create their own Twitch player.</p><button id="start" type="button" ${configured?'':'disabled'}>${configured?'Start Spotlight':'Spotlight source unavailable'}</button> <button id="consent" type="button" ${configured?'':'disabled'}>Clear Twitch warning</button><p id="status">Checking source…</p><div class="preview"><iframe src="/spotlight-media/player?monitor=1" title="Spotlight shared output" allow="autoplay"></iframe></div></main><script>
const start=document.getElementById('start'),consent=document.getElementById('consent'),status=document.getElementById('status');
async function read(){try{const r=await fetch('/api/spotlight-media/status',{cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error||'status '+r.status);status.textContent=data.ready?'Spotlight is running · @'+(data.currentLogin||'live'):data.active?(data.activated?'Starting shared output…':'Source ready — press Start Spotlight'):'Source stopped — press Start Spotlight';if(data.activated)start.hidden=true;return data}catch(e){status.textContent=e.message;return null}}
start.addEventListener('click',async()=>{start.disabled=true;status.textContent='Starting the one Spotlight source…';try{const r=await fetch('/api/spotlight-media/start',{method:'POST',headers:{accept:'application/json'}}),data=await r.json();if(!r.ok)throw Error(data.error||'start '+r.status);start.hidden=true;status.textContent='Spotlight started'+(data.currentLogin?' · @'+data.currentLogin:'')}catch(e){status.textContent=e.message;start.disabled=false}});
consent.addEventListener('click',async()=>{consent.disabled=true;status.textContent='Clearing Twitch content warning on the canonical player…';try{const r=await fetch('/api/spotlight-media/consent',{method:'POST',headers:{accept:'application/json'}}),data=await r.json();if(!r.ok)throw Error(data.error||'consent '+r.status);status.textContent=data.warningCleared?'Twitch warning cleared on the canonical player.':'No Twitch warning button is currently visible.'}catch(e){status.textContent=e.message}finally{consent.disabled=false}});
read();setInterval(read,3000);
</script></body></html>`;
}

function renderSpotlightPlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight shared output</title><style>html,body,video{margin:0;width:100%;height:100%;overflow:hidden;background:#000}video{display:block;object-fit:contain}</style></head><body><video id="player" autoplay playsinline></video><script src="/api/hearmeout/playback-source.js"></script><script>
const video=document.getElementById('player'),source=new window.HearMeOutPlaybackSource(video,()=>{}),monitor=new URLSearchParams(location.search).get('monitor')==='1';
video.volume=.58;video.muted=monitor;source.load('/api/spotlight-media/broadcast/index.m3u8',true,true);
video.addEventListener('canplay',()=>video.play().catch(()=>{}));document.addEventListener('visibilitychange',()=>{if(!document.hidden){source.joinLive();video.play().catch(()=>{})}});setInterval(()=>{if(source.failed)source.retry();else source.syncLive();video.play().catch(()=>{})},5000);
</script></body></html>`;
}