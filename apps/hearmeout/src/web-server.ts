import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCT_UI_CSS } from "@spmt/ui";
import { SqliteHearMeOutRoomMediaRuntime, type HearMeOutPrincipalV1, type HearMeOutRoomV1 } from "./room-media-core.js";

const MAX_BODY_BYTES = 64 * 1024;

export interface HearMeOutWebServerOptions {
  spmtOrigin: string;
  databasePath: string;
  port?: number;
  host?: string;
  buildSha?: string;
}

export function createHearMeOutWebServer(options: HearMeOutWebServerOptions) {
  const spmtOrigin = loopbackOrigin(options.spmtOrigin);
  const runtime = new SqliteHearMeOutRoomMediaRuntime(resolve(options.databasePath));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://hearmeout.green");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/apps/hearmeout")) {
        applyPageHeaders(response);
        return send(response, 200, renderHearMeOutWebPage(options.buildSha ?? "dev"), "text/html; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/health/ready") return sendJson(response, 200, { state: "ready", appId: "hearmeout" });
      if (url.pathname.startsWith("/api/hearmeout/")) return await handleApi(request, response, url, runtime, spmtOrigin);
      return sendJson(response, 404, { error: "not_found", message: "Unknown HearMeOut route" });
    } catch (error) {
      if (!response.headersSent) return sendJson(response, 500, { error: "hearmeout_web_failure", message: safeError(error) });
      response.destroy(error instanceof Error ? error : undefined);
    }
  });
  return {
    server,
    async listen() { await listen(server, options.port ?? 3200, options.host ?? "127.0.0.1"); },
    async close() { runtime.close(); if (server.listening) await close(server); },
  };
}

export function renderHearMeOutWebPage(buildSha = "dev") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f97316"><title>Hear Me Out · SpaceMountain</title><style>${PRODUCT_UI_CSS}${HEARMEOUT_WEB_CSS}</style></head><body class="spmt-product-surface hmo-app" data-app="hearmeout" data-surface="standalone" data-hmo-view="home"><div class="spmt-product-backdrop" aria-hidden="true"><span class="spmt-product-backdrop-image"></span><span class="spmt-product-backdrop-tint"></span><span class="spmt-product-backdrop-shade"></span><span class="spmt-star-layer"><i></i><i></i><i></i></span></div><main class="hmo-stage"><section class="hmo-home" data-hmo-view-panel="home"><div class="hmo-hero"><div class="hmo-mark"><img src="/assets/product/app-icons/solar-flare/hearmeout.png" data-hmo-logo alt=""><span>LIVE ROOMS · SHARED MEDIA</span></div><h1>Hear Me Out</h1><p>Voice rooms, music and watch sessions that stay together without leaving SpaceMountain.</p><div class="hmo-hero-actions"><button type="button" class="hmo-button primary" data-hmo-create-home>Create Room</button><button type="button" class="hmo-button" data-hmo-open-rooms>Rooms</button></div><footer><span class="spmt-product-status" data-hmo-runtime>Green runtime</span><small>Build ${escapeHtml(buildSha.slice(0, 12))}</small></footer></div></section><section class="hmo-rooms" data-hmo-view-panel="rooms" hidden><header class="hmo-page-head"><div><span>ROOMS</span><h2>Hear Me Out</h2></div><div><button type="button" class="hmo-button" data-hmo-home>Home</button><button type="button" class="hmo-button primary" data-hmo-create-toggle>Create Room</button><button type="button" class="hmo-button" data-hmo-refresh>Refresh</button></div></header><form class="hmo-create-panel spmt-product-glass" data-spmt-depth="2" data-hmo-create-form hidden><label><span>Room name</span><input name="name" maxlength="120" required placeholder="Rehearsal room"></label><label><span>Privacy</span><select name="privacy"><option value="public">Public</option><option value="private">Private</option></select></label><label data-hmo-password hidden><span>Password</span><input name="password" type="password" maxlength="120" autocomplete="new-password"></label><button class="hmo-button primary" type="submit">Create & join</button><p data-hmo-create-status>A real Green room will be stored by Hear Me Out.</p></form><div class="hmo-room-scroll"><div class="hmo-room-list" data-hmo-room-list><div class="hmo-empty">Loading rooms…</div></div><section class="hmo-room-detail spmt-product-glass" data-spmt-depth="2" data-hmo-room-detail hidden></section></div></section></main><script>${HEARMEOUT_BRIDGE_BROWSER_JS}${HEARMEOUT_ROOM_BROWSER_JS}</script></body></html>`;
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL, rooms: SqliteHearMeOutRoomMediaRuntime, spmtOrigin: string) {
  try {
    const principal = await resolvePrincipal(request, spmtOrigin);
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
      return sendJson(response, 200, { room, member: members.some((item) => item.userId === principal.userId), members, presence: rooms.listActivePresence(principal.tenantId, roomId), music: rooms.getSession(principal.tenantId, roomId, "music"), movie: rooms.getSession(principal.tenantId, roomId, "movie") });
    }
    const joinMatch = url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      requireSameOrigin(request);
      const roomId = decodeURIComponent(joinMatch[1]!);
      const body = await readJson(request);
      return sendJson(response, 200, rooms.joinRoom(principal, roomId, `web-join:${principal.userId}:${randomBytes(8).toString("hex")}`, undefined, typeof body.password === "string" && body.password ? { password: body.password } : {}));
    }
    const presenceMatch = url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/presence$/);
    if (request.method === "POST" && presenceMatch) {
      requireSameOrigin(request);
      const body = await readJson(request);
      return sendJson(response, 200, rooms.heartbeatPresence(principal, decodeURIComponent(presenceMatch[1]!), requiredText(body.connectionId, "connectionId", 200)));
    }
    return sendJson(response, 404, { error: "not_found", message: "Unknown HearMeOut Green route" });
  } catch (error) {
    const message = safeError(error);
    const status = /session|sign in|unauthor/i.test(message) ? 401 : /not found|expired/i.test(message) ? 404 : /password|member|admin|owner|denied/i.test(message) ? 403 : 400;
    return sendJson(response, status, { error: "hearmeout_green_request_failed", message });
  }
}

