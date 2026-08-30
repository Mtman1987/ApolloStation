import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NEBULA_ARCADE_GAMES } from "./game-hub.js";
import { SqliteNebulaGameActionStore, validateNebulaGameAction } from "./game-actions.js";
import { SqliteNebulaGameMixStore, type NebulaGameMixV1 } from "./game-mixes.js";
import { getNebulaGameStats, joinNebulaGame, leaveNebulaGame, normalizeNebulaPlayerId, resolveNebulaChannelGameIds, setNebulaChannelGameRunning } from "./game-runtime.js";
import { SqliteNebulaGameRuntimeStore } from "./game-runtime-store.js";
import { createNebulaArcadeSandboxHost as createNebulaArcadeCoreHost, validateNebulaArcadeSandboxEnvironment, type NebulaArcadeSandboxHostOptions } from "./nebula-arcade-core-server.js";

const MAX_BODY_BYTES = 64 * 1024;
const APP_PATH = "/apps/nebula-arcade";
const GAME_IDS = new Set(NEBULA_ARCADE_GAMES.map((game) => game.id));

export function createNebulaArcadeSandboxHost(options: NebulaArcadeSandboxHostOptions) {
  const core = createNebulaArcadeCoreHost({ ...options, port: 0, host: "127.0.0.1" });
  const runtime = new SqliteNebulaGameRuntimeStore(options.databasePath);
  const actions = new SqliteNebulaGameActionStore(options.databasePath);
  const mixes = new SqliteNebulaGameMixStore(options.databasePath);
  let corePort = 0;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://nebula.green");
      if (request.method === "GET" && url.pathname === "/assets/nebula-game-mix.js") return javascript(response, GAME_MIX_CLIENT_JS);
      if (request.method === "GET" && url.pathname === "/v1/nebula/game-actions") return json(response, 200, { actions: actions.list(options.tenantId, { ...(url.searchParams.get("channel") ? { channel: url.searchParams.get("channel")! } : {}), ...(url.searchParams.getAll("gameId").length ? { gameIds: url.searchParams.getAll("gameId") } : {}), ...(url.searchParams.get("after") ? { after: url.searchParams.get("after")! } : {}), ...(url.searchParams.get("limit") ? { limit: Number(url.searchParams.get("limit")) } : {}) }) });
      if (request.method === "POST" && url.pathname === "/v1/nebula/game-actions") { requireSameOrigin(request); return handleAction(response, await readJson(request), options, runtime, actions); }
      if (request.method === "GET" && (url.pathname === "/v1/nebula/game-mixes" || (url.pathname === APP_PATH && url.searchParams.get("action") === "game-mixes"))) return json(response, 200, { mixes: mixes.list(options.tenantId) });
      if (request.method === "POST" && (url.pathname === "/v1/nebula/game-mixes" || (url.pathname === APP_PATH && url.searchParams.get("action") === "game-mixes"))) {
        requireSameOrigin(request); const body = await readJson(request); const mix = mixes.save(options.tenantId, gameMixInput(body));
        return json(response, 200, { mix, rendererUrl: `${APP_PATH}?surface=overlay&mix=${encodeURIComponent(mix.id)}` });
      }
      if (request.method === "DELETE" && (url.pathname.startsWith("/v1/nebula/game-mixes/") || (url.pathname === APP_PATH && url.searchParams.get("action") === "game-mixes"))) {
        requireSameOrigin(request); const mixId = url.pathname.startsWith("/v1/nebula/game-mixes/") ? decodeURIComponent(url.pathname.slice("/v1/nebula/game-mixes/".length)) : url.searchParams.get("mix") ?? "";
        return json(response, mixes.delete(options.tenantId, mixId) ? 200 : 404, { deleted: mixId });
      }
      if (request.method === "GET" && url.pathname === "/v1/nebula/game-mix-state") {
        const mix = mixes.get(options.tenantId, url.searchParams.get("mix") ?? ""); if (!mix) return json(response, 404, { error: "mix_not_found" });
        return json(response, 200, gameMixState(options.tenantId, options.channelId, mix, runtime, actions));
      }
      const directMix = request.method === "GET" && url.pathname.startsWith("/overlay/game-mix/") ? decodeURIComponent(url.pathname.slice("/overlay/game-mix/".length)) : undefined;
      const queryMix = request.method === "GET" && url.pathname === APP_PATH && url.searchParams.get("surface") === "overlay" ? url.searchParams.get("mix") ?? undefined : undefined;
      if (directMix || queryMix) { const mix = mixes.get(options.tenantId, directMix ?? queryMix!); return mix ? html(response, 200, renderGameMix(mix, options.channelId)) : html(response, 404, "<!doctype html><meta charset=utf-8><title>Game Mix not found</title>"); }
      if (request.method === "GET" && url.pathname === APP_PATH && url.searchParams.get("view") === "overlay" && url.searchParams.get("surface") !== "overlay") return html(response, 200, canonicalOverlayEditorPage());
      if (request.method === "GET" && (url.pathname === APP_PATH || url.pathname === "/") && url.searchParams.get("surface") !== "overlay") return proxyCore(request, response, corePort, true);
      return proxyCore(request, response, corePort, false);
    } catch (error) { return json(response, error instanceof NebulaHostError ? error.status : 500, { error: error instanceof NebulaHostError ? "invalid_request" : "internal", message: error instanceof Error ? error.message : "unknown error" }); }
  });

  return {
    server,
    async listen() { await core.listen(); const address = core.server.address(); if (!address || typeof address === "string") throw new Error("Nebula Arcade core host did not bind a TCP port"); corePort = address.port; await listen(server, options.port ?? 8080, options.host ?? "0.0.0.0"); },
    async close() { if (server.listening) await close(server); mixes.close(); actions.close(); runtime.close(); await core.close(); },
  };
}

