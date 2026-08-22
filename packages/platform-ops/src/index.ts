import { AuthDeniedError, type AuthPrincipalV1, AuthService } from "@spmt/auth-core";
import { AuthorityConflictError, AuthorityService, AuthorityValidationError, type WorkspaceProfileV1 } from "@spmt/authority-core";

export const PLATFORM_OPERATION_NAMES = [
  "session.get", "workspace.get", "workspace.update", "xp.balance", "xp.award", "events.publish",
] as const;
export type PlatformOperationNameV1 = (typeof PLATFORM_OPERATION_NAMES)[number];

export interface OperationContextV1 { accessToken: string; correlationId?: string; }
export interface OperationRequestV1 { name: PlatformOperationNameV1; input: Record<string, unknown>; }
export interface OperationResultV1 { name: PlatformOperationNameV1; result: unknown; }

export class PlatformOperationError extends Error {
  constructor(public readonly code: "unauthorized" | "invalid" | "not_found" | "conflict", message: string) {
    super(message); this.name = "PlatformOperationError";
  }
}

export class PlatformOperations {
  constructor(private readonly auth: AuthService, private readonly authority: AuthorityService) {}

  execute(request: OperationRequestV1, context: OperationContextV1): OperationResultV1 {
    try {
      switch (request.name) {
        case "session.get": {
          const principal = this.auth.authenticateAccessToken(context.accessToken);
          if (!principal) throw new AuthDeniedError("Access token is invalid or expired");
          return { name: request.name, result: publicPrincipal(principal) };
        }
        case "workspace.get": {
          const tenantId = text(request.input.tenantId, "tenantId");
          this.auth.authorize(context.accessToken, "workspace:read", tenantId);
          const workspace = this.authority.getWorkspace(tenantId);
          if (!workspace) throw new PlatformOperationError("not_found", `Workspace ${tenantId} does not exist`);
          return { name: request.name, result: workspace };
        }
        case "workspace.update": {
          const tenantId = text(request.input.tenantId, "tenantId");
          const principal = this.auth.authorize(context.accessToken, "workspace:write", tenantId);
          const expectedRevision = integer(request.input.expectedRevision, "expectedRevision");
          const patch = object(request.input.patch, "patch") as Partial<Omit<WorkspaceProfileV1, "tenantId" | "revision" | "updatedAt">>;
          const workspace = this.authority.updateWorkspace(tenantId, expectedRevision, patch);
          this.audit(principal, tenantId, "workspace.update", `workspace:${tenantId}`, "accepted", context.correlationId);
          return { name: request.name, result: workspace };
        }
        case "xp.balance": {
          const tenantId = text(request.input.tenantId, "tenantId");
          this.auth.authorize(context.accessToken, "xp:read", tenantId);
          const userId = text(request.input.userId, "userId");
          return { name: request.name, result: { tenantId, userId, balance: this.authority.getXpBalance(tenantId, userId) } };
        }
        case "xp.award": {
          const tenantId = text(request.input.tenantId, "tenantId");
          const principal = this.auth.authorize(context.accessToken, "xp:write", tenantId);
          const result = this.authority.awardXp({
            tenantId,
            userId: text(request.input.userId, "userId"),
            delta: integer(request.input.delta, "delta"),
            sourceAppId: principal.actorId,
            reason: text(request.input.reason, "reason"),
            idempotencyKey: text(request.input.idempotencyKey, "idempotencyKey"),
          });
          this.audit(principal, tenantId, "xp.award", `xp:${result.value.id}`, result.duplicate ? "duplicate" : "accepted", context.correlationId);
          return { name: request.name, result: { duplicate: result.duplicate, event: result.value } };
        }
        case "events.publish": {
          const tenantId = text(request.input.tenantId, "tenantId");
          const principal = this.auth.authorize(context.accessToken, "events:write", tenantId);
          const result = this.authority.publishEvent({
            tenantId,
            sourceAppId: principal.actorId,
            type: text(request.input.type, "type"),
            payload: object(request.input.payload, "payload"),
            idempotencyKey: text(request.input.idempotencyKey, "idempotencyKey"),
          });
          this.audit(principal, tenantId, "events.publish", `event:${result.value.id}`, result.duplicate ? "duplicate" : "accepted", context.correlationId);
          return { name: request.name, result: { duplicate: result.duplicate, event: result.value } };
        }
      }
    } catch (error) {
      if (error instanceof PlatformOperationError) throw error;
      if (error instanceof AuthDeniedError) throw new PlatformOperationError("unauthorized", error.message);
      if (error instanceof AuthorityConflictError) throw new PlatformOperationError("conflict", error.message);
      if (error instanceof AuthorityValidationError) throw new PlatformOperationError("invalid", error.message);
      if (error instanceof Error) throw new PlatformOperationError("invalid", error.message);
      throw error;
    }
  }

  private audit(principal: AuthPrincipalV1, tenantId: string, action: string, target: string, outcome: "accepted" | "duplicate", correlationId?: string) {
    this.authority.audit({
      tenantId,
      actorType: principal.actorType,
      actorId: principal.actorId,
      action,
      target,
      outcome,
      ...(correlationId ? { correlationId } : {}),
    });
  }
}

function publicPrincipal(principal: AuthPrincipalV1) {
  return { actorType: principal.actorType, actorId: principal.actorId, scopes: principal.scopes, tenantMode: principal.tenantMode, tenantIds: principal.tenantIds };
}
function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new PlatformOperationError("invalid", `${name} must be a non-empty string`);
  return value;
}
function integer(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new PlatformOperationError("invalid", `${name} must be a safe integer`);
  return value;
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformOperationError("invalid", `${name} must be an object`);
  return value as Record<string, unknown>;
}
