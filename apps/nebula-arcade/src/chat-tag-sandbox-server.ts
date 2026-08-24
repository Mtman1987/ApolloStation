import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SpmtClient } from "@spmt/sdk";
import { ChatTagExperienceService, SqliteChatTagExperienceStore } from "./chat-tag-experience.js";
import { ChatTagOverlayHttpAdapter } from "./chat-tag-overlay-http.js";
import { ChatTagRuntime, SqliteChatTagStore } from "./chat-tag-runtime.js";
import { NEBULA_ARCADE_GAMES } from "./game-hub.js";

const MAX_BODY_BYTES = 64 * 1_024;
const PROVIDER_ENV_NAMES = ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_BOT_OAUTH_TOKEN", "DISCORD_BOT_TOKEN", "KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "FLY_API_TOKEN"] as const;

export interface ChatTagSandboxHostOptions { databasePath: string; tenantId: string; channelId: string; pinUserId?: string; port?: number; host?: string; buildSha?: string; }

export function createChatTagSandboxHost(options: ChatTagSandboxHostOptions) {
  const gameStore = new SqliteChatTagStore(options.databasePath);
  const experienceStore = new SqliteChatTagExperienceStore(options.databasePath);
  const spmt = new SpmtClient({ baseUrl: "http://sandbox-disabled.invalid", appId: "nebula-arcade", fetchImpl: async () => Response.json({ sandbox: true, outbound: "disabled" }) });
  const runtime = new ChatTagRuntime(gameStore, spmt);
  const experience = new ChatTagExperienceService(runtime, experienceStore, options.pinUserId ?? "provider:twitch:pin", () => new Date().toISOString());
  const overlay = new ChatTagOverlayHttpAdapter(gameStore, () => new Date().toISOString(), experienceStore);
  const principal = { schemaVersion: 1 as const, tenantId: options.tenantId, appId: "nebula-arcade" as const, widgetId: "chat-tag" as const, channelId: options.channelId };
  const server = createServer(async (request, response) => {
    const nonce = randomBytes(18).toString("base64url");
    applyHeaders(response, nonce);
    try {
      const url = new URL(request.url ?? "/", "http://chat-tag.sandbox");
      if (request.method === "GET" && url.pathname === "/health/ready") return json(response, 200, { ready: true, app: "nebula-arcade", runtimeMode: "sandbox", outboundIntegrations: "disabled", buildSha: options.buildSha ?? "dev" });
      if (request.method === "GET" && url.pathname === "/") return html(response, 200, renderSandboxPage(nonce, options.tenantId, options.channelId));
      if (request.method === "GET" && url.pathname === "/assets/chat-tag-sandbox.css") return text(response, 200, SANDBOX_CSS, "text/css; charset=utf-8", "public, max-age=300");
      if (request.method === "GET" && url.pathname === "/assets/chat-tag-sandbox.js") return text(response, 200, SANDBOX_JS, "text/javascript; charset=utf-8", "public, max-age=300");
      if (request.method === "GET" && url.pathname === "/v1/chat-tag/state") return json(response, 200, runtime.getState(options.tenantId));
      if (request.method === "GET" && url.pathname === "/v1/chat-tag/support") return json(response, 200, experienceStore.listSupportTickets(options.tenantId));
      if (request.method === "GET" && url.pathname === "/v1/nebula/chat-tag/overlay/messages") {
        const after = Number(url.searchParams.get("after") ?? "0");
        return json(response, 200, { messages: experienceStore.listOverlayMessages(options.tenantId, options.channelId, after) });
      }
      if (request.method === "POST" && url.pathname === "/v1/chat-tag/message") {
        requireSameOrigin(request); const body = await readJson(request); const occurredAt = optionalIso(body.occurredAt) ?? new Date().toISOString();
        const outcome = await experience.ingest({ schemaVersion: 1, provider: provider(body.provider), tenantId: options.tenantId, channelId: options.channelId, messageId: textField(body.messageId, "messageId", 200), userId: textField(body.userId, "userId", 200), username: textField(body.username, "username", 120), text: normalizeSandboxChatTagCommand(textField(body.text, "text", 500)), occurredAt, roles: roles(body.roles) }, { liveUserIds: stringArray(body.liveUserIds, 200) });
        return json(response, 200, { outcome, stored: runtime.getState(options.tenantId) });
      }
      if (request.method === "POST" && url.pathname === "/v1/chat-tag/rotation") {
        requireSameOrigin(request); const body = await readJson(request);
        const outcome = await runtime.reconcileRotation({ tenantId: options.tenantId, channelId: options.channelId, now: optionalIso(body.now) ?? new Date().toISOString(), liveUserIds: stringArray(body.liveUserIds, 200) });
        return json(response, 200, { outcome, stored: runtime.getState(options.tenantId) });
      }
      if (url.pathname === "/v1/nebula/chat-tag/overlay" || url.pathname.startsWith("/v1/nebula/chat-tag/overlay/")) {
        const adapted = overlay.handle({ method: request.method ?? "GET", path: url.pathname }, principal);
        return textWithHeaders(response, adapted.status, adapted.body, adapted.headers);
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) { const status = error instanceof SandboxError ? error.status : 500; return json(response, status, { error: status === 500 ? "internal" : "invalid_request", message: error instanceof Error ? error.message : "unknown error" }); }
  });
  return {
    server,
    listen: () => new Promise<void>((done, reject) => { server.once("error", reject); server.listen(options.port ?? 8080, options.host ?? "0.0.0.0", () => { server.off("error", reject); done(); }); }),
    close: () => new Promise<void>((done, reject) => server.close((error) => { gameStore.close(); experienceStore.close(); error ? reject(error) : done(); })),
  };
}

export function validateChatTagSandboxEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.SPMT_RUNTIME_MODE !== "sandbox") throw new Error("SPMT_RUNTIME_MODE=sandbox is required");
  if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("SPMT_OUTBOUND_MODE=disabled is required");
  const present = PROVIDER_ENV_NAMES.filter((name) => Boolean(environment[name]));
  if (present.length) throw new Error(`Chat Tag sandbox rejects provider or infrastructure credentials: ${present.join(", ")}`);
  return { databasePath: resolve(environment.CHAT_TAG_DATABASE_PATH ?? ".sandbox-data/chat-tag-green-sandbox.sqlite"), tenantId: safeId(environment.CHAT_TAG_TENANT_ID ?? "chat-tag-sandbox", "CHAT_TAG_TENANT_ID"), channelId: safeId(environment.CHAT_TAG_CHANNEL_ID ?? "sandbox-channel", "CHAT_TAG_CHANNEL_ID") };
}