function handleAction(response: ServerResponse, body: Record<string, unknown>, options: NebulaArcadeSandboxHostOptions, runtime: SqliteNebulaGameRuntimeStore, actions: SqliteNebulaGameActionStore) {
  const gameId = string(body.gameId, "gameId", 80).toLowerCase(); if (!GAME_IDS.has(gameId)) throw new NebulaHostError(400, "Unknown Nebula game");
  const checked = validateNebulaGameAction(gameId, typeof body.action === "string" ? body.action : "join", array(body.args));
  const channel = string(body.channel ?? options.channelId, "channel", 80).replace(/^#/, "").toLowerCase(), username = string(body.username, "username", 120).toLowerCase(), displayName = string(body.displayName ?? body.username, "displayName", 120), userId = string(body.userId ?? username, "userId", 160);
  const canControl = body.isBroadcaster === true || body.isModerator === true || body.isAdmin === true || username === channel;
  if ((checked.action === "start" || checked.action === "stop") && !canControl) throw new NebulaHostError(403, "Only the streamer or a moderator can start or stop a game");
  const now = new Date();
  const updated = runtime.update(options.tenantId, (state) => {
    if (checked.action === "start" || checked.action === "stop") setNebulaChannelGameRunning(state, channel, gameId, checked.action === "start", now);
    else { const active = resolveNebulaChannelGameIds(state, channel); if (gameId !== "tag" && !active.includes(gameId)) throw new NebulaHostError(409, `${gameId} is not active in #${channel}`); if (checked.action === "leave") leaveNebulaGame(state, normalizeNebulaPlayerId(userId, username), gameId, now); else joinNebulaGame(state, { userId, username, displayName, gameId }, now); }
    return getNebulaGameStats(state, gameId);
  }, "default", now);
  const action = actions.record({ tenantId: options.tenantId, channel, gameId, actorId: userId, username, displayName, action: checked.action, args: checked.args, message: String(body.message ?? "").slice(0,500), occurredAt: now.toISOString() });
  return json(response, 200, { handled: true, action, game: updated.result, activeGameIds: resolveNebulaChannelGameIds(updated.state, channel) });
}

function gameMixState(tenantId: string, channelId: string, mix: NebulaGameMixV1, runtimeStore: SqliteNebulaGameRuntimeStore, actionStore: SqliteNebulaGameActionStore) {
  const runtime = runtimeStore.get(tenantId), gameIds = mix.layers.filter((layer) => layer.enabled).map((layer) => layer.gameId), recent = actionStore.list(tenantId, { channel: channelId, gameIds, limit: 100 }), newest = new Map<string, (typeof recent)[number]>();
  for (const action of recent) newest.set(action.gameId, action);
  let visibleGameIds = [...gameIds];
  if (mix.mode === "activity") { const current = [...recent].reverse()[0]; visibleGameIds = current ? [current.gameId] : visibleGameIds.slice(0,1); }
  else if (mix.mode === "manual") visibleGameIds = mix.activeGameId ? [mix.activeGameId] : visibleGameIds.slice(0,1);
  else if (mix.mode === "rotate" && visibleGameIds.length) visibleGameIds = [visibleGameIds[Math.floor(Date.now() / (mix.rotationSeconds * 1000)) % visibleGameIds.length]!];
  return { schemaVersion:1, mix, visibleGameIds, games:Object.fromEntries(gameIds.map((gameId)=>{const stats=getNebulaGameStats(runtime,gameId),action=newest.get(gameId);return[gameId,{playerCount:stats.players.length,leaderboard:stats.leaderboard.slice(0,5),latestAction:action??null}];})) };
}
function renderGameMix(mix: NebulaGameMixV1, channelId: string) { const layers=mix.layers.filter((layer)=>layer.enabled).map((layer)=>`<section class="game-layer style-${layer.style}" data-game="${escapeHtml(layer.gameId)}" style="left:${layer.x}%;top:${layer.y}%;width:${layer.width}%;height:${layer.height}%;opacity:${layer.opacity};z-index:${layer.zIndex}"><header><strong>${escapeHtml(gameName(layer.gameId))}</strong><span data-players>0 players</span></header><div class="latest" data-action>Waiting for game activity…</div><ol data-leader></ol></section>`).join(""); return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(mix.name)}</title><style>${MIX_CSS}</style></head><body data-state="/v1/nebula/game-mix-state?mix=${encodeURIComponent(mix.id)}" data-channel="${escapeHtml(channelId)}">${layers}<script src="/assets/nebula-game-mix.js" defer></script></body></html>`; }
function canonicalOverlayEditorPage() { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nebula Arcade Overlay</title><style>${MANAGE_CSS}</style></head><body><main><span>NEBULA ARCADE · GAME MIX</span><h1>Overlay editing lives in Overlay Bay</h1><p>Nebula owns the twenty game runtimes and saved Game Mix data. SpaceMountain Overlay Bay is the single visual editor for choosing games, arranging them, styling them, and issuing the final OBS/browser-source URL.</p><a href="/?view=workspace" target="_top">Manage Nebula in Overlay Bay</a></main></body></html>`; }