function roomSummary(runtime: SqliteHearMeOutRoomMediaRuntime, principal: HearMeOutPrincipalV1, room: HearMeOutRoomV1) {
  const members = runtime.listMembers(principal.tenantId, room.roomId);
  let activeCount = 0;
  try { activeCount = new Set(runtime.listActivePresence(principal.tenantId, room.roomId).map((item) => item.userId)).size; } catch {}
  return { ...room, member: members.some((item) => item.userId === principal.userId), memberCount: members.length, activeCount };
}

async function resolvePrincipal(request: IncomingMessage, spmtOrigin: string): Promise<HearMeOutPrincipalV1> {
  const headers: Record<string, string> = { accept: "application/json", "x-spmt-app": "hearmeout" };
  if (request.headers.cookie) headers.cookie = request.headers.cookie;
  const response = await fetch(`${spmtOrigin}/v1/session`, { headers, redirect: "manual" });
  if (!response.ok) throw new Error("Sign in to SpaceMountain before using Hear Me Out");
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
function loopbackOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_ORIGIN must be a credential-free loopback HTTP origin");
  return url.origin;
}
function send(response: ServerResponse, status: number, body: string, type: string) {
  const encoded = Buffer.from(body);
  response.writeHead(status, { "content-type": type, "content-length": encoded.byteLength, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(encoded);
}
function sendJson(response: ServerResponse, status: number, value: unknown) { send(response, status, JSON.stringify(value), "application/json; charset=utf-8"); }
function applyPageHeaders(response: ServerResponse) {
  response.setHeader("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; object-src 'none'");
  response.setHeader("permissions-policy", "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-frame-options", "SAMEORIGIN");
}
function listen(server: ReturnType<typeof createServer>, port: number, host: string) { return new Promise<void>((done, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); done(); }); }); }
function close(server: ReturnType<typeof createServer>) { return new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); }
function safeError(error: unknown) { return error instanceof Error ? error.message : String(error ?? "HearMeOut request failed"); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }

