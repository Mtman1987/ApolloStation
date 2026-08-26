import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surfaceSource = readFileSync(new URL("../apps/spacemountain-web/src/first-party-app-surfaces.ts", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");
const integratedSource = readFileSync(new URL("../apps/spacemountain-web/src/integrated-server.ts", import.meta.url), "utf8");

test("focused first-party apps own real pages and fill the existing rocket dock with app navigation", () => {
  for (const appId of ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"]) {
    assert.match(surfaceSource, new RegExp(`id: "${appId}"`));
  }
  assert.match(surfaceSource, /data-focused-nav/);
  assert.match(surfaceSource, /data-focused-nav-item/);
  assert.match(surfaceSource, /spmt-dock-owned/);
  assert.match(surfaceSource, /spmt-dock-app-icon/);
  assert.match(surfaceSource, /IntersectionObserver/);
  assert.match(surfaceSource, /scrollIntoView/);
  assert.match(surfaceSource, /label: "Live"/);
  assert.match(surfaceSource, /label: "Shoutouts"/);
  assert.match(surfaceSource, /label: "Calendar"/);
  assert.match(surfaceSource, /label: "Commands"/);
  assert.match(surfaceSource, /label: "Economy"/);
  assert.match(surfaceSource, /label: "Pokémon"/);
  assert.match(surfaceSource, /label: "Room"/);
  assert.match(surfaceSource, /label: "Music"/);
  assert.match(surfaceSource, /label: "Voice Bridge"/);
  assert.match(surfaceSource, /label: "Scan QR"/);
  assert.match(surfaceSource, /label: "Camera"/);
  assert.match(surfaceSource, /label: "Relay"/);
  assert.match(surfaceSource, /label: "Workflows"/);
  assert.match(surfaceSource, /label: "Diagnostics"/);
});

test("every focused app keeps unique scene art while inheriting the shared SpaceMountain appearance", () => {
  for (const appId of ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"]) {
    assert.match(surfaceSource, new RegExp(`body\\[data-app="${appId}"\\] \\.scene-art`));
    assert.match(surfaceSource, new RegExp(`'${appId}':`));
  }
  assert.match(surfaceSource, /--spmt-glass-opacity/);
  assert.match(surfaceSource, /--spmt-blur/);
  assert.match(surfaceSource, /--spmt-stars/);
  assert.match(surfaceSource, /--spmt-accent-secondary/);
  assert.match(surfaceSource, /dataset\.sharedUi='inherited'/);
  assert.match(surfaceSource, /--depth1:[^;]*\.9/);
  assert.match(surfaceSource, /--depth2:[^;]*\.66/);
  assert.match(surfaceSource, /--depth3:[^;]*\.44/);
  assert.match(surfaceSource, /--depth4:[^;]*\.3/);
  assert.match(surfaceSource, /feature-grid\{[^}]*background:transparent/);
});

test("Nebula Arcade stays on its functional runtime and keeps its own focused navigation and solar-system scene", () => {
  assert.doesNotMatch(surfaceSource, /FirstPartyAppSurfaceId = [^;]*nebula-arcade/);
  assert.match(integratedSource, /url\.pathname === "\/apps\/nebula-arcade"/);
  assert.match(shellSource, /"nebula-arcade"[\s\S]*label: "Games"[\s\S]*label: "Play"[\s\S]*label: "Scores"[\s\S]*label: "Settings"/);
  assert.match(shellSource, /nebula-arcade\/solar-system\.webp/);
});