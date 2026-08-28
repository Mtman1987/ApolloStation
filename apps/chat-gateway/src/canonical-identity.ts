import type { NormalizedChatMessageV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import { resolveProviderIdentity } from "@spmt/sdk/provider-identity";

export interface ChatGatewayIdentityResolverV1 {
  resolve(input: {
    tenantId: string;
    provider: NormalizedChatMessageV1["provider"];
    providerUserId: string;
  }): Promise<string | undefined> | string | undefined;
}

/** Resolve only existing canonical SPMT provider links. The shared gateway does
 * not create users from passive chat observations. */
export class SpmtChatGatewayIdentityResolver implements ChatGatewayIdentityResolverV1 {
  constructor(private readonly client: SpmtClient) {}
  async resolve(input: { tenantId: string; provider: NormalizedChatMessageV1["provider"]; providerUserId: string }) {
    if (input.provider !== "discord" && input.provider !== "twitch") return undefined;
    try {
      return (await resolveProviderIdentity(this.client, input.tenantId, input.provider, input.providerUserId)).userId;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
}

export class CanonicalizingChatIngress {
  constructor(
    private readonly downstream: { ingest(message: NormalizedChatMessageV1): unknown },
    private readonly identities: ChatGatewayIdentityResolverV1,
  ) {}

  async ingest(message: NormalizedChatMessageV1) {
    const actorCanonical = message.actor.canonicalUserId ?? await this.identities.resolve({
      tenantId: message.tenantId,
      provider: message.provider,
      providerUserId: message.actor.providerUserId,
    });
    const mentions = await Promise.all(message.mentions.map(async (mention) => {
      if (mention.canonicalUserId) return mention;
      const canonicalUserId = await this.identities.resolve({
        tenantId: message.tenantId,
        provider: message.provider,
        providerUserId: mention.providerUserId,
      });
      return canonicalUserId ? { ...mention, canonicalUserId } : mention;
    }));
    return this.downstream.ingest({
      ...message,
      actor: actorCanonical ? { ...message.actor, canonicalUserId: actorCanonical } : message.actor,
      mentions,
    });
  }
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status?: unknown }).status === 404);
}
