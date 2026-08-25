import { SpmtClient, buildXpIdempotencyKey, mappedXpAwardV1, type XpMappedEventTypeV1 } from "@spmt/sdk";

export type DshPointsEventType =
  | "raid"
  | "follow"
  | "subscription"
  | "gifted_subscription"
  | "bits"
  | "chat_activity"
  | "first_message"
  | "message_reaction"
  | "admin_calendar_event"
  | "admin_captains_log"
  | "admin_message";

export type DshPointsSource = "twitch" | "discord" | "manual";

export interface DshLeaderboardSettingsV1 {
  raidPoints: number;
  followPoints: number;
  subPoints: number;
  giftedSubPoints: number;
  bitPoints: number;
  chatActivityPoints: number;
  firstMessagePoints: number;
  messageReactionPoints: number;
  adminEventPoints: number;
  adminLogPoints: number;
  adminMessagePoints: number;
}

export const DEFAULT_DSH_LEADERBOARD_SETTINGS: DshLeaderboardSettingsV1 = {
  raidPoints: 10,
  followPoints: 5,
  subPoints: 50,
  giftedSubPoints: 25,
  bitPoints: 1,
  chatActivityPoints: 1,
  firstMessagePoints: 5,
  messageReactionPoints: 1,
  adminEventPoints: 10,
  adminLogPoints: 5,
  adminMessagePoints: 1,
};

const EVENT_TO_SETTING_KEY: Record<DshPointsEventType, keyof DshLeaderboardSettingsV1> = {
  raid: "raidPoints",
  follow: "followPoints",
  subscription: "subPoints",
  gifted_subscription: "giftedSubPoints",
  bits: "bitPoints",
  chat_activity: "chatActivityPoints",
  first_message: "firstMessagePoints",
  message_reaction: "messageReactionPoints",
  admin_calendar_event: "adminEventPoints",
  admin_captains_log: "adminLogPoints",
  admin_message: "adminMessagePoints",
};

const DSH_XP_EVENT_MAP: Partial<Record<DshPointsEventType, XpMappedEventTypeV1>> = {
  chat_activity: "dsh.discord.message",
  follow: "dsh.twitch.follow",
  raid: "dsh.twitch.raid",
  subscription: "dsh.twitch.sub",
  gifted_subscription: "dsh.twitch.sub",
};

export interface DshPointsSettingsProviderV1 {
  getSettings(tenantId: string): Promise<Partial<DshLeaderboardSettingsV1> | undefined> | Partial<DshLeaderboardSettingsV1> | undefined;
}

export interface DshAwardPointsInputV1 {
  userId: string;
  eventType: DshPointsEventType;
  upstreamEventId: string;
  quantity?: number;
  source?: DshPointsSource;
  metadata?: Record<string, unknown>;
}

export interface DshTenantBalanceV1 {
  tenantId: string;
  spendableXp: number;
  currentXp: number;
  lifetimeXp: number;
  totalXp: number;
  rank: number;
  level: number;
  currentTenant: boolean;
}

/**
 * DSH keeps its event-to-points rules. SPMT owns the wallet, ledger and rank.
 * userId is always the canonical SPMT user id; provider identity resolution happens before this boundary.
 */
export class DshPointsService {
  constructor(private readonly client: SpmtClient, private readonly tenantId: string, private readonly settingsProvider?: DshPointsSettingsProviderV1) {}

  async settings(): Promise<DshLeaderboardSettingsV1> {
    const configured = await this.settingsProvider?.getSettings(this.tenantId);
    return { ...DEFAULT_DSH_LEADERBOARD_SETTINGS, ...(configured ?? {}) };
  }

  async awardPoints(input: DshAwardPointsInputV1) {
    const settings = await this.settings();
    const pointsAwarded = calculateDshPoints(input.eventType, input.quantity ?? 1, settings);
    if (!pointsAwarded) return { pointsAwarded: 0, settingsSnapshot: settings, wallet: await this.client.getXpWallet(this.tenantId, input.userId) };

    const source = input.source ?? "manual";
    const metadata = {
      schemaVersion: 1 as const,
      tenantId: this.tenantId,
      source,
      pointsEventType: input.eventType,
      upstreamEventId: input.upstreamEventId,
      ...(input.metadata ?? {}),
      ...(source === "manual" ? { lifetimeEligible: false } : {}),
    };
    const isTwitchMessage = input.eventType === "chat_activity" && source === "twitch";
    const isTwitchBits = input.eventType === "bits" && source === "twitch";
    const mappedEventType = DSH_XP_EVENT_MAP[input.eventType];
    const customEventType = isTwitchMessage ? "dsh-twitch-message" : isTwitchBits ? "dsh-twitch-bits" : mappedEventType ? undefined : `dsh-${input.eventType.replaceAll("_", "-")}`;

    if (customEventType) {
      const idempotencyKey = buildXpIdempotencyKey({ sourceApp: "discord-stream-hub", eventType: customEventType, upstreamEventId: input.upstreamEventId, userId: input.userId });
      await this.client.awardXp(this.tenantId, input.userId, pointsAwarded, customEventType, idempotencyKey, { eventType: customEventType, metadata });
    } else if (mappedEventType) {
      const award = mappedXpAwardV1({ userId: input.userId, mappedEventType, upstreamEventId: input.upstreamEventId, deltaOverride: pointsAwarded, metadata });
      await this.client.awardXp(this.tenantId, award.userId, award.delta, award.eventType, award.idempotencyKey, { eventType: award.eventType, ...(award.metadata ? { metadata: award.metadata } : {}) });
    }
    return { pointsAwarded, settingsSnapshot: settings, wallet: await this.client.getXpWallet(this.tenantId, input.userId) };
  }

