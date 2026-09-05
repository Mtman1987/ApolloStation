import type { IncomingMessage, ServerResponse } from "node:http";
import { ProviderIdentityApiAdapter } from "@spmt/account-recovery-core/provider-identity-api";
import { ProviderIdentityOperations } from "@spmt/account-recovery-core/provider-identity-ops";
import { createSpmtService, type SpmtServiceOptions } from "./index.js";

/**
 * Construct the normal SPMT service, then mount the provider identity adapter on
 * the same HTTP server. Every non-provider request is delegated byte-for-byte to
 * the original request listener; this avoids duplicating OAuth/recovery/platform
 * routing while the donor identity slice is migrated.
 */
export function createSpmtServiceWithProviderIdentity(options: SpmtServiceOptions) {
  const service = createSpmtService(options);
  mountProviderIdentityRoutes(service);
  return service;
}

export function mountProviderIdentityRoutes(service: ReturnType<typeof createSpmtService>) {
  const operations = new ProviderIdentityOperations(service.auth, service.accounts);
  const adapter = new ProviderIdentityApiAdapter(operations);
  const originalListeners = service.server.listeners("request");
  if (originalListeners.length === 0) throw new Error("SPMT service has no request listener to preserve");
  service.server.removeAllListeners("request");
  service.server.on("request", async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://spmt.internal").pathname;
      if (pathname === "/v1/identity/provider" || pathname === "/v1/identity/provider/grandfather") {
        const body = request.method === "POST" ? await readJsonBody(request) : undefined;
        const result = adapter.handle({
          method: request.method ?? "GET",
          path: request.url ?? "/",
          headers: headerRecord(request),
          ...(body === undefined ? {} : { body }),
        });
        if (result) {
          if(result.status===200&&request.method==="GET"&&result.body&&typeof result.body==="object"){
            const identity=result.body as {userId:string;profile:{tenantIds:string[]}},tenantId=String(request.headers["x-spmt-tenant"]??"");
            const tenant=service.store.getTenant(tenantId);
            result.body={...identity,tenantRole:tenant?.ownerUserId===identity.userId?"owner":tenant&&identity.profile.tenantIds.includes(tenantId)?"member":null};
          }
          writeJson(response, result.status, result.body);
          return;
        }
      }
      for (const listener of originalListeners) {
        (listener as (req: IncomingMessage, res: ServerResponse) => void).call(service.server, request, response);
      }
    } catch (error) {
      if (!response.headersSent) writeJson(response, 400, { error: "invalid", message: error instanceof Error ? error.message : "Invalid provider identity request" });
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });
  return service;
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("Provider identity request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Provider identity request body must be a JSON object");
  return parsed as Record<string, unknown>;
}

function headerRecord(request: IncomingMessage) {
  const result: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    result[name] = Array.isArray(value) ? value.join(",") : value;
  }
  return result;
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
