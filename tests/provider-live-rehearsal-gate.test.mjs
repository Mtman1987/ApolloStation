import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("live provider rehearsal fails closed before reading a token or opening a socket", () => {
  const result = spawnSync(process.execPath, ["scripts/provider-live-rehearsal.mjs"], { cwd: process.cwd(), env: { ...process.env, SPMT_PROVIDER_LIVE_REHEARSAL: "0", SPMT_CHAT_GATEWAY_TOKEN: "must-not-be-used" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SPMT_PROVIDER_LIVE_REHEARSAL=1 is required/);
  assert.doesNotMatch(result.stderr, /must-not-be-used/);
});
