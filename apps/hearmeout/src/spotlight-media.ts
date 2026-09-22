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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight Media</title><style>body{margin:0;background:#071025;color:#edf7ff;font:16px system-ui}main{max-width:760px;margin:0 auto;padding:28px}a{display:inline-block;margin:8px 8px 8px 0;padding:12px 16px;border:0;border-radius:10px;background:#69e8ff;color:#031120;font:700 16px system-ui;text-decoration:none;cursor:pointer}p{color:#bdcae6;line-height:1.5}</style></head><body><main><h1>Spotlight Media</h1><p>This is its own permanent Spotlight program. Your HMO Music/Movie program is separate and unchanged.</p><a href="${player}" target="spotlight-media-player">Open permanent Spotlight source</a><p>Use that same URL as your OBS browser source. Click Twitch once only if it asks; the player then rotates live creators automatically.</p></main></body></html>`;
}

function renderSpotlightPlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight Media player</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}</style></head><body><iframe id="spotlight" allow="autoplay; fullscreen" allowfullscreen title="Spotlight Media"></iframe><script>const source=new URL('${STREAMWEAVER_ORIGIN}/spotlight-lab/player');source.searchParams.set('parent',location.hostname);document.querySelector('#spotlight').src=source;</script></body></html>`;
}
