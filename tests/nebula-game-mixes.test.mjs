import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteNebulaGameMixStore, nebulaGameMixSourceWidgetId, parseNebulaGameMixSourceWidgetId, nebulaGameMixToLegacyScene } from "../apps/nebula-arcade/dist/game-mixes.js";

test("Nebula Game Mix keeps one stable source id while games and layout change", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mixes-"));
  const databasePath = join(directory, "arcade.sqlite");
  try {
    const store = new SqliteNebulaGameMixStore(databasePath);
    const first = store.save("tenant-a", {
      id: "game-night",
      name: "Game Night",
      mode: "simultaneous",
      layers: [
        { gameId: "tag", x: 0, y: 0, width: 60, height: 100, opacity: 1, style: "full", zIndex: 2 },
        { gameId: "quackverse", x: 60, y: 0, width: 40, height: 100, opacity: 0.85, style: "compact", zIndex: 1 },
      ],
    }, "2026-08-27T05:00:00.000Z");

    const sourceId = nebulaGameMixSourceWidgetId(first.id);
    assert.equal(sourceId, "game-mix:game-night");
    assert.equal(parseNebulaGameMixSourceWidgetId(sourceId), "game-night");
    assert.deepEqual(first.layers.map((layer) => [layer.gameId, layer.zIndex]), [["quackverse", 0], ["tag", 1]]);

    const updated = store.save("tenant-a", {
      id: "game-night",
      name: "Game Night",
      mode: "activity",
      layers: [
        { gameId: "tag", enabled: true, x: 0, y: 0, width: 100, height: 100, style: "minimal" },
        { gameId: "bingo", enabled: true, x: 0, y: 0, width: 100, height: 100, style: "full" },
      ],
    }, "2026-08-27T05:10:00.000Z");

    assert.equal(nebulaGameMixSourceWidgetId(updated.id), sourceId);
    assert.equal(updated.createdAt, first.createdAt);
    assert.equal(updated.mode, "activity");
    assert.deepEqual(updated.layers.map((layer) => layer.gameId), ["tag", "bingo"]);
    assert.deepEqual(nebulaGameMixToLegacyScene(updated).layers.map((layer) => layer.gameId), ["tag", "bingo"]);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Nebula Game Mix supports manual and rotating variants without per-game URLs", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-mix-modes-"));
  const store = new SqliteNebulaGameMixStore(join(directory, "arcade.sqlite"));
  try {
    const rotating = store.save("tenant-a", {
      id: "rotation",
      name: "Rotation",
      mode: "rotate",
      rotationSeconds: 30,
      layers: [
        { gameId: "chatgarden" },
        { gameId: "wordstorm" },
        { gameId: "petrace" },
      ],
    });
    assert.equal(rotating.rotationSeconds, 30);
    assert.equal(rotating.layers.length, 3);

    const manual = store.save("tenant-a", {
      id: "focus",
      name: "Focus",
      mode: "manual",
      activeGameId: "wordstorm",
      layers: [
        { gameId: "wordstorm", enabled: true },
        { gameId: "tag", enabled: true },
      ],
    });
    assert.equal(manual.activeGameId, "wordstorm");
    assert.throws(() => store.save("tenant-a", { id: "bad", name: "Bad", mode: "manual", activeGameId: "bingo", layers: [{ gameId: "tag" }] }), /must be enabled/);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
