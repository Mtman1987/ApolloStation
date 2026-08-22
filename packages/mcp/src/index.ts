import { PlatformOperations, type PlatformOperationNameV1 } from "@spmt/platform-ops";
export const SPMT_MCP_PROTOCOL_VERSION = "2026-07-28" as const;
export interface McpRequestV1 { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown>; }
export interface McpContextV1 { accessToken: string; correlationId?: string; protocolVersion: string; }
const tools = [
  tool("spmt.workspace.get", "Read the canonical tenant workspace", { tenantId: "string" }), tool("spmt.workspace.update", "Update the canonical tenant workspace", { tenantId: "string", expectedRevision: "number", patch: "object" }),
  tool("spmt.xp.balance", "Read canonical XP balance", { tenantId: "string", userId: "string" }), tool("spmt.xp.award", "Award canonical XP idempotently", { tenantId: "string", userId: "string", delta: "number", reason: "string", idempotencyKey: "string" }),
  tool("spmt.events.publish", "Publish a canonical platform event idempotently", { tenantId: "string", type: "string", payload: "object", idempotencyKey: "string" }),
  tool("spmt.apps.list", "List active ecosystem apps", {}), tool("spmt.apps.get", "Read an app manifest", { appId: "string" }),
  tool("spmt.apps.install", "Install an app for a tenant", { tenantId: "string", appId: "string" }), tool("spmt.apps.disable", "Disable an installed app", { tenantId: "string", appId: "string" }),
  tool("spmt.apps.installed", "List tenant app installs", { tenantId: "string" }), tool("spmt.entitlements.list", "List tenant entitlements", { tenantId: "string" }),
];
export class SpmtMcpServer {
  constructor(private readonly operations: PlatformOperations) {}
  handle(request: McpRequestV1, context: McpContextV1) {
    if (context.protocolVersion !== SPMT_MCP_PROTOCOL_VERSION) return failure(request.id, -32600, `MCP protocol ${SPMT_MCP_PROTOCOL_VERSION} is required`);
    try {
      if (request.method === "server/discover") return success(request.id, { serverInfo: { name: "spmt-platform", version: "0.2.0" }, capabilities: { tools: {} }, protocolVersion: SPMT_MCP_PROTOCOL_VERSION });
      if (request.method === "tools/list") return success(request.id, { tools, ttlMs: 300000, cacheScope: "private" });
      if (request.method === "tools/call") { const params = request.params ?? {}; const name = String(params.name ?? ""); const operationName = operationForTool(name); if (!operationName) return failure(request.id, -32602, `Unknown tool ${name}`); const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {}; const output = this.operations.execute({ name: operationName, input: args }, { accessToken: context.accessToken, ...(context.correlationId ? { correlationId: context.correlationId } : {}) }); return success(request.id, { content: [{ type: "text", text: JSON.stringify(output.result) }], structuredContent: output.result }); }
      return failure(request.id, -32601, `Method not found: ${request.method}`);
    } catch (error) { return failure(request.id, -32000, error instanceof Error ? error.message : "Tool execution failed"); }
  }
}
function operationForTool(name: string): PlatformOperationNameV1 | undefined { return ({ "spmt.workspace.get":"workspace.get","spmt.workspace.update":"workspace.update","spmt.xp.balance":"xp.balance","spmt.xp.award":"xp.award","spmt.events.publish":"events.publish","spmt.apps.list":"apps.list","spmt.apps.get":"apps.get","spmt.apps.install":"apps.install","spmt.apps.disable":"apps.disable","spmt.apps.installed":"apps.installs","spmt.entitlements.list":"apps.entitlements" } as Record<string, PlatformOperationNameV1>)[name]; }
function tool(name: string, description: string, fields: Record<string, string>) { const properties = Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, { type }])); return { name, description, inputSchema: { type: "object", properties, required: Object.keys(fields), additionalProperties: false } }; }
function success(id: McpRequestV1["id"], result: unknown) { return { jsonrpc: "2.0" as const, id: id ?? null, result }; }
function failure(id: McpRequestV1["id"], code: number, message: string) { return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } }; }
