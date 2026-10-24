import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NebulaMosaicRuntime } from "../apps/nebula-arcade/dist/mosaic-runtime.js";

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mosaic-xp-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const runtime = new NebulaMosaicRuntime(
    join(directory, "mosaic.db"),
    async () => ({ target: Array(2000).fill("R"), provider: "fixture" }),
    {
      requestXpCost: 100,
      spendXp: async (...args) => {
        calls.push(["spend", ...args]);
        if (options.failSpend) throw new Error("insufficient XP");
        return { duplicate: false };
      },
      awardXp: async (...args) => { calls.push(["award", ...args]); return { duplicate: false }; },
    },
  );
  t.after(() => runtime.close());
  return { runtime, calls };
}

test("Mosaic theme requests spend canonical XP before queueing and do not charge again on queue success", async t => {
  const { runtime, calls } = fixture(t);
  const result = await runtime.handle({
    tenantId: "tenant-a", channel: "channel-a", playerId: "user-a",
    username: "viewer", text: "!mosaic red dragon", requestId: "message-1", now: 1000,
  });
  assert.equal(calls.filter(call => call[0] === "spend").length, 1);
  assert.equal(calls[0][3], 100);
  assert.equal(calls[0][4], "nebula.mosaic.request");
  assert.match(result.reply, /queued/i);
  assert.equal(calls.some(call => call[0] === "award"), false);
});

test("Mosaic refuses to queue when the canonical XP spend fails", async t => {
  const { runtime, calls } = fixture(t, { failSpend: true });
  const result = await runtime.handle({
    tenantId: "tenant-a", channel: "channel-a", playerId: "user-a",
    username: "viewer", text: "!mosaic red dragon", requestId: "message-2", now: 1000,
  });
  assert.match(result.reply, /charge could not be completed/i);
  assert.equal(calls.filter(call => call[0] === "spend").length, 1);
  assert.equal(runtime.snapshot("tenant-a", "channel-a").queue.length, 0);
});

test("Mosaic status and invalid theme commands never spend XP", async t => {
  const { runtime, calls } = fixture(t);
  await runtime.handle({
    tenantId: "tenant-a", channel: "channel-a", playerId: "user-a",
    username: "viewer", text: "!mosaic status", requestId: "message-3", now: 1000,
  });
  await runtime.handle({
    tenantId: "tenant-a", channel: "channel-a", playerId: "user-a",
    username: "viewer", text: "!mosaic", requestId: "message-4", now: 1000,
  });
  assert.equal(calls.filter(call => call[0] === "spend").length, 0);
});
