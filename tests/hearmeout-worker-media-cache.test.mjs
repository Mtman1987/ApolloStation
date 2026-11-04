import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HEARMEOUT_EXTRACTED_MEDIA_TTL_MS,
  HEARMEOUT_USER_MUSIC_CACHE_LIMIT,
  HearMeOutWorkerMediaCache,
  isHearMeOutContainedWorkerPath,
} from "../apps/hearmeout/dist/index.js";

const ids = Array.from({ length: 30 }, (_, index) => `abcde${String(index).padStart(6, "0")}`);

test("HearMeOut worker music cache persists per-user recent history across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-cache-restart-"));
  let now = 1_000;
  let cache = new HearMeOutWorkerMediaCache({ cacheDir: dir, nowMs: () => now });
  cache.recordUserMusicPlay("user/unsafe", ids[0]);
  now += 100;
  cache.recordUserMusicPlay("user/unsafe", ids[1]);
  assert.deepEqual(cache.listRecent("userunsafe").map((entry) => entry.videoId), [ids[1], ids[0]]);

  cache = new HearMeOutWorkerMediaCache({ cacheDir: dir, nowMs: () => now });
  assert.deepEqual(cache.listRecent("userunsafe").map((entry) => entry.videoId), [ids[1], ids[0]]);
  rmSync(dir, { recursive: true, force: true });
});

test("per-user cache keeps donor limit 25 and only evicts media when no other user references it", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-cache-evict-"));
  const removed = [];
  let now = 2_000;
  const cache = new HearMeOutWorkerMediaCache({ cacheDir: dir, nowMs: () => now++, removeCachedMedia: (videoId) => removed.push(videoId) });
  cache.recordUserMusicPlay("other", ids[0]);
  for (let index = 0; index <= HEARMEOUT_USER_MUSIC_CACHE_LIMIT; index += 1) cache.recordUserMusicPlay("owner", ids[index]);
  assert.equal(cache.listRecent("owner").length, HEARMEOUT_USER_MUSIC_CACHE_LIMIT);
  assert.equal(removed.includes(ids[0]), false, "shared media survives eviction while another user references it");

  for (let index = HEARMEOUT_USER_MUSIC_CACHE_LIMIT + 1; index < ids.length; index += 1) cache.recordUserMusicPlay("owner", ids[index]);
  assert.ok(removed.length > 0);
  rmSync(dir, { recursive: true, force: true });
});

test("replaying a track moves it to the front without duplicating it", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-cache-recent-"));
  let now = 10;
  const cache = new HearMeOutWorkerMediaCache({ cacheDir: dir, nowMs: () => now++ });
  cache.recordUserMusicPlay("user", ids[0]);
  cache.recordUserMusicPlay("user", ids[1]);
  cache.recordUserMusicPlay("user", ids[0]);
  assert.deepEqual(cache.listRecent("user").map((entry) => entry.videoId), [ids[0], ids[1]]);
  rmSync(dir, { recursive: true, force: true });
});

test("extracted media URL cache preserves donor five-hour TTL and audio/video separation", () => {
  let now = 50_000;
  const dir = mkdtempSync(join(tmpdir(), "hmo-cache-url-"));
  const cache = new HearMeOutWorkerMediaCache({ cacheDir: dir, nowMs: () => now });
  const info = { url: "https://media.example/audio", mimeType: "audio/mp4", duration: 180, title: "Song", artist: "Artist" };
  cache.setExtractedInfo(ids[0], "audio", info);
  assert.equal(cache.getExtractedInfo(ids[0], "audio").title, "Song");
  assert.equal(cache.getExtractedInfo(ids[0], "video"), undefined);
  now += HEARMEOUT_EXTRACTED_MEDIA_TTL_MS - 1;
  assert.ok(cache.getExtractedInfo(ids[0], "audio"));
  now += 1;
  assert.equal(cache.getExtractedInfo(ids[0], "audio"), undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("offline media resolver prevents traversal outside worker cache", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-cache-path-"));
  mkdirSync(join(dir, "artist"), { recursive: true });
  writeFileSync(join(dir, "artist", "song.mp3"), "audio");
  const cache = new HearMeOutWorkerMediaCache({ cacheDir: dir });
  const safe = cache.describeOfflineFile("artist/song.mp3");
  assert.equal(safe.relativePath, "artist/song.mp3");
  assert.equal(safe.size, 5);
  assert.throws(() => cache.resolveOfflinePath("../secret.txt"), /escapes/);
  assert.throws(() => cache.resolveOfflinePath("artist/../../secret.txt"), /escapes/);
  assert.equal(isHearMeOutContainedWorkerPath(dir, join(dir, "artist", "song.mp3")), true);
  assert.equal(isHearMeOutContainedWorkerPath(dir, join(dir, "..", "secret.txt")), false);
  rmSync(dir, { recursive: true, force: true });
});

test("corrupt persisted cache index is disposable worker state and rebuilds empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmo-cache-corrupt-"));
  writeFileSync(join(dir, "user-music-cache.json"), "{not-json", "utf8");
  const cache = new HearMeOutWorkerMediaCache({ cacheDir: dir });
  assert.deepEqual(cache.readUserIndex(), {});
  cache.recordUserMusicPlay("user", ids[0]);
  assert.deepEqual(cache.listRecent("user").map((entry) => entry.videoId), [ids[0]]);
  rmSync(dir, { recursive: true, force: true });
});
