import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const surface = await readFile(new URL("../apps/hearmeout/src/surface-client.ts", import.meta.url), "utf8");
const room = await readFile(new URL("../apps/hearmeout/src/web-server-v3.ts", import.meta.url), "utf8");

test("HearMeOut Browse Rooms always returns to the room directory", () => {
  assert.match(surface, /function showDirectory\(\)/);
  assert.match(surface, /detail\.hidden=true/);
  assert.match(surface, /detail\.replaceChildren\(\)/);
  assert.match(surface, /data-hmo-open-rooms/);
});

test("HearMeOut Open does not redundantly rejoin an existing membership", () => {
  assert.match(room, /button\(room\.member\?'Open':'Preview',\(\)=>showRoom\(room\.roomId\)/);
  assert.doesNotMatch(room, /button\(room\.member\?'Open':'Join',\(\)=>joinRoom/);
});
