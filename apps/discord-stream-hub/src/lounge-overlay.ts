import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DshLoungeStateStore } from "./lounge-state.js";
import { DshLoungeHostStore } from "./lounge-host.js";
import { SqliteDshLoungeAvatarStore } from "./lounge-avatar.js";
import { DshLoungeProgramScheduler, DSH_LOUNGE_RECOMMENDED_RESTART_HOURS, dshLoungeBroadcastClock } from "./lounge-program.js";

export class DshLoungeOverlayWeb {
  private readonly db: DatabaseSync;
  private readonly lounge: DshLoungeStateStore;
  private readonly host: DshLoungeHostStore;
  private readonly avatars: SqliteDshLoungeAvatarStore;
  private readonly scheduler = new DshLoungeProgramScheduler();
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS dsh_lounge_broadcast(tenant_id TEXT PRIMARY KEY,started_at TEXT NOT NULL,target_hours REAL NOT NULL) STRICT;");
    this.lounge = new DshLoungeStateStore(path, now); this.host = new DshLoungeHostStore(path, now); this.avatars = new SqliteDshLoungeAvatarStore(path);
  }
  close() { this.avatars.close(); this.host.close(); this.lounge.close(); this.db.close(); }

  handle(request: IncomingMessage, response: ServerResponse, url: URL) {
    if (request.method === "GET" && url.pathname === "/apps/discord-stream-hub/overlay/lounge") { this.overlay(response, url); return true; }
    if (request.method === "GET" && url.pathname === "/apps/discord-stream-hub/api/lounge/state") { this.state(response, url); return true; }
    return false;
  }

  private state(response: ServerResponse, url: URL) {
    try {
      const tenantId = tenant(url), state = this.lounge.view(tenantId), host = this.host.view(tenantId), avatar = this.avatars.get(tenantId), broadcast = this.broadcast(tenantId), clock = dshLoungeBroadcastClock(broadcast.startedAt, this.now(), broadcast.targetHours), program = this.scheduler.select(state, this.now(), clock);
      sendJson(response, 200, { schemaVersion: 1, twitchLogin: "spacemountainlive", state, host, avatar: avatar ?? null, broadcast: clock, program });
    } catch (error) { sendJson(response, 400, { error: safe(error) }); }
  }

  private overlay(response: ServerResponse, url: URL) {
    let tenantId: string; try { tenantId = tenant(url); } catch (error) { response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }); response.end(safe(error)); return; }
    const endpoint = `/apps/discord-stream-hub/api/lounge/state?tenant=${encodeURIComponent(tenantId)}`;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *" });
    response.end(renderOverlay(endpoint));
  }

  private broadcast(tenantId: string) {
    const row = this.db.prepare("SELECT started_at AS startedAt,target_hours AS targetHours FROM dsh_lounge_broadcast WHERE tenant_id=?").get(tenantId) as { startedAt: string; targetHours: number } | undefined;
    if (row) return row;
    const startedAt = this.now(), targetHours = DSH_LOUNGE_RECOMMENDED_RESTART_HOURS;
    this.db.prepare("INSERT INTO dsh_lounge_broadcast(tenant_id,started_at,target_hours) VALUES(?,?,?)").run(tenantId, startedAt, targetHours);
    return { startedAt, targetHours };
  }
}

