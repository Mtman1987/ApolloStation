import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { SqliteHearMeOutRoomMediaRuntime, type HearMeOutPrincipalV1 } from "../../hearmeout/dist/room-media-core.js";

const MAX_BODY_BYTES = 64 * 1024;

export const HEARMEOUT_GREEN_CSS = `
body[data-app="hearmeout"] .hmo-room-floor{gap:14px}
body[data-app="hearmeout"] .hmo-floor-heading{align-items:center}
.hmo-room-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.hmo-action{appearance:none;border:1px solid var(--border,rgba(255,255,255,.16));border-radius:14px;background:var(--depth3,rgba(11,15,30,.38));color:var(--ink,#f7f7fb);padding:9px 13px;font:inherit;font-weight:800;cursor:pointer;transition:transform .16s ease,background .16s ease,border-color .16s ease}
.hmo-action:hover,.hmo-action:focus-visible{transform:translateY(-1px);border-color:var(--accent,#ff8a5b);outline:none}
.hmo-action.primary{background:color-mix(in srgb,var(--accent,#ff8a5b) 34%,var(--depth2,rgba(12,16,32,.52)));border-color:color-mix(in srgb,var(--accent,#ff8a5b) 70%,transparent)}
.hmo-create-panel,.hmo-room-detail{border:1px solid var(--border,rgba(255,255,255,.15));border-radius:18px;background:var(--depth2,rgba(10,14,28,.5));backdrop-filter:blur(var(--blur,18px));padding:14px}
.hmo-create-panel[hidden],.hmo-room-detail[hidden]{display:none!important}
.hmo-create-grid{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:end}
.hmo-field{display:grid;gap:5px}.hmo-field span{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#a9acba)}
.hmo-field input,.hmo-field select{min-width:0;border:1px solid var(--border,rgba(255,255,255,.15));border-radius:12px;background:var(--depth4,rgba(8,12,24,.3));color:var(--ink,#f7f7fb);padding:9px 10px;font:inherit}
.hmo-field.password{grid-column:1/-1}.hmo-field.password[hidden]{display:none!important}
.hmo-room-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;min-height:92px}
.hmo-room-card{display:grid;gap:9px;min-width:0;border:1px solid var(--border,rgba(255,255,255,.14));border-radius:16px;background:var(--depth1,rgba(12,16,32,.62));padding:12px;box-shadow:0 16px 44px rgba(0,0,0,.14)}
.hmo-room-card header{display:flex;gap:8px;justify-content:space-between;align-items:flex-start}.hmo-room-card strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hmo-room-meta{font-size:12px;color:var(--muted,#a9acba)}
.hmo-room-badge{flex:none;border-radius:999px;padding:3px 7px;border:1px solid var(--border,rgba(255,255,255,.15));font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase}
.hmo-room-card footer{display:flex;gap:7px;margin-top:auto}.hmo-room-card footer .hmo-action{flex:1;padding:7px 9px;font-size:12px}
.hmo-empty-state{grid-column:1/-1;display:grid;place-items:center;min-height:90px;border:1px dashed var(--border,rgba(255,255,255,.16));border-radius:16px;color:var(--muted,#a9acba);text-align:center;padding:16px}
.hmo-room-detail-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.hmo-room-detail-head div{min-width:0}.hmo-room-detail-head strong{display:block;font-size:18px}.hmo-room-detail-head small{color:var(--muted,#a9acba)}
.hmo-room-columns{display:grid;grid-template-columns:1.1fr .9fr;gap:10px;margin-top:12px}.hmo-room-pane{border-radius:14px;background:var(--depth3,rgba(8,12,25,.34));padding:11px}.hmo-room-pane h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#a9acba)}
.hmo-member-list,.hmo-session-list{display:grid;gap:6px}.hmo-member,.hmo-session{display:flex;justify-content:space-between;gap:8px;border-radius:10px;background:var(--depth4,rgba(7,10,20,.24));padding:8px 9px;font-size:12px}.hmo-member span:last-child,.hmo-session span:last-child{color:var(--muted,#a9acba)}
.hmo-inline-error{margin:0;color:#ff9a9a;font-size:12px}.hmo-inline-status{margin:0;color:var(--muted,#a9acba);font-size:12px}
@media(max-width:850px){.hmo-room-list{grid-template-columns:1fr 1fr}.hmo-create-grid{grid-template-columns:1fr 1fr}.hmo-create-grid>.hmo-field:first-child{grid-column:1/-1}.hmo-room-columns{grid-template-columns:1fr}}
@media(max-width:560px){.hmo-room-list,.hmo-create-grid{grid-template-columns:1fr}.hmo-create-grid>.hmo-field:first-child{grid-column:auto}}
`;

