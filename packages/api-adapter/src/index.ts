import { PlatformOperationError, PlatformOperations, type PlatformOperationNameV1 } from "@spmt/platform-ops";

export interface ApiRequestV1 {
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}
export interface ApiResponseV1 { status: number; body?: unknown; }

export class PlatformApiAdapter {
  constructor(private readonly operations: PlatformOperations) {}

  handle(request: ApiRequestV1): ApiResponseV1 {
    try {
      const headers = lowerHeaders(request.headers ?? {});
      const accessToken = bearer(headers.authorization);
      const tenantId = headers["x-spmt-tenant"];
      const correlationId = headers["x-correlation-id"];
      const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
      let operation: PlatformOperationNameV1;
      let input: Record<string, unknown>;

      if (request.method === "GET" && request.path === "/v1/session") {
        operation = "session.get"; input = {};
      } else if (request.method === "GET" && request.path === "/v1/workspace/profile") {
        operation = "workspace.get"; input = { tenantId: requiredTenant(tenantId) };
      } else if (request.method === "PATCH" && request.path === "/v1/workspace/profile") {
        operation = "workspace.update"; input = { tenantId: requiredTenant(tenantId), expectedRevision: body.expectedRevision, patch: body.patch };
      } else if (request.method === "GET" && request.path.startsWith("/v1/xp/balance?")) {
        const userId = new URL(`https://spmt.invalid${request.path}`).searchParams.get("userId") ?? "";
        operation = "xp.balance"; input = { tenantId: requiredTenant(tenantId), userId };
      } else if (request.method === "POST" && request.path === "/v1/xp/awards") {
        operation = "xp.award"; input = { tenantId: requiredTenant(tenantId), ...body, idempotencyKey: headers["idempotency-key"] ?? body.idempotencyKey };
      } else if (request.method === "POST" && request.path === "/v1/events") {
        operation = "events.publish"; input = { tenantId: requiredTenant(tenantId), ...body, idempotencyKey: headers["idempotency-key"] ?? body.idempotencyKey };
      } else {
        return { status: 404, body: { error: "not_found" } };
      }

      const result = this.operations.execute({ name: operation, input }, { accessToken, ...(correlationId ? { correlationId } : {}) });
      return { status: 200, body: result.result };
    } catch (error) {
      if (error instanceof PlatformOperationError) {
        const status = error.code === "unauthorized" ? 403 : error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
        return { status, body: { error: error.code, message: error.message } };
      }
      return { status: 500, body: { error: "internal" } };
    }
  }
}

function lowerHeaders(headers: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}
function bearer(value?: string) {
  if (!value?.startsWith("Bearer ") || value.length <= 7) throw new PlatformOperationError("unauthorized", "Bearer access token is required");
  return value.slice(7);
}
function requiredTenant(value?: string) {
  if (!value) throw new PlatformOperationError("invalid", "x-spmt-tenant is required");
  return value;
}
