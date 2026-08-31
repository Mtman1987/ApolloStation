import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSpaceMountainWebHost, validateSandboxWebEnvironment, type SpaceMountainWebHostOptions } from "./server.js";

export interface IntegratedSpaceMountainWebHostOptions extends SpaceMountainWebHostOptions {
  port?: number;
  host?: string;
}

/**
 * SpaceMountain's integrated base host is deliberately app-agnostic.
 * Product app routing belongs to the outer ingress and each app-owned web
 * process. This host only exposes the SpaceMountain/SPMT shell itself.
 */
export function createIntegratedSpaceMountainWebHost(options: IntegratedSpaceMountainWebHostOptions) {
  const inner = createSpaceMountainWebHost({ ...options, host: "127.0.0.1", port: 0 });
  let innerPort = 0;
  const outer = createServer((request, response) => {
    try { return proxyToInner(request, response, innerPort); }
    catch (error) {
      if (!response.headersSent) return json(response, 500, { error: "integrated_host_failure", message: error instanceof Error ? error.message : "unknown error" });
      response.destroy(error instanceof Error ? error : undefined);
    }
  });

  return {
    server: outer,
    async listen() {
      await inner.listen();
      const address = inner.server.address();
      if (!address || typeof address === "string") throw new Error("Integrated SpaceMountain inner host did not bind a TCP port");
      innerPort = address.port;
      await listen(outer, options.port ?? 8080, options.host ?? "0.0.0.0");
    },
    async close() {
      if (outer.listening) await close(outer);
      await inner.close();
    },
  };
}

function proxyToInner(request: IncomingMessage, response: ServerResponse, port: number) {
  if (!port) throw new Error("Integrated SpaceMountain inner host is not ready");
  const headers = { ...request.headers } as Record<string, string | string[] | undefined>;
  delete headers.connection;
  const upstream = httpRequest({ hostname: "127.0.0.1", port, path: request.url ?? "/", method: request.method, headers }, (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on("error", (error) => response.headersSent ? response.destroy(error) : json(response, 502, { error: "inner_host_unavailable", message: error.message }));
  request.pipe(upstream);
}

function listen(server: ReturnType<typeof createServer>, port: number, host: string) {
  return new Promise<void>((done, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); done(); }); });
}
function close(server: ReturnType<typeof createServer>) { return new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); }
function json(response: ServerResponse, status: number, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": String(body.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" });
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
