import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FIRST_PARTY_APP_BROWSER_JS,
  FIRST_PARTY_APP_CSS,
  isFirstPartyAppSurfaceId,
  renderFirstPartyAppSurface,
  type FirstPartyAppSurfaceMode,
} from "./first-party-app-surfaces.js";
import { createSpaceMountainWebHost, validateSandboxWebEnvironment, type SpaceMountainWebHostOptions } from "./server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_SHELL_PATHS = new Set(["/apps/commlink", "/apps/stellar-core", "/apps/mission-control", "/apps/hearmeout"]);
const MAX_EMBED_HTML_BYTES = 4 * 1024 * 1024;
const FIRST_PARTY_SCENE_ASSETS = new Map<string, string>([
  ["/assets/product/discord-stream-hub-background.webp", resolve(HERE, "../assets/discord-stream-hub-background.webp")],
  ["/assets/product/streamweaver-background.webp", resolve(HERE, "../assets/streamweaver-background.webp")],
  ["/assets/product/hearmeout-background.webp", resolve(HERE, "../assets/hearmeout-background.webp")],
  ["/assets/product/mountainview-background.webp", resolve(HERE, "../assets/mountainview-background.webp")],
  ["/assets/product/companion-background.webp", resolve(HERE, "../assets/companion-background.webp")],
]);
const FIRST_PARTY_REAL_SCENE_CSS = `
body[data-app="discord-stream-hub"] .scene-art{background:url("/assets/product/discord-stream-hub-background.webp") center/cover no-repeat!important}
body[data-app="streamweaver"] .scene-art{background:url("/assets/product/streamweaver-background.webp") center/cover no-repeat!important}
body[data-app="hearmeout"] .scene-art{background:url("/assets/product/hearmeout-background.webp") center/cover no-repeat!important}
body[data-app="mountainview"] .scene-art{background:url("/assets/product/mountainview-background.webp") center/cover no-repeat!important}
body[data-app="companion"] .scene-art{background:url("/assets/product/companion-background.webp") center/cover no-repeat!important}
/* In embedded shell/workspace mode the parent SpaceMountain shell owns the full-screen scene and stars. */
body[data-surface="shell"] .app-scene,body[data-surface="workspace"] .app-scene{display:none!important}
`;
const FIRST_PARTY_SHARED_THEME_CSS = `
:root{color-scheme:normal!important}
body[data-shared-ui="inherited"]{color:var(--ink,#f7f7fb)!important}
body[data-shared-ui="inherited"] .app-header>a,
body[data-shared-ui="inherited"] .app-header nav a,
body[data-shared-ui="inherited"] .hero-links a,
body[data-shared-ui="inherited"] .app-hero h1,
body[data-shared-ui="inherited"] .feature-card h2,
body[data-shared-ui="inherited"] .about-strip strong,
body[data-shared-ui="inherited"] .hmo-floor-heading strong,
body[data-shared-ui="inherited"] .hmo-person-card strong,
body[data-shared-ui="inherited"] .hmo-bot-card strong{color:var(--ink,#f7f7fb)!important}
body[data-shared-ui="inherited"] .tagline,
body[data-shared-ui="inherited"] .feature-card p,
body[data-shared-ui="inherited"] .about-strip p,
body[data-shared-ui="inherited"] .about-strip small,
body[data-shared-ui="inherited"] .runtime-note p,
body[data-shared-ui="inherited"] .hmo-floor-heading small,
body[data-shared-ui="inherited"] .hmo-person-card small,
body[data-shared-ui="inherited"] .hmo-bot-title small,
body[data-shared-ui="inherited"] .hmo-service-row small,
body[data-shared-ui="inherited"] .hmo-row-action{color:var(--muted,#a9acba)!important}
`;
const FIRST_PARTY_SHARED_THEME_JS = `;(()=>{if(window.parent===window)return;try{const root=window.parent.document.querySelector('.spmt-space-root');if(!root)return;const sync=()=>{const style=window.parent.getComputedStyle(root),pairs=[['--spmt-accent','--accent'],['--spmt-accent-secondary','--accent2'],['--spmt-glass-opacity','--glass'],['--spmt-blur','--blur'],['--spmt-stars','--stars'],['--spmt-surface-depth-1','--depth1'],['--spmt-surface-depth-2','--depth2'],['--spmt-surface-depth-3','--depth3'],['--spmt-surface-depth-4','--depth4'],['--spmt-ink','--ink'],['--spmt-muted','--muted'],['--spmt-border','--border']];for(const [source,target] of pairs){const value=style.getPropertyValue(source).trim();if(value)document.body.style.setProperty(target,value);}document.body.dataset.sharedUi='inherited';document.documentElement.style.colorScheme='normal';};sync();new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['style','data-spmt-theme','data-theme']});}catch{}})();`;
const FIRST_PARTY_EMBED_BROWSER_JS = FIRST_PARTY_APP_BROWSER_JS.replace(
  /const image=root\.querySelector\(':scope > \.spmt-product-backdrop \.spmt-product-backdrop-image'\),scene=shellScenes\[body\.dataset\.app\];if\(image&&scene\)\{image\.style\.backgroundImage=scene;image\.style\.backgroundPosition='center';image\.style\.backgroundSize='cover';\}/,
  "",
) + FIRST_PARTY_SHARED_THEME_JS;