export const HEARMEOUT_WEB_CSS = `
:root,body{margin:0;width:100%;min-width:0;height:100%;min-height:0;overflow:hidden;background:transparent}.hmo-app{--spmt-app-backdrop-image:url('/assets/product/hearmeout-background.webp');--spmt-app-backdrop-position:center}.hmo-stage{height:var(--spmt-shell-available-height,100dvh);min-height:0;padding:clamp(14px,2vw,28px);overflow:hidden}.hmo-home,.hmo-rooms{height:100%;min-height:0}.hmo-home{display:grid;place-items:center}.hmo-hero{width:min(980px,100%);max-height:100%;display:grid;gap:18px;align-content:center;padding:clamp(22px,4vw,46px);border-radius:30px;background:transparent}.hmo-mark{display:flex;align-items:center;gap:14px;color:var(--spmt-accent-secondary);font-size:11px;font-weight:900;letter-spacing:.17em}.hmo-mark img{width:68px;height:68px;object-fit:contain;filter:drop-shadow(0 0 16px color-mix(in srgb,var(--spmt-accent-secondary) 45%,transparent))}.hmo-hero h1{margin:0;font-size:clamp(48px,9vw,116px);line-height:.88;letter-spacing:-.06em}.hmo-hero p{max-width:680px;margin:0;color:var(--spmt-muted);font-size:clamp(16px,2vw,22px);line-height:1.45}.hmo-hero-actions,.hmo-page-head>div:last-child{display:flex;flex-wrap:wrap;gap:9px}.hmo-hero footer{display:flex;align-items:center;gap:12px;color:var(--spmt-muted)}.hmo-button{appearance:none;border:1px solid var(--spmt-border);border-radius:14px;background:var(--spmt-surface-depth-3);color:var(--spmt-ink);padding:10px 15px;font:inherit;font-weight:850;cursor:pointer}.hmo-button:hover,.hmo-button:focus-visible{border-color:var(--spmt-accent-secondary);transform:translateY(-1px)}.hmo-button.primary{background:color-mix(in srgb,var(--spmt-accent) 28%,var(--spmt-surface-depth-2));border-color:color-mix(in srgb,var(--spmt-accent) 70%,transparent)}.hmo-rooms{display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:12px}.hmo-page-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.hmo-page-head span,.hmo-create-panel label>span{display:block;color:var(--spmt-accent-secondary);font-size:10px;font-weight:900;letter-spacing:.15em}.hmo-page-head h2{margin:2px 0 0;font-size:clamp(27px,4vw,44px)}.hmo-create-panel{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(160px,.35fr) auto;gap:9px;align-items:end;border-radius:20px;padding:12px}.hmo-create-panel[hidden],.hmo-room-detail[hidden]{display:none!important}.hmo-create-panel label{display:grid;gap:5px}.hmo-create-panel input,.hmo-create-panel select{min-width:0;border:1px solid var(--spmt-border);border-radius:12px;background:var(--spmt-surface-depth-4);color:var(--spmt-ink);padding:9px 10px;font:inherit}.hmo-create-panel p{grid-column:1/-1;margin:0;color:var(--spmt-muted);font-size:12px}.hmo-room-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;display:grid;gap:12px}.hmo-room-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.hmo-room-card{display:grid;gap:9px;min-width:0;border:1px solid var(--spmt-border);border-radius:18px;background:var(--spmt-surface-depth-1);padding:13px;backdrop-filter:blur(var(--spmt-blur,18px))}.hmo-room-card header{display:flex;justify-content:space-between;gap:8px}.hmo-room-card strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hmo-badge{border:1px solid var(--spmt-border);border-radius:999px;padding:3px 7px;font-size:10px;text-transform:uppercase}.hmo-meta{color:var(--spmt-muted);font-size:12px}.hmo-room-card footer{display:flex;gap:7px}.hmo-room-card footer .hmo-button{flex:1;padding:7px 9px;font-size:12px}.hmo-empty{display:grid;place-items:center;min-height:110px;grid-column:1/-1;border:1px dashed var(--spmt-border);border-radius:18px;color:var(--spmt-muted);padding:18px}.hmo-room-detail{border-radius:20px;padding:14px}.hmo-room-detail-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.hmo-room-detail-head strong{display:block;font-size:20px}.hmo-room-detail-head small{color:var(--spmt-muted)}.hmo-room-columns{display:grid;grid-template-columns:1.1fr .9fr;gap:10px;margin-top:12px}.hmo-room-pane{border-radius:15px;background:var(--spmt-surface-depth-3);padding:11px}.hmo-room-pane h3{margin:0 0 8px;color:var(--spmt-accent-secondary);font-size:11px;letter-spacing:.1em;text-transform:uppercase}.hmo-member-list,.hmo-session-list{display:grid;gap:6px}.hmo-member,.hmo-session{display:flex;justify-content:space-between;gap:8px;border-radius:11px;background:var(--spmt-surface-depth-4);padding:8px 9px;font-size:12px}.hmo-member span:last-child,.hmo-session span:last-child{color:var(--spmt-muted)}@media(max-width:850px){.hmo-room-list{grid-template-columns:1fr 1fr}.hmo-create-panel{grid-template-columns:1fr 1fr}.hmo-page-head{align-items:flex-start}}@media(max-width:560px){.hmo-stage{padding:10px}.hmo-room-list,.hmo-create-panel{grid-template-columns:1fr}.hmo-page-head{display:grid}.hmo-hero h1{font-size:clamp(46px,18vw,74px)}}`;

