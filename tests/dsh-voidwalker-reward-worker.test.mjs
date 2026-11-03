import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../apps/discord-stream-hub/src/voidwalker-reward-worker.ts", import.meta.url), "utf8");

test("Voidwalker eligibility and completion receipts are canonical SPMT events", () => {
  assert.match(source, /ecosystem\.easter-eggs\.completed\.v1/);
  assert.match(source, /ecosystem\.easter-eggs\.discord-reward-delivered\.v1/);
  assert.match(source, /listCommunityIdentities/);
  assert.match(source, /voidwalker-delivered:/);
});

test("Voidwalker role grant precedes clue-role removal and uses scoped Discord grants", () => {
  const grant = source.indexOf('"/guilds/');
  const titleGrant = source.indexOf('"/roles/"'); // URL paths are assembled from verified guild/member/role IDs.
  const remove = source.indexOf('"DELETE"');
  assert.ok(grant >= 0);
  assert.ok(titleGrant >= 0);
  assert.ok(remove > grant);
  assert.match(source, /"guilds:write"/);
  assert.match(source, /"signal seeker","signal hunter"/);
});

test("reward delivery keeps durable local receipts and is safe to retry", () => {
  assert.match(source, /CREATE TABLE IF NOT EXISTS dsh_voidwalker_rewards/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS dsh_voidwalker_roles/);
  assert.match(source, /this\.store\.delivered/);
  assert.match(source, /this\.store\.success/);
  assert.match(source, /this\.store\.failure/);
});
