import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { AuthorityService } from "@spmt/authority-core";
import { SqliteAuthorityStore } from "@spmt/authority-sqlite";
import { AuthService } from "@spmt/auth-core";
import { ControlService } from "@spmt/control-core";
import { PlatformOperations } from "@spmt/platform-ops";
import { PlatformApiAdapter } from "@spmt/api-adapter";
import { HealthRegistry } from "@spmt/runtime";

export interface SpmtServiceOptions { databasePath: string; port?: number; host?: string; buildSha?: string; }
export function createSpmtService(options: SpmtServiceOptions) {
  const store = new SqliteAuthorityStore(options.databasePath); const authority = new AuthorityService({ store }); const auth = new AuthService({ store }); const control = new ControlService({ store }); const operations = new PlatformOperations(auth, authority, control); const api = new PlatformApiAdapter(operations); const health = new HealthRegistry(); health.setDependency("authority-storage", "ready", `sqlite:${store.journalMode()}`);
  const server = createServer(async (request, response) => {
    try {
      const path = request.url ?? "/";
      if (request.method === "GET" && path === "/health/live") return json(response, 200, { live: true, service: "spmt", buildSha: options.buildSha ?? "dev" });
      if (request.method === "GET" && path === "/health/ready") { const probe = store.probe(); if (!probe.ready) health.setDependency("authority-storage", "unavailable", "authority epoch unavailable"); else health.setDependency("authority-storage", "ready", `sqlite:${probe.journalMode}`); const state = health.snapshot(); const ready = probe.ready && state.state !== "unavailable"; return json(response, ready ? 200 : 503, { ...state, storage: probe, buildSha: options.buildSha ?? "dev" }); }
      if (request.method === "POST" && path === "/v1/auth/service-token") { const body = await readBody(request); if (!body || typeof body.serviceId !== "string" || typeof body.credential !== "string") return json(response, 400, { error: "invalid_request" }); try { return json(response, 200, auth.issueServiceAccess(body.serviceId, body.credential)); } catch { return json(response, 401, { error: "invalid_credentials" }); } }
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request); const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value])); const result = api.handle({ method: request.method ?? "GET", path, headers, ...(body === undefined ? {} : { body }) }); return json(response, result.status, result.body ?? null);
    } catch (error) { const invalid = error instanceof SyntaxError || (error instanceof Error && /body too large|JSON object required/.test(error.message)); return json(response, invalid ? 400 : 500, { error: invalid ? "invalid_request" : "internal", message: error instanceof Error ? error.message : "unknown" }); }
  });
  return { store, authority, auth, control, operations, server, listen() { return new Promise<void>((resolvePromise, reject) => { server.once("error", reject); server.listen(options.port ?? 3000, options.host ?? "0.0.0.0", () => { server.off("error", reject); resolvePromise(); }); }); }, close() { return new Promise<void>((resolvePromise, reject) => server.close((error) => { store.close(); error ? reject(error) : resolvePromise(); })); } };
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let total = 0; for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += buffer.byteLength; if (total > 1024 * 1024) throw new Error("request body too large"); chunks.push(buffer); } if (!chunks.length) return {}; const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required"); return parsed as Record<string, unknown>; }
function json(response: ServerResponse, status: number, body: unknown) { const encoded = JSON.stringify(body); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(encoded) }); response.end(encoded); }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { const databasePath = process.env.DATABASE_PATH; if (!databasePath) throw new Error("DATABASE_PATH is required; SPMT will not fall back to a local production database"); const service = createSpmtService({ databasePath, port: Number(process.env.PORT ?? 3000), buildSha: process.env.BUILD_SHA }); await service.listen(); }
