import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPACE_MOUNTAIN_CSS } from "../apps/spacemountain/dist/shell-ui.js";
import { POLISHED_SPACE_MOUNTAIN_CSS } from "../apps/spacemountain/dist/product-shell-css.js";
import { THEMED_SURFACE_CSS } from "../apps/spacemountain/dist/themed-surface-css.js";

const base = readFileSync(new URL("../apps/spacemountain/src/shell-ui-base.ts", import.meta.url), "utf8");
const wrapper = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../apps/spacemountain/src/overlay-bay-ui.ts", import.meta.url), "utf8");
const overlayScenes = readFileSync(new URL("../apps/spacemountain/src/overlay-scenes.ts", import.meta.url), "utf8");
const source = `${base}\n${wrapper}\n${overlay}`;

test("SpaceMountain wrapper preserves the proven shell and upgrades only Overlay Bay", () => {
  assert.match(wrapper, /BaseShellUi/);
  assert.match(wrapper, /OverlayBayParityController/);
  assert.match(wrapper, /MutationObserver/);
  assert.match(wrapper, /export \{ SPACE_MOUNTAIN_CSS \}/);
  assert.match(overlay, /Canonical ecosystem overlay editor/);
  assert.match(overlay, /Copy Public URL/);
});

test("SpaceMountain shell UI uses measured shared header inset everywhere", () => {
  assert.match(base, /observeShellLayout/);
  assert.match(base, /applyShellLayoutMetrics\(this\.options\.root, "shell", layout\)/);
  assert.match(SPACE_MOUNTAIN_CSS, /--spmt-shell-top-inset/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock\{[^}]*top:calc\(var\(--spmt-shell-top-inset/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-space-main\{[^}]*padding:calc\(var\(--spmt-shell-top-inset/);
});

test("visible shell does not restore private proxy or browser credential storage", () => {
  assert.doesNotMatch(source, /\/api\/spmt/);
  assert.doesNotMatch(source, /sessionStorage/);
  assert.doesNotMatch(source, /localStorage[^\n]*(?:token|credential|authorization)/i);
  assert.match(base, /spmt:personal-overlay-visible/);
  assert.doesNotMatch(source, /[?&](?:tenant|scopes|token)=/);
});

test("canonical home, Shipyard, registry apps, and workspace remain in the preserved shell", () => {
  for (const pattern of [/Open Shipyard/, /Open Commlink/, /Registry, install state, granted scopes, and entitlements come directly from SPMT/, /Three persistent workspace embeds/, /data-workspace-settings/, /Save canonical workspace/, /Custom scene override/, /installProductBackdrop/, /app\.surfaces\.includes\("shell"\)/]) assert.match(base, pattern);
  assert.doesNotMatch(base, /label: "SPMT"/);
  assert.doesNotMatch(base, /const NAV[\s\S]*label: "Commlink"[\s\S]*\];/);
});

test("Commlink retains saved ChatSpaces, Desks, feed, compose, search, pop-out and hidden signal", () => {
  for (const pattern of [/data-commlink-space/, /data-commlink-desk/, /New ChatSpace/, /data-commlink-source/, /data-commlink-filter/, /data-commlink-compose/, /onSendCommlinkMessage/, /data-commlink-new-mail/, /onComposeCommlinkMail/, /data-commlink-read-all/, /onMarkAllCommlinkRead/, /data-commlink-popout/, /data-open-conversation/, /data-commlink-search/, /data-spmt-signal-trigger/]) assert.match(base, pattern);
  assert.match(base, /this\.snapshot\.liveChat/);
  assert.match(base, /this\.snapshot\.commlinkRecipients/);
  assert.match(base, /occurredAt/);
  assert.doesNotMatch(base, /provider.*(?:accessToken|refreshToken)/);
});

test("Stellar Core and Mission Control keep their accepted roles", () => {
  assert.match(base, /Stella is the default ecosystem assistant/);
  assert.match(base, /configured StreamWeaver personas use the same public contracts/);
  assert.match(base, /stellar-core-inference/);
  assert.doesNotMatch(base, /label: "Athena"/);
  assert.match(base, /Ecosystem operations/);
  assert.match(base, /CONSOLIDATED EVIDENCE/);
  assert.match(base, /data-coder-form/);
  assert.match(base, /Draft-only handoff/);
});

test("home and app navigation remain singular, dynamic and scene-aware", () => {
  assert.doesNotMatch(base, /Launch apps, check Commlink/);
  assert.doesNotMatch(base, /<section class="spmt-quick-grid">/);
  assert.doesNotMatch(base, /One command bridge for every creator tool/);
  assert.match(base, /data-theme-logo="hero-secondary"/);
  assert.match(base, /this\.snapshot\.apps\.filter\(\(app\) => app\.installed && app\.enabled/);
  assert.match(base, /APP_DOCK_NAVIGATION/);
  assert.match(base, /"nebula-arcade"[\s\S]*label: "Games"[\s\S]*label: "Play"[\s\S]*label: "Scores"[\s\S]*label: "Settings"/);
  assert.match(base, /nebula-arcade\/solar-system\.webp/);
});

test("Rocketship, Black Hole, and Lost Signal interactions survive the wrapper", () => {
  assert.match(base, /data-spmt-black-hole-trigger/);
  assert.match(base, /data-spmt-rocket-trigger/);
  assert.match(base, /document\.body\.appendChild\(rocket\)/);
  assert.match(base, /window\.addEventListener\("pointermove", follow\)/);
  assert.match(base, /rocketArenaBlackHole/);
  assert.match(base, /ENTER HERE/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-rocket-free\{[^}]*z-index:2147483640!important/);
});

test("workspace tray keeps three persistent embeds and window controls", () => {
  for (const pattern of [/class="spmt-workspace-frames"/, /data-workspace-minimize/, /data-workspace-maximize/, /data-workspace-popout/, /data-workspace-clickthrough/, /data-workspace-opacity/, /frame\.dataset\.appId/]) assert.match(base, pattern);
  for (const pattern of [/data-simulation-rooms-toggle/, /SimulationRoomsUi/, /simulationRoomSlot/]) assert.match(base, pattern);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-workspace-tray\{[^}]*position:fixed[^}]*bottom:/);
});

test("canonical appearance still flattens wrappers and deepens translucency", () => {
  assert.match(base, /\$\{COSMO_COMMLINK_CSS\}\$\{THEMED_SURFACE_CSS\}/);
  assert.match(THEMED_SURFACE_CSS, /--theme-depth-1:/);
  assert.match(THEMED_SURFACE_CSS, /--theme-depth-4:/);
  assert.match(THEMED_SURFACE_CSS, /\.cosmo-commlink\{border:0;background:transparent;box-shadow:none;backdrop-filter:none\}/);
  assert.match(THEMED_SURFACE_CSS, /\.cosmo-message\{[^}]*background:var\(--theme-depth-3\)/);
});

test("shared header and mobile dock remain catalog-backed and viewport-safe", () => {
  assert.match(base, /ecosystemPresence\(this\.snapshot\.events, this\.snapshot\.apps\)/);
  assert.match(base, /data-spmt-local-clock/);
  assert.match(base, /data-spmt-utc-clock/);
  assert.match(base, /data-apps-tray/);
  assert.match(base, /connectedAppUsage\(this\.snapshot\.events, app\.appId\)/);
  assert.match(SPACE_MOUNTAIN_CSS, /@media\(max-width:900px\)/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock\{left:10px;right:10px;top:auto;bottom:/);
});

test("header and rocket dock share one complete core navigation icon contract", () => {
  assert.match(base, /function coreNavIcon\(theme: string, view: SpaceMountainViewV1\)/);
  assert.match(base, /coreNavIcon\(theme\.id, item\.id\)/);
  for (const view of ["home", "apps", "workspace", "settings"]) assert.match(base, new RegExp(`coreNavIcon\\(theme\\.id, "${view}"\\)`));
  assert.match(base, /view === "apps" \? "shipyard" : view === "workspace" \? "overlay-bay"/);
  assert.doesNotMatch(base, /data-workspace-toggle[\s\S]{0,200}themedHeaderIcon\(theme\.id, "mission-control"\)/);
  assert.match(base, /data-core-nav-art/);
  assert.match(base, /data-themed-app-art/);
});

test("Account owns personal identity and usage while Settings owns advanced configuration", () => {
  assert.match(base, /type SpaceMountainViewV1 = "home" \| "apps" \| "workspace" \| "settings" \| "account"/);
  assert.match(base, /<button type="button" class="spmt-account-summary"[^>]*title="Account and personal usage"/);
  assert.match(base, /this\.navigate\("account"\)/);
  assert.match(base, /page\("Your account", "Your plan, personal usage, linked identities, and XP in one private view\./);
  for (const label of ["AI and creation", "AI chat", "AI coding", "Image generation", "Hosted services and storage", "LINKED IDENTITIES"]) assert.match(base, new RegExp(label));
  for (const control of ["Remember this conversation", "Export my Stella data", "Delete my Stella data", "data-stellar-export", "data-stellar-delete"]) assert.match(base, new RegExp(control));
  for (const provider of ["data-provider-link=\"twitch\"", "data-provider-link=\"discord\""]) assert.match(base, new RegExp(provider));
  assert.match(base, /window\.location\.assign\(`\/v1\/identity\/providers\/\$\{provider\}\/start/);
  assert.match(base, /role="progressbar"/);
  assert.match(THEMED_SURFACE_CSS, /\.spmt-usage-track i\{[^}]*linear-gradient\(90deg,var\(--accent\),var\(--accent2\)\)/);
  assert.match(base, /page\("App and ecosystem settings", "Advanced controls stay with the app or shared system they configure\./);
  assert.match(base, /Advanced controls by owning app/);
  assert.match(base, /without mixing them into your personal account/);
});

test("Overlay Bay retains donor editor controls and all source families", () => {
  for (const kind of ["web","image","text","camera","screen","xbox","alert","links","ticker","weather","nebula"]) assert.match(`${overlayScenes}\n${overlay}`, new RegExp(`\\"${kind}\\"|${kind}`));
  for (const feature of [/data-ob-resize/, /data-ob-front/, /data-ob-back/, /data-ob-copy/, /data-ob-remove/, /data-ob-test-alert/, /data-ob-field="opacity"/, /data-ob-field="interactive"/, /data-ob-field="locked"/, /data-ob-game/, /data-ob-game-style/]) assert.match(overlay, feature);
  assert.match(overlay, /NEBULA_GAMES/);
  assert.match(overlay, /\/v1\/overlay\/scenes\/register/);
  assert.match(overlay, /activePublicOverlaySceneId/);
  assert.match(overlay, /activePersonalOverlaySceneId/);
  assert.match(overlay, /Copy Public URL/);
  assert.match(overlay, /Copy Personal URL/);
});
