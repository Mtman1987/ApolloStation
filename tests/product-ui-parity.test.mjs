import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PRODUCT_THEME_PRESETS, PRODUCT_UI_CSS, resolveProductTheme } from "../packages/ui/dist/index.js";
import { POLISHED_SPACE_MOUNTAIN_CSS } from "../apps/spacemountain/dist/product-shell-css.js";

const shellSource = readFileSync(new URL("../apps/spacemountain/src/shell-ui.ts", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../apps/spacemountain-web/src/page.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");

test("shared product UI exposes stable framework-neutral themes and accessible primitives", () => {
  assert.deepEqual(Object.keys(PRODUCT_THEME_PRESETS).sort(), ["aurora-green", "nebula-purple", "oceanic-blue", "solar-flare"]);
  assert.equal(resolveProductTheme("unknown").id, "solar-flare");
  assert.equal(resolveProductTheme("oceanic-blue", "#123ABC").accent, "#123ABC");
  assert.equal(resolveProductTheme("oceanic-blue", "not-a-color").accent, "#3b82f6");
  assert.match(PRODUCT_UI_CSS, /\.spmt-product-glass/);
  assert.match(PRODUCT_UI_CSS, /:focus-visible/);
  assert.match(PRODUCT_UI_CSS, /prefers-reduced-motion/);
});

test("SpaceMountain presentation matches the finished product without hardcoding an app catalog", () => {
  assert.match(shellSource, /One command bridge for every creator tool/);
  assert.match(shellSource, /space-logo-header\.png/);
  assert.match(shellSource, /space-logo-main\.png/);
  assert.match(shellSource, /model-rocket\.png/);
  assert.match(shellSource, /app\.iconUrl/);
  assert.match(shellSource, /this\.snapshot\.apps\.slice/);
  assert.doesNotMatch(shellSource, /app-streamweaver|app-hearmeout|app-discord-hub|app-chat-tag/);
  assert.doesNotMatch(shellSource, /localStorage|sessionStorage|\/api\/spmt/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-telemetry/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock/);
  assert.match(POLISHED_SPACE_MOUNTAIN_CSS, /@media\(max-width:900px\)/);
});

test("private host uses the same product chrome and serves only explicit local artwork", () => {
  assert.match(hostSource, /auth-product-logo/);
  assert.match(hostSource, /PRIVATE PREVIEW/);
  for (const asset of ["space-logo-main.png", "space-logo-header.png", "model-rocket.png", "theme-solar-flare-background.webp"]) {
    assert.match(serverSource, new RegExp(asset.replace(".", "\\.")));
  }
  assert.match(hostSource, /isolated from Blue/);
});
