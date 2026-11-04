import type { DshPointsEventType, DshPointsSource, DshPointsService } from "./points.js";
import type { DshSpmtIdentityResolver } from "./provider-identity.js";

export type DshProviderPointsEventV1 = {
  tenantId: string;
  provider: "discord" | "twitch";
  providerUserId: string;
  username?: string;
  displayName?: string;
  eventId: string;
  eventType: Extract<DshPointsEventType, "raid" | "follow" | "subscription" | "gifted_subscription" | "bits" | "chat_activity" | "first_message" | "message_reaction">;
  quantity?: number;
  metadata?: Record<string, unknown>;
};

/**
 * One ingress for all Discord/Twitch point-producing observations. Provider
 * identity is canonicalized first, then DSH applies its donor point rule, then
 * SPMT owns the resulting ledger mutation.
 */
export class DshPointsEventRouter {
  constructor(private readonly identities: DshSpmtIdentityResolver, private readonly pointsForTenant: (tenantId: string) => DshPointsService) {}

  async handle(event: DshProviderPointsEventV1) {
    if (!event.eventId?.trim()) throw new Error("DSH point eventId is required for idempotency");
    if (!event.providerUserId?.trim()) throw new Error("DSH providerUserId is required");
    const identity = await this.identities.resolveOrGrandfather({
      tenantId: event.tenantId,
      provider: event.provider,
      providerUserId: event.providerUserId,
      ...(event.username ? { username: event.username } : {}),
      ...(event.displayName ? { displayName: event.displayName } : {}),
    });
    const source: DshPointsSource = event.provider;
    const points = this.pointsForTenant(event.tenantId);
    const result = await points.awardPoints({
      userId: identity.userId,
      eventType: event.eventType,
      upstreamEventId: event.eventId,
      ...(event.quantity === undefined ? {} : { quantity: event.quantity }),
      source,
      metadata: {
        provider: event.provider,
        providerUserId: event.providerUserId,
        ...(event.metadata ?? {}),
      },
    });
    return { identity, points: result };
  }
}
