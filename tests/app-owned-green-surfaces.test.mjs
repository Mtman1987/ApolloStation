import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const OWNED = ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"];

test("SpaceMountain base host cannot render private first-party app surfaces", async () => {
  const source = await read("apps/spacemountain-web/src/integrated-server-base.ts");
  assert.doesNotMatch(source, /first-party-app-surfaces/);
  assert.doesNotMatch(source, /hearmeout-green-surface/);
  assert.doesNotMatch(source, /renderFirstPartyAppSurface/);
});

test("supervised Green catalog uses canonical app URLs and app-owned web processes", async () => {
  const source = await read("scripts/sprites/run-supervised-sandbox.mjs");
  assert.doesNotMatch(source, /surface=workspace/);
  for (const appId of OWNED) assert.match(source, new RegExp(`/apps/${appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  for (const script of [
    "apps/discord-stream-hub/dist/web-server.js",
    "apps/streamweaver/dist/web-server.js",
    "apps/hearmeout/dist/web-server.js",
    "apps/mountainview/dist/web-server.js",
    "apps/companion/dist/web-server.js",
  ]) assert.match(source, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("owned Green app frontends live with their product owners", async () => {
  const checks = [
    ["discord-stream-hub", "Discord Stream Hub"],
    ["streamweaver", "StreamWeaver"],
    ["hearmeout", "HearMeOut"],
    ["mountainview", "MountainView"],
    ["companion", "SpaceMountain Companion"],
  ];
  for (const [appId, name] of checks) {
    const source = await read(`apps/${appId}/src/web-server.ts`);
    assert.match(source, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("shared product-web foundation consumes canonical UI and AppFrame protocol", async () => {
  const source = await read("packages/app-foundation/src/product-web.ts");
  assert.match(source, /PRODUCT_UI_CSS/);
  assert.match(source, /spmt\.embed/);
  assert.match(source, /child\.ready/);
  assert.match(source, /theme\.changed/);
  assert.match(source, /layout\.changed/);
});
