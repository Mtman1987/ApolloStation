import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AsyncNebulaGameRuntimeStore, joinNebulaGame, recordNebulaGameChatActivity, recordNebulaGameWin, setNebulaChannelGameRunning } from "../apps/nebula-arcade/dist/index.js";

async function database() {
  const dir = await mkdtemp(join(tmpdir(), "nebula-async-runtime-"));
  return { dir, path: join(dir, "runtime.sqlite") };
}

test("async Nebula game runtime persists canonical player progress across restart", async () => {
  const file = await database();
  const first = new AsyncNebulaGameRuntimeStore({ databasePath: file.path });
  try {
    await first.initialize();
    await first.update("tenant-a", (state) => {
      setNebulaChannelGameRunning(state, "captain", "wordstorm", true, new Date("2026-08-26T12:00:00Z"));
      const joined = joinNebulaGame(state, { userId: "1", username: "alpha", displayName: "Alpha", gameId: "wordstorm" }, new Date("2026-08-26T12:00:01Z"));
      recordNebulaGameChatActivity(state, { channel: "captain", userId: "1", username: "alpha", displayName: "Alpha", message: "spmt hello", profileGameIds: ["wordstorm"] }, Date.parse("2026-08-26T12:01:00Z"));
      recordNebulaGameWin(state, joined.player.id, "wordstorm", 2, new Date("2026-08-26T12:01:01Z"));
    });
    await first.close();
    const second = new AsyncNebulaGameRuntimeStore({ databasePath: file.path });
    try {
      await second.initialize();
      const state = await second.get("tenant-a");
      const player = state.players["twitch:1"];
      assert.equal(state.channels.captain.extraGameIds.includes("wordstorm"), true);
      assert.equal(player.displayName, "Alpha");
      assert.equal(player.joinedGames.wordstorm.active, true);
      assert.equal(player.joinedGames.wordstorm.score, 1);
      assert.equal(player.joinedGames.wordstorm.wins, 1);
      assert.equal(player.gamePointsBalance, 3);
      assert.equal(state.ledger.length, 2);
    } finally { await second.close(); }
  } finally {
    await rm(file.dir, { recursive: true, force: true });
  }
});

test("async Nebula game runtime serializes concurrent tenant updates and rolls back failures", async () => {
  const file = await database();
  const store = new AsyncNebulaGameRuntimeStore({ databasePath: file.path });
  try {
    await store.initialize();
    await Promise.all([
      store.update("tenant-a", (state) => joinNebulaGame(state, { userId: "1", username: "alpha", gameId: "bingo" })),
      store.update("tenant-a", (state) => joinNebulaGame(state, { userId: "2", username: "beta", gameId: "quackverse" })),
      store.update("tenant-b", (state) => joinNebulaGame(state, { userId: "3", username: "gamma", gameId: "wordstorm" })),
    ]);
    assert.deepEqual(Object.keys((await store.get("tenant-a")).players).sort(), ["twitch:1", "twitch:2"]);
    assert.deepEqual(Object.keys((await store.get("tenant-b")).players), ["twitch:3"]);
    await assert.rejects(store.update("tenant-a", (state) => { joinNebulaGame(state, { userId: "4", username: "delta", gameId: "bingo" }); throw new Error("abort update"); }), /abort update/);
    assert.deepEqual(Object.keys((await store.get("tenant-a")).players).sort(), ["twitch:1", "twitch:2"]);
  } finally {
    await store.close();
    await rm(file.dir, { recursive: true, force: true });
  }
});
