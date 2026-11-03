import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NEBULA_GAME_POINTS_INTERVAL_MS,
  NEBULA_GAME_SCORE_INTERVAL_MS,
  awardNebulaGamePoints,
  awardNebulaCheckinBonus,
  SqliteNebulaGameRuntimeStore,
  defaultNebulaGameRuntimeState,
  getNebulaGameStats,
  joinNebulaGame,
  leaveNebulaGame,
  recordNebulaGameChatActivity,
  recordNebulaGameWin,
  resolveNebulaChannelGameIds,
  setNebulaChannelGameRunning,
  spendNebulaGamePoints,
} from "../apps/nebula-arcade/dist/index.js";

test("Nebula shared runtime starts and stops any catalog game per channel", () => {
  const state = defaultNebulaGameRuntimeState();
  setNebulaChannelGameRunning(state, "#captain", "chatgarden", true, new Date("2026-08-26T00:00:00Z"));
  setNebulaChannelGameRunning(state, "captain", "wordstorm", true, new Date("2026-08-26T00:00:00Z"));
  assert.deepEqual(resolveNebulaChannelGameIds(state, "CAPTAIN").sort(), ["chatgarden", "wordstorm"]);
  setNebulaChannelGameRunning(state, "captain", "chatgarden", false);
  assert.deepEqual(resolveNebulaChannelGameIds(state, "captain"), ["wordstorm"]);
});

test("Chat Tag front-seat check-in bonus credits 100 Nebula points exactly once across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-checkin-bonus-")), path = join(directory, "nebula.sqlite");
  let store = new SqliteNebulaGameRuntimeStore(path);
  const input = { awardId: "streamweaver-ride:ride-1", channel: "123456789", userId: "spmt:canonical-member", username: "captain", displayName: "Captain" };
  try {
    const first = store.update("tenant", state => awardNebulaCheckinBonus(state, input, new Date("2026-11-03T20:00:00.000Z"))).result;
    assert.equal(first.amount, 100);
    assert.equal(first.balance, 100);
    assert.equal(first.duplicate, false);
    const state = store.get("tenant");
    assert.equal(state.players["spmt:canonical-member"].gamePointsBalance, 100);
    assert.equal(state.players["spmt:canonical-member"].lifetimeEarned, 100);
    assert.equal(state.ledger.filter(entry => entry.reason === "Chat Tag front-seat check-in bonus").length, 1);
    assert.ok(state.ledger.at(-1).sourceId);
    store.close();
    store = new SqliteNebulaGameRuntimeStore(path);
    const duplicate = store.update("tenant", state => awardNebulaCheckinBonus(state, input)).result;
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.balance, 100);
    assert.equal(store.get("tenant").ledger.filter(entry => entry.reason === "Chat Tag front-seat check-in bonus").length, 1);
    assert.throws(() => store.update("tenant", state => awardNebulaCheckinBonus(state, { ...input, userId: "spmt:other-member" })), /already credited to another player/);
    assert.equal(store.get("tenant").players["spmt:other-member"], undefined);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("Nebula membership records join leave plays and rejoin", () => {
  const state = defaultNebulaGameRuntimeState();
  let joined = joinNebulaGame(state, { userId: "123", username: "Duck", gameId: "petrace" }, new Date("2026-08-26T00:00:00Z"));
  assert.equal(joined.membership.plays, 1);
  assert.equal(joined.alreadyJoined, false);
  assert.equal(leaveNebulaGame(state, joined.player.id, "petrace"), true);
  joined = joinNebulaGame(state, { userId: "123", username: "Duck", gameId: "petrace" });
  assert.equal(joined.membership.plays, 2);
});

test("Nebula chat scoring and game points use independent cooldowns", () => {
  const state = defaultNebulaGameRuntimeState();
  setNebulaChannelGameRunning(state, "captain", "wordstorm", true);
  const { player } = joinNebulaGame(state, { userId: "123", username: "duck", gameId: "wordstorm" });
  const start = Date.parse("2026-08-26T12:00:00Z");
  let activity = recordNebulaGameChatActivity(state, { channel: "captain", userId: "123", username: "duck", message: "spmt hello" }, start);
  assert.deepEqual(activity.scoredGameIds, ["wordstorm"]);
  assert.equal(activity.pointsAwarded, 1);
  activity = recordNebulaGameChatActivity(state, { channel: "captain", userId: "123", username: "duck", message: "spmt again" }, start + NEBULA_GAME_SCORE_INTERVAL_MS - 1);
  assert.equal(activity.scoredGameIds.length, 0);
  activity = recordNebulaGameChatActivity(state, { channel: "captain", userId: "123", username: "duck", message: "spmt score again" }, start + NEBULA_GAME_SCORE_INTERVAL_MS);
  assert.equal(activity.scoredGameIds.length, 1);
  assert.equal(activity.pointsAwarded, 0);
  activity = recordNebulaGameChatActivity(state, { channel: "captain", userId: "123", username: "duck", message: "spmt points again" }, start + NEBULA_GAME_POINTS_INTERVAL_MS);
  assert.equal(activity.pointsAwarded, 1);
  assert.equal(player.gamePointsBalance, 2);
});

test("Nebula points ledger supports awards, spend and win leaderboards", () => {
  const state = defaultNebulaGameRuntimeState();
  const a = joinNebulaGame(state, { userId: "1", username: "a", displayName: "A", gameId: "chatwars" }).player;
  const b = joinNebulaGame(state, { userId: "2", username: "b", displayName: "B", gameId: "chatwars" }).player;
  awardNebulaGamePoints(state, a, 10, "test");
  spendNebulaGamePoints(state, a, 3, "buy");
  recordNebulaGameWin(state, b.id, "chatwars", 5);
  b.joinedGames.chatwars.score = 8;
  a.joinedGames.chatwars.score = 3;
  assert.equal(a.gamePointsBalance, 7);
  assert.equal(a.lifetimeSpent, 3);
  const stats = getNebulaGameStats(state, "chatwars");
  assert.equal(stats.leaderboard[0].id, b.id);
  assert.equal(stats.leaderboard[0].wins, 1);
  assert.equal(state.ledger.length, 3);
});
