import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../apps/hearmeout/src/web-server.ts", import.meta.url), "utf8");

test("HearMeOut keeps its app-owned scene when launched from Shipyard shell mode", () => {
  assert.match(source, /--spmt-app-backdrop-image:url\('\/assets\/product\/hearmeout-background\.webp'\)/);
  assert.doesNotMatch(source, /\.hmo-app\[data-surface=\\?"shell\\?"\][^}]*background:transparent/);
  assert.doesNotMatch(source, /\.hmo-app\[data-surface=\\?"shell\\?"\]>\.spmt-product-backdrop\{display:none\}/);
});
