import assert from "node:assert/strict";
import test from "node:test";
import { DshPointsService, DshPointsEventRouter, calculateDshPoints, DEFAULT_DSH_LEADERBOARD_SETTINGS } from "../apps/discord-stream-hub/dist/index.js";

function wallet(tenantId, userId, spendableXp, lifetimeXp = spendableXp, rank = 1) {
  return { tenantId, userId, spendableXp, currentXp: spendableXp, lifetimeXp, totalXp: lifetimeXp, rank, level: Math.floor(Math.sqrt(lifetimeXp / 100)) + 1 };
}

class FakeSpmtClient {
  constructor() {
    this.wallets = new Map();
    this.awards = [];
    this.spends = [];
    this.transfers = [];
    this.gambles = [];
  }
  key(tenantId, userId) { return `${tenantId}:${userId}`; }
  setWallet(value) { this.wallets.set(this.key(value.tenantId, value.userId), structuredClone(value)); }
  async getXpWallet(tenantId, userId) { return structuredClone(this.wallets.get(this.key(tenantId, userId)) ?? wallet(tenantId, userId, 0, 0, 1)); }
  async getXpLeaderboard(tenantId, limit) { return [...this.wallets.values()].filter((item) => item.tenantId === tenantId).sort((a, b) => b.lifetimeXp - a.lifetimeXp).slice(0, limit).map((item, index) => ({ ...structuredClone(item), rank: index + 1 })); }
  async listXpLedger() { return []; }
  async awardXp(tenantId, userId, delta, reason, idempotencyKey, options = {}) {
    this.awards.push({ tenantId, userId, delta, reason, idempotencyKey, options });
    const before = await this.getXpWallet(tenantId, userId);
    const lifetimeDelta = delta > 0 && options.metadata?.lifetimeEligible !== false ? delta : 0;
    this.setWallet({ ...before, spendableXp: Math.max(0, before.spendableXp + delta), currentXp: Math.max(0, before.currentXp + delta), lifetimeXp: before.lifetimeXp + lifetimeDelta, totalXp: before.totalXp + lifetimeDelta });
    return { duplicate: false, event: { id: idempotencyKey, tenantId, userId, delta } };
  }
  async spendXp(tenantId, userId, amount, eventType, idempotencyKey, metadata) {
    this.spends.push({ tenantId, userId, amount, eventType, idempotencyKey, metadata });
    const before = await this.getXpWallet(tenantId, userId);
    this.setWallet({ ...before, spendableXp: Math.max(0, before.spendableXp - amount), currentXp: Math.max(0, before.currentXp - amount) });
    return { spent: true, duplicate: false, amount, wallet: await this.getXpWallet(tenantId, userId) };
  }
  async transferXp(tenantId, fromUserId, toUserId, amount, eventType, idempotencyKey, metadata) {
    this.transfers.push({ tenantId, fromUserId, toUserId, amount, eventType, idempotencyKey, metadata });
    return { transferred: true, duplicate: false, amount, from: await this.getXpWallet(tenantId, fromUserId), to: await this.getXpWallet(tenantId, toUserId) };
  }
  async settleXpGamble(tenantId, userId, wager, payout, eventType, idempotencyKey, metadata) {
    this.gambles.push({ tenantId, userId, wager, payout, eventType, idempotencyKey, metadata });
    return { settled: true, duplicate: false, wager, payout, refill: 0, overflow: 0, compressed: 0, matchedGrowth: 0, discardedOverflow: 0, before: await this.getXpWallet(tenantId, userId), wallet: await this.getXpWallet(tenantId, userId) };
  }
}

test("DSH donor points table and bits scaling remain intact", () => {
  assert.equal(calculateDshPoints("raid", 1, DEFAULT_DSH_LEADERBOARD_SETTINGS), 10);
  assert.equal(calculateDshPoints("follow", 1, DEFAULT_DSH_LEADERBOARD_SETTINGS), 5);
  assert.equal(calculateDshPoints("subscription", 1, DEFAULT_DSH_LEADERBOARD_SETTINGS), 50);
  assert.equal(calculateDshPoints("gifted_subscription", 4, DEFAULT_DSH_LEADERBOARD_SETTINGS), 100);
  assert.equal(calculateDshPoints("bits", 99, DEFAULT_DSH_LEADERBOARD_SETTINGS), 0);
  assert.equal(calculateDshPoints("bits", 250, DEFAULT_DSH_LEADERBOARD_SETTINGS), 2);
});

test("DSH balance, add, set, rank, leaderboard, bulk, transfer and gamble use the canonical wallet", async () => {
  const client = new FakeSpmtClient();
  client.setWallet(wallet("tenant-a", "user-a", 100, 500, 2));
  client.setWallet(wallet("tenant-a", "user-b", 200, 700, 1));
  const service = new DshPointsService(client, "tenant-a");

  assert.equal((await service.getUserPoints("user-a")).spendableXp, 100);
  assert.deepEqual(await service.getUserRank("user-a"), { rank: 2, points: 100, lifetimeXp: 500, level: wallet("tenant-a", "user-a", 100, 500, 2).level });
  assert.deepEqual((await service.getLeaderboard(50)).map((item) => item.userId), ["user-b", "user-a"]);

  assert.equal((await service.addPoints("user-a", 25, "manual-1")).spendableXp, 125);
  assert.equal((await service.setPoints("user-a", 90, "manual-2")).spendableXp, 90);
  assert.deepEqual(await service.addPointsToUsers(["user-a", "user-b", "user-a"], 10, "bulk-add"), { count: 2 });
  assert.deepEqual(await service.setPointsForUsers(["user-a", "user-b"], 50, "bulk-set"), { count: 2 });

  await service.transfer("user-a", "user-b", 10, "transfer-1");
  await service.settleGamble("user-a", 5, 50, "gamble-1");
  assert.equal(client.transfers.length, 1);
  assert.equal(client.gambles.length, 1);
});

test("DSH tenant-balances preserves current tenant first and hides empty unrelated tenants", async () => {
  const client = new FakeSpmtClient();
  client.setWallet(wallet("tenant-a", "user-a", 25, 100, 3));
  client.setWallet(wallet("tenant-b", "user-a", 60, 200, 1));
  client.setWallet(wallet("tenant-c", "user-a", 0, 0, 1));
  const service = new DshPointsService(client, "tenant-a");
  const balances = await service.getTenantBalances(["tenant-b", "tenant-c", "tenant-a"], "user-a");
  assert.deepEqual(balances.map((item) => item.tenantId), ["tenant-a", "tenant-b"]);
  assert.equal(balances[0].currentTenant, true);
  assert.equal(balances[1].lifetimeXp, 200);
});

test("Discord and Twitch point events canonicalize provider identity before mutating XP", async () => {
  const calls = [];
  const identities = {
    async resolveOrGrandfather(input) { calls.push(input); return { userId: `spmt-${input.providerUserId}`, provider: input.provider, providerUserId: input.providerUserId }; },
  };
  const client = new FakeSpmtClient();
  client.setWallet(wallet("tenant-a", "spmt-123", 0, 0, 1));
  const router = new DshPointsEventRouter(identities, (tenantId) => new DshPointsService(client, tenantId));
  const result = await router.handle({ tenantId: "tenant-a", provider: "discord", providerUserId: "123", eventId: "message-1", eventType: "chat_activity", username: "captain" });
  assert.equal(calls.length, 1);
  assert.equal(result.identity.userId, "spmt-123");
  assert.equal(result.points.pointsAwarded, 1);
  assert.equal(client.awards.length, 1);
  assert.equal(client.awards[0].userId, "spmt-123");
});
