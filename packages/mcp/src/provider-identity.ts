import { ProviderIdentityOperations } from "@spmt/account-recovery-core/provider-identity-ops";

export const SPMT_PROVIDER_IDENTITY_MCP_TOOLS = [
  {
    name: "spmt.identity.provider.resolve",
    description: "Resolve an immutable Discord or Twitch provider user id to the active canonical SPMT identity for an authorized tenant.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        provider: { type: "string", enum: ["discord", "twitch"] },
        providerUserId: { type: "string" },
      },
      required: ["tenantId", "provider", "providerUserId"],
      additionalProperties: false,
    },
  },
  {
    name: "spmt.identity.provider.grandfather",
    description: "Create or recover one canonical SPMT identity from an immutable Discord or Twitch provider id. Requires a service identity with identity:write; display names never merge users.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: { type: "string" },
        provider: { type: "string", enum: ["discord", "twitch"] },
        providerUserId: { type: "string" },
        providerUsername: { type: "string" },
        username: { type: "string" },
        displayName: { type: "string" },
      },
      required: ["tenantId", "provider", "providerUserId"],
      additionalProperties: false,
    },
  },
] as const;

export interface ProviderIdentityMcpRequestV1 {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}
export interface ProviderIdentityMcpContextV1 { accessToken: string; }

/**
 * Small composable MCP surface for provider identity migration. This remains
 * separate from the generic platform MCP router so the SPMT host can mount the
 * exact same ProviderIdentityOperations boundary used by HTTP.
 */
export class ProviderIdentityMcpServer {
  constructor(private readonly operations: ProviderIdentityOperations) {}

  handle(request: ProviderIdentityMcpRequestV1, context: ProviderIdentityMcpContextV1) {
    try {
      if (request.method === "tools/list") {
        return ok(request.id, { tools: SPMT_PROVIDER_IDENTITY_MCP_TOOLS, ttlMs: 300_000, cacheScope: "private" });
      }
      if (request.method !== "tools/call") return err(request.id, -32601, `Method not found: ${request.method}`);
      const params = request.params ?? {};
      const name = String(params.name ?? "");
      const input = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? params.arguments as Record<string, unknown>
        : {};
      const operation = name === "spmt.identity.provider.resolve"
        ? "identity.provider.resolve"
        : name === "spmt.identity.provider.grandfather"
          ? "identity.provider.grandfather"
          : undefined;
      if (!operation) return err(request.id, -32602, `Unknown tool ${name}`);
      const result = this.operations.execute({ name: operation, input }, { accessToken: context.accessToken });
      return ok(request.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    } catch (error) {
      return err(request.id, -32000, error instanceof Error ? error.message : "Provider identity tool failed");
    }
  }
}

function ok(id: ProviderIdentityMcpRequestV1["id"], result: unknown) { return { jsonrpc: "2.0" as const, id: id ?? null, result }; }
function err(id: ProviderIdentityMcpRequestV1["id"], code: number, message: string) { return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } }; }
