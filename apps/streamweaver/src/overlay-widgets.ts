import { createHash } from "node:crypto";
import type { OverlayWidgetManifestV1 } from "@spmt/contracts";

export const STREAMWEAVER_WIDGETS = Object.freeze({
  social: "Chat interactions", "bic-counter": "Bic counter", gamble: "Gamble result", "classic-gamble": "Classic gamble",
  leaderboard: "Creator currency leaderboard", avatar: "Bot avatar", "tts-player": "Voice and captions",
  "shoutout-player": "Shoutout media", "brb-player": "BRB media",
});
export type StreamWeaverWidgetId = keyof typeof STREAMWEAVER_WIDGETS;
export const STREAMWEAVER_WIDGET_EVENT_TYPES = ["streamweaver.social.interaction.v1", "streamweaver.bic.counter.updated.v1", "streamweaver.overlay.cue.requested.v1", "streamweaver.economy.overlay.v1", "streamweaver.avatar.updated.v1", "streamweaver.media.playback.v1"] as const;
type Event = { id?: string; eventId?: string; sourceAppId?: string; type: string; occurredAt?: string; createdAt?: string; payload: unknown };
export interface StreamWeaverWidgetItem { id: string; kind: string; occurredAt: string; text: string; actor?: string; total?: number | undefined; avatarUrl?: string | undefined; talkingUrl?: string | undefined; mediaUrl?: string | undefined; rows?: Array<{name:string;balance:number}>; durationMs?: number; }
export function streamWeaverWidgetManifests(origin: string): OverlayWidgetManifestV1[] {
  return Object.entries(STREAMWEAVER_WIDGETS).map(([widgetId,title])=>({schemaVersion:1,appId:"streamweaver",widgetId,title,kind:"native",rendererUrl:new URL(`/_internal/streamweaver/widgets/${widgetId}`,origin).href,requiredScopes:[],supportsAudio:["tts-player","shoutout-player","brb-player"].includes(widgetId),supportsInteraction:false}));
}
export function isStreamWeaverWidget(value: string): value is StreamWeaverWidgetId { return Object.hasOwn(STREAMWEAVER_WIDGETS,value); }

