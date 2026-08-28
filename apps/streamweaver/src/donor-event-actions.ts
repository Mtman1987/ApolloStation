import type { SpmtClient } from "@spmt/sdk";

export const STREAMWEAVER_PROVIDER_ACTIVITY = "streamweaver.provider.activity.v1";
export const STREAMWEAVER_DONOR_ACTION_FIRED = "streamweaver.donor.action.fired.v1";
export const STREAMWEAVER_DONOR_EFFECT_REQUESTED = "streamweaver.donor.effect.requested.v1";

export type StreamWeaverProviderV1 = "twitch" | "kick" | "tiktok";
export type StreamWeaverProviderActivityKindV1 =
  | "follow"
  | "subscribe"
  | "resubscribe"
  | "gift-sub"
  | "gift-bomb"
  | "cheer"
  | "raid"
  | "provider-event";

export interface StreamWeaverDonorEventActionV1 {
  id: string;
  name: string;
  module: "event-hooks";
  freezeTier: "official_library" | "internal_only";
  role: "provider-event" | "command-shim" | "support" | "aggregator";
  providers: readonly StreamWeaverProviderV1[];
  activities: readonly StreamWeaverProviderActivityKindV1[];
  donorEffects: readonly ("play-sound" | "execute-code")[];
}

/**
 * Frozen StreamWeaver event-hook inventory from donor commit 387acf70552f9a6a557a83e8804c328245932961.
 * The four command shims remain owned by the donor command runtime; this catalog prevents their action-side identities from disappearing.
 */
export const STREAMWEAVER_DONOR_EVENT_ACTIONS = [
  { id:"054c8dab-34f2-4833-9afe-9f21e2d1ef8a", name:"!raidmessage", module:"event-hooks", freezeTier:"official_library", role:"command-shim", providers:["twitch"], activities:[], donorEffects:[] },
  { id:"2941e0e5-121d-4562-b370-6337a1077f3c", name:"!followage", module:"event-hooks", freezeTier:"official_library", role:"command-shim", providers:["twitch"], activities:[], donorEffects:[] },
  { id:"db80bb77-e35d-47ed-9caa-50941d7bb7eb", name:"!followed", module:"event-hooks", freezeTier:"official_library", role:"command-shim", providers:["twitch"], activities:[], donorEffects:[] },
  { id:"0f1dac70-025f-4005-a317-6071755f2ac6", name:"!followers", module:"event-hooks", freezeTier:"official_library", role:"command-shim", providers:["twitch"], activities:[], donorEffects:[] },
  { id:"09621067-51e9-4f59-a685-fd4f062a3d54", name:"Cheer (Anonymous)", module:"event-hooks", freezeTier:"internal_only", role:"support", providers:["twitch"], activities:["cheer"], donorEffects:[] },
  { id:"72073798-50e2-4706-9aeb-6726a50c7459", name:"Cheer", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["cheer"], donorEffects:[] },
  { id:"1de313a9-a737-4f0d-ae2c-b51054e23065", name:"Currency System • Events", module:"event-hooks", freezeTier:"official_library", role:"aggregator", providers:["twitch","kick","tiktok"], activities:["follow","subscribe","resubscribe","gift-sub","gift-bomb","cheer","raid","provider-event"], donorEffects:[] },
  { id:"b4b64576-1951-4c6e-b567-6c5a5ff584d0", name:"Error - You do not follow", module:"event-hooks", freezeTier:"internal_only", role:"support", providers:["twitch"], activities:[], donorEffects:[] },
  { id:"1ca91c15-f039-46f9-944b-507b5efd6134", name:"Gift Bomb", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["gift-bomb"], donorEffects:[] },
  { id:"f10c2b71-18d9-47f6-a42a-46c2c33ebda5", name:"Gift Sub", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["gift-sub"], donorEffects:[] },
  { id:"6d3145b8-b3dc-4891-840f-1bbfe1a9d043", name:"Kick Events", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["kick"], activities:["follow","subscribe","resubscribe","gift-sub","gift-bomb","cheer","raid","provider-event"], donorEffects:[] },
  { id:"f405aaac-ef49-457b-91d6-c6f1a9078dbe", name:"New Follower", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["follow"], donorEffects:[] },
  { id:"faf6ba97-5b69-4a62-91c5-382321350480", name:"New Subscriber", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["subscribe"], donorEffects:[] },
  { id:"d9bdefa5-4962-4b5a-8b84-b3fa99273d52", name:"Raid", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["raid"], donorEffects:[] },
  { id:"9cc272c1-6053-4231-8b16-f24792423950", name:"Resub", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["resubscribe"], donorEffects:[] },
  { id:"f50e1be9-05d6-4b09-9471-edb1d9191669", name:"super follow", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["follow"], donorEffects:["play-sound","execute-code"] },
  { id:"dfff63c7-a4c8-4b47-b1d8-cf9341feef89", name:"TikTok Events", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["tiktok"], activities:["follow","subscribe","resubscribe","gift-sub","gift-bomb","cheer","raid","provider-event"], donorEffects:[] },
  { id:"sample-welcome", name:"Welcome New Followers", module:"event-hooks", freezeTier:"official_library", role:"provider-event", providers:["twitch"], activities:["follow"], donorEffects:[] },
] as const satisfies readonly StreamWeaverDonorEventActionV1[];

