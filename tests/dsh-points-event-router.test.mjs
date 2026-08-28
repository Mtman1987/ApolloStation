import test from "node:test";
import assert from "node:assert/strict";
import { DshPointsEventRouter } from "../apps/discord-stream-hub/dist/points-event-router.js";

test("DSH canonicalizes provider identity before awarding provider event points", async () => {
  const calls = [];
  const identities = {
    async resolveOrGrandfather(input) { calls.push(["identity", input]); return { userId: `spmt-${input.providerUserId}`, provider: input.provider, providerUserId: input.providerUserId }; },
  };
  const points = {
    async awardPoints(input) { calls.push(["points", input]); return { pointsAwarded: 10 }; },
  };
  const router = new DshPointsEventRouter(identities, (tenantId) => { calls.push(["tenant", tenantId]); return points; });
  const result = await router.handle({ tenantId: "tenant-1", provider: "twitch", providerUserId: "twitch-1", username: "captain", eventId: "raid-44", eventType: "raid", quantity: 1, metadata: { channelId: "chan-1" } });
  assert.equal(result.identity.userId, "spmt-twitch-1");
  assert.equal(calls[0][0], "identity");
  assert.equal(calls[1][0], "tenant");
  assert.equal(calls[2][0], "points");
  assert.deepEqual(calls[2][1], {
    userId: "spmt-twitch-1",
    eventType: "raid",
    upstreamEventId: "raid-44",
    quantity: 1,
    source: "twitch",
    metadata: { provider: "twitch", providerUserId: "twitch-1", channelId: "chan-1" },
  });
});

test("Discord chat/reaction and Twitch economy event families share one canonical router", async () => {
  const events = [];
  const router = new DshPointsEventRouter(
    { resolveOrGrandfather: async (input) => ({ userId: `u-${input.providerUserId}` }) },
    () => ({ awardPoints: async (input) => { events.push(input); return { pointsAwarded: 1 }; } }),
  );
  for (const [provider, eventType] of [
    ["discord", "chat_activity"], ["discord", "first_message"], ["discord", "message_reaction"],
    ["twitch", "chat_activity"], ["twitch", "follow"], ["twitch", "raid"], ["twitch", "subscription"], ["twitch", "gifted_subscription"], ["twitch", "bits"],
  ]) {
    await router.handle({ tenantId: "tenant-1", provider, providerUserId: `${provider}-user`, eventId: `${provider}-${eventType}`, eventType, quantity: eventType === "bits" ? 500 : 1 });
  }
  assert.deepEqual(events.map((item) => item.eventType), ["chat_activity", "first_message", "message_reaction", "chat_activity", "follow", "raid", "subscription", "gifted_subscription", "bits"]);
  assert.equal(events[0].source, "discord");
  assert.equal(events[3].source, "twitch");
  assert.equal(events[8].quantity, 500);
});

test("provider point events require stable upstream ids and immutable provider ids", async () => {
  const router = new DshPointsEventRouter({ resolveOrGrandfather: async () => ({ userId: "u" }) }, () => ({ awardPoints: async () => ({}) }));
  await assert.rejects(() => router.handle({ tenantId: "tenant-1", provider: "discord", providerUserId: "discord-1", eventId: "", eventType: "chat_activity" }), /eventId/);
  await assert.rejects(() => router.handle({ tenantId: "tenant-1", provider: "discord", providerUserId: "", eventId: "message-1", eventType: "chat_activity" }), /providerUserId/);
});
