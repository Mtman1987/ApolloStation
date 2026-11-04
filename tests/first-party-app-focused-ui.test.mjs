import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const owned = ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"];
const foundation = read("packages/app-foundation/src/product-web.ts");
const shellSource = `${read("apps/spacemountain/src/shell-ui-base.ts")}\n${read("apps/spacemountain/src/shell-ui.ts")}`;
const integratedSource = `${read("apps/spacemountain-web/src/integrated-server-base.ts")}\n${read("apps/spacemountain-web/src/integrated-server.ts")}`;

test("focused owned apps keep their pages inside their product packages", () => {
  for (const appId of owned) {
    const source = read(`apps/${appId}/src/web-server.ts`);
    assert.match(source, new RegExp(appId === "hearmeout" ? "HearMeOut" : appId === "discord-stream-hub" ? "Discord Stream Hub" : appId === "companion" ? "SpaceMountain Companion" : appId === "mountainview" ? "MountainView" : "StreamWeaver"));
  }
  assert.match(foundation, /data-nav/);
  assert.match(foundation, /data-page/);
  assert.match(foundation, /overflow:auto/);
});

test("owned app UI inherits canonical theme and layout through AppFrame", () => {
  for (const pattern of [/PRODUCT_UI_CSS/, /spmt\.embed/, /host\.hello/, /theme\.changed/, /layout\.changed/, /--spmt-shell-available-height/, /--spmt-accent-secondary/]) assert.match(foundation, pattern);
  assert.match(shellSource, /createAppFrameHost/);
  assert.match(shellSource, /buildAppFrameTarget/);
  assert.doesNotMatch(integratedSource, /renderFirstPartyAppSurface|first-party-app-surfaces/);
});

test("Nebula Arcade stays on its functional runtime while using the same catalog and shell frame", () => {
  assert.match(integratedSource, /nebulaArcadeOrigin/);
  assert.match(shellSource, /"nebula-arcade"[\s\S]*label: "Games"[\s\S]*label: "Play"[\s\S]*label: "Scores"[\s\S]*label: "Settings"/);
  assert.match(shellSource, /nebula-arcade\/solar-system\.webp/);
});
