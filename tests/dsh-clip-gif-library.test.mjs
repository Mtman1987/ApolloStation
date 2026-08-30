import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DSH_CLIP_CAPTURE_SECONDS,
  DSH_CLIP_GIF_LIMIT,
  DSH_CLIP_ROTATION_MS,
  SqliteDshClipGifStore,
  buildDshClipCaptureRequest,
} from "../apps/discord-stream-hub/dist/index.js";

const gif = () => Uint8Array.from(Buffer.from("GIF89a"));

test("DSH keeps the newest ten 60-second GIFs and rotates them every ten minutes", () => {
  const directory = mkdtempSync(join(tmpdir(), "dsh-clip-gifs-"));
  try {
    const store = new SqliteDshClipGifStore(join(directory, "dsh.sqlite"));
    for (let index = 0; index < 11; index += 1) store.put({ schemaVersion: 1, tenantId: "tenant-a", streamerLogin: "Captain", clipId: `clip-${String(index).padStart(2, "0")}`, capturedAt: new Date(Date.UTC(2026, 7, 30, 12, index)).toISOString(), durationSeconds: 60, sourceUrl: `https://clips.example/${index}`, gif: gif() });
    const items = store.list("tenant-a", "captain");
    assert.equal(items.length, DSH_CLIP_GIF_LIMIT);
    assert.equal(items.some((item) => item.clipId === "clip-00"), false);
    assert.notEqual(store.select("tenant-a", "captain", 0).clipId, store.select("tenant-a", "captain", DSH_CLIP_ROTATION_MS).clipId);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("DSH clip capture policy is bounded and rejects unsafe input", () => {
  const request = buildDshClipCaptureRequest({ tenantId: "tenant-a", streamerLogin: "Captain", clipId: "clip-1", sourceUrl: "https://clips.example/live.mp4" });
  assert.deepEqual({ durationSeconds: request.durationSeconds, width: request.width, fps: request.fps, loop: request.loop }, { durationSeconds: DSH_CLIP_CAPTURE_SECONDS, width: 480, fps: 10, loop: true });
  assert.throws(() => buildDshClipCaptureRequest({ tenantId: "tenant-a", streamerLogin: "captain", clipId: "clip-1", sourceUrl: "http://clips.example/live.mp4" }), /HTTPS/);
});
