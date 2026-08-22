import { AuthDeniedError, type AuthPrincipalV1, AuthService } from "@spmt/auth-core";
import { AuthorityConflictError, AuthorityService, AuthorityValidationError, type WorkspaceProfileV1 } from "@spmt/authority-core";
import { ControlConflictError, ControlNotFoundError, ControlService, ControlValidationError } from "@spmt/control-core";

export const PLATFORM_OPERATION_NAMES = [
  "session.get", "workspace.get", "workspace.update", "xp.balance", "xp.award", "events.publish",
  "apps.list", "apps.get", "apps.install", "apps.disable", "apps.installs", "apps.entitlements",
] as const;
export type PlatformOperationNameV1 = (typeof PLATFORM_OPERATION_NAMES)[number];
export interface OperationContextV1 { accessToken: string; correlationId?: string; }
export interface OperationRequestV1 { name: PlatformOperationNameV1; input: Record<string, unknown>; }
export interface OperationResultV1 { name: PlatformOperationNameV1; result: unknown; }

export class PlatformOperationError extends Error {
  constructor(public readonly code: "unauthorized" | "invalid" | "not_found" | "conflict", message: string) { super(message); this.name = "PlatformOperationError"; }
}

export class PlatformOperations {
  constructor(private readonly auth: AuthService, private readonly authority: AuthorityService, private readonly control?: ControlService) {}

