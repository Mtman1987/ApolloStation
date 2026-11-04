import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DshNebulaGameplayCaptureService,
  DshNebulaGameplayHttpAdapter,
  SqliteDshNebulaGameplayStore,
} from "../apps/discord-stream-hub/dist/index.js";
import {
  NEBULA_GAMEPLAY_CAPTURE_SECONDS,
  NEBULA_GAMEPLAY_ROTATION_SECONDS,
  buildNebulaGameplayManifest,
  renderNebulaGameplayCapturePage,
} from "../apps/nebula-arcade/dist/index.js";

const gif = () => Uint8Array.from(Buffer.from("GIF89a"));

test("Nebula publishes the 20-game, 60-second showcase manifest without changing the normal app surface", () => {
  const manifest = buildNebulaGameplayManifest("https://apollo.example");
  assert.equal(manifest.games.length, 20);
  assert.equal(manifest.captureSeconds, 60);
  assert.equal(manifest.rotationSeconds, 600);
  assert.equal(manifest.games.every((game) => game.captureSeconds === 60 && new URL(game.captureUrl).origin === "https://apollo.example"), true);
  const html = renderNebulaGameplayCapturePage({ gameId: "tag", playerCount: 2, leaderboard: [{ displayName: "Captain", score: 300 }], actions: [{ schemaVersion: 1, id: "a-1", tenantId: "tenant-a", channel: "main", gameId: "tag", actorId: "captain", username: "captain", displayName: "Captain", action: "tag", args: ["friend"], message: "!tag friend", occurredAt: "2026-08-30T12:00:00.000Z" }] });
  assert.match(html, /data-nebula-gameplay-capture="tag"/);
  assert.match(html, /Captain/);
  assert.match(html, /friend/);
  assert.match(html, /60-second capture · rotates every 10 minutes/);
  assert.doesNotMatch(html, /spmt-product-backdrop/);
});

test("DSH captures one missing game per cycle and persists renderer-neutral GIFs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dsh-nebula-gameplay-"));
  const databasePath = join(directory, "dsh.sqlite");
  const requests = [];
  try {
    let store = new SqliteDshNebulaGameplayStore(databasePath);
    const service = new DshNebulaGameplayCaptureService(store, { capture: async (request) => { requests.push(request); return gif(); } }, () => "2026-08-30T12:00:00.000Z");
    const manifest = buildNebulaGameplayManifest("https://apollo.example");
    const report = await service.reconcile(manifest);
    assert.equal(report.attempted, 1);
    assert.equal(report.completed.length, 1);
    assert.equal(requests[0].captureSeconds, NEBULA_GAMEPLAY_CAPTURE_SECONDS);
    assert.deepEqual({ width: requests[0].width, height: requests[0].height, fps: requests[0].fps, outputWidth: requests[0].outputWidth, palette: requests[0].palette }, { width: 800, height: 450, fps: 10, outputWidth: 480, palette: { maxColors: 128, statsMode: "diff", dither: "bayer", bayerScale: 4, diffMode: "rectangle" } });
    store.close();
    store = new SqliteDshNebulaGameplayStore(databasePath);
    assert.equal(store.list().length, 1);
    assert.equal(store.needed(manifest).length, 1);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("DSH current GIF honors explicit and default rotation slots with a lightweight fallback", () => {
  const directory = mkdtempSync(join(tmpdir(), "dsh-nebula-http-"));
  const databasePath = join(directory, "dsh.sqlite");
  const fallback = "https://apollo.example/assets/nebula-arcade/games-showcase.gif?v=3";
  try {
    const store = new SqliteDshNebulaGameplayStore(databasePath);
    const manifest = buildNebulaGameplayManifest("https://apollo.example");
    for (const game of manifest.games.slice(0, 2)) store.put({ schemaVersion: 1, ...game, capturedAt: "2026-08-30T12:00:00.000Z", gif: gif() });
    const secondSlotTime = NEBULA_GAMEPLAY_ROTATION_SECONDS * 1_000;
    const adapter = new DshNebulaGameplayHttpAdapter(store, fallback, () => secondSlotTime);
    const explicitFirst = adapter.handle({ method: "GET", path: "/v1/discord-stream-hub/nebula-gameplay/current.gif", slot: "0" });
    const defaultSecond = adapter.handle({ method: "GET", path: "/v1/discord-stream-hub/nebula-gameplay/current.gif" });
    assert.equal(explicitFirst.status, 200);
    assert.equal(defaultSecond.status, 200);
    assert.equal(JSON.parse(adapter.handle({ method: "GET", path: "/v1/discord-stream-hub/nebula-gameplay/gameplay" }).body).active.id, manifest.games[1].id);
    store.close();
    const empty = new SqliteDshNebulaGameplayStore(join(directory, "empty.sqlite"));
    assert.deepEqual(new DshNebulaGameplayHttpAdapter(empty, fallback).handle({ method: "GET", path: "/v1/discord-stream-hub/nebula-gameplay/current.gif" }).headers.location, fallback);
    empty.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