function renderSandboxPage(nonce: string, tenantId: string, channelId: string) { const games = NEBULA_ARCADE_GAMES.map((game) => `<article data-game="${escapeHtml(game.id)}"><span>COMMUNITY GAME</span><h2>${escapeHtml(game.name)}</h2><small>${game.commands.map((command) => `!${escapeHtml(command)}`).join(" · ")}</small></article>`).join(""); return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Nebula Arcade · Games Hub</title><link rel="stylesheet" href="/assets/chat-tag-sandbox.css"><script src="/assets/chat-tag-sandbox.js" defer nonce="${nonce}"></script></head><body><header><div><b>NEBULA ARCADE</b><span>Games Hub · private Sprite sandbox · outbound providers off</span></div><a href="/v1/nebula/chat-tag/overlay" target="_blank" rel="noreferrer">Open Chat Tag OBS output</a></header><main><section class="hero"><p>GAMES HUB · 20 EQUAL TITLES</p><h1>Choose what your community plays.</h1><span>Tenant ${escapeHtml(tenantId)} · Channel ${escapeHtml(channelId)}</span></section><section class="games" aria-label="Nebula Arcade game catalog">${games}</section><section class="console"><header><div><b>CHAT TAG</b><span>Selected game console</span></div></header><form id="command"><label>User ID<input name="userId" value="player-alpha" required></label><label>Username<input name="username" value="Alpha" required></label><label>Role<select name="role"><option value="member">Player</option><option value="moderator">Moderator</option><option value="broadcaster">Broadcaster</option></select></label><label class="wide">Chat message<input name="text" value="!join" required></label><button>Send</button></form><div class="quick"><button data-command="!join">Join</button><button data-command="spmt status">Status</button><button data-command="spmt score">Score</button><button data-command="spmt players">Players</button><button data-command="spmt live">Live</button><button data-command="spmt sleep">Sleep</button><button data-command="spmt wake">Wake</button><button data-command="spmt pinrank">Pin rank</button></div><pre id="reply" aria-live="polite">Ready.</pre></section><section class="state"><div><span>Current IT</span><strong id="it">—</strong></div><div><span>Players</span><strong id="players">0</strong></div><div><span>Last tag</span><strong id="last">—</strong></div></section><section><h2>Chat Tag leaderboard</h2><ol id="leaderboard"></ol></section></main></body></html>`; }

const SANDBOX_CSS = `:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#050816;color:#eef6ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#28134d 0,transparent 35%),radial-gradient(circle at 95% 20%,#00364a 0,transparent 32%),#050816}body>header{display:flex;justify-content:space-between;align-items:center;padding:1rem 4vw;border-bottom:1px solid #2d426d;background:#071020dd;position:sticky;top:0;z-index:5;backdrop-filter:blur(14px)}header div{display:flex;flex-direction:column}header b,.hero p,.games span{color:#54e5ff;letter-spacing:.14em}header span{color:#9cb0cf;font-size:.8rem}a,button{color:#fff;background:#6f3cff;border:1px solid #a78bfa;border-radius:.7rem;padding:.7rem 1rem;text-decoration:none;cursor:pointer}main{width:min(1180px,92vw);margin:3rem auto}.hero h1{font-size:clamp(2.2rem,7vw,5.8rem);line-height:.9;margin:.4rem 0 1rem;max-width:900px}.hero span{color:#9cb0cf}.games{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.8rem;margin:3rem 0}.games article{min-height:135px;padding:1rem;border:1px solid #2e4776;border-radius:1rem;background:#091327c9}.games span{font-size:.62rem}.games h2{margin:.65rem 0;font-size:1.1rem}.games small{color:#879abb;font-size:.68rem;line-height:1.5}.console{margin:3rem 0;padding:1.4rem;border:1px solid #355080;border-radius:1.2rem;background:#091327dd;box-shadow:0 0 50px #5c24c522}.console>header{margin:-1.4rem -1.4rem 1.4rem;padding:1rem 1.4rem;border-bottom:1px solid #355080}form{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem}label{display:flex;flex-direction:column;gap:.4rem;color:#9cb0cf;font-size:.8rem}.wide{grid-column:1/4}input,select{width:100%;background:#030816;color:#fff;border:1px solid #334b76;border-radius:.6rem;padding:.8rem;font:inherit}form button{grid-column:1/4}.quick{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}.quick button{background:#0c203b;border-color:#31537f;padding:.5rem .75rem}pre{white-space:pre-wrap;min-height:4rem;padding:1rem;border-radius:.7rem;background:#02050d;color:#7fffd4}.state{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}.state div{padding:1.2rem;border:1px solid #253d66;border-radius:1rem;background:#081121}.state span{display:block;color:#8ca1c4;font-size:.75rem;text-transform:uppercase}.state strong{font-size:1.4rem}ol{display:grid;gap:.6rem;padding-left:1.5rem}li{padding:.7rem 1rem;background:#0a162a;border-radius:.6rem}@media(max-width:900px){.games{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){form,.state,.games{grid-template-columns:1fr}.wide,form button{grid-column:auto}body>header{align-items:flex-start;gap:1rem}header a{font-size:.75rem}}`;
const SANDBOX_JS = `(()=>{'use strict';const form=document.getElementById('command'),reply=document.getElementById('reply'),it=document.getElementById('it'),players=document.getElementById('players'),last=document.getElementById('last'),leaderboard=document.getElementById('leaderboard');let serial=0;function render(stored){const s=stored.state;it.textContent=s.currentItUserId?(s.players[s.currentItUserId]?.username||s.currentItUserId):'FREE FOR ALL';players.textContent=Object.keys(s.players).length;last.textContent=s.lastTagAt||'—';leaderboard.replaceChildren(...Object.values(s.players).sort((a,b)=>b.score-a.score).map(p=>{const li=document.createElement('li');li.textContent=p.username+' · '+p.score+' pts · '+p.tagsMade+' tags';return li;}));}async function refresh(){const r=await fetch('/v1/chat-tag/state',{cache:'no-store'});render(await r.json());}form.addEventListener('submit',async e=>{e.preventDefault();const data=new FormData(form);reply.textContent='Sending…';const body={messageId:'sandbox-'+Date.now()+'-'+(++serial),userId:data.get('userId'),username:data.get('username'),text:data.get('text'),roles:[data.get('role')]};try{const r=await fetch('/v1/chat-tag/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),value=await r.json();if(!r.ok)throw new Error(value.message||'Request failed');reply.textContent=value.outcome.message||value.outcome.code;render(value.stored);}catch(error){reply.textContent=error.message;}});document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>{form.elements.text.value=button.dataset.command;form.requestSubmit();}));refresh();})();`;

function applyHeaders(response: ServerResponse, nonce: string) { response.setHeader("content-security-policy", `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`); response.setHeader("referrer-policy", "no-referrer"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()"); }
function requireSameOrigin(request: IncomingMessage) { const origin = request.headers.origin; const host = request.headers.host; if (!origin || !host) throw new SandboxError(403, "A same-origin browser request is required"); let parsed: URL; try { parsed = new URL(origin); } catch { throw new SandboxError(403, "Origin is invalid"); } if (parsed.host !== host) throw new SandboxError(403, "Cross-origin mutation is blocked"); }
async function readJson(request: IncomingMessage) { const chunks: Buffer[] = []; let total = 0; for await (const chunk of request) { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += part.byteLength; if (total > MAX_BODY_BYTES) throw new SandboxError(413, "Request body is too large"); chunks.push(part); } let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new SandboxError(400, "A JSON object is required"); } if (!value || typeof value !== "object" || Array.isArray(value)) throw new SandboxError(400, "A JSON object is required"); return value as Record<string, unknown>; }
function textField(value: unknown, name: string, max: number) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new SandboxError(400, `${name} is invalid`); return value.trim(); }
function stringArray(value: unknown, max: number) { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !item.trim())) throw new SandboxError(400, "liveUserIds is invalid"); return value as string[]; }
function roles(value: unknown): Array<"broadcaster" | "moderator" | "member"> { const values = stringArray(value, 3); if (values.some((item) => !["broadcaster", "moderator", "member"].includes(item))) throw new SandboxError(400, "roles is invalid"); return values as Array<"broadcaster" | "moderator" | "member">; }
function provider(value: unknown): "twitch" | "discord" | "kick" { const result = value ?? "twitch"; if (!["twitch", "discord", "kick"].includes(String(result))) throw new SandboxError(400, "provider is invalid"); return result as "twitch" | "discord" | "kick"; }
function optionalIso(value: unknown) { if (value === undefined) return undefined; if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new SandboxError(400, "timestamp is invalid"); return value; }
function normalizeSandboxChatTagCommand(value: string) { const match = /^!(join|leave|status|score|tag|pass|players|live|sleep|wake|pinrank)(\s+.*)?$/i.exec(value); return match ? `spmt ${match[1]!.toLowerCase()}${match[2] ?? ""}` : value; }
function safeId(value: string, name: string) { if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); return value; }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function html(response: ServerResponse, status: number, body: string) { text(response, status, body, "text/html; charset=utf-8", "no-store"); }
function text(response: ServerResponse, status: number, body: string, contentType: string, cache: string) { const encoded = Buffer.from(body); response.writeHead(status, { "content-type": contentType, "content-length": encoded.byteLength, "cache-control": cache }); response.end(encoded); }
function textWithHeaders(response: ServerResponse, status: number, body: string, headers: Record<string, string>) { const encoded = Buffer.from(body); response.writeHead(status, { ...headers, "content-length": encoded.byteLength }); response.end(encoded); }
function json(response: ServerResponse, status: number, body: unknown) { const encoded = Buffer.from(JSON.stringify(body)); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": encoded.byteLength, "cache-control": "no-store" }); response.end(encoded); }
class SandboxError extends Error { constructor(readonly status: number, message: string) { super(message); } }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checked = validateChatTagSandboxEnvironment(process.env);
  const host = createChatTagSandboxHost({ ...checked, port: Number(process.env.PORT ?? 8080), host: process.env.HOST ?? "0.0.0.0", buildSha: process.env.BUILD_SHA ?? "dev", ...(process.env.CHAT_TAG_PIN_USER_ID ? { pinUserId: process.env.CHAT_TAG_PIN_USER_ID } : {}) });
  await host.listen();
}
