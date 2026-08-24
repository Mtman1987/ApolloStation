import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SpmtClient } from "@spmt/sdk";
import { PRODUCT_UI_CSS } from "@spmt/ui";
import { ChatTagExperienceService, SqliteChatTagExperienceStore } from "./chat-tag-experience.js";
import { ChatTagOverlayHttpAdapter } from "./chat-tag-overlay-http.js";
import { ChatTagRuntime, SqliteChatTagStore } from "./chat-tag-runtime.js";
import { NEBULA_ARCADE_GAMES } from "./game-hub.js";
import { NEBULA_THEME_CSS } from "./nebula-theme-css.js";
import { NEBULA_ARCADE_BASE_CSS, NEBULA_ARCADE_BROWSER_JS, NEBULA_OVERLAY_CSS, renderNebulaArcadePage, renderNebulaOverlayOutput, type NebulaArcadeViewV1 } from "./nebula-arcade-page.js";
import { SqliteNebulaOverlaySceneStore, type NebulaOverlayLayerV1, type NebulaOverlaySceneV1 } from "./overlay-scenes.js";

const MAX_BODY_BYTES = 64 * 1_024;
const HERE = dirname(fileURLToPath(import.meta.url));
const NEBULA_ARCADE_BACKGROUND = resolve(HERE, "../assets/nebula-arcade-solar-system.webp");
const APP_PATH = "/apps/nebula-arcade";
const PROVIDER_ENV_NAMES = ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_BOT_OAUTH_TOKEN", "DISCORD_BOT_TOKEN", "KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "FLY_API_TOKEN"] as const;
const GAME_IDS = new Set(NEBULA_ARCADE_GAMES.map((game) => game.id));
const OVERLAY_FLOW_FIX_CSS = `body{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;gap:10px;padding:24px}.nebula-output-layer{z-index:auto}.nebula-output-placeholder{position:relative;inset:auto;width:auto;height:auto;flex:0 0 auto}`;

export interface ChatTagSandboxHostOptions { databasePath: string; tenantId: string; channelId: string; pinUserId?: string; port?: number; host?: string; buildSha?: string; }

