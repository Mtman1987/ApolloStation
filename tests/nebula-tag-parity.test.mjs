import assert from "node:assert/strict";
import test from "node:test";
import {
  NEBULA_TAG_TAG_COMPLETED,
  NEBULA_TAG_CROWN_SET,
  assertNebulaTagStateV1,
  crownAwardKey,
  crownMonthKey,
  crownXpReward,
  createNebulaTagState,
  decorateNebulaTagCrowns,
  executeNebulaTagCommand,
  getNebulaTagLeaderboard,
  getNebulaTagStatus,
  parseNebulaTagCommandText,
  planNebulaTagMessage,
  publishNebulaTagCommandResult,
} from "../apps/nebula-arcade/dist/index.js";
import { requestNebulaArcadeTagAnnouncements } from "../apps/discord-stream-hub/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

const TENANT = "tenant-nebula-arcade";
const CHANNEL = "mtman1987";
const at = (minute) => new Date(Date.UTC(2026, 7, 23, 5, minute)).toISOString();

function command(kind, commandId, actorUserId, minute, extra = {}) {
  return { schemaVersion: 1, tenantId: TENANT, channelId: CHANNEL, kind, commandId, actorUserId, occurredAt: at(minute), ...extra };
}

function apply(state, value) {
  return executeNebulaTagCommand(state, value);
}

test("Nebula Arcade tag-game command words and canonical module prefix remain recognizable", () => {
  assert.deepEqual(parseNebulaTagCommandText("spmt join"), { kind: "join" });
  assert.deepEqual(parseNebulaTagCommandText("SPMT tag @TargetUser"), { kind: "tag", targetUsername: "targetuser" });
  assert.deepEqual(parseNebulaTagCommandText("spmt pass target"), { kind: "pass", targetUsername: "target" });
  assert.deepEqual(parseNebulaTagCommandText("spmt givepass @target"), { kind: "grant-pass", targetUsername: "target" });
  assert.deepEqual(parseNebulaTagCommandText("spmt whosit"), { kind: "status" });
  assert.deepEqual(parseNebulaTagCommandText("spmt stats"), { kind: "score" });
  assert.deepEqual(parseNebulaTagCommandText("spmt away"), { kind: "toggle-away" });
  assert.deepEqual(parseNebulaTagCommandText("spmt arcade join"), { kind: "join" });
  assert.deepEqual(parseNebulaTagCommandText("spmt arcade tag @TargetUser"), { kind: "tag", targetUsername: "targetuser" });
  assert.equal(parseNebulaTagCommandText("hello chat"), null);
  assert.deepEqual(parseNebulaTagCommandText("spmt tag"), { kind: "join" });
});

test("provider-neutral chat ingress resolves aliases, mentions, roles, and read-only replies", () => {
  let state = createNebulaTagState(TENANT);
  ({ state } = apply(state, command("join", "join-alpha", "user-alpha", 0, { username: "Alpha_User" })));
  ({ state } = apply(state, command("join", "join-beta", "user-beta", 1, { username: "BetaUser" })));
  const baseMessage = { schemaVersion: 1, provider: "discord", tenantId: TENANT, channelId: CHANNEL, occurredAt: at(2), roles: ["member"] };
  const tag = planNebulaTagMessage(state, { ...baseMessage, messageId: "discord-1", userId: "user-alpha", username: "Alpha_User", text: "spmt tag <@222>", mentions: [{ token: "<@222>", userId: "user-beta", username: "BetaUser" }] });
  assert.equal(tag.kind, "command");
  assert.equal(tag.command.kind, "tag");
  assert.equal(tag.command.targetUserId, "user-beta");
  assert.equal(tag.command.commandId, "discord:discord-1");
  const rank = planNebulaTagMessage(state, { ...baseMessage, provider: "twitch", messageId: "twitch-1", userId: "user-beta", username: "BetaUser", text: "spmt rank" });
  assert.equal(rank.kind, "response");
  assert.match(rank.message, /#1 alpha_user/);
  const grant = planNebulaTagMessage(state, { ...baseMessage, messageId: "discord-2", userId: "moderator", username: "Mod", roles: ["moderator"], text: "spmt givepass beta" });
  assert.equal(grant.kind, "command");
  assert.equal(grant.command.isModerator, true);
  assert.equal(grant.command.targetUserId, "user-beta");
});

test("two players can join, transfer it, score, and replay a command safely", () => {
  let state = createNebulaTagState(TENANT);
  ({ state } = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" })));
  ({ state } = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" })));
  assert.deepEqual(getNebulaTagStatus(state), { freeForAll: false, currentItUserId: "user-a", currentItUsername: "alpha", playerCount: 2 });

  let outcome;
  ({ state, result: outcome } = apply(state, command("tag", "tag-a-b", "user-a", 2, { targetUserId: "user-b" })));
  assert.equal(outcome.status, "applied");
  assert.equal(outcome.event.type, NEBULA_TAG_TAG_COMPLETED);
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
  assert.deepEqual(getNebulaTagLeaderboard(afterImmunity.state).map((player) => [player.userId, player.score]), [["user-a", 50], ["user-b", 50]]);
});

test("sleep, free-for-all, moderator grants, and passes preserve production game rules", () => {
  let state = createNebulaTagState(TENANT);
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
  assert.equal(getNebulaTagStatus(state).freeForAll, true);

  ({ state, result: response } = apply(state, command("tag", "ffa-a-mod", "user-a", 29, { targetUserId: "user-mod" })));
  assert.equal(response.status, "applied");
  assert.equal(response.xpAward.delta, 200);
  assert.equal(state.currentItUserId, "user-mod");
});

test("state snapshots restore without crossing tenant boundaries", () => {
  let tenantOne = createNebulaTagState("tenant-one");
  ({ state: tenantOne } = executeNebulaTagCommand(tenantOne, { ...command("join", "join-one", "user-one", 0, { username: "One" }), tenantId: "tenant-one" }));
  const restored = assertNebulaTagStateV1(JSON.parse(JSON.stringify(tenantOne)), "tenant-one");
  assert.equal(restored.players["user-one"].username, "one");
  assert.throws(() => assertNebulaTagStateV1(restored, "tenant-two"), /tenant mismatch/);
  const tenantTwo = createNebulaTagState("tenant-two");
  assert.deepEqual(Object.keys(tenantTwo.players), []);
});

test("a scoped moderator can operate the game without becoming a player", () => {
  let state = createNebulaTagState(TENANT);
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
  let state = createNebulaTagState(TENANT);
  ({ state } = apply(state, command("join", "join-a", "user-a", 0, { username: "Alpha" })));
  ({ state } = apply(state, command("join", "join-b", "user-b", 1, { username: "Beta" })));
  const { result } = apply(state, command("tag", "tag-a-b", "user-a", 2, { targetUserId: "user-b" }));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true });
  };
  const client = new SpmtClient({ baseUrl: "https://spmt.example", appId: "nebula-arcade", fetchImpl });
  assert.deepEqual(await publishNebulaTagCommandResult(client, result), { eventPublished: true, xpAwarded: true });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/v1/events", "/v1/xp/awards"]);
  assert.ok(calls.every((call) => call.headers["x-spmt-app"] === "nebula-arcade"));
  assert.ok(calls.every((call) => call.headers["x-spmt-tenant"] === TENANT));
  assert.deepEqual(calls.map((call) => call.headers["idempotency-key"]), ["nebula-arcade:tag:tag-a-b", "nebula-arcade:tag:tag-a-b"]);
});

