import type { IncomingMessage, ServerResponse } from "node:http";
import { SpmtMcpServer, type McpContextV1, type McpRequestV1 } from "@spmt/mcp";
import type { createSpmtService } from "./index.js";

/**
 * Mount the SPMT MCP server (Stella's tool surface) on the production SPMT
 * service HTTP server, following the provider-identity-host pattern: intercept
 * exactly one path and delegate every other request byte-for-byte to the
 * original request listener.
 *
 * POST /v1/mcp carries one JSON-RPC request per call. The caller's access
 * token is resolved exactly like the platform API (Authorization: Bearer,
 * falling back to the spmt_token browser cookie) and is validated by
 * PlatformOperations on every tools/call. The MCP protocol version is taken
 * from the MCP-Protocol-Version header, or params.protocolVersion when the
 * header is absent, and is enforced by SpmtMcpServer itself. The /v1 prefix
 * keeps the route inside the integrated web host's existing SPMT API proxy
 * rule, so it is reachable on the node's public origin unchanged.
 */
export function mountMcpRoutes(service: ReturnType<typeof createSpmtService>) {
  const mcp = new SpmtMcpServer(service.operations);
  const originalListeners = service.server.listeners("request");
  if (originalListeners.length === 0) throw new Error("SPMT service has no request listener to preserve");
  service.server.removeAllListeners("request");
  service.server.on("request", async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://spmt.internal").pathname;
      if (pathname === "/v1/mcp" && request.method === "POST") {
        const token = accessToken(request);
        if (!token) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        const body = await readJsonBody(request);
        const context: McpContextV1 = {
          accessToken: token,
          protocolVersion: protocolVersion(request, body),
        };
        const correlation = correlationId(request);
        if (correlation) context.correlationId = correlation;
        writeJson(response, 200, mcp.handle(body as unknown as McpRequestV1, context));
        return;
      }
      for (const listener of originalListeners) {
        (listener as (req: IncomingMessage, res: ServerResponse) => void).call(service.server, request, response);
      }
    } catch (error) {
      if (!response.headersSent) writeJson(response, 400, { error: "invalid", message: error instanceof Error ? error.message : "Invalid MCP request" });
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });
  return service;
}

function accessToken(request: IncomingMessage) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return cookie(request, "spmt_token");
}

function cookie(request: IncomingMessage, name: string) {
  const source = request.headers.cookie ?? "";
  for (const item of source.split(";")) {
    const [index, ...rest] = item.trim().split("=");
    if (index === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function protocolVersion(request: IncomingMessage, body: Record<string, unknown>) {
  const header = request.headers["mcp-protocol-version"];
  if (typeof header === "string" && header) return header;
  const params = body.params;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const version = (params as Record<string, unknown>).protocolVersion;
    if (typeof version === "string" && version) return version;
  }
  return "";
}

function correlationId(request: IncomingMessage) {
  const value = request.headers["x-correlation-id"] ?? request.headers["x-request-id"];
  return typeof value === "string" && value ? value : undefined;
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("MCP request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP request body must be a JSON object");
  return parsed as Record<string, unknown>;
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
