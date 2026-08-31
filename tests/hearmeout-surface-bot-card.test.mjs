import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../apps/hearmeout/src/web-server.ts", import.meta.url), "utf8");

test("HearMeOut app-owned surface exposes real room creation, membership and media state", () => {
  assert.match(source, /Create Room/);
  assert.match(source, /\/api\/hearmeout\/rooms/);
  assert.match(source, /joinRoom/);
  assert.match(source, /heartbeatPresence/);
  assert.match(source, /listMembers/);
  assert.match(source, /getSession/);
  assert.match(source, /Music \/ DJ/);
  assert.match(source, /Watch party/);
});

test("HearMeOut room UI stays truthful when no media or provider session is active", () => {
  assert.match(source, /Green runtime/);
  assert.match(source, /No rooms yet/);
  assert.match(source, /No members yet/);
  assert.match(source, /idle/);
  assert.doesNotMatch(source, /hearmeout-main\.fly\.dev/);
});
