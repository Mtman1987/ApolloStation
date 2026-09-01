import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("HearMeOut keeps audio and bot controls collapsed into participant cards", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  assert.match(source, /hmo-person/);
  assert.match(source, /Audio settings/);
  assert.match(source, /Bots & personas/);
  assert.match(source, /hmo-bot-drawer/);
  assert.match(source, /Music Bot/);
  assert.match(source, /Personas/);
  assert.match(source, /Bridge/);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(source, /audiooutput/);
  assert.match(source, /noiseSuppression/);
  assert.match(source, /echoCancellation/);
  assert.match(source, /autoGainControl/);
  assert.match(source, /Push to talk/);
  assert.match(source, /hmo-master-volume/);
  assert.match(source, /hmo-volume:/);
  assert.doesNotMatch(source, /hmo-chat-pane/);
  assert.doesNotMatch(source, /Room chat/);
});

test("HearMeOut uses Commlink instead of a second visible room chat", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  assert.match(source, /Open Commlink/);
  assert.match(source, /\?app=commlink/);
  assert.match(source, /surface:\"commlink\"/);
  assert.match(source, /\/v1\/assistants\/community\/invocations/);
  assert.doesNotMatch(source, />Room chat</);
});

test("HearMeOut exposes real leave delete and moderation room actions", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  const core = await read("apps/hearmeout/src/room-media-core.ts");
  for (const pattern of [/Leave room/, /Delete room/, /Timeout 10 minutes/, /Kick from room/, /Ban from room/, /\/moderation/, /method:'DELETE'/]) assert.match(source, pattern);
  for (const pattern of [/moderateMember/, /deleteRoom/, /hmo_room_restrictions/, /Only the room owner or an admin can moderate/, /delete the room instead/]) assert.match(core, pattern);
});

test("HearMeOut private rooms stay discoverable without leaking lobby details", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  const core = await read("apps/hearmeout/src/room-media-core.ts");
  assert.match(source, /locked:true/);
  assert.match(source, /participantCount/);
  assert.match(source, /Enter password/);
  assert.match(source, /hmo-password-bubble/);
  assert.match(source, /member names, activity, chat, and media stay hidden until admission/);
  assert.match(source, /watchParty/);
  assert.match(source, /musicBot/);
  assert.match(source, /joinedAt/);
  assert.doesNotMatch(core, /room\.privacy === \"public\" \|\| room\.ownerUserId/);
});

test("legacy HearMeOut web entrypoint delegates to v3 without changing its public module", async () => {
  const source = await read("apps/hearmeout/src/web-server.ts");
  assert.match(source, /export \* from "\.\/web-server-v3\.js"/);
  assert.match(source, /startHearMeOutWebServerFromEnvironment/);
});