function renderOverlay(endpoint: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SpaceMountainLive Lounge</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#030713;color:white;font-family:system-ui,-apple-system,Segoe UI,sans-serif}*{box-sizing:border-box}.stage{position:relative;width:100vw;height:100vh;background:radial-gradient(circle at 65% 35%,#17305d66,transparent 40%),linear-gradient(145deg,#040715,#09152d 55%,#050918)}.stars{position:absolute;inset:0;opacity:.25;background-image:radial-gradient(#fff 1px,transparent 1px);background-size:52px 52px}.brand{position:absolute;left:4vw;top:4vh;font-weight:900;letter-spacing:.14em;font-size:clamp(18px,2vw,34px)}.brand small{display:block;font-size:.42em;letter-spacing:.3em;opacity:.7;margin-top:.5em}.card{position:absolute;left:5vw;top:21vh;width:min(64vw,1100px);min-height:45vh;padding:clamp(24px,4vw,64px);border:1px solid #8fdcff44;border-radius:32px;background:#071126d9;box-shadow:0 25px 80px #0009,0 0 55px #39b8ff18;display:flex;flex-direction:column;justify-content:center}.eyebrow{text-transform:uppercase;letter-spacing:.2em;color:#8fdcff;font-size:clamp(13px,1.3vw,22px)}h1{font-size:clamp(38px,5.8vw,92px);line-height:.98;margin:.18em 0}.detail{font-size:clamp(18px,2vw,34px);line-height:1.35;opacity:.86;max-width:92%}.meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:28px}.pill{padding:9px 14px;border:1px solid #8fdcff44;border-radius:999px;background:#0e2449aa;font-size:clamp(12px,1vw,17px)}.stella{position:absolute;right:3vw;bottom:4vh;width:min(27vw,430px);height:min(58vh,630px);display:grid;place-items:end center}.stella img{max-width:100%;max-height:100%;image-rendering:auto;filter:drop-shadow(0 15px 28px #000b) drop-shadow(0 0 22px #2cc7ff55)}.stella .name{position:absolute;right:0;bottom:0;padding:8px 16px;border-radius:999px;background:#071126dd;border:1px solid #8fdcff55;font-weight:800}.ticker{position:absolute;left:0;right:0;bottom:0;height:42px;display:flex;align-items:center;padding:0 4vw;background:#06142ae8;border-top:1px solid #8fdcff33;font-size:clamp(13px,1.15vw,20px);white-space:nowrap;overflow:hidden}.maintenance{color:#ffd56a}.hidden{display:none!important}@media(max-aspect-ratio:4/3){.card{width:72vw}.stella{width:31vw}}
</style></head><body><main class="stage"><div class="stars"></div><div class="brand">SPACEMOUNTAIN.LIVE<small>COMMUNITY LOUNGE</small></div><section class="card"><div id="eyebrow" class="eyebrow">Community online</div><h1 id="headline">SpaceMountainLive Lounge</h1><div id="detail" class="detail">Loading community systems…</div><div class="meta"><span id="mode" class="pill">LOUNGE</span><span id="audience" class="pill hidden"></span><span id="target" class="pill hidden"></span><span id="restart" class="pill"></span></div></section><aside class="stella"><img id="stella" alt="Stella"><div class="name">STELLA · HOST</div></aside><div id="ticker" class="ticker">Welcome to the SpaceMountain community.</div><audio id="speech" preload="auto"></audio></main><script>
const endpoint=${JSON.stringify(endpoint)};let lastAudio='',lastGesture=-1,lastAvatar='';const img=document.getElementById('stella'),audio=document.getElementById('speech');
function text(id,value){document.getElementById(id).textContent=value||''}function pill(id,value){const el=document.getElementById(id);el.textContent=value||'';el.classList.toggle('hidden',!value)}function fmt(sec){sec=Math.max(0,sec|0);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h+'h '+String(m).padStart(2,'0')+'m'}
function pickAnimation(data){const manifest=data.avatar?.animations||{},host=data.host||{};const desired=host.gesture||host.persistent||'idle';return manifest[desired]||manifest[host.persistent]||manifest.idle||null}
async function tick(){try{const response=await fetch(endpoint,{cache:'no-store'});if(!response.ok)throw Error('state '+response.status);const data=await response.json(),program=data.program||{},feature=program.feature||{},state=data.state||{},host=data.host||{},clock=data.broadcast||{};text('eyebrow',(program.priority||'normal').replace('-',' ')+' · '+(feature.kind||program.slot?.kind||'community'));text('headline',program.headline||state.headline||'SpaceMountainLive Lounge');text('detail',feature.detail||feature.title||host.currentTopic||'Stella is watching community systems and hanging out with chat.');text('mode',(state.mode||'lounge').toUpperCase());pill('audience',state.physicalAudienceHolder?'PILE HERE: '+state.physicalAudienceHolder:'');pill('target',state.announcedTarget?'NEXT: '+state.announcedTarget:'');const restart=document.getElementById('restart');restart.textContent=clock.due?'RESTART DUE':'Maintenance in '+fmt(clock.secondsRemaining||0);restart.classList.toggle('maintenance',!!clock.warning);text('ticker',host.currentSpeech||feature.title||state.headline||'SpaceMountainLive Community Lounge');const animation=pickAnimation(data);if(animation&&animation.url&&animation.url!==lastAvatar){lastAvatar=animation.url;img.src=animation.url}if(host.speechAudioUrl&&host.speechAudioUrl!==lastAudio){lastAudio=host.speechAudioUrl;audio.src=lastAudio;audio.play().catch(()=>{})}lastGesture=host.gestureNonce??lastGesture;}catch{ text('detail','Community systems are reconnecting. Stella will be right back.');}finally{setTimeout(tick,2000)}}tick();
</script></body></html>`;
}
function tenant(url: URL) { const value = String(url.searchParams.get("tenant") ?? "").trim(); if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(value)) throw new Error("A valid tenant query parameter is required"); return value; }
function sendJson(response: ServerResponse, status: number, body: unknown) { const bytes = Buffer.from(JSON.stringify(body)); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": bytes.length, "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(bytes); }
function safe(value: unknown) { return (value instanceof Error ? value.message : String(value)).replace(/(?:authorization|token|secret|password)\s*[:=]?\s*\S+/gi, "$1=[redacted]").slice(0, 300); }
