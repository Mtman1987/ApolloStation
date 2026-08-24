import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPACE_MOUNTAIN_CSS } from "../apps/spacemountain/dist/shell-ui.js";
import { POLISHED_SPACE_MOUNTAIN_CSS } from "../apps/spacemountain/dist/product-shell-css.js";
import { THEMED_SURFACE_CSS } from "../apps/spacemountain/dist/themed-surface-css.js";

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

test("Commlink restores functional saved ChatSpaces, Desks, source-aware feed, compose, search, and pop-out", () => {
  assert.match(source, /data-commlink-space/);
  assert.match(source, /data-commlink-desk/);
  assert.match(source, /New ChatSpace/);
  assert.match(source, /data-commlink-view="focus"/);
  assert.match(source, /data-commlink-view="desk"/);
  assert.match(source, /data-commlink-source/);
  assert.match(source, /data-commlink-filter/);
  assert.match(source, /data-commlink-compose/);
  assert.match(source, /onSendCommlinkMessage/);
  assert.match(source, /data-commlink-popout/);
  assert.match(source, /data-open-conversation/);
  assert.match(source, /data-commlink-search/);
  assert.match(source, /this\.options\.onSaveWorkspace\?\.\(revision, \{ commlink: next \}\)/);
  assert.match(source, /data-spmt-signal-trigger/);
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
  assert.match(source, /root\.dataset\.spmtView = this\.view/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /data-spmt-view="home"/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /height:calc\(100dvh - var\(--guard-height,0px\)\)/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /overflow-y:hidden/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /container-type:size/);
  assert.match(THEMED_SURFACE_CSS, /height:clamp\(132px,31cqh,205px\)/);
});

test("released rocket escapes the sidebar stack, follows the pointer, and remains above content", () => {
  assert.match(source, /document\.body\.appendChild\(rocket\)/);
  assert.match(source, /--rocket-x/);
  assert.match(source, /window\.addEventListener\("pointermove", follow\)/);
  assert.match(source, /dockParent\.insertBefore\(rocket, dockNext\)/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-rocket-free\{[^}]*z-index:2147483640!important/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /@keyframes spmtRocketFlight/);
});

test("SPMT does not duplicate the existing sidebar destinations", () => {
  assert.doesNotMatch(source, /label: "SPMT"/);
  assert.doesNotMatch(source, /SPMT identity and developer hub/);
  assert.doesNotMatch(source, /requested === "spmt" \? "help"/);
});

test("canonical appearance normalizes every front-facing surface after legacy styles", () => {
  assert.match(source, /\$\{COSMO_COMMLINK_CSS\}\$\{THEMED_SURFACE_CSS\}/);
  assert.match(THEMED_SURFACE_CSS, /--theme-panel:/);
  assert.match(THEMED_SURFACE_CSS, /\.spmt-cosmic-header,\.spmt-rocket-dock,\.spmt-hero/);
  assert.match(THEMED_SURFACE_CSS, /\.cosmo-rail,\.cosmo-topbar,\.cosmo-sources/);
  assert.match(THEMED_SURFACE_CSS, /\.spmt-space-root button:not\(\.primary\)/);
});

test("shared header uses catalog-backed live presence, local and UTC clocks, and no user-facing health strip", () => {
  assert.match(source, /ecosystemPresence\(this\.snapshot\.events, this\.snapshot\.apps\)/);
  assert.match(source, /apps\.filter\(\(app\) => app\.installed && app\.enabled\)\.map\(\(app\) => \[app\.appId, app\.name\]\)/);
  assert.match(source, /data-spmt-local-clock/);
  assert.match(source, /data-spmt-utc-clock/);
  assert.match(source, /timeZone: "UTC"/);
  assert.match(source, /data-workspace-toggle[\s\S]*data-live-toggle/);
  assert.match(source, /Show creators live across the installed app pool/);
  assert.doesNotMatch(source, /const nodes = \[\{ label: "SPMT"/);
  assert.doesNotMatch(source, /spmt-product-status/);
  assert.doesNotMatch(source, /this\.snapshot\.state\.toUpperCase\(\)/);
  assert.doesNotMatch(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-telemetry\{/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-header-clocks\{/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-live-tray\{/);
});

test("mobile layout removes shell-header dependency from bottom dock without hiding content", () => {
  assert.match(SPACE_MOUNTAIN_CSS, /@media\(max-width:900px\)/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock\{left:10px;right:10px;top:auto;bottom:/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-space-main\{padding:calc\(var\(--spmt-shell-top-inset,88px\) \+ 18px\) 14px 92px/);
});
