import type { SpmtClient } from "@spmt/sdk";
import { grandfatherProviderIdentity, resolveProviderIdentity, type SpmtProviderIdentityKindV1 } from "@spmt/sdk/provider-identity";

export interface DshProviderIdentityInputV1 {
  tenantId: string;
  provider: SpmtProviderIdentityKindV1;
  providerUserId: string;
  username?: string;
  displayName?: string;
}

/**
 * DSH no longer owns a provider-account table. Immutable Discord/Twitch ids are
 * resolved through SPMT and, for a verified community observation, can be
 * grandfathered through the DSH service identity.
 */
export class DshSpmtIdentityResolver {
  constructor(private readonly client: SpmtClient) {}

  async resolveOrGrandfather(input: DshProviderIdentityInputV1) {
    try {
      return await resolveProviderIdentity(this.client, input.tenantId, input.provider, input.providerUserId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    return grandfatherProviderIdentity(this.client, input.tenantId, {
      provider: input.provider,
      providerUserId: input.providerUserId,
      ...(input.username ? { providerUsername: input.username } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
    });
  }
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status?: unknown }).status === 404);
}
