import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../apps/hearmeout/src/surface-client.ts", import.meta.url), "utf8");

test("HearMeOut Browse Rooms always returns to the room directory", () => {
  assert.match(source, /function showDirectory\(\)/);
  assert.match(source, /detail\.hidden=true/);
  assert.match(source, /detail\.replaceChildren\(\)/);
  assert.match(source, /data-hmo-open-rooms/);
});

test("HearMeOut Open does not redundantly rejoin an existing membership", () => {
  assert.match(source, /textContent\?\.trim\(\)!=='Open'/);
  assert.match(source, /textContent\?\.trim\(\)==='View'/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /view\.click\(\)/);
});
