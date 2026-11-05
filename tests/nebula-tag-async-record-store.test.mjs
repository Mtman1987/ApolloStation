import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AsyncNebulaTagRecordStore } from "../apps/nebula-arcade/dist/index.js";

const at = (minute) => new Date(Date.UTC(2026, 7, 23, 8, minute)).toISOString();
const command = (tenantId, kind, commandId, actorUserId, minute, extra = {}) => ({
  schemaVersion: 1, tenantId, channelId: "main", kind, commandId, actorUserId,
  occurredAt: at(minute), ...extra,
});

test("async Tag store atomically persists state, command dedupe and outbox across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nebula-tag-async-"));
  const databasePath = join(directory, "tag.sqlite");
  const store = new AsyncNebulaTagRecordStore({ databasePath });
  try {
    await store.initialize();
    await store.applyCommand(command("tenant-a", "join", "join-a", "player-a", 0, { username: "Alpha" }));
    await store.applyCommand(command("tenant-a", "join", "join-b", "player-b", 1, { username: "Beta" }));
    const applied = await store.applyCommand(command("tenant-a", "tag", "tag-a-b", "player-a", 2, { targetUserId: "player-b" }));
    assert.equal(applied.duplicate, false);
    assert.equal(applied.state.players["player-a"].score, 100);
    assert.ok((await store.listPendingDeliveries("tenant-a")).length > 0);
    const replay = await store.applyCommand(command("tenant-a", "tag", "tag-a-b", "player-a", 2, { targetUserId: "player-b" }));
    assert.equal(replay.duplicate, true);
    assert.equal(replay.revision, applied.revision);
    assert.equal((await store.getState("tenant-b")).revision, 0);
    await store.close();

    const reopened = new AsyncNebulaTagRecordStore({ databasePath });
    await reopened.initialize();
    const restored = await reopened.getState("tenant-a");
    assert.equal(restored.revision, applied.revision);
    assert.equal(restored.state.players["player-a"].score, 100);
    assert.ok((await reopened.listPendingDeliveries("tenant-a")).length > 0);
    const encodedTenantStore = new AsyncNebulaTagRecordStore({ databasePath });
    await encodedTenantStore.initialize();
    await encodedTenantStore.setSettings("tenant:encoded", { tagSuccessPoints: 37, rotateMinutes: 3, forceMinutes: 5, immunityMinutes: 2 });
    assert.equal((await encodedTenantStore.rotationRules("tenant:encoded")).rotateAfterMs, 180_000);
    assert.equal((await encodedTenantStore.rotationRules("tenant:encoded")).forceRandomAfterMs, 300_000);
    await encodedTenantStore.applyCommand(command("tenant:encoded", "join", "join-encoded", "player-c", 3, { username: "Gamma" }));
    await encodedTenantStore.applyCommand(command("tenant:encoded", "join", "join-encoded-b", "player-d", 4, { username: "Delta" }));
    const encodedResult = await encodedTenantStore.applyCommand(command("tenant:encoded", "tag", "tag-encoded", "player-c", 5, { targetUserId: "player-d" }));
    assert.equal(encodedResult.state.players["player-c"].score, 37);
    const encodedPending = await encodedTenantStore.listPendingDeliveries("tenant:encoded");
    assert.ok(encodedPending.length > 0);
    await assert.doesNotReject(encodedTenantStore.markDeliveryFailed(encodedPending[0].id, "Bearer do-not-store"));
    await encodedTenantStore.close();
    const pending = await reopened.listPendingDeliveries("tenant-a");
    await reopened.markDeliveryFailed(pending[0].id, "Bearer do-not-store");
    await reopened.markDeliveryComplete(pending[0].id);
    assert.equal((await reopened.listPendingDeliveries("tenant-a")).some((item) => item.id === pending[0].id), false);
    await reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("async Tag store rolls back state and command receipt together on transaction failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nebula-tag-rollback-"));
  const store = new AsyncNebulaTagRecordStore({ databasePath: join(directory, "tag.sqlite") });
  try {
    await store.initialize();
    await assert.rejects(store.applyCommand({
      ...command("tenant-a", "join", "bad-command", "player-a", 0, { username: "Alpha" }),
      occurredAt: "not-a-date",
    }));
    assert.equal((await store.getState("tenant-a")).revision, 0);
    const valid = await store.applyCommand(command("tenant-a", "join", "good-command", "player-a", 1, { username: "Alpha" }));
    assert.equal(valid.revision, 1);
    const replay = await store.applyCommand(command("tenant-a", "join", "good-command", "player-a", 1, { username: "Alpha" }));
    assert.equal(replay.duplicate, true);
    assert.equal(replay.revision, 1);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
