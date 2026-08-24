import { ProviderIdentityOperationError, ProviderIdentityOperations } from "./provider-identity-ops.js";

export interface ProviderIdentityApiRequestV1 {
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}
export interface ProviderIdentityApiResponseV1 { status: number; body?: unknown; }

/** Mount this adapter at the SPMT /v1 identity boundary. */
export class ProviderIdentityApiAdapter {
  constructor(private readonly operations: ProviderIdentityOperations) {}
  handle(request: ProviderIdentityApiRequestV1): ProviderIdentityApiResponseV1 | undefined {
    const url = new URL(request.path, "https://spmt.invalid");
    if (url.pathname !== "/v1/identity/provider" && url.pathname !== "/v1/identity/provider/grandfather") return undefined;
    try {
      const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
      const authorization = headers.authorization;
      if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) return { status: 401, body: { error: "unauthorized" } };
      const tenantId = headers["x-spmt-tenant"];
      if (!tenantId) return { status: 400, body: { error: "invalid", message: "x-spmt-tenant is required" } };
      if (request.method === "GET" && url.pathname === "/v1/identity/provider") {
        return { status: 200, body: this.operations.execute({ name: "identity.provider.resolve", input: { tenantId, provider: url.searchParams.get("provider") ?? "", providerUserId: url.searchParams.get("providerUserId") ?? "" } }, { accessToken: authorization.slice(7) }) };
      }
      if (request.method === "POST" && url.pathname === "/v1/identity/provider/grandfather") {
        const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
        return { status: 200, body: this.operations.execute({ name: "identity.provider.grandfather", input: { tenantId, ...body } }, { accessToken: authorization.slice(7) }) };
      }
      return { status: 405, body: { error: "method_not_allowed" } };
    } catch (error) {
      if (error instanceof ProviderIdentityOperationError) {
        return { status: error.code === "unauthorized" ? 403 : error.code === "not_found" ? 404 : 400, body: { error: error.code, message: error.message } };
      }
      return { status: 500, body: { error: "internal" } };
    }
  }
}
