import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../apps/spacemountain-web/src/first-party-app-surfaces.ts", import.meta.url), "utf8");

test("HearMeOut keeps people as individual cards and consolidates every service into one bot card", () => {
  assert.match(source, /data-kind=\\"person\\"/);
  assert.match(source, /data-kind=\\"bot-activity\\"/);
  assert.match(source, /data-hmo-service=\\"dj\\"/);
  assert.match(source, /data-hmo-service=\\"discord\\"/);
  assert.match(source, /data-hmo-named-bots/);
  assert.match(source, /Bots & room services/);
  assert.match(source, /window\.addEventListener\('hearmeout:room-status'/);
});

test("HearMeOut bot status UI starts truthful instead of fabricating active services", () => {
  assert.match(source, />Idle</);
  assert.match(source, />Disconnected</);
  assert.match(source, />None active</);
  assert.match(source, /0 active/);
});
