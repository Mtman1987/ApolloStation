import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../apps/hearmeout/src/web-server.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../apps/hearmeout/src/web-server-v3.ts", import.meta.url), "utf8");
const surface = readFileSync(new URL("../apps/hearmeout/src/surface-client.ts", import.meta.url), "utf8");

test("HearMeOut app-owned surface exposes real room creation membership media and compact controls", () => {
  for (const pattern of [/Create Room/, /\/api\/hearmeout\/rooms/, /joinRoom/, /heartbeatPresence/, /listMembers/, /getSession/, /Commlink/, /Music Bot/, /Bridge/, /Personas/, /Watch together/, /Leave room/, /Delete room/]) assert.match(source, pattern);
  assert.doesNotMatch(source, /Music \/ DJ/);
});

test("HearMeOut no longer reserves a permanent Bot Hub header surface", () => {
  assert.doesNotMatch(surface, /hmo-bot-hub/);
  assert.doesNotMatch(surface, /hmo-bot-icon/);
  assert.match(runtime, /hmo-bot-drawer/);
  assert.match(runtime, /Bots & personas/);
  assert.match(runtime, /hmo-person-menu/);
  assert.match(runtime, /Audio settings/);
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
  assert.match(runtime, /supervised bridge adapter is mounted/);
  assert.doesNotMatch(source, /hearmeout-main\.fly\.dev/);
});
