import assert from "node:assert/strict";
import test from "node:test";
import {
  STREAMWEAVER_DONOR_REDEEM_ACTIONS,
  STREAMWEAVER_REDEEM_EFFECT_REQUESTED,
  STREAMWEAVER_REDEEM_INVOKED,
  StreamWeaverRedeemRuntime,
  resolveStreamWeaverDonorRedeemAction,
} from "../apps/streamweaver/dist/index.js";

function fixture({ pricing, spendResult } = {}) {
  const published = [];
  const spends = [];
  const client = {
    async publishEvent(tenantId, type, payload, idempotencyKey) {
      published.push({ tenantId, type, payload, idempotencyKey });
      return { duplicate: published.filter((entry) => entry.idempotencyKey === idempotencyKey).length > 1 };
    },
    async spendXp(tenantId, userId, amount, eventType, idempotencyKey, metadata) {
      spends.push({ tenantId, userId, amount, eventType, idempotencyKey, metadata });
      return spendResult ?? { spent: true, duplicate: false, amount, wallet: { spendableXp: 1000 } };
    },
  };
  return { runtime: new StreamWeaverRedeemRuntime({ client, pricing }), published, spends };
}

test("StreamWeaver preserves all 26 frozen redeem-pack action identities with exactly three hidden migration aliases", () => {
  assert.equal(STREAMWEAVER_DONOR_REDEEM_ACTIONS.length, 26);
  assert.equal(STREAMWEAVER_DONOR_REDEEM_ACTIONS.filter((entry) => entry.freezeTier === "official_library").length, 23);
  assert.deepEqual(
    STREAMWEAVER_DONOR_REDEEM_ACTIONS.filter((entry) => entry.migrationAlias).map((entry) => entry.name).sort(),
    ["Currency System • ban in game item (Copy)", "Currency System •sample", "Play Blerps (Copy)"].sort(),
  );
  assert.equal(new Set(STREAMWEAVER_DONOR_REDEEM_ACTIONS.map((entry) => entry.id)).size, 26);
});

test("donor aliases resolve onto one canonical redeem without collapsing uncertain dance variants", () => {
  assert.equal(resolveStreamWeaverDonorRedeemAction("cae578b8-652e-4c0d-949b-1767f9e07d16").canonical, "hydrate");
  assert.equal(resolveStreamWeaverDonorRedeemAction("!hydrate").canonical, "hydrate");
  assert.equal(resolveStreamWeaverDonorRedeemAction("hydrate").canonical, "hydrate");
  assert.equal(resolveStreamWeaverDonorRedeemAction("Currency System • dance party").canonical, "dance-party");
  assert.equal(resolveStreamWeaverDonorRedeemAction("New Dance Parrty").canonical, "new-dance-party");
  assert.equal(resolveStreamWeaverDonorRedeemAction("woop dance party").canonical, "woop-dance-party");
  assert.equal(resolveStreamWeaverDonorRedeemAction("01a4936a-1821-45c0-8530-372397d69dbb").canonical, "blerps");
});

test("XP-funded redeems spend through canonical SPMT authority before emitting one durable effect request", async () => {
  const fx = fixture({ pricing: { resolve({ redeem }) { return { amount: redeem.canonical === "hydrate" ? 150 : 999, eventType: "streamweaver.redeem", reason: "Tenant redeem price", metadata: { priceSource: "tenant" } }; } } });
  const result = await fx.runtime.invoke({
    tenantId: "tenant-1",
    invocationId: "redeem-1",
    action: "!hydrate",
    userId: "user-1",
    funding: { kind: "xp" },
    payload: { message: "water time", access_token: "must-not-leak" },
  });
  assert.equal(result.spentXp, 150);
  assert.equal(fx.spends.length, 1);
  assert.equal(fx.spends[0].idempotencyKey, "streamweaver-redeem-spend:redeem-1");
  assert.equal(fx.spends[0].metadata.canonicalRedeem, "hydrate");
  assert.equal(fx.published.length, 2);
  assert.equal(fx.published[0].type, STREAMWEAVER_REDEEM_INVOKED);
  assert.equal(fx.published[1].type, STREAMWEAVER_REDEEM_EFFECT_REQUESTED);
  assert.equal(fx.published[1].idempotencyKey, "streamweaver-redeem-effect:redeem-1");
  assert.deepEqual(fx.published[1].payload.payload, { message: "water time" });
});

test("provider-funded redeems run the same canonical behavior without double-spending XP", async () => {
  const fx = fixture({ pricing: { resolve() { throw new Error("provider redeem must not consult XP pricing"); } } });
  const result = await fx.runtime.invoke({
    tenantId: "tenant-1",
    invocationId: "twitch-redeem-1",
    action: "Dance Party",
    userId: "user-1",
    funding: { kind: "provider", provider: "twitch", redemptionId: "reward-123" },
    payload: { rewardTitle: "Dance Party" },
  });
  assert.equal(result.canonical, "dance-party");
  assert.equal(result.spentXp, 0);
  assert.equal(fx.spends.length, 0);
  assert.deepEqual(fx.published[1].payload.funding, { kind: "provider", provider: "twitch", redemptionId: "reward-123" });
});

test("XP redeem fails closed when no tenant price is configured", async () => {
  const fx = fixture();
  await assert.rejects(() => fx.runtime.invoke({ tenantId: "tenant-1", invocationId: "unpriced", action: "smoke", userId: "user-1", funding: { kind: "xp" } }), /price is not configured/i);
  assert.equal(fx.spends.length, 0);
  assert.equal(fx.published.length, 0);
});

test("failed SPMT spend never emits the redeem effect", async () => {
  const fx = fixture({
    pricing: { resolve() { return { amount: 100, eventType: "streamweaver.redeem", reason: "Redeem" }; } },
    spendResult: { spent: false, duplicate: false, amount: 100, wallet: { spendableXp: 20 } },
  });
  await assert.rejects(() => fx.runtime.invoke({ tenantId: "tenant-1", invocationId: "poor", action: "stretch", userId: "user-1", funding: { kind: "xp" } }), /did not authorize/);
  assert.equal(fx.published.length, 0);
});

test("retrying an already-spent invocation keeps stable spend and effect idempotency keys", async () => {
  const fx = fixture({
    pricing: { resolve() { return { amount: 75, eventType: "streamweaver.redeem", reason: "Redeem" }; } },
    spendResult: { spent: false, duplicate: true, amount: 75, wallet: { spendableXp: 925 } },
  });
  const result = await fx.runtime.invoke({ tenantId: "tenant-1", invocationId: "retry-1", action: "drop-it", userId: "user-1", funding: { kind: "xp" } });
  assert.equal(result.duplicateSpend, true);
  assert.equal(fx.spends[0].idempotencyKey, "streamweaver-redeem-spend:retry-1");
  assert.equal(fx.published[1].idempotencyKey, "streamweaver-redeem-effect:retry-1");
});

test("hidden Currency sample is preserved for migration evidence but cannot execute", async () => {
  const fx = fixture();
  assert.equal(resolveStreamWeaverDonorRedeemAction("2772f073-af91-4925-94cc-4a33050c35da").canonical, "sample");
  await assert.rejects(() => fx.runtime.invoke({ tenantId: "tenant-1", invocationId: "sample-1", action: "2772f073-af91-4925-94cc-4a33050c35da", funding: { kind: "system", sourceEventId: "migration" } }), /migration-only/);
  assert.equal(fx.published.length, 0);
});