export function createChatTagSandboxHost(options: ChatTagSandboxHostOptions) {
  const gameStore = new SqliteChatTagStore(options.databasePath);
  const experienceStore = new SqliteChatTagExperienceStore(options.databasePath);
  const sceneStore = new SqliteNebulaOverlaySceneStore(options.databasePath);
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

      if (url.pathname === APP_PATH && url.searchParams.get("action") === "overlay-scenes") {
        if (request.method === "GET") return json(response, 200, { scenes: sceneStore.list(options.tenantId) });
        if (request.method === "POST") {
          requireSameOrigin(request);
          const scene = sceneStore.save(options.tenantId, sceneInput(await readJson(request)), new Date().toISOString());
          return json(response, 200, { scene, outputUrl: overlayOutputUrl(scene.id) });
        }
        if (request.method === "DELETE") {
          requireSameOrigin(request);
          const sceneId = url.searchParams.get("scene") ?? "";
          requireSceneId(sceneId);
          return json(response, sceneStore.delete(options.tenantId, sceneId) ? 200 : 404, { deleted: sceneId });
        }
      }

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === APP_PATH)) {
        const sceneId = url.searchParams.get("scene");
        if (url.searchParams.get("surface") === "overlay" && sceneId) {
          requireSceneId(sceneId);
          const scene = sceneStore.get(options.tenantId, sceneId);
          if (!scene) return html(response, 404, "<!doctype html><title>Overlay not found</title><p>Saved Nebula Arcade overlay not found.</p>");
          return html(response, 200, proxySafeOverlayPage(scene));
        }
        const shellSurface = url.searchParams.get("surface") === "shell";
        const page = renderNebulaArcadePage({ nonce, tenantId: options.tenantId, channelId: options.channelId, shellSurface, view: arcadeView(url.searchParams.get("view")), ...(url.searchParams.get("game") ? { gameId: url.searchParams.get("game")! } : {}) });
        return html(response, 200, page.replace('<a href="/?view=spmt">SpaceMountain</a>', '<a href="/">SpaceMountain</a>'));
      }

      if (request.method === "GET" && url.pathname === "/assets/chat-tag-sandbox.css") return text(response, 200, `${PRODUCT_UI_CSS}${NEBULA_ARCADE_BASE_CSS}${NEBULA_THEME_CSS}`, "text/css; charset=utf-8", "public, max-age=300");
      if (request.method === "GET" && url.pathname === "/assets/chat-tag-sandbox.js") return text(response, 200, proxySafeBrowserScript(), "text/javascript; charset=utf-8", "public, max-age=300");
      if (request.method === "GET" && (url.pathname === "/assets/nebula-overlay.css" || url.pathname === "/assets/nebula-arcade/overlay.css")) return text(response, 200, `${NEBULA_OVERLAY_CSS}${OVERLAY_FLOW_FIX_CSS}`, "text/css; charset=utf-8", "public, max-age=300");
      if (request.method === "GET" && url.pathname === "/assets/nebula-arcade/solar-system.webp") return binary(response, 200, await readFile(NEBULA_ARCADE_BACKGROUND), "image/webp", "public, max-age=86400");

      // Canonical direct-service API remains available; the browser uses APP_PATH aliases so the existing SpaceMountain shell proxy can carry it unchanged.
      if (request.method === "GET" && url.pathname === "/v1/nebula/overlay-scenes") return json(response, 200, { scenes: sceneStore.list(options.tenantId) });
      if (request.method === "POST" && url.pathname === "/v1/nebula/overlay-scenes") {
        requireSameOrigin(request);
        const scene = sceneStore.save(options.tenantId, sceneInput(await readJson(request)), new Date().toISOString());
        return json(response, 200, { scene, outputUrl: overlayOutputUrl(scene.id) });
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/v1/nebula/overlay-scenes/")) {
        requireSameOrigin(request);
        const sceneId = decodeURIComponent(url.pathname.slice("/v1/nebula/overlay-scenes/".length));
        requireSceneId(sceneId);
        return json(response, sceneStore.delete(options.tenantId, sceneId) ? 200 : 404, { deleted: sceneId });
      }
      if (request.method === "GET" && url.pathname.startsWith("/overlay/")) {
        const sceneId = decodeURIComponent(url.pathname.slice("/overlay/".length));
        requireSceneId(sceneId);
        const scene = sceneStore.get(options.tenantId, sceneId);
        if (!scene) return html(response, 404, "<!doctype html><title>Overlay not found</title><p>Saved Nebula Arcade overlay not found.</p>");
        return html(response, 200, proxySafeOverlayPage(scene));
      }

      if (request.method === "GET" && url.pathname === "/v1/chat-tag/state") return json(response, 200, runtime.getState(options.tenantId));
      if (request.method === "GET" && url.pathname === "/v1/chat-tag/support") return json(response, 200, experienceStore.listSupportTickets(options.tenantId));
      if (request.method === "GET" && url.pathname === "/v1/nebula/chat-tag/overlay/messages") {
        const after = Number(url.searchParams.get("after") ?? "0");
        return json(response, 200, { messages: experienceStore.listOverlayMessages(options.tenantId, options.channelId, after) });
      }
      if (request.method === "POST" && url.pathname === "/v1/chat-tag/message") {
        requireSameOrigin(request);
        const body = await readJson(request);
        const occurredAt = optionalIso(body.occurredAt) ?? new Date().toISOString();
        const outcome = await experience.ingest({ schemaVersion: 1, provider: provider(body.provider), tenantId: options.tenantId, channelId: options.channelId, messageId: textField(body.messageId, "messageId", 200), userId: textField(body.userId, "userId", 200), username: textField(body.username, "username", 120), text: normalizeSandboxChatTagCommand(textField(body.text, "text", 500)), occurredAt, roles: roles(body.roles) }, { liveUserIds: stringArray(body.liveUserIds, 200) });
        return json(response, 200, { outcome, stored: runtime.getState(options.tenantId) });
      }
      if (request.method === "POST" && url.pathname === "/v1/chat-tag/rotation") {
        requireSameOrigin(request);
        const body = await readJson(request);
        const outcome = await runtime.reconcileRotation({ tenantId: options.tenantId, channelId: options.channelId, now: optionalIso(body.now) ?? new Date().toISOString(), liveUserIds: stringArray(body.liveUserIds, 200) });
        return json(response, 200, { outcome, stored: runtime.getState(options.tenantId) });
      }
      if (url.pathname === "/v1/nebula/chat-tag/overlay" || url.pathname.startsWith("/v1/nebula/chat-tag/overlay/")) {
        const adapted = overlay.handle({ method: request.method ?? "GET", path: url.pathname }, principal);
        return textWithHeaders(response, adapted.status, adapted.body, adapted.headers);
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof SandboxError ? error.status : error instanceof Error && /invalid|requires|contains/i.test(error.message) ? 400 : 500;
      return json(response, status, { error: status === 500 ? "internal" : "invalid_request", message: error instanceof Error ? error.message : "unknown error" });
    }
  });

  return {
    server,
    listen: () => new Promise<void>((done, reject) => { server.once("error", reject); server.listen(options.port ?? 8080, options.host ?? "0.0.0.0", () => { server.off("error", reject); done(); }); }),
    close: () => new Promise<void>((done, reject) => server.close((error) => { sceneStore.close(); gameStore.close(); experienceStore.close(); error ? reject(error) : done(); })),
  };
}

