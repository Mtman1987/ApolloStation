import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../apps/hearmeout/src/web-server.ts", import.meta.url), "utf8");
const surface = readFileSync(new URL("../apps/hearmeout/src/surface-client.ts", import.meta.url), "utf8");

test("HearMeOut app-owned surface exposes real room creation, membership and media state", () => {
  assert.match(source, /Create Room/);
  assert.match(source, /\/api\/hearmeout\/rooms/);
  assert.match(source, /joinRoom/);
  assert.match(source, /heartbeatPresence/);
  assert.match(source, /listMembers/);
  assert.match(source, /getSession/);
  assert.match(source, /Bot Hub/);
  assert.match(source, /Music Bot/);
  assert.match(source, /Bridge/);
  assert.match(source, /Personas/);
  assert.match(source, /Watch party/);
  assert.doesNotMatch(source, /Music \/ DJ/);
});

test("HearMeOut Bot Hub keeps bot-like controls behind icons and popovers", () => {
  assert.match(surface, /hmo-bot-hub/);
  assert.match(surface, /hmo-bot-icon/);
  assert.match(surface, /hmo-bot-popover/);
  assert.match(surface, /Bridge/);
  assert.match(surface, /Music Bot/);
  assert.match(surface, /Personas/);
  assert.match(surface, /aria-expanded/);
  assert.match(surface, /Escape/);
});

test("HearMeOut surface browser bundle parses before room controls initialize", () => {
  const marker = "String.raw`";
  const start = surface.indexOf(marker);
  const end = surface.lastIndexOf("`;");
  assert.ok(start >= 0 && end > start, "HearMeOut surface browser source must exist");
  const browserSource = surface
    .slice(start + marker.length, end)
    .replaceAll("${manifest}", '{"appId":"hearmeout"}');
  assert.doesNotThrow(() => new Function(browserSource));
  assert.match(browserSource, /data-hmo-open-rooms/);
  assert.match(browserSource, /data-hmo-create-home/);
});

test("HearMeOut room UI stays truthful when no media or provider session is active", () => {
  assert.match(source, /Green runtime/);
  assert.match(source, /No rooms yet/);
  assert.match(source, /No members yet/);
  assert.match(source, /idle/);
  assert.doesNotMatch(source, /hearmeout-main\.fly\.dev/);
});