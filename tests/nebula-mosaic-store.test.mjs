import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SqliteNebulaMosaicStore, normalizeMosaicQueueState } from "../apps/nebula-arcade/dist/mosaic-store.js";
import { MOSAIC_CELL_COUNT, queueMosaicThemeRequest, claimNextMosaicRequest, installMosaicQueueTemplate } from "../apps/nebula-arcade/dist/mosaic-core.js";

test("SQLite Mosaic state survives store restart and isolates tenant/channel records", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mosaic-store-"));
  const path = resolve(directory, "mosaic.sqlite");
  try {
    let store = new SqliteNebulaMosaicStore(path);
    const saved = store.update("tenant-a", "#main", (state) => {
      queueMosaicThemeRequest(state, { id: "request-a", theme: "pixel ocean", playerId: "player-a", now: 1000 });
      claimNextMosaicRequest(state, 2000);
      installMosaicQueueTemplate(state, "request-a", Array(MOSAIC_CELL_COUNT).fill("C"), {}, 3000);
      state.current.painted[0] = "C";
      state.current.paintedBy[0] = "player-a";
      return state.current.id;
    }, 4000);
    assert.match(saved.result, /^mosaic:/);
    store.close();

    store = new SqliteNebulaMosaicStore(path);
    const recovered = store.get("tenant-a", "main");
    assert.equal(recovered.current?.theme, "pixel ocean");
    assert.equal(recovered.current?.status, "active");
    assert.equal(recovered.current?.painted[0], "C");
    assert.equal(recovered.current?.paintedBy[0], "player-a");
    assert.equal(store.get("tenant-a", "other").current, undefined);
    assert.equal(store.get("tenant-b", "main").current, undefined);
    store.update("tenant-a", "main", (state) => { state.current!.painted[1] = "C"; return true; }, 5000);
    assert.equal(store.get("tenant-a", "main").current?.painted[1], "C");
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Mosaic persisted-state normalization bounds collections and rejects malformed artwork", () => {
  const normalized = normalizeMosaicQueueState({
    queue: [{ id: "bad", theme: "x", status: "impossible" }],
    current: { id: "broken", target: ["not-a-color"] },
    saves: [{ id: "broken", target: [] }],
    sharedProjects: [{ id: "bad", artworkId: "bad", template: {} }],
  });
  assert.equal(normalized.current, undefined);
  assert.equal(normalized.queue.length, 0);
  assert.equal(normalized.saves.length, 0);
  assert.equal(normalized.sharedProjects.length, 0);
});
