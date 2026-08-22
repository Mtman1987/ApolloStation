import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderSpaceMountainPage, SANDBOX_BEACON_HTML, SANDBOX_CSS } from "./page.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "../../..");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PROVIDER_ENV_NAMES = Object.freeze([
  "DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_BOT_OAUTH_TOKEN",
  "KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "FIREBASE_PRIVATE_KEY", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_YOUTUBE_INNERTUBE_API_KEY", "YOUTUBE_API_KEY", "FLY_API_TOKEN", "SPRITES_TOKEN",
]);

const ASSETS = new Map<string, { file: string; type: string }>([
  ["/assets/web/client.js", { file: resolve(HERE, "client.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/contracts/index.js", { file: resolve(REPOSITORY_ROOT, "packages/contracts/dist/index.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/embed/index.js", { file: resolve(REPOSITORY_ROOT, "packages/embed/dist/index.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/sdk/index.js", { file: resolve(REPOSITORY_ROOT, "packages/sdk/dist/index.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/spacemountain/index.js", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain/dist/index.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/spacemountain/shell-ui.js", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain/dist/shell-ui.js"), type: "text/javascript; charset=utf-8" }],
]);

export interface SpaceMountainWebHostOptions {
  spmtOrigin: string;
  port?: number;
  host?: string;
  buildSha?: string;
  fetchImpl?: typeof fetch;
}

export function createSpaceMountainWebHost(options: SpaceMountainWebHostOptions) {
  const spmtOrigin = requireLoopbackOrigin(options.spmtOrigin);
  const fetchImpl = options.fetchImpl ?? fetch;
  const buildSha = options.buildSha ?? "dev";
  const server = createServer(async (request, response) => {
    const nonce = randomBytes(18).toString("base64url");
    applySecurityHeaders(response, nonce);
    try {
      const url = new URL(request.url ?? "/", "http://spacemountain.local");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/first-time-setup")) return html(response, 200, renderSpaceMountainPage(nonce, buildSha));
      if (request.method === "GET" && url.pathname === "/assets/web/sandbox.css") return textResponse(response, 200, SANDBOX_CSS, "text/css; charset=utf-8", "public, max-age=300");
      if (request.method === "GET" && url.pathname === "/sandbox/beacon") return html(response, 200, SANDBOX_BEACON_HTML);
      if (request.method === "GET" && ASSETS.has(url.pathname)) return serveAsset(response, ASSETS.get(url.pathname)!);
      if (request.method === "GET" && url.pathname === "/sandbox/health") return sandboxHealth(response, spmtOrigin, fetchImpl, buildSha);
      if (request.method === "POST" && url.pathname === "/sandbox/auth/logout") {
        requireSameOrigin(request);
        return json(response, 200, { ok: true }, { "set-cookie": clearSessionCookie() });
      }
      if (request.method === "POST" && url.pathname === "/sandbox/auth/login") {
        requireSameOrigin(request);
        return login(response, spmtOrigin, fetchImpl, await readJsonBody(request));
      }
      if (request.method === "POST" && url.pathname === "/sandbox/auth/register") {
        requireSameOrigin(request);
        return register(response, spmtOrigin, fetchImpl, await readJsonBody(request));
      }
      if ((url.pathname.startsWith("/v1/") || url.pathname.startsWith("/health/")) && browserProxyAllowed(request.method ?? "GET", url.pathname)) {
        if (!["GET", "HEAD"].includes(request.method ?? "GET")) requireSameOrigin(request);
        return proxy(response, request, url, spmtOrigin, fetchImpl);
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof WebHostError ? error.status : 500;
      return json(response, status, { error: status === 500 ? "internal" : "invalid_request", message: error instanceof Error ? error.message : "unknown error" });
    }
  });
  return {
    server,
    listen() { return new Promise<void>((done, reject) => { server.once("error", reject); server.listen(options.port ?? 8080, options.host ?? "0.0.0.0", () => { server.off("error", reject); done(); }); }); },
    close() { return new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); },
  };
}

export function validateSandboxWebEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.SPMT_RUNTIME_MODE !== "sandbox") throw new Error("SPMT_RUNTIME_MODE=sandbox is required");
  if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("SPMT_OUTBOUND_MODE=disabled is required");
  if (!environment.SPMT_SANDBOX_ID || !/^[a-z0-9-]{3,80}$/.test(environment.SPMT_SANDBOX_ID)) throw new Error("SPMT_SANDBOX_ID must be a lowercase sandbox namespace");
  const present = PROVIDER_ENV_NAMES.filter((name) => Boolean(environment[name]));
  if (present.length) throw new Error(`Sandbox web host rejects provider or infrastructure credentials: ${present.join(", ")}`);
  return { spmtOrigin: requireLoopbackOrigin(environment.SPMT_ORIGIN ?? "http://127.0.0.1:3000") };
}

async function serveAsset(response: ServerResponse, asset: { file: string; type: string }) {
  const data = await readFile(asset.file);
  response.writeHead(200, { "content-type": asset.type, "content-length": data.byteLength, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" });
  response.end(data);
}

async function sandboxHealth(response: ServerResponse, origin: string, fetchImpl: typeof fetch, buildSha: string) {
  try {
    const upstream = await fetchImpl(`${origin}/health/ready`, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    const body = await limitedResponseBody(upstream);
    return json(response, upstream.ok ? 200 : 503, { ready: upstream.ok, web: { ready: true, buildSha }, spmt: parseJson(body) });
  } catch (error) {
    return json(response, 503, { ready: false, web: { ready: true, buildSha }, spmt: { error: error instanceof Error ? error.message : "unavailable" } });
  }
}

async function login(response: ServerResponse, origin: string, fetchImpl: typeof fetch, body: Record<string, unknown>) {
  const credentials = credentialsFrom(body);
  const upstream = await upstreamJson(fetchImpl, `${origin}/v1/auth/login`, credentials);
  const headers = sessionHeaders(upstream.response);
  if (!upstream.response.ok) return json(response, upstream.response.status, upstream.body, headers);
  return json(response, 200, { profile: record(upstream.body)?.profile ?? null }, headers);
}

async function register(response: ServerResponse, origin: string, fetchImpl: typeof fetch, body: Record<string, unknown>) {
  const credentials = credentialsFrom(body);
  const displayName = requiredText(body.displayName, "displayName", 120);
  const created = await upstreamJson(fetchImpl, `${origin}/v1/auth/register`, { ...credentials, displayName });
  if (!created.response.ok) return json(response, created.response.status, created.body);
  const signedIn = await upstreamJson(fetchImpl, `${origin}/v1/auth/login`, credentials);
  if (!signedIn.response.ok) return json(response, 502, { error: "sandbox_login_failed", message: "The account was created, but the isolated session could not be opened." });
  return json(response, 201, { profile: record(created.body)?.profile ?? null, tenantId: record(created.body)?.tenantId ?? null }, sessionHeaders(signedIn.response));
}

async function upstreamJson(fetchImpl: typeof fetch, url: string, body: Record<string, unknown>) {
  const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(10000) });
  const encoded = await limitedResponseBody(response);
  return { response, body: parseJson(encoded) };
}

async function proxy(response: ServerResponse, request: IncomingMessage, url: URL, origin: string, fetchImpl: typeof fetch) {
  const method = request.method ?? "GET";
  const headers = new Headers({ accept: request.headers.accept ?? "application/json", "x-spmt-app": "spacemountain" });
  if (request.headers["content-type"]) headers.set("content-type", request.headers["content-type"]);
  if (request.headers.cookie) headers.set("cookie", request.headers.cookie);
  if (typeof request.headers["x-spmt-tenant"] === "string") headers.set("x-spmt-tenant", request.headers["x-spmt-tenant"]);
  if (typeof request.headers["x-correlation-id"] === "string") headers.set("x-correlation-id", request.headers["x-correlation-id"]);
  if (typeof request.headers["idempotency-key"] === "string") headers.set("idempotency-key", request.headers["idempotency-key"]);
  const body = ["GET", "HEAD"].includes(method) ? undefined : await readBody(request);
  const upstream = await fetchImpl(`${origin}${url.pathname}${url.search}`, {
    method,
    headers,
    ...(body ? { body } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const encoded = await limitedResponseBody(upstream);
  const responseHeaders: Record<string, string | string[]> = {
    "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(encoded.byteLength),
  };
  const cookies = getSetCookies(upstream.headers);
  if (cookies.length) responseHeaders["set-cookie"] = cookies;
  response.writeHead(upstream.status, responseHeaders);
  response.end(encoded);
}

function browserProxyAllowed(method: string, pathname: string) {
  if (method === "GET") {
    if (["/health/live", "/health/ready", "/v1/session", "/v1/auth/setup-options", "/v1/workspace/profile", "/v1/apps", "/v1/apps/installs", "/v1/entitlements", "/v1/events", "/v1/commlink/conversations", "/v1/commlink/messages", "/v1/commlink/search", "/v1/notifications", "/v1/assistants/community", "/v1/stellar/context", "/v1/stellar/capabilities"].includes(pathname)) return true;
    return /^\/v1\/apps\/[^/]+$/.test(pathname);
  }
  if (method === "PATCH" && pathname === "/v1/workspace/profile") return true;
  if (method === "POST") return /^\/v1\/apps\/[^/]+\/(?:install|disable)$/.test(pathname) || /^\/v1\/notifications\/[^/]+\/read$/.test(pathname) || pathname === "/v1/commlink/messages" || pathname === "/v1/assistants/community/invocations";
  return false;
}

function applySecurityHeaders(response: ServerResponse, nonce: string) {
  response.setHeader("content-security-policy", `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`);
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function requireSameOrigin(request: IncomingMessage) {
  const value = request.headers.origin;
  const host = request.headers.host;
  if (!value || !host) throw new WebHostError(403, "A same-origin browser request is required");
  let origin: URL;
  try { origin = new URL(value); } catch { throw new WebHostError(403, "Request origin is invalid"); }
  if (!["http:", "https:"].includes(origin.protocol) || origin.host !== host) throw new WebHostError(403, "Cross-origin mutation is blocked");
}

function requireLoopbackOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("SPMT_ORIGIN must be an absolute URL"); }
  if (url.protocol !== "http:") throw new Error("SPMT_ORIGIN must use local HTTP inside the Sprite");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("SPMT_ORIGIN must resolve to loopback");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_ORIGIN must be a credential-free origin");
  return url.origin;
}

async function readJsonBody(request: IncomingMessage) { const body = await readBody(request); const parsed = JSON.parse(body.toString("utf8")) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new WebHostError(400, "A JSON object is required"); return parsed as Record<string, unknown>; }
async function readBody(request: IncomingMessage) { const chunks: Buffer[] = []; let total = 0; for await (const chunk of request) { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += part.byteLength; if (total > MAX_BODY_BYTES) throw new WebHostError(413, "Request body is too large"); chunks.push(part); } return Buffer.concat(chunks); }
async function limitedResponseBody(response: Response) { const declared = Number(response.headers.get("content-length") ?? 0); if (declared > MAX_RESPONSE_BYTES) throw new WebHostError(502, "SPMT response is too large"); const body = Buffer.from(await response.arrayBuffer()); if (body.byteLength > MAX_RESPONSE_BYTES) throw new WebHostError(502, "SPMT response is too large"); return body; }

function credentialsFrom(body: Record<string, unknown>) { return { username: requiredText(body.username, "username", 120), password: requiredText(body.password, "password", 256, false) }; }
function requiredText(value: unknown, name: string, max: number, trim = true) { if (typeof value !== "string") throw new WebHostError(400, `${name} is required`); const result = trim ? value.trim() : value; if (!result || result.length > max) throw new WebHostError(400, `${name} is invalid`); if (name === "password" && result.length < 12) throw new WebHostError(400, "Use a sandbox-only password of at least 12 characters"); return result; }
function sessionHeaders(response: Response) { const cookies = getSetCookies(response.headers).filter((value) => value.startsWith("spmt_token=")); return cookies.length ? { "set-cookie": cookies } : {}; }
function getSetCookies(headers: Headers) { const value = headers as Headers & { getSetCookie?: () => string[] }; const result = value.getSetCookie?.() ?? []; if (result.length) return result; const single = headers.get("set-cookie"); return single ? [single] : []; }
function clearSessionCookie() { return "spmt_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"; }
function parseJson(value: Buffer) { try { return JSON.parse(value.toString("utf8")) as unknown; } catch { return { error: "invalid_upstream_response" }; } }
function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function html(response: ServerResponse, status: number, body: string) { return textResponse(response, status, body, "text/html; charset=utf-8", "no-store"); }
function textResponse(response: ServerResponse, status: number, body: string, type: string, cache: string) { const encoded = Buffer.from(body); response.writeHead(status, { "content-type": type, "content-length": encoded.byteLength, "cache-control": cache }); response.end(encoded); }
function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) { const encoded = Buffer.from(JSON.stringify(body)); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": encoded.byteLength, "cache-control": "no-store", ...headers }); response.end(encoded); }

class WebHostError extends Error { constructor(readonly status: number, message: string) { super(message); } }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checked = validateSandboxWebEnvironment(process.env);
  const host = createSpaceMountainWebHost({ spmtOrigin: checked.spmtOrigin, port: Number(process.env.PORT ?? 8080), host: process.env.HOST ?? "0.0.0.0", buildSha: process.env.BUILD_SHA ?? "dev" });
  await host.listen();
}
