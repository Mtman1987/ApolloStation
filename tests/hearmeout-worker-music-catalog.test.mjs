import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HEARMEOUT_MUSIC_CATALOG_LIMIT,
  HEARMEOUT_MUSIC_QUERY_HISTORY_LIMIT,
  HearMeOutWorkerMusicCatalog,
  scoreHearMeOutCatalogTrack,
} from "../apps/hearmeout/dist/index.js";

function track(index, overrides = {}) {
  return { id: `track-${index}`, title: `Song ${index}`, artist: `Artist ${index}`, url: `https://media.example/${index}`, duration: 180000, ...overrides };
}

test("worker music catalog persists across restart and refreshes existing entries to the front", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-catalog-restart-"));
  const file = join(dir, "search-index.json");
  let now = "2026-08-24T20:00:00.000Z";
  let catalog = new HearMeOutWorkerMusicCatalog({ catalogFile: file, now: () => now });
  catalog.save({ track: track(1), query: "first search" });
  catalog.save({ track: track(2), query: "second search" });
  now = "2026-08-24T20:01:00.000Z";
  catalog.save({ track: track(1, { title: "Song One Updated" }), query: "updated search" });
  assert.deepEqual(catalog.read().map((item) => item.id), ["track-1", "track-2"]);
  assert.deepEqual(catalog.read()[0].queries, ["first search", "updated search"]);

  catalog = new HearMeOutWorkerMusicCatalog({ catalogFile: file, now: () => now });
  assert.equal(catalog.read()[0].title, "Song One Updated");
  assert.equal(catalog.read()[0].savedAt, "2026-08-24T20:00:00.000Z");
  assert.equal(catalog.read()[0].updatedAt, "2026-08-24T20:01:00.000Z");
  rmSync(dir, { recursive: true, force: true });
});

test("catalog search preserves donor substring and word-overlap ranking", () => {
  const exactish = { ...track(1), title: "Blue Moon", queries: [], thumbnail: "", savedAt: "2026-08-24T20:00:00.000Z", updatedAt: "2026-08-24T20:00:00.000Z" };
  const words = { ...track(2), title: "Blue", artist: "Moonlight Band", queries: [], thumbnail: "", savedAt: exactish.savedAt, updatedAt: exactish.updatedAt };
  assert.equal(scoreHearMeOutCatalogTrack(exactish, "blue moon"), 80);
  assert.equal(scoreHearMeOutCatalogTrack(words, "blue moon"), 20);

  const dir = mkdtempSync(join(tmpdir(), "hmo-catalog-search-"));
  const catalog = new HearMeOutWorkerMusicCatalog({ catalogFile: join(dir, "search-index.json"), now: () => exactish.savedAt });
  catalog.save({ track: words });
  catalog.save({ track: exactish });
  assert.deepEqual(catalog.search("blue moon").map((item) => item.id), ["track-1", "track-2"]);
  rmSync(dir, { recursive: true, force: true });
});

test("remembered query phrases participate in later search ranking", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-catalog-query-"));
  const catalog = new HearMeOutWorkerMusicCatalog({ catalogFile: join(dir, "search-index.json"), now: () => "2026-08-24T20:00:00.000Z" });
  catalog.save({ track: track(1, { title: "Unrelated Title" }), query: "road trip anthem" });
  assert.equal(catalog.search("road trip anthem")[0].id, "track-1");
  rmSync(dir, { recursive: true, force: true });
});

test("catalog keeps only the most recent twenty distinct query phrases per track", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-catalog-history-"));
  const catalog = new HearMeOutWorkerMusicCatalog({ catalogFile: join(dir, "search-index.json"), now: () => "2026-08-24T20:00:00.000Z" });
  for (let index = 0; index < HEARMEOUT_MUSIC_QUERY_HISTORY_LIMIT + 5; index += 1) catalog.save({ track: track(1), query: `query-${index}` });
  const queries = catalog.read()[0].queries;
  assert.equal(queries.length, HEARMEOUT_MUSIC_QUERY_HISTORY_LIMIT);
  assert.equal(queries[0], "query-5");
  assert.equal(queries.at(-1), "query-24");
  rmSync(dir, { recursive: true, force: true });
});

test("catalog enforces donor thousand-track cap and supports deletion", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-catalog-cap-"));
  const catalog = new HearMeOutWorkerMusicCatalog({ catalogFile: join(dir, "search-index.json"), now: () => "2026-08-24T20:00:00.000Z" });
  for (let index = 0; index < HEARMEOUT_MUSIC_CATALOG_LIMIT + 3; index += 1) catalog.save({ track: track(index) });
  assert.equal(catalog.read().length, HEARMEOUT_MUSIC_CATALOG_LIMIT);
  assert.equal(catalog.read()[0].id, `track-${HEARMEOUT_MUSIC_CATALOG_LIMIT + 2}`);
  assert.equal(catalog.read().some((item) => item.id === "track-0"), false);
  const removed = catalog.remove("track-1002");
  assert.equal(removed.removed, 1);
  assert.equal(catalog.read().some((item) => item.id === "track-1002"), false);
  rmSync(dir, { recursive: true, force: true });
});

test("corrupt catalog is disposable and next save rebuilds it", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-catalog-corrupt-"));
  const file = join(dir, "search-index.json");
  const catalog = new HearMeOutWorkerMusicCatalog({ catalogFile: file, now: () => "2026-08-24T20:00:00.000Z" });
  assert.deepEqual(catalog.read(), []);
  catalog.save({ track: track(1) });
  assert.equal(catalog.read().length, 1);
  rmSync(dir, { recursive: true, force: true });
});