export function validateChatTagSandboxEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.SPMT_RUNTIME_MODE !== "sandbox") throw new Error("SPMT_RUNTIME_MODE=sandbox is required");
  if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("SPMT_OUTBOUND_MODE=disabled is required");
  const present = PROVIDER_ENV_NAMES.filter((name) => Boolean(environment[name]));
  if (present.length) throw new Error(`Chat Tag sandbox rejects provider or infrastructure credentials: ${present.join(", ")}`);
  return { databasePath: resolve(environment.CHAT_TAG_DATABASE_PATH ?? ".sandbox-data/chat-tag-green-sandbox.sqlite"), tenantId: safeId(environment.CHAT_TAG_TENANT_ID ?? "chat-tag-sandbox", "CHAT_TAG_TENANT_ID"), channelId: safeId(environment.CHAT_TAG_CHANNEL_ID ?? "sandbox-channel", "CHAT_TAG_CHANNEL_ID") };
}

function arcadeView(value: string | null): NebulaArcadeViewV1 { return value === "games" || value === "game" || value === "overlay" || value === "stats" ? value : "home"; }
function overlayOutputUrl(sceneId: string) { return `${APP_PATH}?surface=overlay&scene=${encodeURIComponent(sceneId)}`; }
function proxySafeOverlayPage(scene: NebulaOverlaySceneV1) { return renderNebulaOverlayOutput(scene).replace("/assets/nebula-overlay.css", "/assets/nebula-arcade/overlay.css").replace(/\sstyle="--layer:\d+"/g, ""); }
function proxySafeBrowserScript() {
  return NEBULA_ARCADE_BROWSER_JS
    .replace("fetch('/v1/nebula/overlay-scenes/'+encodeURIComponent(id),{method:'DELETE'", "fetch('/apps/nebula-arcade?action=overlay-scenes&scene='+encodeURIComponent(id),{method:'DELETE'")
    .replaceAll("'/v1/nebula/overlay-scenes'", "'/apps/nebula-arcade?action=overlay-scenes'")
    .replace("const output='/overlay/'+encodeURIComponent(scene.id);", "const output='/apps/nebula-arcade?surface=overlay&scene='+encodeURIComponent(scene.id);")
    .replace("location.origin+'/overlay/'+value.scene.id", "location.origin+'/apps/nebula-arcade?surface=overlay&scene='+encodeURIComponent(value.scene.id)");
}
function sceneInput(body: Record<string, unknown>): { id: string; name: string; layers: NebulaOverlayLayerV1[] } {
  const id = textField(body.id, "id", 80).toLowerCase(); requireSceneId(id);
  const name = textField(body.name, "name", 100);
  if (!Array.isArray(body.gameIds) || body.gameIds.length > NEBULA_ARCADE_GAMES.length) throw new SandboxError(400, "gameIds is invalid");
  const ids = body.gameIds.map((value) => textField(value, "gameId", 80));
  if (new Set(ids).size !== ids.length || ids.some((gameId) => !GAME_IDS.has(gameId))) throw new SandboxError(400, "gameIds contains an unknown or duplicate game");
  return { id, name, layers: ids.map((gameId, zIndex) => ({ gameId, enabled: true, zIndex })) };
}
function requireSceneId(value: string): void { if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) throw new SandboxError(400, "sceneId is invalid"); }
function applyHeaders(response: ServerResponse, nonce: string) {
  response.setHeader("content-security-policy", `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; img-src 'self' data: https:; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`);
  response.setHeader("referrer-policy", "no-referrer"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
}
function requireSameOrigin(request: IncomingMessage) { const origin = request.headers.origin; const host = request.headers.host; if (!origin || !host) throw new SandboxError(403, "A same-origin browser request is required"); let parsed: URL; try { parsed = new URL(origin); } catch { throw new SandboxError(403, "Origin is invalid"); } if (parsed.host !== host) throw new SandboxError(403, "Cross-origin mutation is blocked"); }
async function readJson(request: IncomingMessage) { const chunks: Buffer[] = []; let total = 0; for await (const chunk of request) { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += part.byteLength; if (total > MAX_BODY_BYTES) throw new SandboxError(413, "Request body is too large"); chunks.push(part); } let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new SandboxError(400, "A JSON object is required"); } if (!value || typeof value !== "object" || Array.isArray(value)) throw new SandboxError(400, "A JSON object is required"); return value as Record<string, unknown>; }
function textField(value: unknown, name: string, max: number) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new SandboxError(400, `${name} is invalid`); return value.trim(); }
function stringArray(value: unknown, max: number) { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !item.trim())) throw new SandboxError(400, "liveUserIds is invalid"); return value as string[]; }
function roles(value: unknown): Array<"broadcaster" | "moderator" | "member"> { const values = stringArray(value, 3); if (values.some((item) => !["broadcaster", "moderator", "member"].includes(item))) throw new SandboxError(400, "roles is invalid"); return values as Array<"broadcaster" | "moderator" | "member">; }
function provider(value: unknown): "twitch" | "discord" | "kick" { const result = value ?? "twitch"; if (!["twitch", "discord", "kick"].includes(String(result))) throw new SandboxError(400, "provider is invalid"); return result as "twitch" | "discord" | "kick"; }
function optionalIso(value: unknown) { if (value === undefined) return undefined; if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new SandboxError(400, "timestamp is invalid"); return value; }
function normalizeSandboxChatTagCommand(value: string) { const match = /^!(join|leave|status|score|tag|pass|players|live|sleep|wake|pinrank)(\s+.*)?$/i.exec(value); return match ? `spmt ${match[1]!.toLowerCase()}${match[2] ?? ""}` : value; }
function safeId(value: string, name: string) { if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); return value; }
function html(response: ServerResponse, status: number, body: string) { text(response, status, body, "text/html; charset=utf-8", "no-store"); }
function text(response: ServerResponse, status: number, body: string, contentType: string, cache: string) { const encoded = Buffer.from(body); response.writeHead(status, { "content-type": contentType, "content-length": encoded.byteLength, "cache-control": cache }); response.end(encoded); }
function binary(response: ServerResponse, status: number, body: Buffer, contentType: string, cache: string) { response.writeHead(status, { "content-type": contentType, "content-length": body.byteLength, "cache-control": cache, "x-content-type-options": "nosniff" }); response.end(body); }
function textWithHeaders(response: ServerResponse, status: number, body: string, headers: Record<string, string>) { const encoded = Buffer.from(body); response.writeHead(status, { ...headers, "content-length": encoded.byteLength }); response.end(encoded); }
function json(response: ServerResponse, status: number, body: unknown) { const encoded = Buffer.from(JSON.stringify(body)); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": encoded.byteLength, "cache-control": "no-store" }); response.end(encoded); }
class SandboxError extends Error { constructor(readonly status: number, message: string) { super(message); } }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checked = validateChatTagSandboxEnvironment(process.env);
  const host = createChatTagSandboxHost({ ...checked, port: Number(process.env.PORT ?? 8080), host: process.env.HOST ?? "0.0.0.0", buildSha: process.env.BUILD_SHA ?? "dev", ...(process.env.CHAT_TAG_PIN_USER_ID ? { pinUserId: process.env.CHAT_TAG_PIN_USER_ID } : {}) });
  await host.listen();
}
