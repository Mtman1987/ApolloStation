import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("HearMeOut room console exposes recognizable voice chat watch music and persona controls", async () => {
  const source = await read("apps/hearmeout/src/web-server-v2.ts");
  assert.match(source, /People & volume/);
  assert.match(source, /Room chat/);
  assert.match(source, /WATCH ROOM/);
  assert.match(source, /MUSIC \/ DJ/);
  assert.match(source, /Add configured persona/);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(source, /noiseSuppression/);
  assert.match(source, /echoCancellation/);
  assert.match(source, /autoGainControl/);
  assert.match(source, /Hold to talk/);
  assert.match(source, /hmo-volume:/);
});

test("HearMeOut room console routes chat and media through Green authority", async () => {
  const source = await read("apps/hearmeout/src/web-server-v2.ts");
  assert.match(source, /hmo_room_chat/);
  assert.match(source, /\/media\\\/(movie\|music)/);
  assert.match(source, /rooms\.enqueue\(principal/);
  assert.match(source, /rooms\.control\(principal/);
  assert.match(source, /\/v1\/assistants\/community\/invocations/);
  assert.doesNotMatch(source, /firebase|firestore/i);
});

test("legacy HearMeOut web entrypoint delegates to the room console without changing its public module", async () => {
  const source = await read("apps/hearmeout/src/web-server.ts");
  assert.match(source, /export \* from "\.\/web-server-v2\.js"/);
  assert.match(source, /startHearMeOutWebServerFromEnvironment/);
});
