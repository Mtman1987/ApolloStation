import assert from "node:assert/strict";
import test from "node:test";
import { handleSpaceMountainGoLiveMessage, isAuthorizedSpaceMountainGoLive, isSpaceMountainGoLiveCommand } from "../apps/streamweaver/dist/spacemountain-golive.js";

const owner = { message: "!golive", channel: "#SpaceMountainLive", tenantId: "spacemountainlive", username: "SpaceMountainLive", userId: "immutable-twitch-user-id", self: false, mirrored: false, botAuthored: false, broadcasterBadge: true };

test("recognizes only the reserved exact command in the system channel", () => {
  assert.equal(isSpaceMountainGoLiveCommand("!golive", "#spacemountainlive"), true);
  assert.equal(isSpaceMountainGoLiveCommand("!golive now", "#spacemountainlive"), false);
  assert.equal(isSpaceMountainGoLiveCommand("!golive", "#anotherchannel"), false);
});

test("requires the verified broadcaster identity and rejects mirrored or bot-authored messages", () => {
  assert.equal(isAuthorizedSpaceMountainGoLive(owner), true);
  for (const patch of [
    { username: "someoneelse" }, { userId: "" }, { broadcasterBadge: false },
    { tenantId: "another-tenant" }, { self: true }, { mirrored: true }, { botAuthored: true },
  ]) assert.equal(isAuthorizedSpaceMountainGoLive({ ...owner, ...patch }), false);
});

test("never reports success unless the start adapter confirms verified live state", async () => {
  const replies = [];
  const handled = await handleSpaceMountainGoLiveMessage(owner, {
    start: async () => ({ ok: true, state: "not_live" }),
    reply: async (message) => replies.push(message),
  });
  assert.equal(handled, true);
  assert.equal(replies.length, 2);
  assert.match(replies[1], /did not confirm.*live/i);
  assert.doesNotMatch(replies[1], /Twitch confirms .* is live/);
});

test("does not start the stream for an unauthorized command sender", async () => {
  let starts = 0;
  const handled = await handleSpaceMountainGoLiveMessage({ ...owner, username: "anotheruser" }, {
    start: async () => { starts++; return { ok: true, state: "live" }; },
    reply: async () => undefined,
  });
  assert.equal(handled, true);
  assert.equal(starts, 0);
});
