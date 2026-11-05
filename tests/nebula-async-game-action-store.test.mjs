import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AsyncNebulaGameActionStore } from "../apps/nebula-arcade/dist/index.js";

test("async Nebula game action store is idempotent, tenant-scoped and ordered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nebula-async-actions-"));
  const path = join(dir, "actions.sqlite");
  const store = new AsyncNebulaGameActionStore({ databasePath: path });
  try {
    await store.initialize();
    const first = await store.record({ id: "action-1", tenantId: "tenant-a", channel: "#captain", gameId: "wordstorm", actorId: "spmt:alice", username: "Alice", displayName: "Alice", action: "join", args: [], message: "spmt wordstorm join", occurredAt: "2026-11-05T10:00:00.000Z" });
    assert.equal(first.channel, "captain");
    assert.deepEqual(await store.record({ ...first }), first);
    await assert.rejects(store.record({ ...first, message: "different payload" }), /reused with different input/);
    await store.record({ id: "action-2", tenantId: "tenant-a", channel: "captain", gameId: "bingo", actorId: "spmt:bob", username: "Bob", displayName: "Bob", action: "claim", args: ["4"], message: "spmt bingo claim 4", occurredAt: "2026-11-05T10:01:00.000Z" });
    await store.record({ id: "action-other", tenantId: "tenant-b", channel: "captain", gameId: "wordstorm", actorId: "spmt:other", username: "Other", displayName: "Other", action: "join", args: [], message: "join", occurredAt: "2026-11-05T10:02:00.000Z" });
    assert.equal((await store.get("tenant-a", "action-1"))?.actorId, "spmt:alice");
    assert.equal(await store.get("tenant-b", "action-1"), undefined);
    assert.deepEqual((await store.list("tenant-a", { channel: "captain" })).map((item) => item.id), ["action-1", "action-2"]);
    assert.deepEqual((await store.list("tenant-a", { gameIds: ["bingo"] })).map((item) => item.id), ["action-2"]);
    assert.deepEqual((await store.list("tenant-a", { after: "action-1" })).map((item) => item.id), ["action-2"]);
    await store.close();
    const restarted = new AsyncNebulaGameActionStore({ databasePath: path });
    try { await restarted.initialize(); assert.equal((await restarted.list("tenant-a")).length, 2); }
    finally { await restarted.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
