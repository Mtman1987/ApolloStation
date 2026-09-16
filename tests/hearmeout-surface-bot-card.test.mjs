import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../apps/hearmeout/src/web-server.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../apps/hearmeout/src/web-server-v3.ts", import.meta.url), "utf8");
const surface = readFileSync(new URL("../apps/hearmeout/src/surface-client.ts", import.meta.url), "utf8");
const rtc = readFileSync(new URL("../apps/hearmeout/src/rtc-browser.ts", import.meta.url), "utf8");

test("HearMeOut app-owned surface exposes real room creation membership media and compact controls", () => {
  for (const pattern of [/Create Room/, /\/api\/hearmeout\/rooms/, /joinRoom/, /heartbeatPresence/, /listMembers/, /getSession/, /Commlink/, /Music Bot/, /Bridge/, /Personas/, /Watch together/, /Leave room/, /Delete room/]) assert.match(source, pattern);
  assert.doesNotMatch(source, /Music \/ DJ/);
});

test("HearMeOut renders participant, persona, and DJ cards in the app-owned room renderer", () => {
  assert.doesNotMatch(surface, /hmo-bot-hub/);
  assert.doesNotMatch(surface, /hmo-bot-icon/);
  assert.doesNotMatch(surface, /MutationObserver/);
  assert.doesNotMatch(surface, /function personaCard/);
  assert.match(runtime, /function peoplePane\(p\).*personaCard\(p,persona,p\.personaData\).*djCard\(p\)/);
  assert.match(runtime, /function personaCard\(/);
  assert.match(runtime, /function djCard\(/);
  assert.match(runtime, /Music, movies, personas & Discord/);
  assert.match(runtime, /actions\.append\(music,watch,personas,bridge\)/);
  assert.match(runtime, /Deploy HearMeOut DJ/);
  assert.match(runtime, /function deployDj\(p,control\).*append\(djCard\(p\)\)/);
  assert.match(runtime, /if\(deployedDjRooms\.has\(p\.room\.roomId\)\)rows\.append\(djCard\(p\)\)/);
  assert.match(runtime, /hmo-bot-drawer/);
  assert.match(runtime, /hmo-person-menu/);
  assert.match(runtime, /Audio settings/);
  assert.doesNotMatch(runtime, /label\.textContent=own\?'Room volume'/);
});

test("HearMeOut leaves Commlink exclusively to the shared shell header", () => {
  assert.doesNotMatch(runtime, /Open Commlink|hmo:open-commlink/);
  assert.doesNotMatch(surface, /workspace\.open|service:'commlink'|window\.open|app:'commlink'/);
});

test("HearMeOut persona text controls send directly without relying on shell enhancement", () => {
  assert.match(runtime, /call=button\('Send'/);
  assert.match(runtime, /input\.dataset\.hmoEnterSend='1'/);
  assert.match(runtime, /(?:event|e)\.key==='Enter'.*call\.click\(\)/);
  assert.doesNotMatch(runtime, /const call=button\('Call '/);
});
test("HearMeOut uses the Discord directory and the native persona room transport", () => {
  assert.match(runtime, /channelKind=voice/);
  assert.match(runtime, /Discord server/);
  assert.match(runtime, /Discord voice channel/);
  assert.match(runtime, /result\.personaSpeech\?\.attempted/);
  assert.match(runtime, /talkingAvatarUrl/);
  assert.match(runtime, /data-speaking/);
});

test("HearMeOut never republishes fallback persona audio as the human microphone", () => {
  assert.match(runtime, /private browser playback/);
  assert.match(runtime, /new Audio\(result\.audioUrl\)/);
  assert.doesNotMatch(runtime, /createMediaStreamDestination/);
  assert.doesNotMatch(runtime, /personaMix/);
  assert.match(runtime, /rtc\?\.setInput\(micStream\)/);
});

test("HearMeOut drives human and persona speaking indicators from LiveKit participants", () => {
  assert.match(rtc, /RoomEvent\.ActiveSpeakersChanged/);
  assert.match(rtc, /hmo:participant-speaking/);
  assert.doesNotMatch(rtc, /attachAudio\(Number\(participant\.identity\)/);
  assert.match(runtime, /data-hmo-persona-id/);
  assert.match(runtime, /data-hmo-user-id/);
  assert.match(runtime, /toggleAttribute\('data-speaking',speaking\)/);
});

test("HearMeOut surface browser bundle parses before room controls initialize", () => {
  const marker = "String.raw`";
  const start = surface.indexOf(marker);
  const end = surface.lastIndexOf("`;");
  assert.ok(start >= 0 && end > start, "HearMeOut surface browser source must exist");
  const browserSource = surface.slice(start + marker.length, end).replaceAll("${manifest}", '{"appId":"hearmeout"}');
  assert.doesNotThrow(() => new Function(browserSource));
  assert.match(browserSource, /data-hmo-open-rooms/);
  assert.match(browserSource, /data-hmo-create-home/);
});

test("HearMeOut room UI stays truthful when no media or provider session is active", () => {
  assert.match(source, /Green runtime/);
  assert.match(source, /No rooms yet/);
  assert.match(source, /idle/);
  assert.match(runtime, /async function renderBridge/);
  assert.doesNotMatch(source, /hearmeout-main\.fly\.dev/);
});

test("HearMeOut home exposes only room navigation until music saving is a complete workflow", () => {
  assert.match(runtime, /data-hmo-library.*remove\(\)/);
  assert.match(runtime, /hmo-hero-actions.*href="\/watch".*remove\(\)/);
});
