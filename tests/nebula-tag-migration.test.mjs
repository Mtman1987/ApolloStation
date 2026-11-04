import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteNebulaTagStore, migrateDonorNebulaTagState } from "../apps/nebula-arcade/dist/index.js";

const migratedAt = "2026-08-23T12:00:00.000Z";
const donor = {
  tagPlayers: {
    "user-a": { id: "user-a", twitchUsername: "Alpha", joinedAt: 1_700_000_000_000, lastChatAt: 1_700_000_100_000, passCount: 2, bingoPoints: 10, isIt: false },
    "user-b": { id: "user-b", twitchUsername: "Beta", joinedAt: 1_700_000_000_100, lastChatAt: 1_700_000_200_000, sleepingImmunity: true, isIt: true },
  },
  tagHistory: [
    { id: "hist-1", taggerId: "user-a", taggedId: "user-b", streamerId: "mtman1987", timestamp: 1_700_000_300_000 },
    { id: "hist-blocked", taggerId: "user-b", taggedId: "user-a", timestamp: 1_700_000_400_000, blocked: "immune" },
  ],
  tagGame: { state: { currentIt: "user-b", lastTagTime: 1_700_000_300_000, monthlyWinners: [{ userId: "user-a", username: "Alpha", place: 1, month: "August 2026" }], crownPayouts: [{ key: "crown:2026-08:1:user-a" }] } },
};

test("donor migration preserves private game state without creating XP deliveries", () => {
  const migrated = migrateDonorNebulaTagState(donor, { tenantId: "tenant-migrate", migratedAt });
  assert.deepEqual(migrated.report, { playersImported: 2, historyImported: 1, blockedHistorySkipped: 1, winnersImported: 1, warnings: [] });
  assert.equal(migrated.state.currentItUserId, "user-b");
  assert.equal(migrated.state.players["user-a"].score, 110);
  assert.equal(migrated.state.players["user-b"].score, -50);
  assert.equal(migrated.state.players["user-b"].sleeping, true);
  assert.deepEqual(migrated.state.crownAwardKeys, ["crown:2026-08:1:user-a"]);
  assert.deepEqual(migrated.state.appliedCommands, {});
});

test("SQLite import is one-time, restart-safe, and creates no historical SPMT outbox", () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-nebula-arcade-migration-"));
  const path = join(directory, "nebula-arcade.sqlite");
  try {
    const migrated = migrateDonorNebulaTagState(donor, { tenantId: "tenant-migrate", migratedAt });
    const store = new SqliteNebulaTagStore(path);
    const first = store.importState(migrated.state, "donor-8170c51");
    const replay = store.importState(migrated.state, "donor-8170c51");
    assert.equal(first.duplicate, false);
    assert.equal(replay.duplicate, true);
    assert.equal(store.listPendingDeliveries("tenant-migrate").length, 0);
    assert.throws(() => store.importState(migrated.state, "different-import"), /already exists/);
    store.close();
    const reopened = new SqliteNebulaTagStore(path);
    assert.equal(reopened.getState("tenant-migrate").state.history.length, 1);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
