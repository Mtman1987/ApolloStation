import type {IncomingMessage, ServerResponse} from 'node:http';
type Creator = {username: string; displayName: string};

const SPMT_ORIGIN = (process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/+$/, '');

function send(response: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8') {
  response.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  response.end(body);
  return true;
}

function cleanCreators(value: unknown): Creator[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).flatMap((row: any) => {
    const live = row?.isLive === true || row?.live === true || String(row?.status || '').toLowerCase() === 'live';
    const username = String(row?.twitchLogin || row?.username || row?.twitchUsername || row?.login || '').trim().replace(/^@/, '').toLowerCase();
    if (!live || !/^[a-z0-9_]{1,25}$/.test(username) || seen.has(username)) return [];
    seen.add(username);
    return [{username, displayName: String(row?.displayName || row?.twitchDisplayName || username).trim() || username}];
  });
}

async function creators(): Promise<Creator[]> {
  const response = await fetch(`${SPMT_ORIGIN}/api/live-community`, {
    headers: {Accept: 'application/json'}, cache: 'no-store', signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Canonical live creator feed returned ${response.status}`);
  const body = await response.json() as any;
  const data = body?.data && typeof body.data === 'object' ? body.data : body;
  const rows = [data?.shoutouts, data?.liveMembers, data?.items, data?.rows, data?.community].find((value) => Array.isArray(value)) || [];
  return cleanCreators(rows);
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight Media</title><style>body{margin:0;background:#071025;color:#edf7ff;font:16px system-ui}main{max-width:760px;margin:0 auto;padding:28px}a{display:inline-block;margin:8px 8px 8px 0;padding:12px 16px;border:0;border-radius:10px;background:#69e8ff;color:#031120;font:700 16px system-ui;text-decoration:none;cursor:pointer}p{color:#bdcae6;line-height:1.5}</style></head><body><main><h1>Spotlight Media</h1><p>This is its own permanent Spotlight program. Your HMO Music/Movie program is separate and unchanged.</p><a href="${player}" target="spotlight-media-player">Open permanent Spotlight source</a><p>Use that same URL as your OBS browser source. It reads the canonical live-community feed and rotates the approved live Twitch creators automatically.</p></main></body></html>`;
}

function renderSpotlightPlayer() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotlight Media player</title><style>html,body,#player{margin:0;width:100%;height:100%;background:#000;overflow:hidden}#readonly{position:fixed;z-index:2;inset:0;background:transparent}#sound{position:fixed;z-index:3;left:50%;top:50%;transform:translate(-50%,-50%);padding:12px 18px;border:0;border-radius:999px;background:#ff7a3d;color:#fff;font:700 15px system-ui;cursor:pointer;box-shadow:0 6px 24px #0008}#sound[hidden]{display:none}#notice{position:fixed;z-index:4;left:12px;bottom:12px;padding:8px 10px;border-radius:8px;background:#071025d9;color:#dceaff;font:13px system-ui;pointer-events:none}</style></head><body><div id="player"></div><div id="readonly" aria-hidden="true"></div><button id="sound" type="button">Enable sound</button><div id="notice">Loading Spotlight Media…</div><script>
const ROTATE_MS=600000,REFRESH_MS=60000;let list=[],index=-1,player,rotateTimer,refreshTimer,audioStarted=false;const notice=document.querySelector('#notice'),sound=document.querySelector('#sound');
function slotIndex(){return list.length?Math.floor(Date.now()/ROTATE_MS)%list.length:0}
function show(force=false){if(!list.length)return;const nextIndex=slotIndex(),next=list[nextIndex];if(!next)return;if(force||nextIndex!==index){index=nextIndex;if(player){player.setChannel(next.username);player.play();if(audioStarted){player.setMuted(false);player.setVolume(1)}}}notice.textContent='@'+next.username+' · Spotlight Media'}
function schedule(){clearTimeout(rotateTimer);show();const wait=ROTATE_MS-(Date.now()%ROTATE_MS)+100;rotateTimer=setTimeout(schedule,wait)}
async function load(){const r=await fetch('/api/spotlight-media/channels',{cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error||'Could not load creators');return Array.isArray(data.creators)?data.creators:[]}
async function refresh(){const fresh=await load().catch(()=>[]);if(fresh.length){list=fresh;show()}}
async function start(){list=await load();if(!list.length){notice.textContent='No approved live creators right now.';sound.hidden=true;return}const first=list[slotIndex()];const script=document.createElement('script');script.src='https://player.twitch.tv/js/embed/v1.js';script.onload=()=>{player=new Twitch.Player('player',{channel:first.username,width:'100%',height:'100%',parent:[location.hostname],autoplay:true,muted:true,controls:false});player.addEventListener(Twitch.Player.READY,()=>{index=slotIndex();player.play();notice.textContent='@'+list[index].username+' · Spotlight Media';schedule();refreshTimer=setInterval(refresh,REFRESH_MS)})};document.head.append(script)}
sound.addEventListener('click',()=>{if(!player)return;audioStarted=true;player.setMuted(false);player.setVolume(1);player.play();sound.hidden=true});
start().catch(()=>{notice.textContent='Could not load the Spotlight creator feed.';sound.hidden=true});
addEventListener('beforeunload',()=>{clearTimeout(rotateTimer);clearInterval(refreshTimer)});
</script></body></html>`;
}
