import type { ChatProviderV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import { grandfatherProviderIdentity, resolveProviderIdentity } from "@spmt/sdk/provider-identity";

export interface StreamWeaverProviderIdentityInputV1 {
  tenantId: string;
  provider: ChatProviderV1;
  providerUserId: string;
  username: string;
  displayName?: string;
}

/**
 * Resolve the provider actor through SPMT. Discord/Twitch can be grandfathered
 * by the scoped StreamWeaver service when no active link exists. Kick has no
 * production grandfather contract and therefore stays provider-scoped until a
 * canonical SPMT link arrives through another verified path.
 */
export class StreamWeaverSpmtIdentityResolver {
  constructor(private readonly client: SpmtClient) {}

  async resolve(input: StreamWeaverProviderIdentityInputV1): Promise<string | undefined> {
    if (input.provider !== "discord" && input.provider !== "twitch") return undefined;
    try {
      return (await resolveProviderIdentity(this.client, input.tenantId, input.provider, input.providerUserId)).userId;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const created = await grandfatherProviderIdentity(this.client, input.tenantId, {
      provider: input.provider,
      providerUserId: input.providerUserId,
      providerUsername: input.username,
      ...(input.displayName ? { displayName: input.displayName } : {}),
    });
    return created.userId;
  }
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status?: unknown }).status === 404);
}