export interface StreamWeaverProviderActivityV1 {
  tenantId: string;
  eventId: string;
  provider: StreamWeaverProviderV1;
  kind: StreamWeaverProviderActivityKindV1;
  occurredAt: string;
  actor: {
    userId?: string;
    providerUserId: string;
    displayName: string;
    anonymous?: boolean;
  };
  target?: { providerUserId?: string; displayName?: string };
  amount?: number;
  count?: number;
  metadata?: Record<string, unknown>;
}

export interface StreamWeaverEventRewardV1 {
  delta: number;
  reason: string;
  eventType: string;
  metadata?: Record<string, unknown>;
}

export interface StreamWeaverEventRewardPolicyV1 {
  resolve(input: StreamWeaverProviderActivityV1): Promise<StreamWeaverEventRewardV1 | undefined> | StreamWeaverEventRewardV1 | undefined;
}

export interface StreamWeaverDonorEffectExecutorV1 {
  execute(input: {
    tenantId: string;
    actionId: string;
    actionName: string;
    effect: "play-sound" | "execute-code";
    activity: StreamWeaverProviderActivityV1;
  }): Promise<void> | void;
}

export interface StreamWeaverEventActionRuntimeOptionsV1 {
  client: Pick<SpmtClient, "publishEvent" | "awardXp">;
  rewardPolicy?: StreamWeaverEventRewardPolicyV1;
  effects?: StreamWeaverDonorEffectExecutorV1;
}

export interface StreamWeaverEventActionExecutionV1 {
  eventId: string;
  actions: Array<{ id: string; name: string; effects: string[] }>;
  reward?: { delta: number; duplicate?: boolean };
}

export class StreamWeaverEventActionRuntime {
  constructor(private readonly options: StreamWeaverEventActionRuntimeOptionsV1) {}

  async ingest(activity: StreamWeaverProviderActivityV1): Promise<StreamWeaverEventActionExecutionV1> {
    validateActivity(activity);
    const normalized = sanitizeActivity(activity);
    await this.options.client.publishEvent(
      normalized.tenantId,
      STREAMWEAVER_PROVIDER_ACTIVITY,
      normalized as unknown as Record<string, unknown>,
      `streamweaver-provider:${normalized.provider}:${normalized.eventId}`,
    );

    const matched = STREAMWEAVER_DONOR_EVENT_ACTIONS.filter((action) =>
      action.role !== "command-shim" &&
      action.activities.includes(normalized.kind as never) &&
      action.providers.includes(normalized.provider as never) &&
      !(action.id === "09621067-51e9-4f59-a685-fd4f062a3d54" && normalized.actor.anonymous !== true) &&
      !(action.id === "72073798-50e2-4706-9aeb-6726a50c7459" && normalized.kind === "cheer" && normalized.actor.anonymous === true)
    );

    const actions: StreamWeaverEventActionExecutionV1["actions"] = [];
    for (const action of matched) {
      await this.options.client.publishEvent(
        normalized.tenantId,
        STREAMWEAVER_DONOR_ACTION_FIRED,
        {
          schemaVersion: 1,
          donorActionId: action.id,
          donorActionName: action.name,
          provider: normalized.provider,
          activityKind: normalized.kind,
          sourceEventId: normalized.eventId,
          actor: normalized.actor,
          occurredAt: normalized.occurredAt,
        },
        `streamweaver-donor-action:${action.id}:${normalized.provider}:${normalized.eventId}`,
      );
      for (const effect of action.donorEffects) {
        await this.options.client.publishEvent(
          normalized.tenantId,
          STREAMWEAVER_DONOR_EFFECT_REQUESTED,
          { schemaVersion: 1, donorActionId: action.id, donorActionName: action.name, effect, sourceEventId: normalized.eventId, provider: normalized.provider },
          `streamweaver-donor-effect:${action.id}:${effect}:${normalized.eventId}`,
        );
        await this.options.effects?.execute({ tenantId: normalized.tenantId, actionId: action.id, actionName: action.name, effect, activity: normalized });
      }
      actions.push({ id: action.id, name: action.name, effects: [...action.donorEffects] });
    }

    const reward = normalized.actor.userId ? await this.options.rewardPolicy?.resolve(normalized) : undefined;
    if (!reward || !normalized.actor.userId || !Number.isSafeInteger(reward.delta) || reward.delta === 0) return { eventId: normalized.eventId, actions };
    const award = await this.options.client.awardXp(
      normalized.tenantId,
      normalized.actor.userId,
      reward.delta,
      reward.reason,
      `streamweaver-provider-xp:${normalized.provider}:${normalized.eventId}:${reward.eventType}`,
      { eventType: reward.eventType, metadata: { provider: normalized.provider, providerEventId: normalized.eventId, activityKind: normalized.kind, ...(reward.metadata ?? {}) } },
    );
    return { eventId: normalized.eventId, actions, reward: { delta: reward.delta, duplicate: Boolean(award.duplicate) } };
  }

