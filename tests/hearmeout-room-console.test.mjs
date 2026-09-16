import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("HearMeOut keeps audio and bot controls collapsed into participant cards", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  assert.match(source, /hmo-person/);
  assert.match(source, /Audio settings/);
  assert.match(source, /Movies and watch player/);
  assert.match(source, /hmo-bot-drawer/);
  assert.match(source, /Music, movies, personas & Discord/);
  assert.match(source, /Personas/);
  assert.match(source, /Discord bridge/);
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

test("HearMeOut keeps the room bar compact and owns room actions from one header menu", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  assert.match(source, /function roomConsole\(p\).*Room controls.*head\.append\(identity,menu\).*root\.append\(head,grid,watch\)/);
  assert.match(source, /hmo-room-logo.*hearmeout\.png/);
  assert.match(source, /function roomHeaderMenu\(p\).*Deploy HearMeOut DJ.*Voice waiting queue.*Share screen.*Room moderation.*Back to rooms.*Refresh room.*Delete room/);
  assert.doesNotMatch(source, /function personCard\(p,person,isActive\).*Room and connection controls/);
  assert.match(source, /User profile and settings/);
  assert.match(source, /function userCardMenu\(\).*User profile.*User settings/);
});

test("HearMeOut floating controls are singleton dialogs instead of header children", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  assert.match(source, /function openFloatingPanel\(.*data-hmo-floating-dialog/);
  assert.match(source, /document\.querySelector\('\[data-hmo-floating-dialog\]'\)\?\.remove\(\)/);
  assert.match(source, /function roomModeration\(p\).*openFloatingPanel\('Room moderation'/);
  assert.match(source, /dialog\.show\(\)/);
  assert.doesNotMatch(source, /function openFloatingPanel\(.*dialog\.showModal\(\)/);
  assert.doesNotMatch(source, /function roomModeration\(p\).*hmo-console-head/);
});

test("HearMeOut watch player is a movable resizable popover with opt-in controls", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  const surface = await read("apps/hearmeout/src/surface-client.ts");
  const player = await read("apps/hearmeout/src/broadcast-window.ts");
  assert.match(source, /resize:both/);
  assert.match(source, /hmo-player-head/);
  assert.match(source, /Player controls/);
  assert.match(surface, /function restoreWatchGeometry/);
  assert.match(surface, /hmo:toggle-watch-controls/);
  assert.match(surface, /height:100%/);
  assert.match(player, /controls-hidden \.viewer-controls\{display:none!important\}/);
  assert.match(player, /main:hover #view-toggle/);
});

test("deleting an active room invalidates stale renders before returning to the directory", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  assert.match(source, /const token=\+\+roomRenderToken/);
  assert.match(source, /token!==roomRenderToken\|\|activeRoom!==roomId/);
  assert.match(source, /async function deleteRoom\(roomId\).*roomRenderToken\+\+.*activeRoom=''[\s\S]*detail\.hidden=true;await loadRooms\(\)/);
});

test("HearMeOut relies on the shared header for Commlink instead of adding room chat controls", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  const surface = await read("apps/hearmeout/src/surface-client.ts");
  assert.doesNotMatch(source, /Open Commlink|hmo:open-commlink/);
  assert.doesNotMatch(surface, /workspace\.open|service:'commlink'|app:'commlink'/);
  assert.match(await read("apps/hearmeout/src/room-assistant-jobs.ts"), /\/v1\/assistants\/community\/invocations/);
  assert.doesNotMatch(source, />Room chat</);
});

test("HearMeOut exposes real leave delete and moderation room actions", async () => {
  const source = await read("apps/hearmeout/src/web-server-v3.ts");
  const core = await read("apps/hearmeout/src/room-media-core.ts");
  for (const pattern of [/Leave room/, /Delete room/, /Timeout 10 minutes/, /Kick from room/, /Ban from room/, /\/moderation/, /method:'DELETE'/]) assert.match(source, pattern);
  for (const pattern of [/moderateMember/, /deleteRoom/, /hmo_room_restrictions/, /Only the room owner or an admin can moderate/]) assert.match(core, pattern);
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
