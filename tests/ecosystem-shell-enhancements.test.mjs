import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = readFileSync(new URL("../apps/spacemountain/src/shell-ui-base.ts", import.meta.url), "utf8");
const wrapper = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../apps/spacemountain/src/overlay-bay-ui.ts", import.meta.url), "utf8");
const shell = `${base}\n${wrapper}\n${overlay}`;
const client = readFileSync(new URL("../apps/spacemountain-web/src/client.ts", import.meta.url), "utf8");

test("home is singular, Stella is actionable, and Overlay Bay consumes canonical widgets", () => {
  assert.doesNotMatch(shell, /YOUR APP SUITE/);
  assert.match(shell, /spmt-hero-logo-large/);
  assert.match(shell, /data-stella-form/);
  assert.match(client, /invokeCommunityAssistant|invokeStella/);
  assert.match(shell, /data-overlay-bay|dataset\.overlayBay/);
  assert.match(shell, /overlayWidgets/);
  assert.match(shell, /overlayOutputs/);
  assert.match(overlay, /Canonical stream overlay editor/);
  assert.match(overlay, /Create OBS URL/);
});

test("ecosystem presence deduplicates canonical users and retains every reporting source", () => {
  assert.match(base, /new Map<string, \{ name: string; sources: string\[\] \}>/);
  assert.match(base, /canonicalUserId/);
  assert.match(base, /existing\.sources\.includes/);
});

test("Black Hole and Rocketship remain hidden double-click ecosystem interactions", () => {
  assert.match(base, /data-spmt-black-hole-trigger/);
  assert.match(base, /data-spmt-rocket-trigger/);
  assert.match(base, /addEventListener\("dblclick"/);
  assert.match(base, /rocketArenaBlackHole/);
  assert.match(base, /ENTER HERE/);
  assert.match(base, /Math\.hypot/);
  assert.match(base, /data-spmt-signal-trigger/);
  assert.match(client, /ecosystem\.easter-egg\.\$\{egg\}\.completed\.v1/);
  assert.match(client, /blackHole.*rocket.*signal/s);
  assert.match(client, /Lord Puzzler unlocked/);
});
