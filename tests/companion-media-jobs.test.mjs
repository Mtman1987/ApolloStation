import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompanionMediaJobs, mediaFileNameFromUrl } from "../apps/companion/dist/index.js";

function fixture(options = {}) {
  const libraryPath = mkdtempSync(join(tmpdir(), "apollo-companion-media-"));
  const jobs = new CompanionMediaJobs({ libraryPath, ffmpegPath: "__missing_ffmpeg__", ...options });
  return { libraryPath, jobs };
}

async function waitForJob(jobs, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = jobs.snapshot().find((candidate) => candidate.id === id);
    if (job && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for Companion media job ${id}`);
}

test("Companion cache names are deterministic and cannot escape the media library", () => {
  const first = mediaFileNameFromUrl("https://media.example/path/movie.mkv?token=redacted", "../../Movie Night.mkv");
  const second = mediaFileNameFromUrl("https://media.example/path/movie.mkv?token=redacted", "../../Movie Night.mkv");
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{12}-Movie-Night\.mkv$/);
  assert.equal(first.includes(".."), false);
});

test("Companion downloads remain opt-in, HTTPS-only, and never adopt untagged user media", () => {
  const disabled = fixture({ downloadsEnabled: false });
  assert.throws(() => disabled.jobs.download({ url: "https://media.example/movie.mp4" }), /disabled/i);
  rmSync(disabled.libraryPath, { recursive: true, force: true });

  const enabled = fixture({ downloadsEnabled: true });
  try {
    assert.throws(() => enabled.jobs.download({ url: "http://media.example/movie.mp4" }), /HTTPS/i);
    const url = "https://media.example/movie.mp4";
    const target = mediaFileNameFromUrl(url);
    writeFileSync(join(enabled.libraryPath, target), Buffer.alloc(8));
    assert.throws(() => enabled.jobs.download({ url }), /non-cache media file/i);
  } finally {
    rmSync(enabled.libraryPath, { recursive: true, force: true });
  }
});

test("Companion LRU pruning removes only tagged download-cache files", () => {
  const { libraryPath, jobs } = fixture({ downloadsEnabled: true });
  try {
    writeFileSync(join(libraryPath, "imported.mp4"), Buffer.alloc(10));
    writeFileSync(join(libraryPath, "cached.mp4"), Buffer.alloc(20));
    writeFileSync(join(libraryPath, "cached.mp4.cache.json"), JSON.stringify({ completedAt: "2026-01-01T00:00:00.000Z" }));
    const result = jobs.pruneDownloads(0);
    assert.equal(result.removed.length, 1);
    assert.equal(existsSync(join(libraryPath, "cached.mp4")), false);
    assert.equal(existsSync(join(libraryPath, "imported.mp4")), true);
  } finally {
    rmSync(libraryPath, { recursive: true, force: true });
  }
});

test("Companion HTTPS download writes a tagged deterministic cache entry with checksum verification", async () => {
  const payload = Buffer.from("companion-media-payload");
  const digest = createHash("sha256").update(payload).digest("hex");
  const { libraryPath, jobs } = fixture({
    downloadsEnabled: true,
    now: () => "2026-08-25T04:10:00.000Z",
    idFactory: () => "download-1",
    fetchFn: async () => new Response(payload, { status: 200, headers: { "content-length": String(payload.length) } }),
  });
  try {
    const started = jobs.download({ url: "https://media.example/movie.mp4", expectedSha256: digest, maxBytes: 1024 });
    const completed = await waitForJob(jobs, started.id);
    assert.equal(completed.status, "completed");
    const status = jobs.cacheStatus();
    assert.equal(status.entries.length, 1);
    assert.equal(status.entries[0].bytes, payload.length);
    const outputPath = join(libraryPath, status.entries[0].name);
    assert.equal(readFileSync(outputPath, "utf8"), payload.toString("utf8"));
    assert.equal(existsSync(`${outputPath}.cache.json`), true);
  } finally {
    rmSync(libraryPath, { recursive: true, force: true });
  }
});

test("Companion rejects a bad download checksum and removes the untrusted partial", async () => {
  const payload = Buffer.from("wrong-payload");
  const { libraryPath, jobs } = fixture({
    downloadsEnabled: true,
    idFactory: () => "download-bad",
    fetchFn: async () => new Response(payload, { status: 200, headers: { "content-length": String(payload.length) } }),
  });
  try {
    const started = jobs.download({ url: "https://media.example/wrong.mp4", expectedSha256: "0".repeat(64), maxBytes: 1024 });
    const failed = await waitForJob(jobs, started.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /checksum/i);
    assert.equal(jobs.cacheStatus().entries.length, 0);
    assert.equal(existsSync(join(libraryPath, `${failed.outputName}.part`)), false);
  } finally {
    rmSync(libraryPath, { recursive: true, force: true });
  }
});