  async emitFollowRequiredError(input: { tenantId: string; eventId: string; providerUserId: string; displayName: string }): Promise<void> {
    const action = STREAMWEAVER_DONOR_EVENT_ACTIONS.find((candidate) => candidate.id === "b4b64576-1951-4c6e-b567-6c5a5ff584d0");
    if (!action) throw new Error("Donor follow error action is missing");
    await this.options.client.publishEvent(input.tenantId, STREAMWEAVER_DONOR_ACTION_FIRED, {
      schemaVersion: 1,
      donorActionId: action.id,
      donorActionName: action.name,
      provider: "twitch",
      activityKind: "follow-required",
      sourceEventId: input.eventId,
      actor: { providerUserId: safeId(input.providerUserId, "providerUserId"), displayName: safeText(input.displayName, 120) },
    }, `streamweaver-donor-action:${action.id}:${input.eventId}`);
  }
}

function validateActivity(input: StreamWeaverProviderActivityV1): void {
  safeId(input.tenantId, "tenantId");
  safeId(input.eventId, "eventId");
  safeId(input.actor.providerUserId, "actor.providerUserId");
  safeText(input.actor.displayName, 120);
  if (!(["twitch","kick","tiktok"] as const).includes(input.provider)) throw new Error("Unsupported provider event source");
  if (!(["follow","subscribe","resubscribe","gift-sub","gift-bomb","cheer","raid","provider-event"] as const).includes(input.kind)) throw new Error("Unsupported provider activity kind");
  if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error("Provider event occurredAt is invalid");
  if (input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount < 0)) throw new Error("Provider event amount is invalid");
  if (input.count !== undefined && (!Number.isSafeInteger(input.count) || input.count < 0)) throw new Error("Provider event count is invalid");
}

function sanitizeActivity(input: StreamWeaverProviderActivityV1): StreamWeaverProviderActivityV1 {
  return {
    tenantId: safeId(input.tenantId, "tenantId"),
    eventId: safeId(input.eventId, "eventId"),
    provider: input.provider,
    kind: input.kind,
    occurredAt: new Date(input.occurredAt).toISOString(),
    actor: {
      ...(input.actor.userId ? { userId: safeId(input.actor.userId, "actor.userId") } : {}),
      providerUserId: safeId(input.actor.providerUserId, "actor.providerUserId"),
      displayName: safeText(input.actor.displayName, 120),
      ...(input.actor.anonymous === true ? { anonymous: true } : {}),
    },
    ...(input.target ? { target: { ...(input.target.providerUserId ? { providerUserId: safeId(input.target.providerUserId, "target.providerUserId") } : {}), ...(input.target.displayName ? { displayName: safeText(input.target.displayName, 120) } : {}) } } : {}),
    ...(input.amount === undefined ? {} : { amount: input.amount }),
    ...(input.count === undefined ? {} : { count: input.count }),
    ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
  };
}

function sanitizeMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 50)) {
    if (/token|secret|password|authorization|cookie|key/i.test(key)) continue;
    if (typeof value === "string") output[key.slice(0, 80)] = value.slice(0, 1_000);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) output[key.slice(0, 80)] = value;
  }
  return output;
}
function safeId(value: unknown, field: string): string { const result = String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 180); if (!result) throw new Error(`${field} is required`); return result; }
function safeText(value: unknown, max: number): string { const result = String(value ?? "").trim().slice(0, max); if (!result) throw new Error("Text value is required"); return result; }
