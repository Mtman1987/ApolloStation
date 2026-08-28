import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createNebulaArcadeSandboxHost as createBaseNebulaHost, validateNebulaArcadeSandboxEnvironment, type NebulaArcadeSandboxHostOptions } from "./nebula-runtime-host-base.js";

const APP_PATH = "/apps/nebula-arcade";

export function createNebulaArcadeSandboxHost(options: NebulaArcadeSandboxHostOptions) {
  const base = createBaseNebulaHost({ ...options, port: 0, host: "127.0.0.1" });
  let basePort = 0;
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://nebula-canonical.local");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === APP_PATH) && url.searchParams.get("view") === "overlay") {
        return canonicalOverlayPage(response);
      }
      const transformGamePage = request.method === "GET" && (url.pathname === "/" || url.pathname === APP_PATH) && url.searchParams.get("view") === "game";
      return proxy(request, response, basePort, transformGamePage);
    } catch (error) {
      const body = Buffer.from(JSON.stringify({ error: "nebula_front_door_failure", message: error instanceof Error ? error.message : "unknown error" }));
      response.writeHead(500, { "content-type": "application/json; charset=utf-8", "content-length": body.byteLength, "cache-control": "no-store" });
      response.end(body);
    }
  });
  return {
    server,
    async listen() {
      await base.listen();
      const address = base.server.address();
      if (!address || typeof address === "string") throw new Error("Nebula base runtime did not bind a TCP port");
      basePort = address.port;
      await listen(server, options.port ?? 8080, options.host ?? "0.0.0.0");
    },
    async close() {
      if (server.listening) await close(server);
      await base.close();
    },
  };
}

function canonicalOverlayPage(response: ServerResponse) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nebula Arcade Overlay</title><style>html,body{min-height:100%;margin:0;background:#050916;color:#eef8ff;font-family:Inter,system-ui,sans-serif}body{display:grid;place-items:center;padding:24px}main{max-width:760px;padding:32px;border:1px solid #315b84;border-radius:24px;background:rgba(11,22,45,.9)}span{color:#6de8ff;font-size:12px;letter-spacing:.14em}h1{font-size:clamp(30px,6vw,56px);margin:.35em 0}p{line-height:1.65;color:#bed2e5}a{display:inline-block;margin-top:16px;padding:13px 18px;border-radius:12px;background:#6de8ff;color:#05111d;font-weight:800;text-decoration:none}</style></head><body><main><span>NEBULA ARCADE · GAME MIX</span><h1>Overlay editing lives in Overlay Bay</h1><p>Nebula owns the twenty game runtimes and saved Game Mix data. SpaceMountain Overlay Bay is the single visual editor for choosing games, arranging them, styling them, and issuing the final OBS/browser-source URL.</p><a href="/?view=workspace" target="_top">Manage Nebula in Overlay Bay</a></main></body></html>`;
  const body = Buffer.from(html);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": body.byteLength, "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'", "x-content-type-options": "nosniff" });
  response.end(body);
}

function proxy(request: IncomingMessage, response: ServerResponse, port: number, transform: boolean) {
  if (!port) throw new Error("Nebula base runtime is not ready");
  const headers = { ...request.headers }; delete headers.connection;
  const upstream = httpRequest({ hostname: "127.0.0.1", port, path: request.url ?? "/", method: request.method, headers }, (incoming) => {
    if (!transform || !String(incoming.headers["content-type"] ?? "").includes("text/html")) {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(response); return;
    }
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    incoming.on("end", () => {
      let html = Buffer.concat(chunks).toString("utf8");
      html = html
        .replaceAll("Catalog registered", "Shared runtime ready")
        .replaceAll("catalog ready", "runtime ready")
        .replaceAll("Runtime widget pending", "Shared runtime connected")
        .replaceAll("This title has its catalog and overlay contract reserved. Its runtime will plug into the same game, overlay, command, and theme contracts as it is ported.", "This title is connected to Nebula Arcade's shared persistent players, scores, Games Points, command, action, and overlay runtime.")
        .replaceAll("This page does not fake gameplay. The runtime will use the same game, overlay, command, and theme contracts when its port is added.", "This game uses Nebula Arcade's shared persistent runtime. Game-specific actions are validated before they enter the shared player, score, points, action, and overlay state.")
        .replaceAll("Game page screenshot placeholder", "Shared runtime game surface")
        .replaceAll("Overlay screenshot placeholder", "Overlay Bay Game Mix surface")
        .replaceAll("Chat interaction example placeholder", "Provider-neutral chat action surface");
      const body = Buffer.from(html); const out = { ...incoming.headers, "content-length": String(body.byteLength) }; delete out["transfer-encoding"];
      response.writeHead(incoming.statusCode ?? 200, out); response.end(body);
    });
  });
  upstream.on("error", (error) => response.headersSent ? response.destroy(error) : response.writeHead(502).end());
  request.pipe(upstream);
}

function listen(server: ReturnType<typeof createServer>, port: number, host: string) { return new Promise<void>((done, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); done(); }); }); }
function close(server: ReturnType<typeof createServer>) { return new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); }

export { validateNebulaArcadeSandboxEnvironment };
export type { NebulaArcadeSandboxHostOptions };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checked = validateNebulaArcadeSandboxEnvironment(process.env);
  const host = createNebulaArcadeSandboxHost({ ...checked, port: Number(process.env.PORT ?? 8080), host: process.env.HOST ?? "0.0.0.0", buildSha: process.env.BUILD_SHA ?? "dev", ...(process.env.NEBULA_ARCADE_PIN_USER_ID ? { pinUserId: process.env.NEBULA_ARCADE_PIN_USER_ID } : {}) });
  await host.listen();
}
