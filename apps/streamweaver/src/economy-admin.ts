import type { StreamWeaverEconomyStoreV1 } from "./economy.js";

export interface StreamWeaverTenantMemberSourceV1 {
  listCanonicalUserIds(tenantId: string): Promise<string[]> | string[];
}

/** StreamWeaver moderator operations mutate only the tenant-owned local currency. */
export class StreamWeaverAdminEconomy {
  constructor(private readonly store: StreamWeaverEconomyStoreV1, private readonly tenantId: string, private readonly members: StreamWeaverTenantMemberSourceV1) {
    if (!tenantId) throw new Error("tenantId is required");
  }

  async addPoints(userId: string, deltaInput: number, _operationId: string, _metadata: Record<string, unknown> = {}) {
    const delta = safeInteger(deltaInput, "delta");
    if (!delta) return this.store.getWallet(this.tenantId, userId);
    return this.store.adjustBalance(this.tenantId, userId, delta, delta > 0);
  }

  async setPoints(userId: string, targetInput: number, _operationId: string, _metadata: Record<string, unknown> = {}) {
    const target = Math.max(0, safeInteger(targetInput, "target"));
    return this.store.setBalance(this.tenantId, userId, target);
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
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > 1_000_000_000_000) throw new Error(`${name} must be a safe integer in the supported local-currency range`);
  return parsed;
}
