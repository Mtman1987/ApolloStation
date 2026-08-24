import test from "node:test";
import assert from "node:assert/strict";
import { chooseLostSignalMessage, requestRandomLostSignalMessage } from "../apps/discord-stream-hub/dist/signal-discovery.js";

const candidates = [
  { messageId: "m1", channelId: "c1", authorUserId: "u1", createdAt: "2026-08-23T01:00:00.000Z" },
  { messageId: "m2", channelId: "c2", authorUserId: "u2", createdAt: "2026-08-23T02:00:00.000Z" },
  { messageId: "m3", channelId: "c3", authorUserId: "u3", createdAt: "2026-08-23T03:00:00.000Z" },
];

test("Lost Signal chooses one eligible Discord message without exposing an ordered slot", () => {
  assert.equal(chooseLostSignalMessage(candidates, () => 0)?.messageId, "m1");
  assert.equal(chooseLostSignalMessage(candidates, () => .5)?.messageId, "m2");
  assert.equal(chooseLostSignalMessage(candidates, () => .999)?.messageId, "m3");
});

test("Lost Signal requests a hidden link on the chosen Discord message", async () => {
  const published = [];
  const client = { publishEvent: async (...args) => { published.push(args); } };
  const result = await requestRandomLostSignalMessage(client, "tenant-a", "viewer-1", candidates, "https://spacemountain.live/signal", () => .5);
  assert.equal(result.target.messageId, "m2");
  assert.equal(published[0][1], "dsh.discord.lost-signal-message.requested.v1");
  assert.equal(published[0][2].presentation, "hidden-link");
  assert.equal(published[0][2].targetMessageId, "m2");
});