export const HEARMEOUT_GREEN_BROWSER_JS = String.raw`;(()=>{
const body=document.body;if(!body||body.dataset.app!=="hearmeout")return;
const floor=document.querySelector('[data-hmo-room-floor]');if(!floor)return;
let connectionId='web-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));let heartbeatTimer=0;let activeRoom='';
const staticMarkup='<div class="hmo-floor-heading"><div><span>ROOMS</span><strong>Hear Me Out</strong></div><div class="hmo-room-actions"><button class="hmo-action primary" type="button" data-hmo-create-toggle>Create Room</button><button class="hmo-action" type="button" data-hmo-refresh>Refresh</button></div></div><form class="hmo-create-panel" data-hmo-create-form hidden><div class="hmo-create-grid"><label class="hmo-field"><span>Room name</span><input name="name" maxlength="120" required placeholder="Rehearsal room"></label><label class="hmo-field"><span>Privacy</span><select name="privacy"><option value="public">Public</option><option value="private">Private</option></select></label><button class="hmo-action primary" type="submit">Create</button><label class="hmo-field password" data-hmo-password hidden><span>Password</span><input name="password" type="password" maxlength="120" autocomplete="new-password"></label></div><p class="hmo-inline-status" data-hmo-create-status>Create and join a real Green room stored by ApolloStation.</p></form><div class="hmo-room-list" data-hmo-room-list><div class="hmo-empty-state">Loading rooms…</div></div><section class="hmo-room-detail" data-hmo-room-detail hidden></section>';
floor.innerHTML=staticMarkup;
const list=floor.querySelector('[data-hmo-room-list]'),form=floor.querySelector('[data-hmo-create-form]'),detail=floor.querySelector('[data-hmo-room-detail]'),status=floor.querySelector('[data-hmo-create-status]'),privacy=form.querySelector('[name="privacy"]'),password=floor.querySelector('[data-hmo-password]');
const openRoomPage=()=>{const link=document.querySelector('[data-focused-nav-target="#room"]');if(link instanceof HTMLElement)link.click();else location.hash='room';};
const hero=document.querySelector('.app-hero .hero-links');if(hero){const create=document.createElement('button');create.type='button';create.className='hmo-action primary';create.textContent='Create Room';create.addEventListener('click',()=>{openRoomPage();form.hidden=false;setTimeout(()=>form.querySelector('input')?.focus(),0)});hero.prepend(create);const rooms=document.createElement('button');rooms.type='button';rooms.className='hmo-action';rooms.textContent='Rooms';rooms.addEventListener('click',openRoomPage);hero.insertBefore(rooms,create.nextSibling)}
privacy.addEventListener('change',()=>{password.hidden=privacy.value!=='private';if(password.hidden)password.querySelector('input').value=''});
floor.querySelector('[data-hmo-create-toggle]').addEventListener('click',()=>{form.hidden=!form.hidden;if(!form.hidden)form.querySelector('input')?.focus()});
floor.querySelector('[data-hmo-refresh]').addEventListener('click',()=>void loadRooms());
form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;status.className='hmo-inline-status';status.textContent='Creating room…';try{const fd=new FormData(form);const payload={name:String(fd.get('name')||'').trim(),privacy:String(fd.get('privacy')||'public'),password:String(fd.get('password')||'')||undefined};const room=await api('/api/hearmeout/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});form.reset();password.hidden=true;form.hidden=true;await loadRooms();await joinRoom(room.roomId)}catch(error){status.className='hmo-inline-error';status.textContent=message(error)}finally{button.disabled=false}});
async function api(path,init){const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...init});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.message||payload.error||('Request failed ('+response.status+')'));return payload}
async function loadRooms(){list.replaceChildren(empty('Loading rooms…'));try{const payload=await api('/api/hearmeout/rooms');const rooms=Array.isArray(payload.rooms)?payload.rooms:[];if(!rooms.length){list.replaceChildren(empty('No rooms yet. Create the first Green room.'));return}const fragment=document.createDocumentFragment();for(const room of rooms)fragment.append(roomCard(room));list.replaceChildren(fragment)}catch(error){list.replaceChildren(empty(message(error),true))}}
function roomCard(room){const card=document.createElement('article');card.className='hmo-room-card';const head=document.createElement('header'),title=document.createElement('strong'),badge=document.createElement('span');title.textContent=room.name||room.roomId;badge.className='hmo-room-badge';badge.textContent=room.privacy||'public';head.append(title,badge);const meta=document.createElement('div');meta.className='hmo-room-meta';const count=Number(room.activeCount||0);meta.textContent=count+' active · '+(room.systemRoom?'system room':expiry(room.expiresAt));const footer=document.createElement('footer');const inspect=action('View',()=>void showRoom(room.roomId));const join=action(room.member?'Open':'Join',()=>void joinRoom(room.roomId,room.privacy==='private'&&!room.member));if(room.member)join.classList.add('primary');footer.append(inspect,join);card.append(head,meta,footer);return card}
function action(label,fn){const button=document.createElement('button');button.type='button';button.className='hmo-action';button.textContent=label;button.addEventListener('click',fn);return button}
function empty(text,error=false){const node=document.createElement('div');node.className='hmo-empty-state'+(error?' hmo-inline-error':'');node.textContent=text;return node}
async function joinRoom(roomId,askPassword=false){let pass;if(askPassword){pass=prompt('Password for this private room');if(pass===null)return}try{await api('/api/hearmeout/rooms/'+encodeURIComponent(roomId)+'/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pass?{password:pass}:{})});activeRoom=roomId;await heartbeat();clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>void heartbeat(),15000);await Promise.all([loadRooms(),showRoom(roomId)])}catch(error){detail.hidden=false;detail.replaceChildren(empty(message(error),true))}}
async function heartbeat(){if(!activeRoom)return;try{await api('/api/hearmeout/rooms/'+encodeURIComponent(activeRoom)+'/presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId})})}catch{}}
async function showRoom(roomId){detail.hidden=false;detail.replaceChildren(empty('Loading room…'));try{const payload=await api('/api/hearmeout/rooms/'+encodeURIComponent(roomId));const room=payload.room||{};const wrap=document.createElement('div');const head=document.createElement('div');head.className='hmo-room-detail-head';const text=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small');name.textContent=room.name||room.roomId;meta.textContent=(room.privacy||'public')+' · '+(payload.member?'joined':'not joined');text.append(name,meta);const join=action(payload.member?'Refresh room':'Join room',()=>payload.member?void showRoom(roomId):void joinRoom(roomId,room.privacy==='private'));if(!payload.member)join.classList.add('primary');head.append(text,join);const columns=document.createElement('div');columns.className='hmo-room-columns';columns.append(memberPane(payload),sessionPane(payload));wrap.append(head,columns);detail.replaceChildren(wrap)}catch(error){detail.replaceChildren(empty(message(error),true))}}
function memberPane(payload){const pane=document.createElement('section');pane.className='hmo-room-pane';const h=document.createElement('h3');h.textContent='People';const rows=document.createElement('div');rows.className='hmo-member-list';const members=Array.isArray(payload.members)?payload.members:[];const active=new Set((payload.presence||[]).map(item=>item.userId));if(!members.length)rows.append(empty('No members yet.'));for(const item of members){const row=document.createElement('div');row.className='hmo-member';const n=document.createElement('span'),s=document.createElement('span');n.textContent=item.displayName||item.userId;s.textContent=active.has(item.userId)?'active':'member';row.append(n,s);rows.append(row)}pane.append(h,rows);return pane}
function sessionPane(payload){const pane=document.createElement('section');pane.className='hmo-room-pane';const h=document.createElement('h3');h.textContent='Room media';const rows=document.createElement('div');rows.className='hmo-session-list';for(const lane of ['music','movie']){const session=payload[lane]||{};const row=document.createElement('div');row.className='hmo-session';const n=document.createElement('span'),s=document.createElement('span');n.textContent=lane==='music'?'Music / DJ':'Watch party';s.textContent=session.current?.item?.title||session.playback?.status||'idle';row.append(n,s);rows.append(row)}pane.append(h,rows);return pane}
function expiry(value){if(!value)return'no expiry';const ms=Date.parse(value)-Date.now();if(ms<=0)return'expired';const min=Math.ceil(ms/60000);return min>=60?Math.ceil(min/60)+'h left':min+'m left'}
function message(error){return error instanceof Error?error.message:String(error||'HearMeOut request failed')}
void loadRooms();
})();`;