export interface IntegratedSpaceMountainWebHostOptions extends SpaceMountainWebHostOptions {
  port?: number;
  host?: string;
}

export function createIntegratedSpaceMountainWebHost(options: IntegratedSpaceMountainWebHostOptions) {
  const inner = createSpaceMountainWebHost({ ...options, host: "127.0.0.1", port: 0 });
  let innerPort = 0;
  const outer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://spacemountain.integrated");
      if (request.method === "GET" && FIRST_PARTY_SCENE_ASSETS.has(url.pathname)) {
        applyAppHeaders(response, false);
        return sendBuffer(response, 200, await readFile(FIRST_PARTY_SCENE_ASSETS.get(url.pathname)!), "image/webp", "public, max-age=86400");
      }
      if (request.method === "GET" && url.pathname === "/assets/web/first-party-apps.css") {
        applyAppHeaders(response, false);
        return send(response, 200, FIRST_PARTY_APP_CSS + FIRST_PARTY_REAL_SCENE_CSS + FIRST_PARTY_SHARED_THEME_CSS, "text/css; charset=utf-8", "public, max-age=300");
      }
      if (request.method === "GET" && url.pathname === "/assets/web/first-party-apps.js") {
        applyAppHeaders(response, false);
        return send(response, 200, FIRST_PARTY_EMBED_BROWSER_JS, "text/javascript; charset=utf-8", "public, max-age=300");
      }
      const appId = appIdFromPath(url.pathname);
      if (request.method === "GET" && appId) {
        applyAppHeaders(response, true);
        const mode = appSurfaceMode(url.searchParams.get("surface"));
        return send(response, 200, renderFirstPartyAppSurface(appId, "external-script", mode, options.buildSha ?? "dev"), "text/html; charset=utf-8", "no-store");
      }
      const proxiedUrl = new URL(url.pathname + url.search, "http://spacemountain.integrated");
      if (url.pathname === "/apps/nebula-arcade" && url.searchParams.get("surface") === "workspace") proxiedUrl.searchParams.set("surface", "shell");
      return proxyToInner(request, response, innerPort, proxiedUrl.pathname + proxiedUrl.search, workspaceEmbed(url));
    } catch (error) {
      if (!response.headersSent) send(response, 500, JSON.stringify({ error: "integrated_host_failure", message: error instanceof Error ? error.message : "unknown error" }), "application/json; charset=utf-8", "no-store");
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });

  return {
    server: outer,
    async listen() {
      await inner.listen();
      const address = inner.server.address();
      if (!address || typeof address === "string") throw new Error("Integrated SpaceMountain inner host did not bind a TCP port");
      innerPort = address.port;
      await new Promise<void>((done, reject) => { outer.once("error", reject); outer.listen(options.port ?? 8080, options.host ?? "0.0.0.0", () => { outer.off("error", reject); done(); }); });
    },
    async close() {
      await new Promise<void>((done, reject) => outer.close((error) => error ? reject(error) : done()));
      await inner.close();
    },
  };
}

function appIdFromPath(pathname: string) {
  const match = pathname.match(/^\/apps\/([^/]+)$/);
  if (!match) return undefined;
  const appId = decodeURIComponent(match[1] ?? "");
  return isFirstPartyAppSurfaceId(appId) ? appId : undefined;
}

