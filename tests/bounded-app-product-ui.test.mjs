import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../apps/spacemountain-web/src/bounded-app-pages.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../apps/spacemountain-web/src/bounded-app-client.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");

const appScenes = [
  ["discord-stream-hub", "discord-stream-hub-background.webp"],
  ["hearmeout", "hearmeout-background.webp"],
  ["mountainview", "mountainview-background.webp"],
  ["companion", "companion-background.webp"],
  ["streamweaver", "streamweaver-background.webp"],
];

test("bounded donor apps use shared product UI with their own stable scenes", () => {
  assert.match(pageSource, /PRODUCT_UI_CSS/);
  assert.match(pageSource, /spmt-product-glass/);
  assert.match(pageSource, /spmt-product-kicker/);
  assert.match(pageSource, /data-spmt-depth="1"/);
  assert.match(pageSource, /data-spmt-surface/);
  assert.match(pageSource, /bounded-app-client\.js/);
  assert.doesNotMatch(pageSource, /theme-(?:solar-flare|nebula-purple|oceanic-blue|aurora-green)-background\.webp/);
  assert.doesNotMatch(pageSource, /stellar-core-background\.webp/);
  for (const [appId, asset] of appScenes) {
    assert.match(pageSource, new RegExp(appId));
    assert.match(pageSource, new RegExp(asset.replace(".", "\\.")));
    assert.match(serverSource, new RegExp(asset.replace(".", "\\.")));
  }
});

test("bounded donor apps consume canonical workspace appearance instead of keeping app-local theme settings", () => {
  assert.match(clientSource, /SpmtClient/);
  assert.match(clientSource, /getSession\(\)/);
  assert.match(clientSource, /getWorkspaceProfile/);
  assert.match(clientSource, /resolveProductTheme/);
  assert.match(clientSource, /resolveProductBackdrop/);
  assert.match(clientSource, /installProductBackdrop/);
  assert.match(clientSource, /--spmt-glass-opacity/);
  assert.match(clientSource, /--spmt-blur/);
  assert.match(clientSource, /--spmt-stars/);
  assert.match(clientSource, /--spmt-glow/);
  assert.match(clientSource, /sidebarCollapsed/);
  assert.doesNotMatch(clientSource, /localStorage|sessionStorage/);
});

test("bounded app shell surfaces remain frame-safe while standalone mode owns its rocket navigation", () => {
  assert.match(serverSource, /url\.searchParams\.get\("surface"\) === "shell"/);
  assert.match(serverSource, /frame-ancestors 'self'/);
  assert.match(pageSource, /surface !== "standalone"/);
  assert.match(pageSource, /data-spmt-product-nav/);
  assert.match(clientSource, /bindProductRocketNavigation/);
  assert.match(pageSource, /overscroll-behavior:contain/);
});
