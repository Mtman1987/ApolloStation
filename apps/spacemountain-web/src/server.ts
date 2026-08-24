import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderSpaceMountainPage, SANDBOX_BEACON_HTML, SANDBOX_CSS, SANDBOX_POLISH_CSS } from "./page.js";
import { DEVELOPER_DOCS_CSS, DEVELOPER_MANIFEST_EXAMPLE, renderDeveloperDocsPage } from "./developer-docs.js";
import type { AppCatalogRegistrationV1 } from "@spmt/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "../../..");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
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
  ["/assets/ui/index.js", { file: resolve(REPOSITORY_ROOT, "packages/ui/dist/index.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/spacemountain/index.js", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain/dist/index.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/spacemountain/shell-ui.js", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain/dist/shell-ui.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/spacemountain/product-shell-css.js", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain/dist/product-shell-css.js"), type: "text/javascript; charset=utf-8" }],
  ["/assets/product/model-rocket.png", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain-web/assets/model-rocket.png"), type: "image/png" }],
  ["/assets/product/space-logo-header.png", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain-web/assets/space-logo-header.png"), type: "image/png" }],
  ["/assets/product/space-logo-main.png", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain-web/assets/space-logo-main.png"), type: "image/png" }],
  ["/assets/product/theme-aurora-green-background.webp", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain-web/assets/theme-aurora-green-background.webp"), type: "image/webp" }],
  ["/assets/product/theme-nebula-purple-background.webp", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain-web/assets/theme-nebula-purple-background.webp"), type: "image/webp" }],
  ["/assets/product/theme-oceanic-blue-background.webp", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain-web/assets/theme-oceanic-blue-background.webp"), type: "image/webp" }],
  ["/assets/product/theme-solar-flare-background.webp", { file: resolve(REPOSITORY_ROOT, "apps/spacemountain-web/assets/theme-solar-flare-background.webp"), type: "image/webp" }],
]);

export interface SpaceMountainWebHostOptions {
  spmtOrigin: string;
  port?: number;
  host?: string;
  buildSha?: string;
  fetchImpl?: typeof fetch;
  candidateManifest?: AppCatalogRegistrationV1;
  chatTagOrigin?: string;
}

export function createSpaceMountainWebHost(options: SpaceMountainWebHostOptions) {
  const spmtOrigin = requireLoopbackOrigin(options.spmtOrigin);
  const fetchImpl = options.fetchImpl ?? fetch;
  const buildSha = options.buildSha ?? "dev";
  const chatTagOrigin = options.chatTagOrigin ? requireLoopbackOrigin(options.chatTagOrigin) : undefined;
  const server = createServer(async (request, response) => {
    const nonce = randomBytes(18).toString("base64url");
    applySecurityHeaders(response, nonce);
    try {
      const url = new URL(request.url ?? "/", "http://spacemountain.local");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/first-time-setup")) return html(response, 200, renderSpaceMountainPage(nonce, buildSha, Boolean(options.candidateManifest)));
      if (request.method === "GET" && url.pathname === "/assets/web/sandbox.css") return textResponse(response, 200, SANDBOX_CSS + SANDBOX_POLISH_CSS, "text/css; charset=utf-8", "public, max-age=300");
      if (request.method === "GET" && url.pathname === "/assets/web/developer-docs.css") return textResponse(response, 200, DEVELOPER_DOCS_CSS, "text/css; charset=utf-8", "public, max-age=300");
      if (request.method === "GET" && url.pathname === "/docs/developers") return html(response, 200, renderDeveloperDocsPage(buildSha));
      if (request.method === "GET" && url.pathname === "/docs/examples/app-manifest.json") return json(response, 200, DEVELOPER_MANIFEST_EXAMPLE);
      if (request.method === "GET" && url.pathname === "/sandbox/beacon") return html(response, 200, SANDBOX_BEACON_HTML);
      if (request.method === "GET" && ASSETS.has(url.pathname)) return serveAsset(response, ASSETS.get(url.pathname)!);
      if (request.method === "GET" && url.pathname === "/sandbox/health") return sandboxHealth(response, spmtOrigin, fetchImpl, buildSha);
      if (request.method === "GET" && url.pathname === "/sandbox/candidate-app" && options.candidateManifest) return json(response, 200, options.candidateManifest);
      if (request.method === "POST" && url.pathname === "/sandbox/developer/import-manifest") {
        requireSameOrigin(request);
        return await importDeveloperManifest(response, request, spmtOrigin, fetchImpl, await readJsonBody(request), options.candidateManifest);
      }
      if (chatTagOrigin && chatTagProxyPath(url.pathname)) {
        if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) requireSameOrigin(request);
        return proxyChatTag(response, request, url, chatTagOrigin, fetchImpl);
      }
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
      if ((request.method === "GET" || request.method === "HEAD") && /^\/o\/[A-Za-z0-9_-]{16,512}$/.test(url.pathname)) {
        return proxy(response, request, url, spmtOrigin, fetchImpl);
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
  return { spmtOrigin: requireLoopbackOrigin(environment.SPMT_ORIGIN ?? "http://127.0.0.1:3000"), ...(environment.CHAT_TAG_ORIGIN ? { chatTagOrigin: requireLoopbackOrigin(environment.CHAT_TAG_ORIGIN) } : {}), ...(environment.SPMT_SANDBOX_CANDIDATE_MANIFEST ? { candidateManifest: candidateManifest(environment.SPMT_SANDBOX_CANDIDATE_MANIFEST) } : {}) };
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

async function importDeveloperManifest(response: ServerResponse, request: IncomingMessage, origin: string, fetchImpl: typeof fetch, body: Record<string, unknown>, candidate?: AppCatalogRegistrationV1) {
  await requireCatalogPublisher(request, origin, fetchImpl);
  const source = requiredText(body.manifestUrl, "manifestUrl", 2048);
  if (source === "/sandbox/candidate-app") {
    if (!candidate) throw new WebHostError(404, "The sandbox example manifest is unavailable");
    return json(response, 200, normalizeDeveloperManifest(candidate));
  }
  let manifestUrl: URL;
  try { manifestUrl = new URL(source); } catch { throw new WebHostError(400, "manifestUrl must be an absolute HTTPS URL"); }
  if (manifestUrl.protocol !== "https:") throw new WebHostError(400, "manifestUrl must use HTTPS");
  if (manifestUrl.username || manifestUrl.password) throw new WebHostError(400, "manifestUrl may not contain embedded credentials");
  if (manifestUrl.port && manifestUrl.port !== "443") throw new WebHostError(400, "manifestUrl may not use a nonstandard port");
  if (manifestUrl.hash) throw new WebHostError(400, "manifestUrl may not contain a fragment");
  if (privateManifestHostname(manifestUrl.hostname)) throw new WebHostError(400, "manifestUrl may not target a local or private host");
  let upstream: Response;
  try {
    upstream = await fetchImpl(manifestUrl, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(7000) });
  } catch (error) {
    throw new WebHostError(502, `Manifest fetch failed: ${error instanceof Error ? error.message : "network unavailable"}`);
  }
  if (upstream.status >= 300 && upstream.status < 400) throw new WebHostError(400, "Manifest redirects are not allowed");
  if (!upstream.ok) throw new WebHostError(502, `Manifest host returned HTTP ${upstream.status}`);
  const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "application/json" && !contentType.endsWith("+json")) throw new WebHostError(400, "Manifest response must use a JSON content type");
  const encoded = await limitedBody(upstream, MAX_MANIFEST_BYTES, "Manifest response is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(encoded.toString("utf8")); } catch { throw new WebHostError(400, "Manifest response is not valid JSON"); }
  return json(response, 200, normalizeDeveloperManifest(parsed));
}

async function requireCatalogPublisher(request: IncomingMessage, origin: string, fetchImpl: typeof fetch) {
  if (!request.headers.cookie) throw new WebHostError(401, "Sign in before importing a manifest");
  const upstream = await fetchImpl(`${origin}/v1/session`, { headers: { accept: "application/json", cookie: request.headers.cookie, "x-spmt-app": "spacemountain" }, redirect: "manual", signal: AbortSignal.timeout(5000) });
  const encoded = await limitedResponseBody(upstream);
  if (!upstream.ok) throw new WebHostError(upstream.status === 401 || upstream.status === 403 ? upstream.status : 502, "The SPMT session could not be verified");
  const principal = record(parseJson(encoded));
  const scopes = Array.isArray(principal?.scopes) ? principal.scopes.filter((scope): scope is string => typeof scope === "string") : [];
  if (!scopes.includes("apps:register")) throw new WebHostError(403, "Only an authorized catalog publisher may import a manifest");
}

function normalizeDeveloperManifest(value: unknown): AppCatalogRegistrationV1 {
  const item = record(value);
  if (!item) throw new WebHostError(400, "The manifest must be a JSON object");
  const appId = manifestText(item.appId, "appId", 200);
  if (!/^[A-Za-z0-9._:@/-]+$/.test(appId)) throw new WebHostError(400, "appId contains unsupported characters");
  const name = manifestText(item.name, "name", 120);
  const description = manifestText(item.description, "description", 1000);
  const version = manifestText(item.version, "version", 80);
  const launchUrl = manifestLaunchUrl(item.launchUrl, "launchUrl");
  const iconUrl = item.iconUrl === undefined || item.iconUrl === "" ? undefined : manifestLaunchUrl(item.iconUrl, "iconUrl");
  const allowedScopes = manifestArray(item.allowedScopes, "allowedScopes").map((scope) => scope.trim()).filter(Boolean);
  if (allowedScopes.some((scope) => scope.length > 120 || !/^[A-Za-z0-9.*:_-]+$/.test(scope))) throw new WebHostError(400, "allowedScopes contains an invalid scope");
  const declaredSurfaces = manifestArray(item.surfaces, "surfaces");
  const validSurfaces = new Set(["shell", "standalone", "overlay", "popout"]);
  if (!declaredSurfaces.length || declaredSurfaces.some((surface) => !validSurfaces.has(surface))) throw new WebHostError(400, "surfaces must contain at least one supported surface");
  if (item.status !== "active" && item.status !== "disabled") throw new WebHostError(400, "status must be active or disabled");
  return { appId, name, description, version, launchUrl, ...(iconUrl ? { iconUrl } : {}), allowedScopes: [...new Set(allowedScopes)].sort(), surfaces: [...new Set(declaredSurfaces)] as AppCatalogRegistrationV1["surfaces"], status: item.status };
}

function manifestText(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > max) throw new WebHostError(400, `${name} is required and must be at most ${max} characters`);
  return value;
}

function manifestArray(value: unknown, name: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new WebHostError(400, `${name} must be an array of strings`);
  return value as string[];
}

function manifestLaunchUrl(value: unknown, name: string) {
  const text = manifestText(value, name, 2048);
  let url: URL;
  try { url = new URL(text); } catch { throw new WebHostError(400, `${name} must be an absolute URL`); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new WebHostError(400, `${name} must use HTTPS outside localhost`);
  if (url.username || url.password) throw new WebHostError(400, `${name} may not contain embedded credentials`);
  return url.toString();
}

function privateManifestHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (normalized === "localhost" || normalized === "metadata.google.internal" || normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal") || normalized.endsWith(".lan") || normalized.endsWith(".home") || normalized.endsWith(".arpa")) return true;
  const version = isIP(normalized);
  if (version === 4) {
    const [a = 0, b = 0] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (version === 6) return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
  return false;
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

async function proxyChatTag(response: ServerResponse, request: IncomingMessage, url: URL, origin: string, fetchImpl: typeof fetch) {
  const method = request.method ?? "GET";
  const pathname = url.pathname === "/apps/nebula-arcade" || url.pathname === "/apps/chat-tag" ? "/" : url.pathname;
  const headers = new Headers({ accept: request.headers.accept ?? "*/*" });
  if (request.headers["content-type"]) headers.set("content-type", request.headers["content-type"]);
  if (!["GET", "HEAD"].includes(method)) headers.set("origin", origin);
  const body = ["GET", "HEAD"].includes(method) ? undefined : await readBody(request);
  const upstream = await fetchImpl(`${origin}${pathname}${url.search}`, { method, headers, ...(body ? { body } : {}), redirect: "manual", signal: AbortSignal.timeout(10000) });
  const encoded = await limitedResponseBody(upstream);
  response.removeHeader("x-frame-options");
  response.removeHeader("content-security-policy");
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "content-length": encoded.byteLength,
    "cache-control": upstream.headers.get("cache-control") ?? "no-store",
    "content-security-policy": upstream.headers.get("content-security-policy") ?? "default-src 'none'; frame-ancestors 'self'",
    "x-content-type-options": "nosniff",
  });
  response.end(encoded);
}

function chatTagProxyPath(pathname: string) {
  return pathname === "/apps/nebula-arcade" || pathname === "/apps/chat-tag" || pathname.startsWith("/assets/chat-tag-sandbox.") || pathname.startsWith("/assets/nebula-arcade/") || pathname.startsWith("/v1/chat-tag/") || pathname === "/v1/chat-tag/state" || pathname.startsWith("/v1/nebula/chat-tag/overlay");
}

function browserProxyAllowed(method: string, pathname: string) {
  if (method === "GET") {
    if (["/health/live", "/health/ready", "/v1/session", "/v1/auth/setup-options", "/v1/identity/providers", "/v1/workspace/profile", "/v1/apps", "/v1/apps/installs", "/v1/entitlements", "/v1/events", "/v1/commlink/conversations", "/v1/commlink/messages", "/v1/commlink/search", "/v1/notifications", "/v1/assistants/community", "/v1/stellar/context", "/v1/stellar/capabilities", "/v1/operations/logs", "/v1/operations/coder", "/v1/operations/coder/jobs"].includes(pathname)) return true;
    return /^\/v1\/apps\/[^/]+$/.test(pathname);
  }
  if (method === "PATCH" && pathname === "/v1/workspace/profile") return true;
  if (method === "DELETE" && /^\/v1\/identity\/providers\/[^/]+\/[^/]+$/.test(pathname)) return true;
  if (method === "POST") return pathname === "/v1/apps" || /^\/v1\/apps\/[^/]+\/(?:install|disable)$/.test(pathname) || /^\/v1\/notifications\/[^/]+\/read$/.test(pathname) || pathname === "/v1/commlink/messages" || pathname === "/v1/assistants/community/invocations" || pathname === "/v1/operations/coder/jobs";
  return false;
}

function applySecurityHeaders(response: ServerResponse, nonce: string) {
  response.setHeader("content-security-policy", `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`);
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

function candidateManifest(source: string): AppCatalogRegistrationV1 {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("SPMT_SANDBOX_CANDIDATE_MANIFEST must be JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SPMT_SANDBOX_CANDIDATE_MANIFEST must be an object");
  const item = value as AppCatalogRegistrationV1;
  if (item.appId !== "nebula-arcade" || item.status !== "active" || !Array.isArray(item.allowedScopes) || !Array.isArray(item.surfaces)) throw new Error("Sandbox candidate manifest is invalid");
  const launch = new URL(item.launchUrl);
  const local = launch.hostname === "localhost" || launch.hostname === "127.0.0.1";
  if ((!local && launch.protocol !== "https:") || (!local && !launch.hostname.endsWith(".sprites.app")) || launch.pathname !== "/apps/nebula-arcade") throw new Error("Sandbox candidate launch URL is invalid");
  return structuredClone(item);
}

async function readJsonBody(request: IncomingMessage) { const body = await readBody(request); const parsed = JSON.parse(body.toString("utf8")) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new WebHostError(400, "A JSON object is required"); return parsed as Record<string, unknown>; }
async function readBody(request: IncomingMessage) { const chunks: Buffer[] = []; let total = 0; for await (const chunk of request) { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += part.byteLength; if (total > MAX_BODY_BYTES) throw new WebHostError(413, "Request body is too large"); chunks.push(part); } return Buffer.concat(chunks); }
async function limitedResponseBody(response: Response) { return limitedBody(response, MAX_RESPONSE_BYTES, "SPMT response is too large"); }
async function limitedBody(response: Response, maximum: number, errorMessage: string) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new WebHostError(502, errorMessage);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) { await reader.cancel(errorMessage); throw new WebHostError(502, errorMessage); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

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
  const host = createSpaceMountainWebHost({ spmtOrigin: checked.spmtOrigin, port: Number(process.env.PORT ?? 8080), host: process.env.HOST ?? "0.0.0.0", buildSha: process.env.BUILD_SHA ?? "dev", ...(checked.chatTagOrigin ? { chatTagOrigin: checked.chatTagOrigin } : {}), ...(checked.candidateManifest ? { candidateManifest: checked.candidateManifest } : {}) });
  await host.listen();
}
