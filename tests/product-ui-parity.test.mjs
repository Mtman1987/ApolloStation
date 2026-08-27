import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PRODUCT_STAR_FIELDS, PRODUCT_THEME_PRESETS, PRODUCT_UI_CSS, isProductImageUrl, resolveProductBackdrop, resolveProductTheme } from "../packages/ui/dist/index.js";
import { POLISHED_SPACE_MOUNTAIN_CSS } from "../apps/spacemountain/dist/product-shell-css.js";

const shellSource = `${readFileSync(new URL("../apps/spacemountain/src/shell-ui-base.ts", import.meta.url), "utf8")}\n${readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8")}\n${readFileSync(new URL("../apps/spacemountain/src/overlay-bay-ui.ts", import.meta.url), "utf8")}`;
const themedSource = readFileSync(new URL("../apps/spacemountain/src/themed-surface-css.ts", import.meta.url), "utf8");
const nebulaThemeSource = readFileSync(new URL("../apps/nebula-arcade/src/nebula-theme-css.ts", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../apps/spacemountain-web/src/page.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");

test("shared product UI exposes stable framework-neutral themes and accessible primitives", () => {
  assert.deepEqual(Object.keys(PRODUCT_THEME_PRESETS).sort(), ["aurora-green", "nebula-purple", "oceanic-blue", "solar-flare"]);
  assert.equal(resolveProductTheme("unknown").id, "solar-flare");
  assert.equal(resolveProductTheme("oceanic-blue", "#123ABC").accent, "#123ABC");
  assert.equal(resolveProductTheme("oceanic-blue", "#123ABC", "#FEDCBA").accentSecondary, "#FEDCBA");
  const palettes = Object.values(PRODUCT_THEME_PRESETS);
  assert.equal(new Set(palettes.map(({ accentSecondary }) => accentSecondary.toLowerCase())).size, palettes.length);
  for (const { accent, accentSecondary } of palettes) assert.notEqual(accent.toLowerCase(), accentSecondary.toLowerCase());
  assert.match(PRODUCT_UI_CSS, /\.spmt-product-glass/);
  assert.match(PRODUCT_UI_CSS, /:focus-visible/);
  assert.ok(PRODUCT_STAR_FIELDS.length >= 1);
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

test("SpaceMountain presentation remains finished and dynamically catalog-backed after shell split", () => {
  for (const pattern of [/data-theme-logo="hero"/, /data-theme-logo="spmt"/, /themeLogoUrl/, /themedAppIconUrl/, /model-rocket\.png/, /SPACEMOUNTAIN_SCENE/, /installProductBackdrop/, /bindProductRocketNavigation/, /Custom scene override/, /app\.iconUrl/, /this\.snapshot\.apps\.filter/]) assert.match(shellSource, pattern);
  assert.doesNotMatch(shellSource, /One command bridge for every creator tool/);
  assert.doesNotMatch(shellSource, /app-streamweaver|app-hearmeout|app-discord-hub|app-chat-tag/);
  assert.doesNotMatch(shellSource, /localStorage|sessionStorage|\/api\/spmt/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-header-clocks/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-live-button/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /@media\(max-width:900px\)/);
});

test("Nebula and SpaceMountain use the same theme language without sharing one background image", () => {
  assert.match(themedSource, /--theme-depth-1/);
  assert.match(nebulaThemeSource, /solar-system|nebula/i);
  assert.match(shellSource, /nebula-arcade\/solar-system\.webp/);
});

test("private host uses the product chrome and serves explicit local artwork", () => {
  assert.match(hostSource, /auth-product-logo/);
  assert.match(hostSource, /PRIVATE PREVIEW/);
  assert.match(hostSource, /isolated from Blue/);
  for (const asset of ["space-logo-main.png", "space-logo-header.png", "model-rocket.png", "theme-solar-flare-background.webp", "commlink-communications-background.webp", "stellar-core-background.webp", "mission-control-background.webp"]) assert.match(serverSource, new RegExp(asset.replace(".", "\\.")));
});