  /** Donor `/points/update` compatibility without restoring a private DSH points authority. */
  updatePoints(input: DshAwardPointsInputV1) { return this.awardPoints(input); }

  getUserPoints(userId: string) { return this.client.getXpWallet(this.tenantId, userId); }
  getUserRank(userId: string) { return this.client.getXpWallet(this.tenantId, userId).then((wallet) => ({ rank: wallet.rank, points: wallet.spendableXp, lifetimeXp: wallet.lifetimeXp, level: wallet.level })); }
  getLeaderboard(limit = 50) { return this.client.getXpLeaderboard(this.tenantId, limit); }
  getLedger(userId: string, limit = 100) { return this.client.listXpLedger(this.tenantId, userId, limit); }

  async getTenantBalances(tenantIds: string[], userId: string, currentTenantId = this.tenantId): Promise<DshTenantBalanceV1[]> {
    const orderedTenantIds = uniqueIds([currentTenantId, ...tenantIds]);
    const balances = await Promise.all(orderedTenantIds.map(async (tenantId) => {
      const wallet = await this.client.getXpWallet(tenantId, userId);
      return {
        tenantId,
        spendableXp: wallet.spendableXp,
        currentXp: wallet.currentXp,
        lifetimeXp: wallet.lifetimeXp,
        totalXp: wallet.totalXp,
        rank: wallet.rank,
        level: wallet.level,
        currentTenant: tenantId === currentTenantId,
      } satisfies DshTenantBalanceV1;
    }));
    return balances
      .filter((item) => item.currentTenant || item.spendableXp > 0 || item.lifetimeXp > 0)
      .sort((a, b) => Number(b.currentTenant) - Number(a.currentTenant) || b.lifetimeXp - a.lifetimeXp || a.tenantId.localeCompare(b.tenantId));
  }

  async addPoints(userId: string, points: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const delta = Math.trunc(Number(points || 0));
    if (!delta) return this.client.getXpWallet(this.tenantId, userId);
    const eventType = "dsh-manual-add";
    const key = buildXpIdempotencyKey({ sourceApp: "discord-stream-hub", eventType, upstreamEventId: operationId, userId });
    if (delta > 0) await this.client.awardXp(this.tenantId, userId, delta, eventType, key, { eventType, metadata: { ...metadata, lifetimeEligible: false, source: "manual" } });
    else {
      const wallet = await this.client.getXpWallet(this.tenantId, userId);
      const amount = Math.min(wallet.spendableXp, Math.abs(delta));
      if (amount) await this.client.spendXp(this.tenantId, userId, amount, eventType, key, { ...metadata, source: "manual" });
    }
    return this.client.getXpWallet(this.tenantId, userId);
  }

  async setPoints(userId: string, points: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const target = Math.max(0, Math.trunc(Number(points || 0)));
    const current = await this.client.getXpWallet(this.tenantId, userId);
    const delta = target - current.spendableXp;
    if (!delta) return current;
    return this.addPoints(userId, delta, `set:${operationId}:${target}`, { ...metadata, action: "set", target });
  }

  transfer(fromUserId: string, toUserId: string, amount: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const eventType = "dsh-points-transfer";
    const key = buildXpIdempotencyKey({ sourceApp: "discord-stream-hub", eventType, upstreamEventId: operationId, userId: `${fromUserId}:${toUserId}` });
    return this.client.transferXp(this.tenantId, fromUserId, toUserId, Math.trunc(amount), eventType, key, metadata);
  }

  settleGamble(userId: string, wager: number, payout: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const eventType = "dsh-gamble-settle";
    const key = buildXpIdempotencyKey({ sourceApp: "discord-stream-hub", eventType, upstreamEventId: operationId, userId });
    return this.client.settleXpGamble(this.tenantId, userId, Math.trunc(wager), Math.trunc(payout), eventType, key, metadata);
  }

  async addPointsToUsers(userIds: string[], points: number, operationId: string) {
    let count = 0;
    for (const userId of uniqueIds(userIds)) { await this.addPoints(userId, points, `${operationId}:${userId}`); count += 1; }
    return { count };
  }

  async setPointsForUsers(userIds: string[], points: number, operationId: string) {
    let count = 0;
    for (const userId of uniqueIds(userIds)) { await this.setPoints(userId, points, `${operationId}:${userId}`); count += 1; }
    return { count };
  }
}

export function calculateDshPoints(eventType: DshPointsEventType, quantity: number, settings: DshLeaderboardSettingsV1): number {
  const baseValue = settings[EVENT_TO_SETTING_KEY[eventType]];
  if (eventType === "bits") return Math.floor(quantity / 100) * baseValue;
  return quantity * baseValue;
}

function uniqueIds(values: string[]) { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }