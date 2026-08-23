import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_TAG_TAG_COMPLETED,
  assertChatTagStateV1,
  createChatTagState,
  executeChatTagCommand,
  getChatTagLeaderboard,
  getChatTagStatus,
  parseChatTagCommandText,
  publishChatTagCommandResult,
} from "../apps/nebula-arcade/dist/index.js";
import { requestChatTagGameAnnouncements } from "../apps/discord-stream-hub/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

const TENANT = "tenant-chat-tag";
const CHANNEL = "mtman1987";
const at = (minute) => new Date(Date.UTC(2026, 7, 23, 5, minute)).toISOString();

function command(kind, commandId, actorUserId, minute, extra = {}) {
  return { schemaVersion: 1, tenantId: TENANT, channelId: CHANNEL, kind, commandId, actorUserId, occurredAt: at(minute), ...extra };
}

function apply(state, value) {
  return executeChatTagCommand(state, value);
}

test("original Chat Tag command words and aliases remain recognizable", () => {
  assert.deepEqual(parseChatTagCommandText("spmt join"), { kind: "join" });
  assert.deepEqual(parseChatTagCommandText("SPMT tag @TargetUser"), { kind: "tag", targetUsername: "targetuser" });
  assert.deepEqual(parseChatTagCommandText("spmt pass target"), { kind: "pass", targetUsername: "target" });
  assert.deepEqual(parseChatTagCommandText("spmt givepass @target"), { kind: "grant-pass", targetUsername: "target" });
  assert.deepEqual(parseChatTagCommandText("spmt whosit"), { kind: "status" });
  assert.deepEqual(parseChatTagCommandText("spmt stats"), { kind: "score" });
  assert.deepEqual(parseChatTagCommandText("spmt away"), { kind: "toggle-away" });
  assert.equal(parseChatTagCommandText("hello chat"), null);
  assert.equal(parseChatTagCommandText("spmt tag"), null);
});

