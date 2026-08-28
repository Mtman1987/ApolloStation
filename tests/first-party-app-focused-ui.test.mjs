import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surfaceSource = readFileSync(new URL("../apps/spacemountain-web/src/first-party-app-surfaces.ts", import.meta.url), "utf8");
const shellSource = `${readFileSync(new URL("../apps/spacemountain/src/shell-ui-base.ts", import.meta.url), "utf8")}\n${readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8")}`;
const integratedSource = `${readFileSync(new URL("../apps/spacemountain-web/src/integrated-server-base.ts", import.meta.url), "utf8")}\n${readFileSync(new URL("../apps/spacemountain-web/src/integrated-server.ts", import.meta.url), "utf8")}`;

test("focused first-party apps own real pages and fill the existing rocket dock with app navigation", () => {
  for (const appId of ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"]) assert.match(surfaceSource, new RegExp(`id: "${appId}"`));
  assert.match(surfaceSource, /data-themed-app-icon/);
  assert.doesNotMatch(surfaceSource, /APP CONTRACT|Registered first-party module/);
  for (const pattern of [/data-focused-nav/, /data-focused-nav-item/, /data-app-page/, /function showPage/, /spmt-dock-owned/, /spmt-dock-app-icon/, /scrollbar-gutter:stable/, /data-page="overview"/, /label: "Live"/, /label: "Shoutouts"/, /label: "Calendar"/, /label: "Commands"/, /label: "Economy"/, /label: "Pokémon"/, /label: "Room"/, /label: "Music"/, /label: "Voice Bridge"/, /label: "Scan QR"/, /label: "Camera"/, /label: "Relay"/, /label: "Workflows"/, /label: "Diagnostics"/]) assert.match(surfaceSource, pattern);
});

test("every focused app keeps unique scene art while inheriting shared SpaceMountain appearance", () => {
  for (const appId of ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"]) { assert.match(surfaceSource, new RegExp(`body\\[data-app="${appId}"\\] \\.scene-art`)); assert.match(surfaceSource, new RegExp(`'${appId}':`)); }
  for (const pattern of [/--spmt-glass-opacity/, /--spmt-blur/, /--spmt-stars/, /--spmt-accent-secondary/, /dataset\.sharedUi='inherited'/, /feature-grid\{[^}]*background:transparent/]) assert.match(surfaceSource, pattern);
});

test("Nebula Arcade stays on its functional runtime with shared shell navigation and unique scene", () => {
  assert.doesNotMatch(surfaceSource, /FirstPartyAppSurfaceId = [^;]*nebula-arcade/);
  assert.match(integratedSource, /apps\/nebula-arcade|chatTagOrigin/);
  assert.match(shellSource, /"nebula-arcade"[\s\S]*label: "Games"[\s\S]*label: "Play"[\s\S]*label: "Scores"[\s\S]*label: "Settings"/);
  assert.match(shellSource, /nebula-arcade\/solar-system\.webp/);
});
