import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NebulaMosaicRuntime } from "../apps/nebula-arcade/dist/mosaic-runtime.js";
import { MOSAIC_CELL_COUNT } from "../apps/nebula-arcade/dist/mosaic-core.js";

test("Mosaic chat runtime persists queued requests and never claims generation without a runner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mosaic-runtime-"));
  const path = resolve(directory, "mosaic.sqlite");
  try {
    let runtime = new NebulaMosaicRuntime(path);
    const result = await runtime.handle({ tenantId: "tenant-a", channel: "#main", playerId: "player-a", username: "owl", text: "!mosaic owl in space", now: 1000 });
    assert.equal(result.handled, true);
    assert.match(result.reply, /queued at position 1/);
    assert.match(result.reply, /runner is not configured/);
    assert.equal(result.generated, false);
    const duplicate = await runtime.handle({ tenantId: "tenant-a", channel: "#main", playerId: "player-b", username: "owl2", text: "!mosaic OWL IN SPACE", now: 1500 });
    assert.match(duplicate.reply, /already active or queued/);
    assert.equal(runtime.snapshot("tenant-a", "main").queueLength, 1);
    runtime.close();

    runtime = new NebulaMosaicRuntime(path);
    const snapshot = runtime.snapshot("tenant-a", "main", 2000);
    assert.equal(snapshot.queueLength, 1);
    assert.equal(snapshot.queue[0]?.theme, "owl in space");
    const removed = await runtime.handle({ tenantId: "tenant-a", channel: "main", playerId: "mod", username: "mod", text: "!mosaic remove 1", moderator: true, now: 3000 });
    assert.match(removed.reply, /Removed Mosaic request/);
    assert.equal(runtime.snapshot("tenant-a", "main").queueLength, 0);
    runtime.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Mosaic chat runtime generates, paints with per-player brush settings, and starts a reveal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mosaic-runtime-"));
  const path = resolve(directory, "mosaic.sqlite");
  try {
    const runtime = new NebulaMosaicRuntime(path, async () => ({ target: Array(MOSAIC_CELL_COUNT).fill("G"), provider: "test-provider" }));
    const queued = await runtime.handle({ tenantId: "tenant-a", channel: "main", playerId: "player-a", username: "owl", text: "!mosaic green garden", now: 1000 });
    assert.equal(queued.generated, true);
    assert.match(queued.reply, /generated and installed/);
    assert.equal(queued.state?.artwork?.theme, "green garden");

    const brush = await runtime.handle({ tenantId: "tenant-a", channel: "main", playerId: "player-a", username: "owl", text: "!mosaic brush 3 right", now: 2000 });
    assert.match(brush.reply, /size 3, direction right/);
    const painted = await runtime.handle({ tenantId: "tenant-a", channel: "main", playerId: "player-a", username: "owl", text: "!mosaic paint A1 green", now: 3000 });
    assert.match(painted.reply, /3 cell\(s\) painted/);
    assert.equal(painted.state?.artwork?.painted[0], "G");
    assert.equal(painted.state?.artwork?.painted[1], "G");
    assert.equal(painted.state?.artwork?.painted[2], "G");

    const reveal = await runtime.handle({ tenantId: "tenant-a", channel: "main", playerId: "player-a", username: "owl", text: "!spmt mosaic reveal", now: 4000 });
    assert.match(reveal.reply, /reveal started for 15 seconds/);
    assert.equal(reveal.state?.artwork?.revealing, true);
    runtime.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Mosaic chat runtime rejects moderator-only queue actions from regular players", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mosaic-runtime-"));
  const path = resolve(directory, "mosaic.sqlite");
  try {
    const runtime = new NebulaMosaicRuntime(path);
    await runtime.handle({ tenantId: "tenant-a", channel: "main", playerId: "player-a", username: "owl", text: "!mosaic owl", now: 1000 });
    const result = await runtime.handle({ tenantId: "tenant-a", channel: "main", playerId: "player-a", username: "owl", text: "!mosaic clear", now: 2000 });
    assert.match(result.reply, /Only a broadcaster or moderator/);
    assert.equal(runtime.snapshot("tenant-a", "main").queueLength, 1);
    runtime.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
