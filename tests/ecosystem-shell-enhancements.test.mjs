import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../apps/spacemountain-web/src/client.ts", import.meta.url), "utf8");

test("home is singular, Stella is actionable, and Overlay Bay consumes canonical widgets", () => {
  assert.doesNotMatch(shell, /YOUR APP SUITE/);
  assert.match(shell, /spmt-hero-logo-large/);
  assert.match(shell, /data-stella-form/);
  assert.match(client, /invokeCommunityAssistant|invokeStella/);
  assert.match(shell, /data\.overlayBay|dataset\.overlayBay/);
  assert.match(shell, /overlayWidgets/);
  assert.match(shell, /overlayOutputs/);
});

test("ecosystem presence deduplicates canonical users and retains every reporting source", () => {
  assert.match(shell, /new Map<string, \{ name: string; sources: string\[\] \}>/);
  assert.match(shell, /canonicalUserId/);
  assert.match(shell, /existing\.sources\.includes/);
});

test("Black Hole and Rocketship remain hidden double-click ecosystem interactions", () => {
  assert.match(shell, /data-spmt-black-hole-trigger/);
  assert.match(shell, /data-spmt-rocket-trigger/);
  assert.match(shell, /addEventListener\("dblclick"/);
  assert.match(shell, /rocketArenaBlackHole/);
  assert.match(shell, /ENTER HERE/);
  assert.match(shell, /Math\.hypot/);
  assert.match(shell, /data-spmt-signal-trigger/);
  assert.match(client, /ecosystem\.easter-egg\.\$\{egg\}\.completed\.v1/);
  assert.match(client, /blackHole.*rocket.*signal/s);
  assert.match(client, /Lord Puzzler unlocked/);
});
