import type { ChatProviderV1 } from "@spmt/contracts";
import { SpmtApiError, type SpmtClient } from "@spmt/sdk";
import type { ProviderConnectionConfigV1, ProviderGrantResultV1, ProviderGrantSourceV1 } from "./connection-supervisor.js";

export interface SpmtChatProviderGrantSourceOptionsV1 {
  capabilityId?: string;
  ttlSeconds?: number;
  requiredScopes?: Partial<Record<ChatProviderV1, string[]>>;
}

const DEFAULT_SCOPES: Record<ChatProviderV1, string[]> = {
  twitch: ["chat:edit", "chat:read"],
  discord: ["gateway", "messages:write"],
  kick: ["chat:read", "chat:write"],
};

/** Chat Gateway receives access grants only; refresh credentials stay in SPMT. */
export class SpmtChatProviderGrantSource implements ProviderGrantSourceV1 {
  private readonly capabilityId: string;
  private readonly ttlSeconds: number;
  private readonly scopes: Record<ChatProviderV1, string[]>;
  constructor(private readonly client: SpmtClient, options: SpmtChatProviderGrantSourceOptionsV1 = {}) {
    this.capabilityId = options.capabilityId ?? "provider-chat";
    this.ttlSeconds = options.ttlSeconds ?? 300;
    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds < 30 || this.ttlSeconds > 900) throw new Error("Provider grant TTL is invalid");
    this.scopes = { twitch: [...(options.requiredScopes?.twitch ?? DEFAULT_SCOPES.twitch)], discord: [...(options.requiredScopes?.discord ?? DEFAULT_SCOPES.discord)], kick: [...(options.requiredScopes?.kick ?? DEFAULT_SCOPES.kick)] };
  }
  async getGrant(connection: ProviderConnectionConfigV1): Promise<ProviderGrantResultV1> {
    try {
      const grant = await this.client.issueProviderGrant(connection.tenantId, connection.provider, connection.providerAccountId, this.capabilityId, this.scopes[connection.provider], this.ttlSeconds);
      return { status: "ready", accessToken: grant.credential.accessToken, expiresAt: grant.expiresAt, metadata: grant.credential.metadata };
    } catch (error) {
      if (error instanceof SpmtApiError && error.status === 503) return { status: "unavailable", reason: "SPMT could not issue a current provider grant" };
      if (error instanceof SpmtApiError && error.status === 403) return { status: "reauthorization-required", reason: "The provider grant is no longer authorized for Chat Gateway" };
      throw error;
    }
  }
  async recoverAuthentication(connection: ProviderConnectionConfigV1, reason: string): Promise<ProviderGrantResultV1> {
    try {
      const recovery = await this.client.recoverProviderCredential(connection.tenantId, connection.provider, connection.providerAccountId, safeReason(reason));
      if (recovery.status === "reauthorization-required") return { status: "reauthorization-required", reason: recovery.reason ?? "Provider reauthorization is required" };
      if (recovery.status === "unavailable") return { status: "unavailable", reason: recovery.reason ?? "Provider refresh is temporarily unavailable" };
      return this.getGrant(connection);
    } catch (error) {
      if (error instanceof SpmtApiError && error.status === 503) return { status: "unavailable", reason: "SPMT provider refresh is temporarily unavailable" };
      if (error instanceof SpmtApiError && error.status === 403) return { status: "reauthorization-required", reason: "Provider refresh is not authorized" };
      throw error;
    }
  }
}

function safeReason(value: string): string { return value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 500); }