export const HEARMEOUT_BRIDGE_BROWSER_JS = String.raw`;(()=>{const body=document.body;let hostOrigin='*';const appId='hearmeout';function send(message){window.parent!==window&&window.parent.postMessage(message,hostOrigin)}function applyTheme(theme={}){if(theme.accent)body.style.setProperty('--spmt-accent',theme.accent);if(theme.accentSecondary)body.style.setProperty('--spmt-accent-secondary',theme.accentSecondary);if(theme.glassOpacity!==undefined)body.style.setProperty('--spmt-glass-opacity',String(Number(theme.glassOpacity)/100));if(theme.blurStrength!==undefined)body.style.setProperty('--spmt-blur',Number(theme.blurStrength)+'px');if(theme.starDensity!==undefined)body.style.setProperty('--spmt-stars',String(Number(theme.starDensity)/100));const id=theme.themeId||'solar-flare';const logo=document.querySelector('[data-hmo-logo]');if(logo)logo.src='/assets/product/app-icons/'+id+'/hearmeout.png';document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme.accent||'#f97316')}function applyLayout(layout={}){for(const [key,value] of Object.entries({'--spmt-header-height':layout.headerHeight,'--spmt-safe-top':layout.safeTop,'--spmt-safe-right':layout.safeRight,'--spmt-safe-bottom':layout.safeBottom,'--spmt-safe-left':layout.safeLeft,'--spmt-shell-available-height':Math.max(0,(layout.availableHeight||0)-(layout.headerHeight||0)-(layout.safeTop||0)-(layout.safeBottom||0))}))if(Number.isFinite(value))body.style.setProperty(key,value+'px')}window.addEventListener('message',event=>{const message=event.data;if(!message||message.protocol!=='spmt.embed'||message.version!==1)return;hostOrigin=event.origin||hostOrigin;if(message.type==='host.hello'&&message.launch?.appId===appId)body.dataset.surface=message.launch.surfaceMode||'standalone';else if(message.type==='theme.changed')applyTheme(message.theme);else if(message.type==='layout.changed')applyLayout(message.layout);else if(message.type==='runtime.changed'){const node=document.querySelector('[data-hmo-runtime]');if(node)node.textContent=message.state==='ready'?'Green runtime':String(message.state||'runtime')} });if(window.parent!==window)send({protocol:'spmt.embed',version:1,type:'child.ready',appId});})();`;

