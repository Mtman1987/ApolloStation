import { AuthDeniedError, AuthService } from "@spmt/auth-core";
import type { AccountRecoveryService, GrandfatherProviderV1 } from "./index.js";

export const PROVIDER_IDENTITY_OPERATION_NAMES = ["identity.provider.resolve", "identity.provider.grandfather"] as const;
export type ProviderIdentityOperationNameV1 = (typeof PROVIDER_IDENTITY_OPERATION_NAMES)[number];
export interface ProviderIdentityOperationRequestV1 { name: ProviderIdentityOperationNameV1; input: Record<string, unknown>; }
export interface ProviderIdentityOperationContextV1 { accessToken: string; }
export class ProviderIdentityOperationError extends Error {
  constructor(public readonly code: "unauthorized" | "invalid" | "not_found", message: string) { super(message); this.name = "ProviderIdentityOperationError"; }
}

/**
 * Public, scope-checked boundary for immutable Discord/Twitch -> SPMT identity resolution.
 * The caller app identity comes only from the access token; callers cannot spoof sourceAppId.
 */
export class ProviderIdentityOperations {
  constructor(private readonly auth: AuthService, private readonly accounts: AccountRecoveryService) {}

  execute(request: ProviderIdentityOperationRequestV1, context: ProviderIdentityOperationContextV1) {
    try {
      const tenantId = text(request.input.tenantId, "tenantId");
      if (request.name === "identity.provider.resolve") {
        this.auth.authorize(context.accessToken, "identity:read", tenantId);
        const value = this.accounts.resolveProviderIdentity(provider(request.input.provider), text(request.input.providerUserId, "providerUserId"));
        if (!value) throw new ProviderIdentityOperationError("not_found", "Provider identity is not linked to an active SPMT user");
        return value;
      }
      const principal = this.auth.authorize(context.accessToken, "identity:write", tenantId);
      if (principal.actorType !== "service") throw new AuthDeniedError("Only an authenticated app service may grandfather provider identities");
      return this.accounts.grandfatherProviderIdentity({
        sourceAppId: principal.actorId,
        provider: provider(request.input.provider),
        providerUserId: text(request.input.providerUserId, "providerUserId"),
        ...(request.input.providerUsername === undefined ? {} : { providerUsername: text(request.input.providerUsername, "providerUsername") }),
        ...(request.input.username === undefined ? {} : { username: text(request.input.username, "username") }),
        ...(request.input.displayName === undefined ? {} : { displayName: text(request.input.displayName, "displayName") }),
      });
    } catch (error) {
      if (error instanceof ProviderIdentityOperationError) throw error;
      if (error instanceof AuthDeniedError) throw new ProviderIdentityOperationError("unauthorized", error.message);
      if (error instanceof Error) throw new ProviderIdentityOperationError("invalid", error.message);
      throw error;
    }
  }
}

function provider(value: unknown): GrandfatherProviderV1 {
  if (value !== "discord" && value !== "twitch") throw new ProviderIdentityOperationError("invalid", "provider must be discord or twitch");
  return value;
}
function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new ProviderIdentityOperationError("invalid", `${name} must be a non-empty string`);
  return value.trim();
}
