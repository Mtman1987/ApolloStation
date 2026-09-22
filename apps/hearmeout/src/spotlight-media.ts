import type {IncomingMessage, ServerResponse} from 'node:http';
import {SPOTLIGHT_MEDIA_ID} from './lounge-room.js';

type Creator = {username: string; displayName: string};

const STREAMWEAVER_ORIGIN = (process.env.STREAMWEAVER_ORIGIN || 'https://streamweaver-new.fly.dev').replace(/\/+$/, '');

function send(response: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8') {
  response.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  response.end(body);
  return true;
}

function cleanCreators(value: unknown): Creator[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap((row: any) => {
    const username = String(row?.username || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(username) || seen.has(username)) return [];
    seen.add(username);
    return [{username, displayName: String(row?.displayName || username).trim() || username}];
  });
}

async function creators(): Promise<Creator[]> {
  const load = async (group: string) => {
    const response = await fetch(`${STREAMWEAVER_ORIGIN}/api/lounge/live-shoutouts?group=${group}`, {
      headers: {Accept: 'application/json'}, cache: 'no-store', signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Live creator feed returned ${response.status}`);
    return cleanCreators((await response.json())?.creators);
  };
  const results = await Promise.allSettled([load('community'), load('partner')]);
  return cleanCreators(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
}

export async function handleSpotlightMedia(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (url.pathname === '/api/spotlight-media/channels') {
    if (request.method !== 'GET') return send(response, 405, JSON.stringify({error: 'method_not_allowed'}), 'application/json; charset=utf-8');
    try { return send(response, 200, JSON.stringify({creators: await creators()}), 'application/json; charset=utf-8'); }
    catch { return send(response, 200, JSON.stringify({creators: [], error: 'live_creator_feed_unavailable'}), 'application/json; charset=utf-8'); }
  }
  if (url.pathname === '/spotlight-media') return send(response, 200, renderSpotlightControl());
  if (url.pathname === '/spotlight-media/player') return send(response, 200, renderSpotlightPlayer());
  return false;
}

function renderSpotlightControl() {
  const player = '/spotlight-media/player';
  const viewer = `/watch?roomId=${encodeURIComponent(SPOTLIGHT_MEDIA_ID)}&output=screen`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight Media control</title><style>body{margin:0;background:#071025;color:#edf7ff;font:16px system-ui}main{max-width:760px;margin:0 auto;padding:28px}button,a{display:inline-block;margin:8px 8px 8px 0;padding:12px 16px;border:0;border-radius:10px;background:#69e8ff;color:#031120;font:700 16px system-ui;text-decoration:none;cursor:pointer}p{color:#bdcae6;line-height:1.5}#status{min-height:24px;color:#baf6ff}</style></head><body><main><h1>Spotlight Media</h1><p>This is its own permanent Spotlight program. Your HMO Music/Movie program is separate and unchanged.</p><a href="${player}" target="spotlight-media-player">Open the clean Spotlight player</a><button id="share">Share that player tab</button><a href="${viewer}" target="spotlight-media-viewer">Open the Spotlight output</a><p id="status">Open the player, click Twitch once if asked, then share that tab with audio enabled.</p></main><script>
let publisher,stream;const status=document.querySelector('#status');
async function call(url,init){const r=await fetch(url,{...init,signal:AbortSignal.timeout(15000)}),data=await r.json();if(!r.ok)throw Error(data.error||data.message||'Spotlight Media request failed');return data}
document.querySelector('#share').onclick=async()=>{try{stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});const accepted=await call('/api/hearmeout/rooms/${SPOTLIGHT_MEDIA_ID}/screen',{method:'POST'});let n=0,tail=Promise.resolve(),stopped=false;publisher={stop:()=>{stopped=true;for(const track of stream.getTracks())track.stop();fetch('/api/hearmeout/rooms/${SPOTLIGHT_MEDIA_ID}/screen/'+accepted.id,{method:'DELETE',keepalive:true}).catch(()=>{})}};stream.getVideoTracks()[0].addEventListener('ended',publisher.stop,{once:true});const rec=new MediaRecorder(stream,{mimeType:MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')?'video/webm;codecs=vp8,opus':'video/webm',videoBitsPerSecond:2000000,audioBitsPerSecond:128000});rec.ondataavailable=e=>{if(stopped||!e.data.size)return;const seq=n++;tail=tail.then(()=>call('/api/hearmeout/rooms/${SPOTLIGHT_MEDIA_ID}/screen/'+accepted.id+'?sequence='+seq,{method:'POST',headers:{'content-type':'video/webm'},body:e.data})).catch(err=>{status.textContent=err.message;publisher.stop()})};rec.start(1000);status.textContent='Spotlight Media is live. Keep the player tab open; viewers can reconnect to the shared feed.'}catch(e){status.textContent=e.message}};
</script></body></html>`;
}

function renderSpotlightPlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight Media player</title><style>html,body,#player{margin:0;width:100%;height:100%;background:#000;overflow:hidden}#notice{position:fixed;z-index:2;left:12px;bottom:12px;padding:8px 10px;border-radius:8px;background:#071025d9;color:#dceaff;font:13px system-ui}</style></head><body><div id="player"></div><div id="notice">Loading Spotlight Media…</div><script>let list=[],index=0,player;const notice=document.querySelector('#notice');function show(){const next=list[index];if(!next)return;if(player){player.setChannel(next.username);player.play()}notice.textContent='@'+next.username+' · rotates every 30 seconds'}async function start(){const r=await fetch('/api/spotlight-media/channels',{cache:'no-store'}),data=await r.json();list=Array.isArray(data.creators)?data.creators:[];if(!list.length){notice.textContent='No approved live creators right now.';return}const script=document.createElement('script');script.src='https://player.twitch.tv/js/embed/v1.js';script.onload=()=>{player=new Twitch.Player('player',{channel:list[0].username,width:'100%',height:'100%',parent:[location.hostname],autoplay:true,muted:false});player.addEventListener(Twitch.Player.READY,()=>{player.play();notice.textContent='Click Twitch Start Watching once if it asks.';setInterval(()=>{index=(index+1)%list.length;show()},30000);setInterval(async()=>{const fresh=await fetch('/api/spotlight-media/channels',{cache:'no-store'}).then(r=>r.json()).catch(()=>({}));if(Array.isArray(fresh.creators)&&fresh.creators.length)list=fresh.creators},30000)})};document.head.append(script)}start().catch(()=>notice.textContent='Could not load the Spotlight creator feed.')</script></body></html>`;
}