export function createHearMeOutGreenWebRuntime(options: { innerPort: () => number; dbPath?: string }) {
  let runtime: SqliteHearMeOutRoomMediaRuntime | undefined;
  const getRuntime = () => runtime ??= new SqliteHearMeOutRoomMediaRuntime(options.dbPath ?? process.env.HEARMEOUT_DB_PATH ?? resolve(process.cwd(), ".spmt-hearmeout-green.sqlite"));

  return {
    async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
      if (!url.pathname.startsWith("/api/hearmeout/")) return false;
      try {
        const principal = await resolvePrincipal(request, options.innerPort());
        const rooms = getRuntime();
        if (request.method === "GET" && url.pathname === "/api/hearmeout/rooms") {
          const visible = rooms.listRooms(principal);
          return sendJson(response, 200, { rooms: visible.map((room) => roomSummary(rooms, principal, room)) });
        }
        if (request.method === "POST" && url.pathname === "/api/hearmeout/rooms") {
          requireSameOrigin(request);
          const body = await readJson(request);
          const name = requiredText(body.name, "name", 120);
          const privacy = body.privacy === "private" ? "private" : "public";
          const password = privacy === "private" && typeof body.password === "string" && body.password ? body.password : undefined;
          const room = rooms.createRoom(principal, { roomId: makeRoomId(name), name, privacy, ...(password ? { password } : {}), operationId: `web-create:${principal.userId}:${randomBytes(8).toString("hex")}` });
          return sendJson(response, 201, room);
        }
        const roomMatch = url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)$/);
        if (request.method === "GET" && roomMatch) {
          const roomId = decodeURIComponent(roomMatch[1]!);
          const room = rooms.getRoom(principal.tenantId, roomId);
          if (!room) return sendJson(response, 404, { error: "room_not_found", message: "HearMeOut room not found or expired" });
          const members = rooms.listMembers(principal.tenantId, roomId);
          const member = members.some((item) => item.userId === principal.userId);
          return sendJson(response, 200, { room, member, members, presence: rooms.listActivePresence(principal.tenantId, roomId), music: rooms.getSession(principal.tenantId, roomId, "music"), movie: rooms.getSession(principal.tenantId, roomId, "movie") });
        }
        const joinMatch = url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/join$/);
        if (request.method === "POST" && joinMatch) {
          requireSameOrigin(request);
          const roomId = decodeURIComponent(joinMatch[1]!);
          const body = await readJson(request);
          const room = rooms.joinRoom(principal, roomId, `web-join:${principal.userId}:${randomBytes(8).toString("hex")}`, undefined, typeof body.password === "string" && body.password ? { password: body.password } : {});
          return sendJson(response, 200, room);
        }
        const presenceMatch = url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/presence$/);
        if (request.method === "POST" && presenceMatch) {
          requireSameOrigin(request);
          const roomId = decodeURIComponent(presenceMatch[1]!);
          const body = await readJson(request);
          const presence = rooms.heartbeatPresence(principal, roomId, requiredText(body.connectionId, "connectionId", 200));
          return sendJson(response, 200, presence);
        }
        return sendJson(response, 404, { error: "not_found", message: "Unknown HearMeOut Green route" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "HearMeOut Green request failed";
        const status = /session|sign in|unauthor/i.test(message) ? 401 : /not found|expired/i.test(message) ? 404 : /password|member|admin|owner|denied/i.test(message) ? 403 : 400;
        return sendJson(response, status, { error: "hearmeout_green_request_failed", message });
      }
    },
    close() { runtime?.close(); runtime = undefined; },
  };
}

