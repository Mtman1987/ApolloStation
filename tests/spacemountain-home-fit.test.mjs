import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const themed = readFileSync(new URL("../apps/spacemountain/src/themed-surface-css.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");

test("SpaceMountain home reserves rows for logo, tagline, and launch actions", () => {
  assert.match(themed, /\.spmt-space-root\[data-spmt-view="home"\] \.spmt-hero-copy\{[^}]*display:grid;[^}]*grid-template-rows:minmax\(0,1fr\) auto auto;/);
  const logoRule = themed.match(/\.spmt-space-root\[data-spmt-view="home"\] \.spmt-hero-logo-large\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(logoRule, /flex:1/);
  assert.match(logoRule, /height:100%/);
  assert.match(themed, /\.spmt-space-root\[data-spmt-view="home"\] \.spmt-space-main[^}]*overflow:hidden/);
  assert.match(shell, /data-nav="apps" class="primary"[^>]*>.*Open Shipyard/);
  assert.match(shell, /data-launch-app="commlink"[^>]*>.*Open Commlink/);
});
