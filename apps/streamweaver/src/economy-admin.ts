import { SpmtClient, buildXpIdempotencyKey } from "@spmt/sdk";

export interface StreamWeaverTenantMemberSourceV1 {
  listCanonicalUserIds(tenantId: string): Promise<string[]> | string[];
}

/**
 * StreamWeaver owns its moderator command semantics; SPMT owns balances.
 * Positive !addpoints retains donor totalEarned behavior. !setpoints and reset only
 * move spendable XP and never rewrite lifetime XP.
 */
export class StreamWeaverAdminEconomy {
  constructor(private readonly client: SpmtClient, private readonly tenantId: string, private readonly members: StreamWeaverTenantMemberSourceV1) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async addPoints(userId: string, deltaInput: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const delta = safeInteger(deltaInput, "delta");
    if (!delta) return this.client.getXpWallet(this.tenantId, userId);
    const eventType = "streamweaver-admin-addpoints";
    const key = buildXpIdempotencyKey({ sourceApp: "streamweaver", eventType, upstreamEventId: operationId, userId });
    if (delta > 0) {
      await this.client.awardXp(this.tenantId, userId, delta, eventType, key, {
        eventType,
        metadata: { ...metadata, command: "!addpoints", lifetimeEligible: true },
      });
    } else {
      const wallet = await this.client.getXpWallet(this.tenantId, userId);
      const amount = Math.min(wallet.spendableXp, Math.abs(delta));
      if (amount > 0) await this.client.spendXp(this.tenantId, userId, amount, eventType, key, { ...metadata, command: "!addpoints" });
    }
    return this.client.getXpWallet(this.tenantId, userId);
  }

  async setPoints(userId: string, targetInput: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const target = Math.max(0, safeInteger(targetInput, "target"));
    const current = await this.client.getXpWallet(this.tenantId, userId);
    const delta = target - current.spendableXp;
    if (!delta) return current;
    const eventType = "streamweaver-admin-setpoints";
    const key = buildXpIdempotencyKey({ sourceApp: "streamweaver", eventType, upstreamEventId: `${operationId}:${target}`, userId });
    if (delta > 0) {
      await this.client.awardXp(this.tenantId, userId, delta, eventType, key, {
        eventType,
        metadata: { ...metadata, command: "!setpoints", target, lifetimeEligible: false },
      });
    } else {
      await this.client.spendXp(this.tenantId, userId, Math.abs(delta), eventType, key, { ...metadata, command: "!setpoints", target });
    }
    return this.client.getXpWallet(this.tenantId, userId);
  }

  async addToAll(delta: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const users = await this.uniqueMembers();
    for (const userId of users) await this.addPoints(userId, delta, `${operationId}:${userId}`, { ...metadata, bulk: true });
    return users.length;
  }

  async setToAll(target: number, operationId: string, metadata: Record<string, unknown> = {}) {
    const users = await this.uniqueMembers();
    for (const userId of users) await this.setPoints(userId, target, `${operationId}:${userId}`, { ...metadata, bulk: true });
    return users.length;
  }

  resetAll(operationId: string, metadata: Record<string, unknown> = {}) {
    return this.setToAll(0, operationId, { ...metadata, command: "!resetallpoints" });
  }

  private async uniqueMembers() {
    const users = await this.members.listCanonicalUserIds(this.tenantId);
    return [...new Set(users.map((value) => String(value).trim()).filter(Boolean))].sort();
  }
}

function safeInteger(value: number, name: string) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > 1_000_000) throw new Error(`${name} must be a safe integer from -1000000 through 1000000`);
  return parsed;
}