function roomSummary(runtime: SqliteHearMeOutRoomMediaRuntime, principal: HearMeOutPrincipalV1, room: ReturnType<SqliteHearMeOutRoomMediaRuntime["getRoom"]> extends infer T ? Exclude<T, undefined> : never) {
  const members = runtime.listMembers(principal.tenantId, room.roomId);
  let activeCount = 0;
  try { activeCount = new Set(runtime.listActivePresence(principal.tenantId, room.roomId).map((item) => item.userId)).size; } catch {}
  return { ...room, member: members.some((item) => item.userId === principal.userId), memberCount: members.length, activeCount };
}

async function resolvePrincipal(request: IncomingMessage, port: number): Promise<HearMeOutPrincipalV1> {
  if (!port) throw new Error("SPMT session service is unavailable");
  const headers: Record<string, string> = { accept: "application/json", "x-spmt-app": "hearmeout" };
  if (request.headers.cookie) headers.cookie = request.headers.cookie;
  const response = await fetch(`http://127.0.0.1:${port}/v1/session`, { headers, redirect: "manual" });
  if (!response.ok) throw new Error("Sign in to SpaceMountain before using HearMeOut");
  const value = await response.json() as Record<string, unknown>;
  const userId = typeof value.actorId === "string" ? value.actorId : "";
  const tenantId = Array.isArray(value.tenantIds) && typeof value.tenantIds[0] === "string" ? value.tenantIds[0] : "";
  const scopes = Array.isArray(value.scopes) ? value.scopes.filter((item): item is string => typeof item === "string") : [];
  if (!userId || !tenantId) throw new Error("SPMT session has no user or tenant");
  const admin = scopes.some((scope) => scope === "*" || scope === "admin" || scope.startsWith("admin:") || scope.endsWith(":any"));
  const displayName = typeof value.displayName === "string" && value.displayName.trim() ? value.displayName.trim() : typeof value.username === "string" && value.username.trim() ? value.username.trim() : userId;
  return { tenantId, userId, displayName, roles: admin ? ["admin"] : ["member"] };
}

function makeRoomId(name: string) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "room";
  return `${slug}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error("HearMeOut request body is too large");
    chunks.push(part);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("HearMeOut request must be a JSON object");
  return parsed as Record<string, unknown>;
}

function requiredText(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`HearMeOut ${name} is invalid`);
  return value;
}

function requireSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  if (!host || new URL(origin).host !== host) throw new Error("HearMeOut request origin is invalid");
}

function sendJson(response: ServerResponse, status: number, value: unknown): true {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.byteLength, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(body);
  return true;
}
