import type { NebulaTagStore } from "./nebula-tag-runtime.js";
import type { NebulaTagExperienceStore } from "./nebula-tag-experience.js";
import { buildNebulaTagOverlaySnapshot } from "./nebula-tag-overlay.js";

export interface NebulaTagOverlayPrincipalV1 {
  schemaVersion: 1;
  tenantId: string;
  appId: "nebula-arcade";
  widgetId: "tag";
  viewerUserId?: string;
  channelId?: string;
}

export interface NebulaTagOverlayHttpRequestV1 {
  method: string;
  path: string;
}

export interface NebulaTagOverlayHttpResponseV1 {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const ROOT = "/v1/nebula-arcade/tag/overlay";

/**
 * Controls-free Nebula Arcade tag game output mounted behind the authenticated SPMT output
 * gateway. The gateway owns grants and passes only a verified principal here;
 * Nebula never accepts provider tokens, app headers, or tenant IDs from URLs.
 */
export class NebulaTagOverlayHttpAdapter {
  constructor(private readonly store: NebulaTagStore, private readonly now: () => string = () => new Date().toISOString(), private readonly experience?: NebulaTagExperienceStore) {}

  handle(request: NebulaTagOverlayHttpRequestV1, principal?: NebulaTagOverlayPrincipalV1): NebulaTagOverlayHttpResponseV1 {
    if (!principal) return response(401, "text/plain; charset=utf-8", "Authenticated overlay principal required");
    if (principal.schemaVersion !== 1 || principal.appId !== "nebula-arcade" || principal.widgetId !== "tag" || !validId(principal.tenantId)) {
      return response(403, "text/plain; charset=utf-8", "Overlay principal is not authorized for Nebula Arcade tag game");
    }
    if (request.method !== "GET") return response(405, "text/plain; charset=utf-8", "Method not allowed", { allow: "GET" });
    if (request.path === ROOT) {
      return response(200, "text/html; charset=utf-8", renderNebulaTagOverlayHtml(), {
        "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors *",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
    }
    if (request.path === ROOT + "/client.js") return response(200, "text/javascript; charset=utf-8", NEBULA_TAG_OVERLAY_CLIENT_JS, { "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" });
    if (request.path === ROOT + "/styles.css") return response(200, "text/css; charset=utf-8", NEBULA_TAG_OVERLAY_CSS, { "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" });
    if (request.path === ROOT + "/state") {
      const stored = this.store.getState(principal.tenantId);
      const snapshot = buildNebulaTagOverlaySnapshot(stored.state, { ...(principal.viewerUserId ? { viewerUserId: principal.viewerUserId } : {}), generatedAt: this.now() });
      return response(200, "application/json; charset=utf-8", JSON.stringify({ revision: stored.revision, snapshot }), {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
    }
    if (request.path.startsWith(ROOT + "/messages")) {
      if (!this.experience || !principal.channelId || !validId(principal.channelId)) return response(404, "text/plain; charset=utf-8", "Not found");
      const url = new URL(request.path, "https://overlay.invalid");
      const after = Number(url.searchParams.get("after") ?? "0");
      if (!Number.isSafeInteger(after) || after < 0) return response(400, "text/plain; charset=utf-8", "Invalid message cursor");
      return response(200, "application/json; charset=utf-8", JSON.stringify({ messages: this.experience.listOverlayMessages(principal.tenantId, principal.channelId, after) }), { "cache-control": "no-store", "x-content-type-options": "nosniff" });
    }
    return response(404, "text/plain; charset=utf-8", "Not found");
  }
}

export function renderNebulaTagOverlayHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    "<title>Nebula Arcade tag game Overlay</title>",
    '<link rel="stylesheet" href="' + ROOT + '/styles.css">',
    "</head>",
    '<body data-state-url="' + ROOT + '/state" data-message-url="' + ROOT + '/messages" data-cycle-ms="240000">',
    '<main id="overlay" aria-live="polite">',
    '<section id="broadcast" class="broadcast" hidden><div id="confetti" class="confetti"></div><div id="broadcast-icon" class="broadcast-icon"></div><div id="broadcast-lines" class="broadcast-lines"></div></section>',
    '<footer id="status-bar" class="status-bar">',
    '<div class="viewer"><strong id="viewer-name">Nebula Arcade tag game</strong><span id="viewer-stats"></span></div>',
    '<div class="holder"><small>Current</small><strong id="holder">Loading…</strong></div>',
    '<div class="population"><strong id="population">0</strong><small>players</small></div>',
    "</footer>",
    "</main>",
    '<script src="' + ROOT + '/client.js" defer></script>',
    "</body>",
    "</html>",
  ].join("");
}

export const NEBULA_TAG_OVERLAY_CSS = [
  ":root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}",
  "*{box-sizing:border-box}",
  "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}",
  "body{color:#fff}",
  ".status-bar{position:fixed;left:2vw;right:2vw;bottom:2vh;min-height:10vh;display:grid;grid-template-columns:1fr auto auto;gap:2vw;align-items:center;padding:1.2vh 2vw;border:1px solid rgba(0,217,255,.5);border-radius:1.2rem;background:linear-gradient(135deg,rgba(6,12,27,.92),rgba(35,13,63,.88));box-shadow:0 0 2.5rem rgba(145,70,255,.4);transition:opacity .35s,filter .35s}",
  ".status-bar.dim{opacity:.24;filter:blur(1px)}",
  ".viewer,.holder,.population{display:flex;flex-direction:column;min-width:0}",
  ".viewer strong,.holder strong{font-size:min(3.7vw,4.2vh);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 2px 8px #000}",
  ".viewer span,.holder small,.population small{font-size:min(1.25vw,1.5vh);color:#c7ecff;text-transform:uppercase;letter-spacing:.08em}",
  ".holder{align-items:center}.holder strong{color:#00d9ff}",
  ".population{align-items:flex-end}.population strong{font-size:min(4vw,4.6vh)}",
  ".broadcast{position:fixed;inset:4vh 3vw 17vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-radius:2rem;background:radial-gradient(circle,rgba(25,14,56,.9),rgba(2,5,15,.72));box-shadow:inset 0 0 5rem rgba(145,70,255,.25);animation:arrival .35s ease-out}",
  ".broadcast[hidden]{display:none}",
  ".broadcast-icon{font-size:min(18vw,18vh);filter:drop-shadow(0 0 1.5rem currentColor)}",
  ".broadcast-lines{display:flex;flex-direction:column;gap:1.2vh;max-width:90%;font-weight:900;font-size:min(6vw,7vh);line-height:1.05;text-shadow:0 3px 12px #000}",
  ".broadcast.history .broadcast-lines{font-size:min(3.5vw,4.2vh);text-align:left;align-self:stretch;margin:auto}",
  ".confetti{position:absolute;inset:0;overflow:hidden;pointer-events:none}",
  ".confetti i{position:absolute;top:-5%;width:.8rem;height:1.3rem;background:var(--color);animation:fall var(--duration) linear var(--delay) forwards}",
  "@keyframes arrival{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}",
  "@keyframes fall{to{transform:translate(var(--drift),110vh) rotate(720deg)}}",
  "@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.confetti{display:none}}",
].join("");

export const NEBULA_TAG_OVERLAY_CLIENT_JS = [
  "(()=>{'use strict';",
  "const body=document.body,stateUrl=body.dataset.stateUrl,messageUrl=body.dataset.messageUrl,cycleMs=Number(body.dataset.cycleMs)||240000;",
  "const bar=document.getElementById('status-bar'),holder=document.getElementById('holder'),population=document.getElementById('population'),viewerName=document.getElementById('viewer-name'),viewerStats=document.getElementById('viewer-stats'),broadcast=document.getElementById('broadcast'),icon=document.getElementById('broadcast-icon'),lines=document.getElementById('broadcast-lines'),confetti=document.getElementById('confetti');",
  "let snapshot=null,lastHistoryId=null,lastHolder=undefined,lastMessage=0,active=false,queue=[],cycle='leaderboard';",
  "const tones={tag:[523.25,659.25,783.99],ffa:[329.63,440,587.33,783.99],newit:[493.88,659.25,739.99],history:[392,523.25]};",
  "function sound(kind){try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const c=new A(),now=c.currentTime;(tones[kind]||tones.history).forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.type=kind==='history'?'triangle':'sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,now+i*.11);g.gain.exponentialRampToValueAtTime(kind==='history'?.018:.03,now+i*.11+.02);g.gain.exponentialRampToValueAtTime(.0001,now+i*.11+.22);o.connect(g);g.connect(c.destination);o.start(now+i*.11);o.stop(now+i*.11+.24)});}catch{}}",
  "function celebrate(colors){confetti.replaceChildren();if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;for(let i=0;i<28;i++){const p=document.createElement('i');p.style.left=(Math.random()*100)+'%';p.style.setProperty('--color',colors[i%colors.length]);p.style.setProperty('--delay',(Math.random()*.35)+'s');p.style.setProperty('--duration',(3.8+Math.random()*1.8)+'s');p.style.setProperty('--drift',(-18+Math.random()*36)+'vw');confetti.append(p);}}",
  "function show(item){if(active){queue.push(item);return;}active=true;broadcast.hidden=false;broadcast.className='broadcast '+item.kind;bar.classList.add('dim');icon.textContent=item.icon;icon.style.color=item.color;lines.replaceChildren(...item.lines.map(value=>{const line=document.createElement('div');line.textContent=value;return line;}));sound(item.kind);if(item.kind!=='history')celebrate([item.color,'#fff','#ffd700']);setTimeout(()=>{broadcast.hidden=true;bar.classList.remove('dim');active=false;const next=queue.shift();if(next)setTimeout(()=>show(next),450);},item.duration||7000);}",
  "function render(next){const previous=snapshot;snapshot=next;holder.textContent=next.currentIt?next.currentIt.username:'FREE FOR ALL';holder.style.color=next.currentIt?'#00d9ff':'#ff6b35';population.textContent=String(next.playerCount);if(next.viewer){viewerName.textContent=next.viewer.username;viewerStats.textContent='#'+next.viewer.rank+' • '+next.viewer.score+' pts • '+next.viewer.passCount+' passes';}else{viewerName.textContent='Nebula Arcade tag game';viewerStats.textContent=next.availablePlayerCount+' available';}const history=next.recentHistory[0];if(previous&&history&&history.id!==lastHistoryId)show({kind:'tag',icon:history.doublePoints?'🔥':'🎯',color:history.doublePoints?'#ff4500':'#00d9ff',lines:[history.announcement],duration:9000});if(previous&&lastHolder!==undefined&&lastHolder!==(next.currentIt&&next.currentIt.userId)){show(next.currentIt?{kind:'newit',icon:'🎯',color:'#00d9ff',lines:[next.currentIt.username+' is now IT!'],duration:8000}:{kind:'ffa',icon:'🔥',color:'#ff4500',lines:['FREE FOR ALL!','Anyone can tag for DOUBLE POINTS!'],duration:10000});}lastHistoryId=history&&history.id;lastHolder=next.currentIt&&next.currentIt.userId;}",
  "async function poll(){try{const r=await fetch(stateUrl,{cache:'no-store',credentials:'same-origin'});if(!r.ok)return;const value=await r.json();render(value.snapshot);}catch{}}",
  "async function pollMessages(){try{const r=await fetch(messageUrl+'?after='+lastMessage,{cache:'no-store',credentials:'same-origin'});if(!r.ok)return;const value=await r.json();for(const item of value.messages||[]){lastMessage=Math.max(lastMessage,item.sequence);show({kind:'history',icon:'🏷️',color:'#00d9ff',lines:[item.text],duration:9000});}}catch{}}",
  "setInterval(poll,1000);setInterval(pollMessages,1000);poll();pollMessages();",
  "setInterval(()=>{if(!snapshot||active)return;if(cycle==='leaderboard'){cycle='history';const rows=snapshot.leaderboard.slice(0,5).map(p=>'#'+p.rank+' '+p.username+' '+p.score+' pts');if(rows.length)show({kind:'history',icon:'🏆',color:'#ffd700',lines:rows,duration:15000});}else{cycle='leaderboard';const rows=snapshot.recentHistory.slice(0,6).map(h=>(h.doublePoints?'🔥 ':'🎯 ')+h.announcement);if(rows.length)show({kind:'history',icon:'📜',color:'#9146ff',lines:rows,duration:15000});}},cycleMs);",
  "})();",
].join("");

function response(status: number, contentType: string, body: string, headers: Record<string, string> = {}): NebulaTagOverlayHttpResponseV1 {
  return { status, headers: { "content-type": contentType, ...headers }, body };
}

function validId(value: string): boolean {
  return Boolean(value && value.trim() === value && value.length <= 200 && /^[A-Za-z0-9._:@/-]+$/.test(value));
}
