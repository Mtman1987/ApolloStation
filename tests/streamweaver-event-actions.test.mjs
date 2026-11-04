import assert from "node:assert/strict";
import test from "node:test";
import {
  STREAMWEAVER_DONOR_ACTION_FIRED,
  STREAMWEAVER_DONOR_EFFECT_REQUESTED,
  STREAMWEAVER_DONOR_EVENT_ACTIONS,
  STREAMWEAVER_PROVIDER_ACTIVITY,
  StreamWeaverEventActionRuntime,
} from "../apps/streamweaver/dist/index.js";

function fixture({ rewardPolicy, effects } = {}) {
  const published = [];
  const awards = [];
  const client = {
    async publishEvent(tenantId, type, payload, idempotencyKey) {
      published.push({ tenantId, type, payload, idempotencyKey });
      return { id: `event-${published.length}` };
    },
    async awardXp(tenantId, userId, delta, reason, idempotencyKey, options) {
      awards.push({ tenantId, userId, delta, reason, idempotencyKey, options });
      return { duplicate: false, event: { id: `xp-${awards.length}` } };
    },
  };
  return { runtime: new StreamWeaverEventActionRuntime({ client, rewardPolicy, effects }), published, awards };
}

function activity(kind, overrides = {}) {
  return {
    tenantId: "tenant-1",
    eventId: `evt-${kind}`,
    provider: "twitch",
    kind,
    occurredAt: "2026-08-25T04:30:00.000Z",
    actor: { userId: "user-1", providerUserId: "tw-1", displayName: "Viewer" },
    ...overrides,
  };
}

test("StreamWeaver preserves all 18 frozen event-hook action identities while leaving four command shims to the command runtime", () => {
  assert.equal(STREAMWEAVER_DONOR_EVENT_ACTIONS.length, 18);
  const shims = STREAMWEAVER_DONOR_EVENT_ACTIONS.filter((action) => action.role === "command-shim");
  assert.deepEqual(shims.map((action) => action.name).sort(), ["!followage", "!followed", "!followers", "!raidmessage"]);
  assert.equal(STREAMWEAVER_DONOR_EVENT_ACTIONS.some((action) => action.id === "f50e1be9-05d6-4b09-9471-edb1d9191669" && action.name === "super follow"), true);
});

test("a Twitch follow preserves New Follower, super follow, welcome, and currency-event action identities", async () => {
  const effects = [];
  const fx = fixture({ effects: { async execute(input) { effects.push(input); } } });
  const result = await fx.runtime.ingest(activity("follow"));
  assert.deepEqual(result.actions.map((action) => action.name).sort(), ["Currency System • Events", "New Follower", "Welcome New Followers", "super follow"].sort());
  assert.equal(fx.published[0].type, STREAMWEAVER_PROVIDER_ACTIVITY);
  const actionEvents = fx.published.filter((entry) => entry.type === STREAMWEAVER_DONOR_ACTION_FIRED);
  assert.equal(actionEvents.length, 4);
  assert.deepEqual(effects.map((effect) => effect.effect).sort(), ["execute-code", "play-sound"]);
  assert.equal(fx.published.filter((entry) => entry.type === STREAMWEAVER_DONOR_EFFECT_REQUESTED).length, 2);
});

test("anonymous and named Twitch cheers keep the donor anonymous split", async () => {
  const anonymous = fixture();
  const anonymousResult = await anonymous.runtime.ingest(activity("cheer", { eventId: "cheer-anon", actor: { providerUserId: "anon", displayName: "Anonymous", anonymous: true }, amount: 100 }));
  assert.deepEqual(anonymousResult.actions.map((action) => action.name).sort(), ["Cheer (Anonymous)", "Currency System • Events"].sort());

  const named = fixture();
  const namedResult = await named.runtime.ingest(activity("cheer", { eventId: "cheer-named", amount: 250 }));
  assert.deepEqual(namedResult.actions.map((action) => action.name).sort(), ["Cheer", "Currency System • Events"].sort());
});

test("Kick and TikTok provider events route to their donor integration action plus the currency-event aggregator", async () => {
  const kick = fixture();
  const kickResult = await kick.runtime.ingest(activity("provider-event", { provider: "kick", eventId: "kick-1" }));
  assert.deepEqual(kickResult.actions.map((action) => action.name).sort(), ["Currency System • Events", "Kick Events"].sort());

  const tiktok = fixture();
  const tiktokResult = await tiktok.runtime.ingest(activity("provider-event", { provider: "tiktok", eventId: "tt-1" }));
  assert.deepEqual(tiktokResult.actions.map((action) => action.name).sort(), ["Currency System • Events", "TikTok Events"].sort());
});

test("provider rewards use the canonical SPMT XP authority without inventing donor values", async () => {
  const fx = fixture({ rewardPolicy: { resolve(input) { return input.kind === "follow" ? { delta: 25, reason: "Tenant follow reward", eventType: "streamweaver.follow", metadata: { configuredBy: "tenant" } } : undefined; } } });
  const result = await fx.runtime.ingest(activity("follow"));
  assert.equal(result.reward.delta, 25);
  assert.equal(fx.awards.length, 1);
  assert.equal(fx.awards[0].userId, "user-1");
  assert.equal(fx.awards[0].idempotencyKey, "streamweaver-provider-xp:twitch:evt-follow:streamweaver.follow");
  assert.deepEqual(fx.awards[0].options.metadata, { provider: "twitch", providerEventId: "evt-follow", activityKind: "follow", configuredBy: "tenant" });
});

test("unlinked provider identities never receive guessed XP and secret-looking metadata is dropped", async () => {
  const fx = fixture({ rewardPolicy: { resolve() { throw new Error("reward policy should not be called without a canonical user"); } } });
  await fx.runtime.ingest(activity("follow", {
    eventId: "unlinked",
    actor: { providerUserId: "tw-unlinked", displayName: "Unlinked" },
    metadata: { title: "safe", access_token: "must-not-leak", password: "must-not-leak" },
  }));
  assert.equal(fx.awards.length, 0);
  const providerEvent = fx.published.find((entry) => entry.type === STREAMWEAVER_PROVIDER_ACTIVITY);
  assert.deepEqual(providerEvent.payload.metadata, { title: "safe" });
});

test("the donor follow-required support action remains callable with stable idempotency", async () => {
  const fx = fixture();
  await fx.runtime.emitFollowRequiredError({ tenantId: "tenant-1", eventId: "follow-required-1", providerUserId: "tw-2", displayName: "Viewer Two" });
  assert.equal(fx.published.length, 1);
  assert.equal(fx.published[0].type, STREAMWEAVER_DONOR_ACTION_FIRED);
  assert.equal(fx.published[0].payload.donorActionName, "Error - You do not follow");
  assert.equal(fx.published[0].idempotencyKey, "streamweaver-donor-action:b4b64576-1951-4c6e-b567-6c5a5ff584d0:follow-required-1");
});