/** Public output is an allowlisted projection, never an export of the event payload. */
export function streamWeaverWidgetSnapshot(events: Event[], now = new Date().toISOString(), widget?: StreamWeaverWidgetId) {
  const items: StreamWeaverWidgetItem[] = [];
  for (const event of events) {
    if(event.sourceAppId && event.sourceAppId !== "streamweaver")continue;
    const payload=object(event.payload),occurredAt=event.occurredAt??event.createdAt??"",id=String(event.id??event.eventId??"");
    if(!id||!Number.isFinite(Date.parse(occurredAt)))continue;
    const base={id,occurredAt,text:""};
    if(event.type==="streamweaver.social.interaction.v1") {
      const actor=short(object(payload.actor).displayName??object(payload.actor).username,100),target=short(object(payload.target).username,100),trigger=short(payload.trigger,40);
      const verbs:Record<string,string>={"!boop":"boops","!cuddle":"cuddles","!dance":"dances with","!fistbump":"fist bumps","!headpat":"gives headpats to","!highfive":"high fives","!hug":"hugs","!love":"sends love to","!tickle":"tickles"};
      if(Object.hasOwn(verbs,trigger))items.push({...base,kind:"social",actor,text:`${actor} ${verbs[trigger]} ${target||"chat"}!`,durationMs:7000});
    } else if(event.type==="streamweaver.bic.counter.updated.v1") {
      const total=number(payload.total);if(total!==undefined)items.push({...base,kind:"bic-counter",total,text:`${short(payload.thiefDisplayName,100)||"Streamer"} · ${total} lighters`,actor:short(payload.lastUserDisplayName??payload.lastUser,100)});
    } else if(event.type==="streamweaver.economy.overlay.v1") {
      const rows=(Array.isArray(payload.leaderboard)?payload.leaderboard:[]).slice(0,10).flatMap(value=>{const row=object(value),balance=number(row.balance);return balance===undefined?[]:[{name:short(row.displayName??row.userId,100),balance}];});
      items.push({...base,id:id+":leaderboard",kind:"leaderboard",text:short(payload.currencyName,100),rows});
      const result=object(payload.result);
      if(["gamble","gambel","roll"].includes(String(payload.command))&&result.success===true)items.push({...base,kind:"gamble",text:short(payload.text,1000),actor:short(payload.displayName,100),total:number(result.newTotal),durationMs:9000});
    } else if(event.type==="streamweaver.avatar.updated.v1") {
      items.push({...base,kind:"avatar",text:short(payload.displayName,100),avatarUrl:media(payload.avatarUrl),talkingUrl:media(payload.talkingUrl)});
    } else if(event.type==="streamweaver.media.playback.v1") {
      const kind=String(payload.kind),mediaUrl=media(payload.mediaUrl);
      if(["tts-player","shoutout-player","brb-player"].includes(kind)&&(mediaUrl||payload.operation==="stop"))items.push({...base,kind,text:short(payload.text,2000),mediaUrl,avatarUrl:media(payload.avatarUrl),talkingUrl:media(payload.talkingUrl),durationMs:Math.max(1000,Math.min(3600000,Number(payload.durationMs)||60000))});
    }
  }
  return {schemaVersion:1,generatedAt:now,items:items.filter(item=>!widget||item.kind===(widget==="classic-gamble"?"gamble":widget)||(widget==="tts-player"&&item.kind==="avatar")).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)).slice(-200)};
}
const CSS = `*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color-scheme:only light;color:#f5f8ff;font-family:Inter,system-ui,sans-serif}[hidden]{display:none!important}#surface{position:absolute;inset:0;display:grid;place-items:center;padding:3%}.card{max-width:94%;padding:3%;border:1px solid #74adf699;border-radius:24px;background:linear-gradient(130deg,#0a1738ed,#122a48e8);box-shadow:0 12px 40px #0006;text-align:center;animation:arrive .3s ease-out}.card h1{font-size:clamp(18px,4.5vw,76px);margin:.3em 0;overflow-wrap:anywhere}.card p{font-size:clamp(12px,2vw,32px);margin:.5em 0;color:#b8d8ff}.icon{font-size:clamp(24px,9vw,140px)}#avatar{width:clamp(60px,18vw,260px);max-height:70vh;object-fit:contain;filter:drop-shadow(0 0 18px #75acff88)}#avatar.talking{animation:talk .32s ease-in-out infinite alternate}#player{width:100%;height:100%;object-fit:contain}#caption{position:absolute;bottom:4%;left:8%;right:8%;padding:12px;background:#081222e8;border-radius:14px;font-size:clamp(14px,2.5vw,42px);text-align:center;white-space:pre-wrap}#rankings{display:grid;gap:10px;min-width:min(75vw,500px);font-size:clamp(13px,2.5vw,30px)}.rank{display:flex;gap:24px;justify-content:space-between;border-bottom:1px solid #587ca355;padding:8px}nav{position:absolute;top:8px;right:8px;z-index:4;display:flex;gap:6px}nav select,nav button{color:#eef4ff;background:#111f35;border:1px solid #7187ab;border-radius:8px;padding:7px}#playback-error{position:absolute;bottom:0;font-size:13px;background:#151a24;padding:5px;color:#ffd38a}body[data-widget=avatar] .card{background:none;border:0;box-shadow:none}@keyframes arrive{from{opacity:0;transform:translateY(15px) scale(.96)}}@keyframes talk{to{transform:translateY(-3px) scale(1.03)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}`;
export const STREAMWEAVER_WIDGET_CLIENT = String.raw`(()=>{'use strict';
const body=document.body,card=document.querySelector('.card'),heading=document.querySelector('h1'),detail=document.querySelector('.card p'),icon=document.querySelector('.icon'),avatar=document.querySelector('#avatar'),rankings=document.querySelector('#rankings'),player=document.querySelector('#player'),caption=document.querySelector('#caption'),selector=document.querySelector('select'),error=document.querySelector('#playback-error');
let widget=body.dataset.widget,snapshot={items:[]},seen=new Set(),queue=[],active=false,timer,avatarState={},audioEnabled=body.dataset.simulation!=='true';
function reset(){clearTimeout(timer);player.pause();player.removeAttribute('src');player.load();active=false;card.hidden=true;player.hidden=true;caption.hidden=true;avatar.classList.remove('talking');}
function safeUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function image(url){const safe=safeUrl(url);avatar.hidden=!safe;if(safe)avatar.src=safe;else avatar.removeAttribute('src');}
function show(item){active=true;card.hidden=false;player.hidden=true;caption.hidden=true;rankings.replaceChildren();heading.textContent=item.text||'';detail.textContent=item.actor||'';icon.textContent=item.kind==='bic-counter'?'🔥':item.kind==='gamble'?'🎲':item.kind==='social'?'💫':'';image('');
if(item.kind==='leaderboard'){icon.textContent='🏆';for(const [i,row] of (item.rows||[]).entries()){const line=document.createElement('div'),name=document.createElement('span'),balance=document.createElement('strong');line.className='rank';name.textContent=(i+1)+'. '+row.name;balance.textContent=Number(row.balance).toLocaleString();line.append(name,balance);rankings.append(line);}}
if(item.kind==='avatar'){heading.textContent='';detail.textContent='';image(item.avatarUrl);}
if(['tts-player','shoutout-player','brb-player'].includes(item.kind)){const url=safeUrl(item.mediaUrl);if(!url){finish();return;}card.hidden=item.kind!=='tts-player';heading.textContent='';detail.textContent='';image(item.talkingUrl||item.avatarUrl||avatarState.talkingUrl||avatarState.avatarUrl);avatar.classList.add('talking');player.src=url;player.hidden=item.kind==='tts-player';player.muted=!audioEnabled;player.loop=item.kind==='brb-player';caption.textContent=item.text;caption.hidden=!item.text;player.play().catch(()=>{error.hidden=false;error.textContent='Playback needs permission. Enable audio or open the preview to start it.';});}
if(!['leaderboard','bic-counter','avatar','brb-player'].includes(item.kind))timer=setTimeout(finish,item.durationMs||7000);else active=false;}
function finish(){reset();image(avatarState.avatarUrl);const next=queue.shift();if(next)show(next);else renderPersistent();}
function renderPersistent(){if(active)return;const kind=widget==='classic-gamble'?'gamble':widget;if(['bic-counter','leaderboard','avatar'].includes(kind)){const latest=snapshot.items.filter(i=>i.kind===kind).at(-1);if(latest)show(latest);}}
function accept(next){if(next?.schemaVersion!==1||!Array.isArray(next.items))return;snapshot=next;avatarState=next.items.filter(i=>i.kind==='avatar').at(-1)||{};const now=Date.now();for(const item of next.items){if(seen.has(item.id))continue;seen.add(item.id);const kind=widget==='classic-gamble'?'gamble':widget;if(widget!=='auto'&&item.kind!==kind)continue;if(['leaderboard','bic-counter','avatar'].includes(item.kind)){if(widget!=='auto')renderPersistent();continue;}if(now-Date.parse(item.occurredAt)>Math.max(15000,item.durationMs||15000))continue;if(!item.mediaUrl&&['tts-player','brb-player','shoutout-player'].includes(item.kind)){queue=[];reset();continue;}if(active){if(queue.length<50)queue.push(item);}else show(item);}if(seen.size>1000)seen=new Set(next.items.map(i=>i.id));renderPersistent();}
player.addEventListener('ended',finish);player.addEventListener('error',()=>{error.textContent='The media could not be played.';error.hidden=body.dataset.simulation!=='true';finish();});
selector?.addEventListener('change',()=>{widget=selector.value;body.dataset.widget=widget;queue=[];reset();seen=new Set();accept(snapshot);});
document.querySelector('[data-audio]')?.addEventListener('click',event=>{audioEnabled=!audioEnabled;player.muted=!audioEnabled;event.currentTarget.textContent=audioEnabled?'Mute audio':'Enable audio';error.hidden=true;if(player.src)player.play().catch(()=>{error.hidden=false;});});
if(body.dataset.simulation==='true'){window.addEventListener('message',event=>{if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='spmt.simulation.streamweaver')return;accept(event.data.snapshot);});window.parent.postMessage({type:'spmt.simulation.streamweaver.ready'},location.origin);}else{const poll=async()=>{try{const r=await fetch(location.href,{headers:{accept:'application/json'},credentials:'same-origin',cache:'no-store'});if(r.ok)accept(await r.json());else reset();}catch{reset();}};poll();setInterval(poll,1000);}
})();`;
export function renderStreamWeaverWidget(widget: StreamWeaverWidgetId | "auto", simulation = false) {
  if(widget!=="auto"&&!isStreamWeaverWidget(widget))throw new Error("Unknown StreamWeaver widget");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StreamWeaver ${widget}</title><style>${CSS}</style></head><body data-widget="${widget}" data-simulation="${simulation}">${simulation?`<nav><select aria-label="StreamWeaver widget"><option value="auto">Follow activity</option>${Object.entries(STREAMWEAVER_WIDGETS).map(([id,title])=>`<option value="${id}">${title}</option>`).join("")}</select><button data-audio>Enable audio</button></nav>`:""}<main id="surface"><video id="player" playsinline hidden></video><section class="card" hidden><div class="icon"></div><img id="avatar" alt="" hidden><h1></h1><p></p><div id="rankings"></div></section><div id="caption" hidden></div><output id="playback-error" hidden></output></main><script>${STREAMWEAVER_WIDGET_CLIENT}</script></body></html>`;
}
export const STREAMWEAVER_WIDGET_CSP = `default-src 'none'; script-src 'sha256-${createHash("sha256").update(STREAMWEAVER_WIDGET_CLIENT).digest("base64") }'; style-src 'unsafe-inline'; connect-src 'self'; img-src https:; media-src https:; frame-ancestors *; base-uri 'none'`;
function object(value: unknown): Record<string,unknown> { return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{}; }
function short(value:unknown,max:number) { return String(value??"").slice(0,max); }
function number(value:unknown) { const n=Number(value);return Number.isFinite(n)&&n>=0?n:undefined; }
function media(value:unknown) { if(typeof value!=="string")return undefined;try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password?url.href:undefined;}catch{return undefined;} }
