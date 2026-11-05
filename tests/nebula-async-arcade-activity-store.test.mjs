import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AsyncNebulaArcadeActivityStore } from "../apps/nebula-arcade/dist/index.js";

test("async Nebula activity store persists channel membership, choices and activity snapshots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nebula-async-activity-"));
  const path = join(dir, "activity.sqlite");
  const store = new AsyncNebulaArcadeActivityStore({ databasePath: path });
  try {
    await store.initialize();
    await store.configure("tenant-a", "room-a", ["wordstorm", "bingo"]);
    await store.membership("tenant-a", "room-a", "spmt:alice", "wordstorm", true, 1000);
    await store.membership("tenant-a", "room-a", "spmt:bob", "bingo", true, 2000);
    assert.deepEqual((await store.joinedGames("tenant-a", "room-a", "spmt:alice")), ["wordstorm"]);
    await store.observe("tenant-a", "room-a", "spmt:alice", "spmt hello", 3000);
    const snapshot = await store.snapshot("tenant-a", "room-a", ["wordstorm"], ["wordstorm", "bingo"], 4000);
    assert.equal(snapshot.visible, true);
    assert.equal(snapshot.games.find((game) => game.id === "wordstorm").players, 1);
    assert.equal(snapshot.games.find((game) => game.id === "bingo").players, 1);
    const targets = [{ gameId: "wordstorm", command: "join", args: [] }];
    await store.saveChoice("tenant-a", "room-a", "spmt:alice", targets, 5000);
    assert.deepEqual(await store.choice("tenant-a", "room-a", "spmt:alice", 5001), targets);
    assert.equal(await store.choice("tenant-a", "room-a", "spmt:alice", 35001), undefined);
    await store.membership("tenant-a", "room-a", "spmt:alice", "wordstorm", false, 6000);
    assert.deepEqual(await store.joinedGames("tenant-a", "room-a", "spmt:alice"), []);
    await store.close();
    const restarted = new AsyncNebulaArcadeActivityStore({ databasePath: path });
    try { await restarted.initialize(); assert.deepEqual(await restarted.configuredGames("tenant-a", "room-a"), ["wordstorm", "bingo"]); }
    finally { await restarted.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
