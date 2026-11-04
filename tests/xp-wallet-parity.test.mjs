import test from "node:test";
import assert from "node:assert/strict";
import { AuthorityConflictError, AuthorityService, MemoryAuthorityStore } from "../packages/authority-core/dist/index.js";

function fixture() {
  let id = 0;
  const authority = new AuthorityService({
    store: new MemoryAuthorityStore(),
    now: () => "2026-08-24T18:00:00.000Z",
    idFactory: (prefix) => `${prefix}-${++id}`,
  });
  for (const userId of ["captain", "crewmate", "rival"]) authority.ensureUser(userId);
  return authority;
}

function award(authority, userId, delta, key, metadata = {}) {
  return authority.awardXp({
    tenantId: "tenant-1",
    userId,
    delta,
    sourceAppId: "discord-stream-hub",
    reason: "production-parity",
    eventType: "dsh.points",
    idempotencyKey: key,
    metadata,
  });
}

test("dual wallet preserves spendable XP while lifetime XP only grows from eligible positive awards", () => {
  const authority = fixture();
  award(authority, "captain", 100, "award-100");
  assert.deepEqual(authority.getXpWallet("tenant-1", "captain"), {
    tenantId: "tenant-1",
    userId: "captain",
    spendableXp: 100,
    currentXp: 100,
    lifetimeXp: 100,
    totalXp: 100,
    rank: 1,
    level: 2,
  });

  const spend = authority.spendXp({
    tenantId: "tenant-1",
    userId: "captain",
    amount: 40,
    sourceAppId: "discord-stream-hub",
    eventType: "shop-purchase",
    idempotencyKey: "spend-40",
  });
  assert.equal(spend.spent, true);
  assert.equal(spend.wallet.spendableXp, 60);
  assert.equal(spend.wallet.lifetimeXp, 100);
  assert.equal(spend.event.metadata.lifetimeEligible, false);
  assert.equal(spend.event.metadata.walletAction, "spend");

  const replay = authority.spendXp({
    tenantId: "tenant-1",
    userId: "captain",
    amount: 40,
    sourceAppId: "discord-stream-hub",
    eventType: "shop-purchase",
    idempotencyKey: "spend-40",
  });
  assert.equal(replay.spent, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.wallet.spendableXp, 60);
});

test("transfers are atomic, replay safe, and never inflate lifetime XP", () => {
  const authority = fixture();
  award(authority, "captain", 100, "award-100");
  const transfer = authority.transferXp({
    tenantId: "tenant-1",
    fromUserId: "captain",
    toUserId: "crewmate",
    amount: 25,
    sourceAppId: "discord-stream-hub",
    eventType: "community-transfer",
    idempotencyKey: "transfer-1",
  });
  assert.equal(transfer.transferred, true);
  assert.equal(transfer.from.spendableXp, 75);
  assert.equal(transfer.from.lifetimeXp, 100);
  assert.equal(transfer.to.spendableXp, 25);
  assert.equal(transfer.to.lifetimeXp, 0);

  const replay = authority.transferXp({
    tenantId: "tenant-1",
    fromUserId: "captain",
    toUserId: "crewmate",
    amount: 25,
    sourceAppId: "discord-stream-hub",
    eventType: "community-transfer",
    idempotencyKey: "transfer-1",
  });
  assert.equal(replay.transferred, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.from.spendableXp, 75);
  assert.equal(replay.to.spendableXp, 25);

  assert.throws(() => authority.transferXp({
    tenantId: "tenant-1",
    fromUserId: "crewmate",
    toUserId: "rival",
    amount: 50,
    sourceAppId: "discord-stream-hub",
    eventType: "community-transfer",
    idempotencyKey: "transfer-too-large",
  }), AuthorityConflictError);
  assert.equal(authority.getXpWallet("tenant-1", "crewmate").spendableXp, 25);
  assert.equal(authority.getXpWallet("tenant-1", "rival").spendableXp, 0);
});

test("gamble settlement preserves donor refill, compression, matched-growth and replay semantics", () => {
  const authority = fixture();
  award(authority, "captain", 100, "award-100");
  authority.spendXp({
    tenantId: "tenant-1",
    userId: "captain",
    amount: 60,
    sourceAppId: "discord-stream-hub",
    eventType: "prior-spend",
    idempotencyKey: "prior-spend",
  });

  const settlement = authority.settleXpGamble({
    tenantId: "tenant-1",
    userId: "captain",
    wager: 20,
    payout: 100,
    sourceAppId: "discord-stream-hub",
    eventType: "gamble",
    idempotencyKey: "gamble-1",
    metadata: { game: "dice" },
  });
  assert.equal(settlement.settled, true);
  assert.equal(settlement.duplicate, false);
  assert.equal(settlement.before.spendableXp, 40);
  assert.equal(settlement.before.lifetimeXp, 100);
  assert.equal(settlement.refill, 80);
  assert.equal(settlement.overflow, 20);
  assert.equal(settlement.compressed, 2);
  assert.equal(settlement.matchedGrowth, 1);
  assert.equal(settlement.discardedOverflow, 18);
  assert.equal(settlement.wallet.spendableXp, 101);
  assert.equal(settlement.wallet.lifetimeXp, 101);

  const replay = authority.settleXpGamble({
    tenantId: "tenant-1",
    userId: "captain",
    wager: 20,
    payout: 100,
    sourceAppId: "discord-stream-hub",
    eventType: "gamble",
    idempotencyKey: "gamble-1",
  });
  assert.equal(replay.settled, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.wallet.spendableXp, 101);
  assert.equal(replay.wallet.lifetimeXp, 101);
});

test("leaderboard ranks lifetime growth instead of temporary spendable wallet balance", () => {
  const authority = fixture();
  award(authority, "captain", 100, "captain-100");
  authority.spendXp({ tenantId: "tenant-1", userId: "captain", amount: 95, sourceAppId: "streamweaver", eventType: "redeem", idempotencyKey: "captain-spend" });
  award(authority, "rival", 60, "rival-60");
  award(authority, "crewmate", 500, "crewmate-wallet-only", { lifetimeEligible: false });

  const board = authority.getXpLeaderboard("tenant-1", 10);
  assert.deepEqual(board.map((entry) => [entry.rank, entry.userId, entry.spendableXp, entry.lifetimeXp]), [
    [1, "captain", 5, 100],
    [2, "rival", 60, 60],
    [3, "crewmate", 500, 0],
  ]);
  assert.equal(authority.getXpWallet("tenant-1", "captain").rank, 1);
  assert.equal(authority.getXpLedger("tenant-1", "captain", 10).length, 2);
});