export const HEARMEOUT_ROOM_BROWSER_JS = String.raw`;(()=>{const body=document.body;if(body.dataset.app!=='hearmeout')return;let connectionId='web-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)),activeRoom='',heartbeatTimer=0;const panels=[...document.querySelectorAll('[data-hmo-view-panel]')],list=document.querySelector('[data-hmo-room-list]'),form=document.querySelector('[data-hmo-create-form]'),detail=document.querySelector('[data-hmo-room-detail]'),privacy=form?.querySelector('[name="privacy"]'),password=document.querySelector('[data-hmo-password]'),status=document.querySelector('[data-hmo-create-status]');function view(name){body.dataset.hmoView=name;for(const panel of panels)panel.hidden=panel.getAttribute('data-hmo-view-panel')!==name;if(name==='rooms')void loadRooms()}function openCreate(){view('rooms');if(form){form.hidden=false;setTimeout(()=>form.querySelector('input')?.focus(),0)}}document.querySelector('[data-hmo-create-home]')?.addEventListener('click',openCreate);document.querySelector('[data-hmo-open-rooms]')?.addEventListener('click',()=>view('rooms'));document.querySelector('[data-hmo-home]')?.addEventListener('click',()=>view('home'));document.querySelector('[data-hmo-create-toggle]')?.addEventListener('click',()=>{if(form){form.hidden=!form.hidden;if(!form.hidden)form.querySelector('input')?.focus()}});document.querySelector('[data-hmo-refresh]')?.addEventListener('click',()=>void loadRooms());privacy?.addEventListener('change',()=>{if(password){password.hidden=privacy.value!=='private';if(password.hidden){const input=password.querySelector('input');if(input)input.value=''}}});form?.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;if(status)status.textContent='Creating room…';try{const fd=new FormData(form),room=await api('/api/hearmeout/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:String(fd.get('name')||'').trim(),privacy:String(fd.get('privacy')||'public'),password:String(fd.get('password')||'')||undefined})});form.reset();if(password)password.hidden=true;form.hidden=true;await loadRooms();await joinRoom(room.roomId)}catch(error){if(status)status.textContent=message(error)}finally{if(button)button.disabled=false}});async function api(path,init){const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...init}),payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.message||payload.error||('Request failed ('+response.status+')'));return payload}async function loadRooms(){if(!list)return;list.replaceChildren(empty('Loading rooms…'));try{const payload=await api('/api/hearmeout/rooms'),rooms=Array.isArray(payload.rooms)?payload.rooms:[];if(!rooms.length){list.replaceChildren(empty('No rooms yet. Create the first Green room.'));return}const fragment=document.createDocumentFragment();for(const room of rooms)fragment.append(roomCard(room));list.replaceChildren(fragment)}catch(error){list.replaceChildren(empty(message(error)))}}function roomCard(room){const card=document.createElement('article');card.className='hmo-room-card';const head=document.createElement('header'),title=document.createElement('strong'),badge=document.createElement('span');title.textContent=room.name||room.roomId;badge.className='hmo-badge';badge.textContent=room.privacy||'public';head.append(title,badge);const meta=document.createElement('div');meta.className='hmo-meta';meta.textContent=Number(room.activeCount||0)+' active · '+(room.systemRoom?'system room':expiry(room.expiresAt));const footer=document.createElement('footer'),inspect=action('View',()=>void showRoom(room.roomId)),join=action(room.member?'Open':'Join',()=>void joinRoom(room.roomId,room.privacy==='private'&&!room.member));if(room.member)join.classList.add('primary');footer.append(inspect,join);card.append(head,meta,footer);return card}function action(label,fn){const button=document.createElement('button');button.type='button';button.className='hmo-button';button.textContent=label;button.addEventListener('click',fn);return button}function empty(text){const node=document.createElement('div');node.className='hmo-empty';node.textContent=text;return node}async function joinRoom(roomId,askPassword=false){let pass;if(askPassword){pass=prompt('Password for this private room');if(pass===null)return}try{await api('/api/hearmeout/rooms/'+encodeURIComponent(roomId)+'/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pass?{password:pass}:{})});activeRoom=roomId;await heartbeat();clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>void heartbeat(),15000);await Promise.all([loadRooms(),showRoom(roomId)])}catch(error){if(detail){detail.hidden=false;detail.replaceChildren(empty(message(error)))}}}async function heartbeat(){if(!activeRoom)return;try{await api('/api/hearmeout/rooms/'+encodeURIComponent(activeRoom)+'/presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId})})}catch{}}async function showRoom(roomId){if(!detail)return;detail.hidden=false;detail.replaceChildren(empty('Loading room…'));try{const payload=await api('/api/hearmeout/rooms/'+encodeURIComponent(roomId)),room=payload.room||{},wrap=document.createElement('div'),head=document.createElement('div');head.className='hmo-room-detail-head';const text=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small');name.textContent=room.name||room.roomId;meta.textContent=(room.privacy||'public')+' · '+(payload.member?'joined':'not joined');text.append(name,meta);const join=action(payload.member?'Refresh room':'Join room',()=>payload.member?void showRoom(roomId):void joinRoom(roomId,room.privacy==='private'));if(!payload.member)join.classList.add('primary');head.append(text,join);const columns=document.createElement('div');columns.className='hmo-room-columns';columns.append(memberPane(payload),sessionPane(payload));wrap.append(head,columns);detail.replaceChildren(wrap)}catch(error){detail.replaceChildren(empty(message(error)))}}function memberPane(payload){const pane=document.createElement('section');pane.className='hmo-room-pane';const h=document.createElement('h3');h.textContent='People';const rows=document.createElement('div');rows.className='hmo-member-list';const members=Array.isArray(payload.members)?payload.members:[],active=new Set((payload.presence||[]).map(item=>item.userId));if(!members.length)rows.append(empty('No members yet.'));for(const item of members){const row=document.createElement('div');row.className='hmo-member';const n=document.createElement('span'),s=document.createElement('span');n.textContent=item.displayName||item.userId;s.textContent=active.has(item.userId)?'active':'member';row.append(n,s);rows.append(row)}pane.append(h,rows);return pane}function sessionPane(payload){const pane=document.createElement('section');pane.className='hmo-room-pane';const h=document.createElement('h3');h.textContent='Room media';const rows=document.createElement('div');rows.className='hmo-session-list';for(const lane of ['music','movie']){const session=payload[lane]||{},row=document.createElement('div');row.className='hmo-session';const n=document.createElement('span'),s=document.createElement('span');n.textContent=lane==='music'?'Music / DJ':'Watch party';s.textContent=session.current?.item?.title||session.playback?.status||'idle';row.append(n,s);rows.append(row)}pane.append(h,rows);return pane}function expiry(value){if(!value)return'no expiry';const ms=Date.parse(value)-Date.now();if(ms<=0)return'expired';const min=Math.ceil(ms/60000);return min>=60?Math.ceil(min/60)+'h left':min+'m left'}function message(error){return error instanceof Error?error.message:String(error||'HearMeOut request failed')}})();`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const spmtOrigin = process.env.SPMT_ORIGIN ?? "";
  const databasePath = process.env.HEARMEOUT_ROOM_DATABASE_PATH ?? "";
  if (!databasePath) throw new Error("HEARMEOUT_ROOM_DATABASE_PATH is required");
  const host = createHearMeOutWebServer({ spmtOrigin, databasePath, port: Number(process.env.PORT ?? 3200), host: process.env.HOST ?? "127.0.0.1", buildSha: process.env.BUILD_SHA ?? "dev" });
  await host.listen();
}
