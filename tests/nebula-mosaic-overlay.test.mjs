import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createNebulaArcadeSandboxHost } from "../apps/nebula-arcade/dist/nebula-runtime-host-base.js";
import { SqliteNebulaMosaicStore } from "../apps/nebula-arcade/dist/mosaic-store.js";
import { queueMosaicThemeRequest, claimNextMosaicRequest, installMosaicQueueTemplate, MOSAIC_CELL_COUNT } from "../apps/nebula-arcade/dist/mosaic-core.js";

test("Nebula serves the public Mosaic overlay and a sanitized live snapshot for allowed channels", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mosaic-overlay-"));
  const databasePath = resolve(directory, "nebula.sqlite");
  const host = createNebulaArcadeSandboxHost({ databasePath, tenantId: "tenant-a", channelId: "main", channels: ["main", "side"], port: 0, host: "127.0.0.1" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const origin = "http://127.0.0.1:" + address.port;

    const page = await fetch(origin + "/overlay/mosaic?channel=main");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Community Mosaic/);
    const pixelbattleOverlay = await fetch(origin + "/overlay/arcade/pixelbattle");
    assert.equal(pixelbattleOverlay.status, 200);
    assert.match(await pixelbattleOverlay.text(), /Nebula Arcade · Community Mosaic/);
    const script = await fetch(origin + "/assets/nebula-arcade/mosaic-overlay.js");
    assert.equal(script.status, 200);
    assert.match(await script.text(), /v1\/nebula\/mosaic\/snapshot/);

    const store = new SqliteNebulaMosaicStore(databasePath);
    store.update("tenant-a", "main", (state) => {
      queueMosaicThemeRequest(state, { id: "overlay-request", theme: "blue bird", playerId: "private-player-id", now: 1000 });
      const request = claimNextMosaicRequest(state, 2000);
      assert.ok(request);
      installMosaicQueueTemplate(state, request.id, Array(MOSAIC_CELL_COUNT).fill("B"), {}, 3000);
      state.current.painted[0] = "B";
      state.current.paintedBy[0] = "private-player-id";
    }, 4000);
    store.close();

    const snapshotResponse = await fetch(origin + "/v1/nebula/mosaic/snapshot?channel=main");
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.artwork.theme, "blue bird");
    assert.equal(snapshot.artwork.painted[0], "B");
    assert.equal("paintedBy" in snapshot.artwork, false);
    const denied = await fetch(origin + "/v1/nebula/mosaic/snapshot?channel=not-allowed");
    assert.equal(denied.status, 404);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