function proxyCore(request: IncomingMessage, response: ServerResponse, port: number, transformPage: boolean) {
  if (!port) throw new Error("Nebula Arcade core runtime is not ready"); const headers={...request.headers};delete headers.connection;
  const upstream=httpRequest({hostname:"127.0.0.1",port,path:request.url??"/",method:request.method,headers},(incoming)=>{if(!transformPage||!String(incoming.headers["content-type"]??"").includes("text/html")){response.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(response);return;}const chunks:Buffer[]=[];incoming.on("data",(chunk:Buffer|string)=>chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)));incoming.on("end",()=>{let body=Buffer.concat(chunks).toString("utf8");body=body.replaceAll("Catalog registered","Shared runtime ready").replaceAll("Runtime widget pending","Shared runtime connected").replace("The shared Nebula Arcade shell is real; this title's game-specific runtime will plug in behind the same contracts as it is ported.","This title is connected to Nebula Arcade's shared persistent players, scores, Games Points, commands, actions, and overlay runtime.");const encoded=Buffer.from(body),out={...incoming.headers,"content-length":String(encoded.byteLength)};response.writeHead(incoming.statusCode??200,out);response.end(encoded);});});upstream.on("error",(error)=>response.headersSent?response.destroy(error):json(response,502,{error:"core_runtime_unavailable"}));request.pipe(upstream);
}
function gameMixInput(body:Record<string,unknown>){const layers=Array.isArray(body.layers)?body.layers:Array.isArray(body.gameIds)?body.gameIds.map((gameId,index)=>({gameId,zIndex:index})):[];return{id:string(body.id,"id",80).toLowerCase(),name:string(body.name??body.id,"name",100),...(typeof body.mode==="string"?{mode:body.mode as NebulaGameMixV1["mode"]}:{}),...(typeof body.rotationSeconds==="number"?{rotationSeconds:body.rotationSeconds}:{}),...(typeof body.activeGameId==="string"?{activeGameId:body.activeGameId}:{}),layers:layers as any[]};}
async function readJson(request:IncomingMessage){const chunks:Buffer[]=[];let total=0;for await(const chunk of request){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=part.byteLength;if(total>MAX_BODY_BYTES)throw new NebulaHostError(413,"Request body is too large");chunks.push(part);}let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new NebulaHostError(400,"A JSON object is required");}if(!value||typeof value!=="object"||Array.isArray(value))throw new NebulaHostError(400,"A JSON object is required");return value as Record<string,unknown>;}
function requireSameOrigin(request:IncomingMessage){const origin=request.headers.origin,host=request.headers.host;if(!origin||!host)throw new NebulaHostError(403,"A same-origin browser request is required");let parsed:URL;try{parsed=new URL(origin);}catch{throw new NebulaHostError(403,"Origin is invalid");}if(parsed.host!==host)throw new NebulaHostError(403,"Cross-origin mutation is blocked");}
function string(value:unknown,name:string,max:number){if(typeof value!=="string"||!value.trim()||value.length>max)throw new NebulaHostError(400,`${name} is invalid`);return value.trim();}function array(value:unknown){return Array.isArray(value)?value.map((item)=>String(item??"").trim()).filter(Boolean).slice(0,8):[];}function gameName(id:string){return NEBULA_ARCADE_GAMES.find((game)=>game.id===id)?.name??id;}function escapeHtml(value:string){return value.replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]??char);}
function html(response:ServerResponse,status:number,body:string){const encoded=Buffer.from(body);response.writeHead(status,{"content-type":"text/html; charset=utf-8","content-length":encoded.byteLength,"cache-control":"no-store","content-security-policy":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *; base-uri 'none'","x-content-type-options":"nosniff"});response.end(encoded);}function javascript(response:ServerResponse,body:string){const encoded=Buffer.from(body);response.writeHead(200,{"content-type":"text/javascript; charset=utf-8","content-length":encoded.byteLength,"cache-control":"public, max-age=300","x-content-type-options":"nosniff"});response.end(encoded);}function json(response:ServerResponse,status:number,body:unknown){const encoded=Buffer.from(JSON.stringify(body));response.writeHead(status,{"content-type":"application/json; charset=utf-8","content-length":encoded.byteLength,"cache-control":"no-store","x-content-type-options":"nosniff"});response.end(encoded);}function listen(server:ReturnType<typeof createServer>,port:number,host:string){return new Promise<void>((done,reject)=>{server.once("error",reject);server.listen(port,host,()=>{server.off("error",reject);done();});});}function close(server:ReturnType<typeof createServer>){return new Promise<void>((done,reject)=>server.close((error)=>error?reject(error):done()));}class NebulaHostError extends Error{constructor(readonly status:number,message:string){super(message);}}

const MIX_CSS=`*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;color:white;font-family:Inter,system-ui,sans-serif}.game-layer{position:absolute;border:1px solid rgba(80,210,255,.52);border-radius:18px;padding:14px;background:linear-gradient(145deg,rgba(5,12,30,.88),rgba(36,11,61,.82));box-shadow:0 0 26px rgba(120,70,255,.22);overflow:hidden}.game-layer[hidden]{display:none}.game-layer header{display:flex;justify-content:space-between;gap:12px;align-items:center}.game-layer strong{font-size:clamp(14px,2vw,28px)}.game-layer span,.latest,li{font-size:clamp(10px,1.1vw,16px)}.latest{margin:10px 0;color:#c9f4ff}.game-layer ol{margin:0;padding-left:22px}.style-minimal ol,.style-minimal .latest{display:none}.style-compact ol li:nth-child(n+3){display:none}`;
const MANAGE_CSS=`html,body{min-height:100%;margin:0;background:#050916;color:#eef8ff;font-family:Inter,system-ui,sans-serif}body{display:grid;place-items:center;padding:24px}main{max-width:760px;padding:32px;border:1px solid #315b84;border-radius:24px;background:rgba(11,22,45,.9)}span{color:#6de8ff;font-size:12px;letter-spacing:.14em}h1{font-size:clamp(30px,6vw,56px);margin:.35em 0}p{line-height:1.65;color:#bed2e5}a{display:inline-block;margin-top:16px;padding:13px 18px;border-radius:12px;background:#6de8ff;color:#05111d;font-weight:800;text-decoration:none}`;
const GAME_MIX_CLIENT_JS=`(()=>{'use strict';const url=document.body.dataset.state;async function tick(){try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)return;const s=await r.json(),visible=new Set(s.visibleGameIds||[]);document.querySelectorAll('[data-game]').forEach(node=>{const id=node.dataset.game,g=s.games&&s.games[id];node.hidden=!visible.has(id);if(!g)return;const p=node.querySelector('[data-players]');if(p)p.textContent=g.playerCount+' players';const a=node.querySelector('[data-action]');if(a)a.textContent=g.latestAction?(g.latestAction.displayName+' · '+g.latestAction.action+(g.latestAction.args.length?' '+g.latestAction.args.join(' '):'')):'Waiting for game activity…';const l=node.querySelector('[data-leader]');if(l){l.replaceChildren();for(const item of g.leaderboard||[]){const li=document.createElement('li');li.textContent=item.displayName+' · '+item.score+' pts';l.append(li);}}});}catch{}}tick();setInterval(tick,1000);})();`;

export { validateNebulaArcadeSandboxEnvironment }; export type { NebulaArcadeSandboxHostOptions };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { const checked=validateNebulaArcadeSandboxEnvironment(process.env);const host=createNebulaArcadeSandboxHost({...checked,port:Number(process.env.PORT??8080),host:process.env.HOST??"0.0.0.0",buildSha:process.env.BUILD_SHA??"dev",...(process.env.NEBULA_ARCADE_PIN_USER_ID?{pinUserId:process.env.NEBULA_ARCADE_PIN_USER_ID}:{}),...(process.env.NEBULA_ARCADE_PUBLIC_ORIGIN?{publicOrigin:process.env.NEBULA_ARCADE_PUBLIC_ORIGIN}:{})});await host.listen(); }