function appSurfaceMode(value: string | null): FirstPartyAppSurfaceMode {
  return value === "shell" || value === "workspace" ? value : "standalone";
}

function workspaceEmbed(url: URL) {
  return url.searchParams.get("surface") === "workspace" && WORKSPACE_SHELL_PATHS.has(url.pathname);
}

function proxyToInner(request: IncomingMessage, response: ServerResponse, port: number, path: string, embed: boolean) {
  if (!port) throw new Error("Integrated SpaceMountain inner host is not ready");
  const headers = { ...request.headers } as Record<string, string | string[] | undefined>;
  delete headers.connection;
  const upstream = httpRequest({ hostname: "127.0.0.1", port, path, method: request.method, headers }, (incoming) => {
    if (!embed) {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    incoming.on("data", (chunk: Buffer | string) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += part.byteLength;
      if (total > MAX_EMBED_HTML_BYTES) { incoming.destroy(new Error("Workspace app response is too large")); return; }
      chunks.push(part);
    });
    incoming.on("end", () => {
      const contentType = String(incoming.headers["content-type"] ?? "");
      if (!contentType.includes("text/html")) {
        response.writeHead(incoming.statusCode ?? 502, embedHeaders(incoming.headers));
        response.end(Buffer.concat(chunks));
        return;
      }
      const original = Buffer.concat(chunks).toString("utf8");
      const body = original.replace("</head>", `<style data-spmt-workspace-embed>.spmt-shell-header-stack,.spmt-rocket-dock{display:none!important}.spmt-space-root{height:100dvh!important;min-height:0!important;overflow:hidden!important}.spmt-space-shell{height:100%!important;min-height:0!important;overflow:hidden!important}.spmt-space-main{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-height:0!important;margin:0!important;padding:10px!important;overflow:auto!important;scrollbar-gutter:stable}.spmt-product-backdrop{opacity:.78}</style></head>`);
      const encoded = Buffer.from(body);
      const outHeaders = embedHeaders(incoming.headers);
      outHeaders["content-length"] = String(encoded.byteLength);
      response.writeHead(incoming.statusCode ?? 502, outHeaders);
      response.end(encoded);
    });
  });
  upstream.on("error", (error) => {
    if (!response.headersSent) send(response, 502, JSON.stringify({ error: "inner_host_unavailable", message: error.message }), "application/json; charset=utf-8", "no-store");
    else response.destroy(error);
  });
  request.pipe(upstream);
}

function embedHeaders(source: IncomingMessage["headers"]) {
  const headers = { ...source } as Record<string, string | string[] | undefined>;
  delete headers["content-length"];
  headers["x-frame-options"] = "SAMEORIGIN";
  const csp = String(headers["content-security-policy"] ?? "default-src 'none'; frame-ancestors 'self'");
  headers["content-security-policy"] = csp.includes("frame-ancestors 'none'") ? csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : csp;
  return headers;
}

function applyAppHeaders(response: ServerResponse, frameable: boolean) {
  response.setHeader("content-security-policy", `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors ${frameable ? "'self'" : "'none'"}; object-src 'none'`);
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("permissions-policy", frameable ? "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()" : "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", frameable ? "SAMEORIGIN" : "DENY");
}

function send(response: ServerResponse, status: number, body: string, type: string, cache: string) {
  return sendBuffer(response, status, Buffer.from(body), type, cache);
}

function sendBuffer(response: ServerResponse, status: number, body: Buffer, type: string, cache: string) {
  response.writeHead(status, { "content-type": type, "content-length": body.byteLength, "cache-control": cache, "x-content-type-options": "nosniff" });
  response.end(body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checked = validateSandboxWebEnvironment(process.env);
  const host = createIntegratedSpaceMountainWebHost({
    spmtOrigin: checked.spmtOrigin,
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
    buildSha: process.env.BUILD_SHA ?? "dev",
    ...(checked.nebulaArcadeOrigin ? { nebulaArcadeOrigin: checked.nebulaArcadeOrigin } : {}),
    ...(checked.candidateManifest ? { candidateManifest: checked.candidateManifest } : {}),
  });
  await host.listen();
}
