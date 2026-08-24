import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteNebulaOverlaySceneStore } from "../apps/nebula-arcade/dist/overlay-scenes.js";

test("Nebula overlay scenes persist multiple ordered game layers", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-scenes-"));
  const databasePath = join(directory, "arcade.sqlite");
  try {
    const first = new SqliteNebulaOverlaySceneStore(databasePath);
    const scene = first.save("tenant-a", {
      id: "main-stream",
      name: "Main Stream",
      layers: [
        { gameId: "chat-tag", enabled: true, zIndex: 4 },
        { gameId: "chatgarden", enabled: true, zIndex: 2 },
      ],
    }, "2026-08-24T12:00:00.000Z");
    assert.deepEqual(scene.layers.map((layer) => [layer.gameId, layer.zIndex]), [["chatgarden", 0], ["chat-tag", 1]]);
    first.close();

    const reopened = new SqliteNebulaOverlaySceneStore(databasePath);
    assert.equal(reopened.list("tenant-a").length, 1);
    assert.equal(reopened.get("tenant-a", "main-stream").name, "Main Stream");
    const updated = reopened.save("tenant-a", { id: "main-stream", name: "Community Night", layers: [{ gameId: "quackverse", enabled: true, zIndex: 0 }] }, "2026-08-24T12:10:00.000Z");
    assert.equal(updated.createdAt, "2026-08-24T12:00:00.000Z");
    assert.equal(updated.updatedAt, "2026-08-24T12:10:00.000Z");
    assert.deepEqual(updated.layers.map((layer) => layer.gameId), ["quackverse"]);
    assert.equal(reopened.delete("tenant-a", "main-stream"), true);
    assert.equal(reopened.list("tenant-a").length, 0);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Nebula overlay scenes reject unknown or duplicate game layers", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-scenes-invalid-"));
  const store = new SqliteNebulaOverlaySceneStore(join(directory, "arcade.sqlite"));
  try {
    assert.throws(() => store.save("tenant-a", { id: "bad", name: "Bad", layers: [{ gameId: "not-a-game", enabled: true, zIndex: 0 }] }), /invalid game layer/);
    assert.throws(() => store.save("tenant-a", { id: "duplicate", name: "Duplicate", layers: [{ gameId: "chat-tag", enabled: true, zIndex: 0 }, { gameId: "chat-tag", enabled: true, zIndex: 1 }] }), /invalid game layer/);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
