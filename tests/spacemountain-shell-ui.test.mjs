import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPACE_MOUNTAIN_CSS } from "../apps/spacemountain/dist/shell-ui.js";

const source = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");

test("SpaceMountain shell UI uses measured shared header inset everywhere", () => {
  assert.match(source, /observeShellLayout/);
  assert.match(source, /applyShellLayoutMetrics\(this\.options\.root, "shell", layout\)/);
  assert.match(SPACE_MOUNTAIN_CSS, /--spmt-shell-top-inset/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock\{[^}]*top:calc\(var\(--spmt-shell-top-inset/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-space-main\{[^}]*padding:calc\(var\(--spmt-shell-top-inset/);
});

test("SpaceMountain visible shell does not restore private proxy or browser token storage", () => {
  assert.doesNotMatch(source, /\/api\/spmt/);
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /sessionStorage/);
  assert.doesNotMatch(source, /[?&](?:tenant|scopes|token)=/);
});

test("SpaceMountain visible shell exposes canonical home, Shipyard, Commlink and three-slot workspace", () => {
  assert.match(source, /Open Shipyard/);
  assert.match(source, /Open Commlink/);
  assert.match(source, /Registry, install state, granted scopes, and entitlements come directly from SPMT/);
  assert.match(source, /Three persistent app slots/);
  assert.match(source, /\[0, 1, 2\]\.map/);
  assert.match(source, /data-workspace-settings/);
  assert.match(source, /Save canonical workspace/);
  assert.match(source, /Custom scene override/);
  assert.match(source, /leave blank to use each app's artwork/);
  assert.match(source, /onSaveWorkspace/);
  assert.match(source, /installProductBackdrop/);
  assert.match(source, /root\.style\.setProperty\("--accent"/);
});

test("Settings exposes canonical SPMT provider links without browser-owned auth state", () => {
  assert.match(source, /LINKED ACCOUNTS/);
  assert.match(source, /data-provider-unlink/);
  assert.match(source, /this\.snapshot\.sources\.identity/);
  assert.match(source, /same SPMT user identity/);
});

test("Commlink renders the canonical desks, spaces, mail, event, and IRC surfaces", () => {
  assert.match(source, /data-commlink-tab/);
  assert.match(source, /Chat Spaces/);
  assert.match(source, /Notifications/);
  assert.match(source, /Developer IRC/);
  assert.match(source, /provider-neutral Chat Gateway/);
  assert.match(source, /data-notification-read/);
  assert.match(source, /data-open-conversation/);
  assert.match(source, /data-commlink-search/);
  assert.match(source, /Search all canonical Commlink history/);
});

test("Stellar Core stays persona-neutral while Stella and configured personas remain presentation identities", () => {
  assert.match(source, /Stellar Core/);
  assert.match(source, /Stella is the default ecosystem assistant/);
  assert.match(source, /configured StreamWeaver personas use the same public contracts/);
  assert.match(source, /stellar-core-inference/);
  assert.doesNotMatch(source, /label: "Athena"/);
});

test("Mission Control renders consolidated scoped evidence and a truthful coder handoff", () => {
  assert.match(source, /label: "Operations"/);
  assert.match(source, /Ecosystem operations/);
  assert.match(source, /CONSOLIDATED EVIDENCE/);
  assert.match(source, /data-coder-form/);
  assert.match(source, /data-coder-log/);
  assert.match(source, /Draft-only handoff/);
  assert.match(source, /Prepared drafts do not change code/);
  assert.match(source, /Work with Coder/);
});

test("home avoids duplicate navigation and sidebar hover text carries page descriptions", () => {
  assert.doesNotMatch(source, /Launch apps, check Commlink/);
  assert.doesNotMatch(source, /<section class="spmt-quick-grid">/);
  assert.match(source, /spmt-hero-tagline/);
  assert.match(source, /item\.description/);
});

test("mobile layout removes shell-header dependency from bottom dock without hiding content", () => {
  assert.match(SPACE_MOUNTAIN_CSS, /@media\(max-width:900px\)/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock\{left:10px;right:10px;top:auto;bottom:/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-space-main\{padding:calc\(var\(--spmt-shell-top-inset,88px\) \+ 18px\) 14px 92px/);
});
