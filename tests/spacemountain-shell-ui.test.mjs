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

test("SpaceMountain visible shell exposes canonical home, Shipyard, registry apps and three-slot workspace", () => {
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
  assert.match(source, /this\.snapshot\.apps\.filter\(\(app\) => app\.installed && app\.enabled/);
  assert.match(source, /class="spmt-dock-apps" aria-label="Installed applications"/);
  assert.match(source, /app\.name/);
  assert.match(source, /app\.description/);
  assert.doesNotMatch(source, /const NAV[\s\S]*label: "Commlink"[\s\S]*\];/);
  assert.doesNotMatch(source, /const NAV[\s\S]*label: "Stellar Core"[\s\S]*\];/);
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
  assert.match(source, /this\.activeAppId === "mission-control"/);
  assert.match(source, /app\.appId !== "mission-control" \|\| this\.snapshot\.operations\.canReadLogs \|\| this\.snapshot\.operations\.canReadCoder/);
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
  assert.match(source, /root\.dataset\.spmtView = this\.activeAppId \? "app" : this\.view/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /data-spmt-view="home"/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /height:calc\(100dvh - var\(--guard-height,0px\)\)/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /overflow-y:hidden/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /container-type:size/);
  assert.match(THEMED_SURFACE_CSS, /spmt-hero-logo-large\{flex:1 1 0;width:100%;height:100%/);
  assert.match(THEMED_SURFACE_CSS, /max-width:none;max-height:none/);
});

test("installed app overflow stays inside a themed sidebar region and reveals its scrollbar only on hover", () => {
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-dock-apps\{[^}]*overflow-y:auto/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-dock-apps\{[^}]*scrollbar-width:none/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-dock-apps:hover\{scrollbar-width:thin\}/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-dock-apps::-webkit-scrollbar\{width:0\}/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-dock-apps:hover::-webkit-scrollbar\{width:4px\}/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /scrollbar-color:color-mix\(in srgb,var\(--accent\)/);
});

test("released rocket escapes the sidebar stack, follows the pointer, and remains above content", () => {
  assert.match(source, /document\.body\.appendChild\(rocket\)/);
  assert.match(source, /--rocket-x/);
  assert.match(source, /window\.addEventListener\("pointermove", follow\)/);
  assert.match(source, /dockParent\.insertBefore\(rocket, dockNext \?\? null\)/);
  assert.match(source, /if \(rocket\.classList\.contains\("spmt-rocket-free"\)\) \{ restoreRocket\(\); return; \}/);
  assert.match(source, /onDockToggle\(root\.dataset\.spmtDock !== "collapsed"\)/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-rocket-free\{[^}]*z-index:2147483640!important/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-rocket-free\{pointer-events:auto;cursor:pointer/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /data-spmt-dock="collapsed"/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /@keyframes spmtRocketFlight/);
});

test("workspace icon opens a persistent footer with three retained embeds and window controls", () => {
  assert.match(source, /class="spmt-workspace-frames"/);
  assert.match(source, /<footer><strong>\$\{icon\("layout"\)\}/);
  assert.match(source, /data-workspace-minimize/);
  assert.match(source, /data-workspace-maximize/);
  assert.match(source, /data-workspace-popout/);
  assert.match(source, /data-workspace-clickthrough/);
  assert.match(source, /data-workspace-opacity/);
  assert.match(source, /this\.workspaceExpanded = true/);
  assert.match(source, /frame\.dataset\.appId/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-workspace-tray\{[^}]*position:fixed[^}]*bottom:/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-workspace-tray\.maximized \.spmt-workspace-frames/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-workspace-tray\.click-through/);
});

test("first-party shell apps keep unique artwork under the shared tint and star layers", () => {
  assert.match(source, /commlink-communications-background\.webp/);
  assert.match(source, /stellar-core-background\.webp/);
  assert.match(source, /mission-control-background\.webp/);
  assert.match(source, /SHELL_APP_SCENES\[this\.activeAppId\] \?\? SPACEMOUNTAIN_SCENE/);
  assert.match(source, /resolveProductBackdrop\(scene, configuredTheme, accent, backgroundUrl\)/);
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
  assert.match(THEMED_SURFACE_CSS, /filter:grayscale\(1\) saturate\(0\)/);
  assert.match(THEMED_SURFACE_CSS, /\.spmt-page-title\{[^}]*border:1px solid/);
  assert.match(THEMED_SURFACE_CSS, /\.spmt-space-root \.spmt-brand,[^}]*background:transparent!important/);
  assert.match(source, /data-workspace-theme/);
  assert.match(source, /accentInput\.value = resolveProductTheme\(themeSelect\.value\)\.accent/);
});

test("shared header uses catalog-backed live presence, local and UTC clocks, and no user-facing health strip", () => {
  assert.match(source, /ecosystemPresence\(this\.snapshot\.events, this\.snapshot\.apps\)/);
  assert.match(source, /apps\.filter\(\(app\) => app\.installed && app\.enabled\)\.map\(\(app\) => \[app\.appId, app\.name\]\)/);
  assert.match(source, /data-spmt-local-clock/);
  assert.match(source, /data-spmt-utc-clock/);
  assert.match(source, /timeZone: "UTC"/);
  assert.match(source, /data-workspace-toggle[\s\S]*data-live-toggle/);
  assert.match(source, /data-apps-toggle[\s\S]*data-workspace-toggle/);
  assert.match(source, /data-apps-tray/);
  assert.match(source, /connectedAppUsage\(this\.snapshot\.events, app\.appId\)/);
  assert.match(source, /spmt-account-copy[\s\S]*\.toLocaleString\(\)\} XP/);
  assert.match(source, /Show creators live across the installed app pool/);
  assert.doesNotMatch(source, /<nav class="spmt-header-links"/);
  assert.doesNotMatch(source, /<a href="\/docs\/developers">Docs<\/a>/);
  assert.doesNotMatch(source, /const nodes = \[\{ label: "SPMT"/);
  assert.doesNotMatch(source, /spmt-product-status/);
  assert.doesNotMatch(source, /this\.snapshot\.state\.toUpperCase\(\)/);
  assert.doesNotMatch(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-telemetry\{/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-header-clocks\{/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-live-tray\{/);
  assert.match(THEMED_SURFACE_CSS, /\.spmt-apps-tray\{/);
  assert.match(THEMED_SURFACE_CSS, /\.spmt-brand-cluster/);
  assert.match(THEMED_SURFACE_CSS, /\.spmt-account-copy/);
});

test("mobile layout removes shell-header dependency from bottom dock without hiding content", () => {
  assert.match(SPACE_MOUNTAIN_CSS, /@media\(max-width:900px\)/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock\{left:10px;right:10px;top:auto;bottom:/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-space-main\{padding:calc\(var\(--spmt-shell-top-inset,88px\) \+ 18px\) 14px 92px/);
});
