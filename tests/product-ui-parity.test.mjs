import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PRODUCT_STAR_FIELDS, PRODUCT_THEME_PRESETS, PRODUCT_UI_CSS, bindProductRocketNavigation, isProductImageUrl, resolveProductBackdrop, resolveProductTheme } from "../packages/ui/dist/index.js";
import { POLISHED_SPACE_MOUNTAIN_CSS } from "../apps/spacemountain/dist/product-shell-css.js";

const shellSource = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");
const themedSource = readFileSync(new URL("../apps/spacemountain/src/themed-surface-css.ts", import.meta.url), "utf8");
const nebulaThemeSource = readFileSync(new URL("../apps/nebula-arcade/src/nebula-theme-css.ts", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../apps/spacemountain-web/src/page.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../apps/spacemountain-web/src/client.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");

test("shared product UI exposes stable framework-neutral themes and accessible primitives", () => {
  assert.deepEqual(Object.keys(PRODUCT_THEME_PRESETS).sort(), ["aurora-green", "nebula-purple", "oceanic-blue", "solar-flare"]);
  assert.equal(resolveProductTheme("unknown").id, "solar-flare");
  assert.equal(resolveProductTheme("oceanic-blue", "#123ABC").accent, "#123ABC");
  assert.equal(resolveProductTheme("oceanic-blue", "not-a-color").accent, "#3b82f6");
  assert.match(PRODUCT_UI_CSS, /\.spmt-product-glass/);
  assert.match(PRODUCT_UI_CSS, /:focus-visible/);
  assert.match(PRODUCT_UI_CSS, /prefers-reduced-motion/);
  assert.match(PRODUCT_UI_CSS, /\.spmt-star-layer/);
  assert.match(PRODUCT_UI_CSS, /filter: grayscale\(1\) saturate\(0\)/);
  assert.deepEqual(PRODUCT_STAR_FIELDS.map(({ size, count, seed, durationSeconds }) => ({ size, count, seed, durationSeconds })), [
    { size: 1, count: 700, seed: 11, durationSeconds: 200 },
    { size: 2, count: 200, seed: 23, durationSeconds: 150 },
    { size: 3, count: 100, seed: 37, durationSeconds: 100 },
  ]);
  assert.match(PRODUCT_UI_CSS, /@keyframes spmt-stars-up[\s\S]*?translateY\(-2000px\)/);
  assert.doesNotMatch(PRODUCT_UI_CSS, /background-size:\s*67px 61px/);
  assert.match(PRODUCT_UI_CSS, /\.spmt-product-backdrop-tint/);
  assert.equal(typeof bindProductRocketNavigation, "function");
});

test("shared surfaces use fewer layers and progressively lower opacity with depth", () => {
  assert.match(PRODUCT_UI_CSS, /--spmt-glass-opacity:\s*\.76/);
  assert.match(PRODUCT_UI_CSS, /--spmt-depth-1-alpha:[^;]*\* \.9/);
  assert.match(PRODUCT_UI_CSS, /--spmt-depth-2-alpha:[^;]*\* \.68/);
  assert.match(PRODUCT_UI_CSS, /--spmt-depth-3-alpha:[^;]*\* \.48/);
  assert.match(PRODUCT_UI_CSS, /--spmt-depth-4-alpha:[^;]*\* \.32/);
  assert.match(PRODUCT_UI_CSS, /data-spmt-depth="0"[\s\S]*background:\s*transparent/);
  assert.match(themedSource, /\.cosmo-commlink\{border:0;background:transparent;box-shadow:none;backdrop-filter:none\}/);
  assert.match(themedSource, /\.cosmo-message\{[^}]*background:var\(--theme-depth-3\)/);
  assert.match(themedSource, /\.cosmo-composer\{[^}]*background:var\(--theme-depth-2\)/);
  assert.match(themedSource, /\.spmt-page-title\{[^}]*border:0/);
  assert.match(nebulaThemeSource, /\.hero,.view-heading,.games,.overlay-bay,.arcade-stats,.game-detail[^}]*background:transparent/);
  assert.match(nebulaThemeSource, /\.console,.overlay-editor[^}]*background:var\(--nebula-depth-2\)/);
  assert.match(nebulaThemeSource, /\.overlay-layer[^}]*background:var\(--nebula-depth-3\)/);
});

