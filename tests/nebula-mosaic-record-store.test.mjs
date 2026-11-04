import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncNebulaMosaicRecordStore } from "../apps/nebula-arcade/dist/mosaic-record-store.js";

test("async Nebula Mosaic store persists state by tenant and channel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nebula-mosaic-records-"));
  const databasePath = join(directory, "mosaic.sqlite");
  const store = new AsyncNebulaMosaicRecordStore({ databasePath });
  try {
    await store.initialize();
    assert.deepEqual(await store.health(), { ready: true });
    const updated = await store.update("Tenant-A", "#Main", (state) => {
      state.queue.push({ id: "request-1", theme: "aurora", status: "pending", requestedBy: "player-1", requestedAt: new Date(1).toISOString() });
      return "queued";
    }, 1000);
    assert.equal(updated.result, "queued");
    assert.equal(updated.state.queue.length, 1);
    assert.equal((await store.get("tenant-a", "main")).queue[0].id, "request-1");
    assert.equal((await store.get("tenant-a", "other")).queue.length, 0);
    assert.equal((await store.get("tenant-b", "main")).queue.length, 0);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("async Nebula Mosaic update rolls back a failed mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nebula-mosaic-rollback-"));
  const store = new AsyncNebulaMosaicRecordStore({ databasePath: join(directory, "mosaic.sqlite") });
  try {
    await store.initialize();
    await store.update("tenant-a", "main", (state) => { state.queue.push({ id: "stable", theme: "forest", status: "pending", requestedBy: "p1", requestedAt: new Date(1).toISOString() }); });
    await assert.rejects(store.update("tenant-a", "main", (state) => {
      state.queue.push({ id: "must-rollback", theme: "ocean", status: "pending", requestedBy: "p2", requestedAt: new Date(2).toISOString() });
      throw new Error("abort transaction");
    }), /abort transaction/);
    const after = await store.get("tenant-a", "main");
    assert.deepEqual(after.queue.map((item) => item.id), ["stable"]);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
