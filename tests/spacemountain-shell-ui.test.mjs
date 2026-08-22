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
  assert.match(source, /Three persistent dock slots/);
  assert.match(source, /\[0, 1, 2\]\.map/);
});

test("Commlink renders separate canonical account feeds and does not fake live chat", () => {
  assert.match(source, /data-commlink-tab/);
  assert.match(source, /Notifications/);
  assert.match(source, /App Events/);
  assert.match(source, /chat-gateway-live-chat/);
  assert.match(source, /provider-neutral Chat Gateway/);
  assert.match(source, /no fabricated data/);
  assert.match(source, /data-notification-read/);
  assert.match(source, /data-open-conversation/);
});

test("Stellar Core stays persona-neutral while Stella and configured personas remain presentation identities", () => {
  assert.match(source, /Stellar Core/);
  assert.match(source, /Stella is the default ecosystem assistant/);
  assert.match(source, /configured StreamWeaver personas use the same public contracts/);
  assert.match(source, /stellar-core-inference/);
  assert.doesNotMatch(source, /label: "Athena"/);
});

test("mobile layout removes shell-header dependency from bottom dock without hiding content", () => {
  assert.match(SPACE_MOUNTAIN_CSS, /@media\(max-width:900px\)/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-rocket-dock\{left:10px;right:10px;top:auto;bottom:/);
  assert.match(SPACE_MOUNTAIN_CSS, /\.spmt-space-main\{padding:calc\(var\(--spmt-shell-top-inset,88px\) \+ 18px\) 14px 92px/);
});