  execute(request: OperationRequestV1, context: OperationContextV1): OperationResultV1 {
    try {
      switch (request.name) {
        case "session.get": { const principal = this.auth.authenticateAccessToken(context.accessToken); if (!principal) throw new AuthDeniedError("Access token is invalid or expired"); return { name: request.name, result: publicPrincipal(principal) }; }
        case "workspace.get": { const tenantId = text(request.input.tenantId, "tenantId"); this.auth.authorize(context.accessToken, "workspace:read", tenantId); const workspace = this.authority.getWorkspace(tenantId); if (!workspace) throw new PlatformOperationError("not_found", `Workspace ${tenantId} does not exist`); return { name: request.name, result: workspace }; }
        case "workspace.update": {
          const tenantId = text(request.input.tenantId, "tenantId"); const principal = this.auth.authorize(context.accessToken, "workspace:write", tenantId);
          const workspace = this.authority.updateWorkspace(tenantId, integer(request.input.expectedRevision, "expectedRevision"), object(request.input.patch, "patch") as Partial<Omit<WorkspaceProfileV1, "tenantId" | "revision" | "updatedAt">>);
          this.audit(principal, tenantId, "workspace.update", `workspace:${tenantId}`, "accepted", context.correlationId); return { name: request.name, result: workspace };
        }
        case "xp.balance": { const tenantId = text(request.input.tenantId, "tenantId"); this.auth.authorize(context.accessToken, "xp:read", tenantId); const userId = text(request.input.userId, "userId"); return { name: request.name, result: { tenantId, userId, balance: this.authority.getXpBalance(tenantId, userId) } }; }
        case "xp.award": {
          const tenantId = text(request.input.tenantId, "tenantId"); const principal = this.auth.authorize(context.accessToken, "xp:write", tenantId);
          const result = this.authority.awardXp({ tenantId, userId: text(request.input.userId, "userId"), delta: integer(request.input.delta, "delta"), sourceAppId: principal.actorId, reason: text(request.input.reason, "reason"), idempotencyKey: text(request.input.idempotencyKey, "idempotencyKey") });
          this.audit(principal, tenantId, "xp.award", `xp:${result.value.id}`, result.duplicate ? "duplicate" : "accepted", context.correlationId); return { name: request.name, result: { duplicate: result.duplicate, event: result.value } };
        }
        case "events.publish": {
          const tenantId = text(request.input.tenantId, "tenantId"); const principal = this.auth.authorize(context.accessToken, "events:write", tenantId);
          const result = this.authority.publishEvent({ tenantId, sourceAppId: principal.actorId, type: text(request.input.type, "type"), payload: object(request.input.payload, "payload"), idempotencyKey: text(request.input.idempotencyKey, "idempotencyKey") });
          this.audit(principal, tenantId, "events.publish", `event:${result.value.id}`, result.duplicate ? "duplicate" : "accepted", context.correlationId); return { name: request.name, result: { duplicate: result.duplicate, event: result.value } };
        }
        case "apps.list": { this.auth.authorize(context.accessToken, "apps:read"); return { name: request.name, result: this.requireControl().listApps() }; }
        case "apps.get": { this.auth.authorize(context.accessToken, "apps:read"); return { name: request.name, result: this.requireControl().getApp(text(request.input.appId, "appId")) }; }
        case "apps.install": {
          const tenantId = text(request.input.tenantId, "tenantId"); const principal = this.auth.authorize(context.accessToken, "apps:install", tenantId);
          const rawScopes = request.input.grantedScopes; const grantedScopes = rawScopes === undefined ? undefined : stringArray(rawScopes, "grantedScopes");
          const install = this.requireControl().installApp(tenantId, text(request.input.appId, "appId"), grantedScopes);
          this.audit(principal, tenantId, "apps.install", `app:${install.appId}`, "accepted", context.correlationId); return { name: request.name, result: install };
        }
        case "apps.disable": { const tenantId = text(request.input.tenantId, "tenantId"); const principal = this.auth.authorize(context.accessToken, "apps:install", tenantId); const install = this.requireControl().disableApp(tenantId, text(request.input.appId, "appId")); this.audit(principal, tenantId, "apps.disable", `app:${install.appId}`, "accepted", context.correlationId); return { name: request.name, result: install }; }
        case "apps.installs": { const tenantId = text(request.input.tenantId, "tenantId"); this.auth.authorize(context.accessToken, "apps:read", tenantId); return { name: request.name, result: this.requireControl().listInstalls(tenantId) }; }
        case "apps.entitlements": { const tenantId = text(request.input.tenantId, "tenantId"); this.auth.authorize(context.accessToken, "entitlements:read", tenantId); return { name: request.name, result: this.requireControl().listEntitlements(tenantId, request.input.appId === undefined ? undefined : text(request.input.appId, "appId")) }; }
      }
    } catch (error) {
      if (error instanceof PlatformOperationError) throw error;
      if (error instanceof AuthDeniedError) throw new PlatformOperationError("unauthorized", error.message);
      if (error instanceof AuthorityConflictError || error instanceof ControlConflictError) throw new PlatformOperationError("conflict", error.message);
      if (error instanceof ControlNotFoundError) throw new PlatformOperationError("not_found", error.message);
      if (error instanceof AuthorityValidationError || error instanceof ControlValidationError) throw new PlatformOperationError("invalid", error.message);
      if (error instanceof Error) throw new PlatformOperationError("invalid", error.message);
      throw error;
    }
  }

  private requireControl() { if (!this.control) throw new PlatformOperationError("invalid", "Control service is not configured"); return this.control; }
  private audit(principal: AuthPrincipalV1, tenantId: string, action: string, target: string, outcome: "accepted" | "duplicate", correlationId?: string) { this.authority.audit({ tenantId, actorType: principal.actorType, actorId: principal.actorId, action, target, outcome, ...(correlationId ? { correlationId } : {}) }); }
}

function publicPrincipal(principal: AuthPrincipalV1) { return { actorType: principal.actorType, actorId: principal.actorId, scopes: principal.scopes, tenantMode: principal.tenantMode, tenantIds: principal.tenantIds }; }
function text(value: unknown, name: string) { if (typeof value !== "string" || !value.trim() || value.length > 500) throw new PlatformOperationError("invalid", `${name} must be a non-empty string`); return value; }
function integer(value: unknown, name: string) { if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new PlatformOperationError("invalid", `${name} must be a safe integer`); return value; }
function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformOperationError("invalid", `${name} must be an object`); return value as Record<string, unknown>; }
function stringArray(value: unknown, name: string) { if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new PlatformOperationError("invalid", `${name} must be an array of strings`); return value as string[]; }
