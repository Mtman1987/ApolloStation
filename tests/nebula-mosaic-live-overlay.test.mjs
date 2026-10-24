import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createNebulaArcadeLiveHost } from "../apps/nebula-arcade/dist/nebula-arcade-live-server.js";

test("public Mosaic overlay and snapshot are wired, cache-safe, and tenant-channel scoped", async t => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mosaic-overlay-"));
  const host = createNebulaArcadeLiveHost({
    databasePath: join(directory, "nebula.db"),
    tenantId: "tenant-a",
    channelId: "channel-a",
    channels: ["channel-b"],
    spmtOrigin: "https://spmt.invalid",
    publicOrigin: "https://nebula.invalid",
    credential: "x".repeat(40),
    port: 0,
    host: "127.0.0.1",
    fetchImpl: async () => { throw new Error("unexpected external request in public overlay test"); },
    buildSha: "test",
  });
  t.after(async () => { await host.close().catch(() => undefined); rmSync(directory, { recursive: true, force: true }); });
  await host.listen();
  const address = host.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  const page = await fetch(`${origin}/mosaic?channel=channel-a`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Nebula Mosaic/);
  assert.match(page.headers.get("cache-control") || "", /no-store/);

  const script = await fetch(`${origin}/assets/nebula-arcade/mosaic-overlay.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /v1\/nebula\/mosaic\/snapshot/);

  const snapshot = await fetch(`${origin}/v1/nebula/mosaic/snapshot?channel=channel-b`);
  assert.equal(snapshot.status, 200);
  assert.match(snapshot.headers.get("cache-control") || "", /no-store/);
  const publicState = await snapshot.json();
  assert.equal(publicState.artwork, null);
  assert.equal(publicState.queueLength, 0);
  assert.deepEqual(publicState.queue, []);

  const denied = await fetch(`${origin}/v1/nebula/mosaic/snapshot?channel=not-configured`);
  assert.equal(denied.status, 404);
});
