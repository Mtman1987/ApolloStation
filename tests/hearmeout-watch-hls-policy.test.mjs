import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  HEARMEOUT_WATCH_HLS_BUDGET_BYTES,
  HearMeOutWatchHlsCache,
  buildHearMeOutXtreamVariantMap,
  cleanHearMeOutHlsFileName,
  hearMeOutDefaultAudioTrackIndex,
  isAllowedHearMeOutYoutubeMediaUrl,
  pinHearMeOutHlsManifestToMachine,
  planHearMeOutWatchHlsPrune,
} from "../apps/hearmeout/dist/index.js";

test("HearMeOut watch HLS preserves multi-audio and prefers English by default", () => {
  const tracks = [
    { sourceIndex: 1, language: "hin", title: "Hindi", index: 0 },
    { sourceIndex: 2, language: "eng", title: "English", index: 1 },
  ];
  assert.equal(hearMeOutDefaultAudioTrackIndex(tracks), 1);
  const map = buildHearMeOutXtreamVariantMap({ hasVideo: true, audio: tracks });
  assert.match(map, /v:0,agroup:audio,name:video/);
  assert.match(map, /a:0,agroup:audio,name:Hindi,language:hin/);
  assert.match(map, /a:1,agroup:audio,name:English,language:eng,default:yes/);
});

test("HearMeOut watch HLS validates filenames and YouTube source hosts", () => {
  assert.equal(cleanHearMeOutHlsFileName("stream_0_seg_00001.ts"), "stream_0_seg_00001.ts");
  assert.throws(() => cleanHearMeOutHlsFileName("../secret"), /Invalid HLS file/);
  assert.equal(isAllowedHearMeOutYoutubeMediaUrl("https://rr1---sn.googlevideo.com/videoplayback?id=1"), true);
  assert.equal(isAllowedHearMeOutYoutubeMediaUrl("https://www.youtube.com/watch?v=abcdefghijk"), true);
  assert.equal(isAllowedHearMeOutYoutubeMediaUrl("http://googlevideo.com/video"), false);
  assert.equal(isAllowedHearMeOutYoutubeMediaUrl("https://example.com/video"), false);
});

test("HearMeOut watch HLS pins media and alternate audio playlists to the owning Fly machine", () => {
  const manifest = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="stream_1.m3u8"\nstream_0.m3u8\n';
  const pinned = pinHearMeOutHlsManifestToMachine(manifest, "abc-123");
  assert.match(pinned, /URI="stream_1\.m3u8\?machine=abc123"/);
  assert.match(pinned, /stream_0\.m3u8\?machine=abc123/);
});

test("HearMeOut watch HLS prunes inactive directories oldest first without deleting active jobs", () => {
  const result = planHearMeOutWatchHlsPrune([
    { streamId: "old", bytes: 700, mtimeMs: 1, active: false },
    { streamId: "new", bytes: 700, mtimeMs: 3, active: false },
    { streamId: "active", bytes: 700, mtimeMs: 0, active: true },
  ], 1_400);
  assert.deepEqual(result.removed, [{ streamId: "old", bytes: 700 }]);
  assert.equal(result.bytes, 1_400);
  assert.equal(HEARMEOUT_WATCH_HLS_BUDGET_BYTES, 1_536 * 1024 * 1024);
});

test("HearMeOut watch HLS rejects legacy EVENT manifests and requires a real first media file", () => {
  const root = mkdtempSync(join(tmpdir(), "hmo-hls-"));
  const streamDir = join(root, "vod-42-multiaudio-v2");
  mkdirSync(streamDir, { recursive: true });
  const cache = new HearMeOutWatchHlsCache(root);

  writeFileSync(join(streamDir, "index.m3u8"), "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\nseg_00001.ts\n");
  writeFileSync(join(streamDir, "seg_00001.ts"), "segment");
  assert.equal(cache.hasUsableIndex("vod-42"), false);

  writeFileSync(join(streamDir, "index.m3u8"), "#EXTM3U\nseg_00001.ts\n");
  assert.equal(cache.hasUsableIndex("vod-42"), true);
  rmSync(root, { recursive: true, force: true });
});