test("two players can join, transfer it, score, and replay a command safely", () => {
  let state = createChatTagState(TENANT);
  ({ state } = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" })));
  ({ state } = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" })));
  assert.deepEqual(getChatTagStatus(state), { freeForAll: false, currentItUserId: "user-a", currentItUsername: "alpha", playerCount: 2 });

  let outcome;
  ({ state, result: outcome } = apply(state, command("tag", "tag-a-b", "user-a", 2, { targetUserId: "user-b" })));
  assert.equal(outcome.status, "applied");
  assert.equal(outcome.event.type, CHAT_TAG_TAG_COMPLETED);
  assert.equal(outcome.xpAward.delta, 100);
  assert.equal(state.currentItUserId, "user-b");
  assert.equal(state.players["user-a"].score, 100);
  assert.equal(state.players["user-b"].score, -50);
  assert.equal(state.history.length, 1);

  const duplicate = apply(state, command("tag", "tag-a-b", "user-a", 2, { targetUserId: "user-b" }));
  assert.equal(duplicate.result.status, "duplicate");
  assert.equal(duplicate.state.history.length, 1);
  assert.equal(duplicate.state.players["user-a"].score, 100);

  const tooSoon = apply(duplicate.state, command("tag", "tag-b-a-too-soon", "user-b", 3, { targetUserId: "user-a" }));
  assert.equal(tooSoon.result.status, "rejected");
  assert.equal(tooSoon.result.code, "target-timed-immunity");

  const afterImmunity = apply(tooSoon.state, command("tag", "tag-b-a", "user-b", 23, { targetUserId: "user-a" }));
  assert.equal(afterImmunity.result.status, "applied");
  assert.equal(afterImmunity.state.currentItUserId, "user-a");
  assert.deepEqual(getChatTagLeaderboard(afterImmunity.state).map((player) => [player.userId, player.score]), [["user-a", 50], ["user-b", 50]]);
});

test("sleep, free-for-all, moderator grants, and passes preserve production game rules", () => {
  let state = createChatTagState(TENANT);
  ({ state } = apply(state, command("join", "join-mod", "user-mod", 0, { username: "Commander" })));
  ({ state } = apply(state, command("join", "join-a", "user-a", 1, { username: "Alpha" })));
  ({ state } = apply(state, command("join", "join-b", "user-b", 2, { username: "Beta" })));

  let response;
  ({ state, result: response } = apply(state, command("sleep", "sleep-b", "user-b", 3)));
  assert.equal(response.status, "applied");
  ({ state, result: response } = apply(state, command("tag", "tag-sleeping", "user-mod", 4, { targetUserId: "user-b" })));
  assert.equal(response.code, "target-sleeping");
  ({ state } = apply(state, command("wake", "wake-b", "user-b", 5)));

  ({ state, result: response } = apply(state, command("grant-pass", "grant-denied", "user-a", 6, { targetUserId: "user-a" })));
  assert.equal(response.code, "moderator-required");
  ({ state } = apply(state, command("grant-pass", "grant-a", "user-mod", 7, { targetUserId: "user-a", isModerator: true })));
  assert.equal(state.players["user-a"].passCount, 1);

  ({ state, result: response } = apply(state, command("pass", "pass-a-b", "user-a", 8, { targetUserId: "user-b" })));
  assert.equal(response.status, "applied");
  assert.equal(response.xpAward.delta, 200);
  assert.equal(state.players["user-a"].passCount, 0);
  assert.equal(state.currentItUserId, "user-b");

  ({ state, result: response } = apply(state, command("trigger-ffa", "ffa-denied", "user-a", 9)));
  assert.equal(response.code, "moderator-required");
  ({ state, result: response } = apply(state, command("trigger-ffa", "ffa", "user-mod", 10, { isModerator: true })));
  assert.equal(response.status, "applied");
  assert.equal(getChatTagStatus(state).freeForAll, true);

  ({ state, result: response } = apply(state, command("tag", "ffa-a-mod", "user-a", 29, { targetUserId: "user-mod" })));
  assert.equal(response.status, "applied");
  assert.equal(response.xpAward.delta, 200);
  assert.equal(state.currentItUserId, "user-mod");
});

test("state snapshots restore without crossing tenant boundaries", () => {
  let tenantOne = createChatTagState("tenant-one");
  ({ state: tenantOne } = executeChatTagCommand(tenantOne, { ...command("join", "join-one", "user-one", 0, { username: "One" }), tenantId: "tenant-one" }));
  const restored = assertChatTagStateV1(JSON.parse(JSON.stringify(tenantOne)), "tenant-one");
  assert.equal(restored.players["user-one"].username, "one");
  assert.throws(() => assertChatTagStateV1(restored, "tenant-two"), /tenant mismatch/);
  const tenantTwo = createChatTagState("tenant-two");
  assert.deepEqual(Object.keys(tenantTwo.players), []);
});

test("a scoped moderator can operate the game without becoming a player", () => {
  let state = createChatTagState(TENANT);
  ({ state } = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" })));
  ({ state } = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" })));
  let response;
  ({ state, result: response } = apply(state, command("grant-pass", "grant-by-mod", "moderator-not-playing", 2, { targetUserId: "user-b", isModerator: true })));
  assert.equal(response.status, "applied");
  assert.equal(state.players["user-b"].passCount, 1);
  ({ state, result: response } = apply(state, command("trigger-ffa", "ffa-by-mod", "moderator-not-playing", 3, { isModerator: true })));
  assert.equal(response.status, "applied");
  assert.equal(state.currentItUserId, null);
});

test("successful tags publish and award XP only through tenant-scoped SPMT APIs", async () => {
  let state = createChatTagState(TENANT);
  ({ state } = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" })));
  ({ state } = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" })));
  const { result } = apply(state, command("tag", "tag-a-b", "user-a", 2, { targetUserId: "user-b" }));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true });
  };
  const client = new SpmtClient({ baseUrl: "https://spmt.example", appId: "nebula-arcade", fetchImpl });
  assert.deepEqual(await publishChatTagCommandResult(client, result), { eventPublished: true, xpAwarded: true });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/v1/events", "/v1/xp/awards"]);
  assert.ok(calls.every((call) => call.headers["x-spmt-app"] === "nebula-arcade"));
  assert.ok(calls.every((call) => call.headers["x-spmt-tenant"] === TENANT));
  assert.deepEqual(calls.map((call) => call.headers["idempotency-key"]), ["chat-tag:tag:tag-a-b", "chat-tag:tag:tag-a-b"]);
});

test("Discord Stream Hub consumes only the public production Chat Tag event", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)), body: init.body ? JSON.parse(String(init.body)) : undefined });
    if ((init.method ?? "GET") === "GET") return Response.json([{ id: "event-tag-a-b", payload: { actorUsername: "alpha", targetUsername: "beta" } }]);
    return Response.json({ ok: true });
  };
  const client = new SpmtClient({ baseUrl: "https://spmt.example", appId: "discord-stream-hub", fetchImpl });
  assert.deepEqual(await requestChatTagGameAnnouncements(client, TENANT), { observed: 1 });
  assert.equal(new URL(calls[0].url).searchParams.get("type"), CHAT_TAG_TAG_COMPLETED);
  assert.equal(new URL(calls[0].url).searchParams.get("sourceAppId"), "nebula-arcade");
  assert.equal(calls[1].body.payload.kind, "chat-tag");
  assert.equal(calls[1].headers["idempotency-key"], "dsh-chat-tag:event-tag-a-b");
  assert.ok(calls.every((call) => call.headers["x-spmt-tenant"] === TENANT));
});
