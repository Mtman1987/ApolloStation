import type {IncomingMessage, ServerResponse} from 'node:http';
import {SPOTLIGHT_MEDIA_ID} from './lounge-room.js';

const STREAMWEAVER_ORIGIN = (process.env.STREAMWEAVER_ORIGIN || 'https://streamweaver-new.fly.dev').replace(/\/+$/, '');

function send(response: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8') {
  response.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  response.end(body);
  return true;
}

export async function handleSpotlightMedia(request: IncomingMessage, response: ServerResponse, url: URL) {
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight Media player</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}</style></head><body><iframe src="${STREAMWEAVER_ORIGIN}/spotlight-lab/player" allow="autoplay; fullscreen" allowfullscreen title="Spotlight Media"></iframe></body></html>`;
}