test("Discord Stream Hub consumes only the public production Nebula Arcade tag game event", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)), body: init.body ? JSON.parse(String(init.body)) : undefined });
    if ((init.method ?? "GET") === "GET") return Response.json([{ id: "event-tag-a-b", payload: { actorUsername: "alpha", targetUsername: "beta" } }]);
    return Response.json({ ok: true });
  };
  const client = new SpmtClient({ baseUrl: "https://spmt.example", appId: "discord-stream-hub", fetchImpl });
  assert.deepEqual(await requestNebulaArcadeTagAnnouncements(client, TENANT), { observed: 1 });
  assert.equal(new URL(calls[0].url).searchParams.get("type"), NEBULA_TAG_TAG_COMPLETED);
  assert.equal(new URL(calls[0].url).searchParams.get("sourceAppId"), "nebula-arcade");
  assert.equal(calls[1].body.payload.kind, "nebula-arcade-tag");
  assert.equal(calls[1].headers["idempotency-key"], "dsh-nebula-arcade:event-tag-a-b");
  assert.ok(calls.every((call) => call.headers["x-spmt-tenant"] === TENANT));
});

test("monthly crowns preserve fixed donor rewards and never schedule the same payout twice", () => {
  let state = createNebulaTagState(TENANT);
  ({ state } = apply(state, command("join", "join-winner", "user-winner", 0, { username: "Van_Braak" })));
  const crowned = apply(state, command("set-winner", "crown-first", "owner", 1, { targetUserId: "user-winner", place: 1, isModerator: true }));
  state = crowned.state;
  assert.equal(crowned.result.event.type, NEBULA_TAG_CROWN_SET);
  assert.equal(crowned.result.xpAward.delta, 500);
  assert.equal(crowned.result.xpAward.idempotencyKey, "crown:2026-08:1:user-winner");
  assert.deepEqual(state.monthlyWinners.map((winner) => [winner.place, winner.username]), [[1, "van_braak"]]);

  const reset = apply(state, command("set-winner", "crown-reset", "owner", 2, { targetUserId: "user-winner", place: 1, isModerator: true }));
  assert.equal(reset.result.status, "applied");
  assert.equal(reset.result.code, "winner-updated");
  assert.equal(reset.result.xpAward, undefined);
  assert.equal(reset.state.crownAwardKeys.length, 1);
  assert.equal(crownXpReward(2), 250);
  assert.equal(crownXpReward(3), 100);
  assert.equal(crownXpReward(4), 0);
  assert.equal(crownMonthKey(new Date("2026-12-31T23:59:59Z")), "2026-12");
  assert.equal(crownAwardKey("user-winner", 1, "2026-08"), "crown:2026-08:1:user-winner");
});

test("crown decoration preserves mentions, skips URLs, and does not double-crown", () => {
  const winners = [{ userId: "u1", username: "van_braak", place: 1, monthKey: "2026-08", selectedAt: at(0) }];
  assert.equal(decorateNebulaTagCrowns("@van_braak tagged van braak", winners), "👑@van_braak tagged 👑van braak");
  assert.equal(decorateNebulaTagCrowns("👑van_braak wins", winners), "👑van_braak wins");
  assert.equal(decorateNebulaTagCrowns("https://twitch.tv/van_braak", winners), "https://twitch.tv/van_braak");
});