test("embedded Nebula shell is truly transparent and cannot drift behind the shared header", () => {
  assert.match(nebulaThemeSource, /:root\{background:transparent\}/);
  assert.match(nebulaThemeSource, /data-surface="shell"\]\{height:100%;min-height:0;overflow:hidden;background:transparent\}/);
  assert.match(nebulaThemeSource, /data-surface="shell"\] main\{[^}]*height:100%[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/);
  assert.match(themedSource, /data-spmt-view="app"\]\{height:calc\(100dvh - var\(--guard-height,0px\)\);min-height:0;overflow:hidden\}/);
  assert.match(themedSource, /data-spmt-view="app"\] \.spmt-space-main\{height:100%;min-height:0;box-sizing:border-box;overflow:hidden\}/);
  assert.match(themedSource, /data-spmt-view="app"\] \.spmt-embedded-app-shell\{height:100%;min-height:0;overflow:hidden\}/);
});

test("workspace colors tint one stable app scene and preserve a safe custom override", () => {
  const scene = { appId: "nebula-arcade", imageUrl: "/assets/nebula-arcade/solar-system.webp" };
  const solar = resolveProductBackdrop(scene, "solar-flare");
  const oceanic = resolveProductBackdrop(scene, "oceanic-blue");
  assert.equal(solar.imageUrl, scene.imageUrl);
  assert.equal(oceanic.imageUrl, scene.imageUrl);
  assert.notEqual(solar.theme.accent, oceanic.theme.accent);
  assert.equal(resolveProductBackdrop(scene, "nebula-purple", undefined, "https://images.example/scene.webp").customImage, true);
  assert.equal(resolveProductBackdrop(scene, "nebula-purple", undefined, "javascript:alert(1)").imageUrl, scene.imageUrl);
  assert.equal(isProductImageUrl("/assets/app/scene.webp"), true);
  assert.equal(isProductImageUrl("http://images.example/scene.webp"), false);
});

test("SpaceMountain presentation matches the finished product without hardcoding an app catalog", () => {
  assert.match(shellSource, /One command bridge for every creator tool/);
  assert.match(shellSource, /space-logo-header\.png/);
  assert.match(shellSource, /space-logo-main\.png/);
  assert.match(shellSource, /model-rocket\.png/);
  assert.match(shellSource, /SPACEMOUNTAIN_SCENE/);
  assert.match(shellSource, /installProductBackdrop/);
  assert.match(shellSource, /bindProductRocketNavigation/);
  assert.match(shellSource, /Custom scene override/);
  assert.match(shellSource, /app\.iconUrl/);
  assert.match(shellSource, /this\.snapshot\.apps\.filter/);
  assert.doesNotMatch(shellSource, /app-streamweaver|app-hearmeout|app-discord-hub|app-chat-tag/);
  assert.doesNotMatch(shellSource, /localStorage|sessionStorage|\/api\/spmt/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-header-clocks/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-live-button/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /@media\(max-width:900px\)/);
  assert.doesNotMatch(POLISHED_SPACE_MOUNTAIN_CSS, /background-size:150px 150px,230px 230px/);
});

test("private host uses the same product chrome and serves only explicit local artwork", () => {
  assert.match(hostSource, /auth-product-logo/);
  assert.match(hostSource, /PRIVATE PREVIEW/);
  for (const asset of ["space-logo-main.png", "space-logo-header.png", "model-rocket.png", "theme-solar-flare-background.webp", "commlink-communications-background.webp", "stellar-core-background.webp", "mission-control-background.webp"]) {
    assert.match(serverSource, new RegExp(asset.replace(".", "\\.")));
  }
  assert.match(hostSource, /isolated from Blue/);
  assert.match(hostSource, /<span id="sandbox-status"[\s\S]*<a href="\/docs\/developers">Developer docs<\/a>/);
  assert.doesNotMatch(hostSource, /view=help/);
  assert.doesNotMatch(hostSource, /position:fixed;z-index:1001;top:var\(--guard-height\)/);
  assert.match(clientSource, /setStatus\("Sandbox open", "ready"\)/);
  assert.doesNotMatch(clientSource, /Sandbox open · degraded/);
});

test("shared workspace saves reconcile one stale revision without disabling conflict protection", () => {
  assert.match(clientSource, /error instanceof SpmtApiError[\s\S]*error\.status !== 409/);
  assert.match(clientSource, /spmt\.getWorkspaceProfile\(tenantId\)/);
  assert.match(clientSource, /controller\.saveWorkspace\(tenantId, currentRevision, patch\)/);
  assert.match(clientSource, /workspace changed again while saving/i);
  assert.match(clientSource, /JSON\.parse\(value\.responseBody\)/);
});
