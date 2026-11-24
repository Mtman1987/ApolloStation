import test from "node:test";
import assert from "node:assert/strict";
import { resolveCronToken } from "./cron-auth.mjs";

test("cron token prefers the dedicated token and trims whitespace", () => {
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN: "  bulletin-token  ", APOLLO_BROWSER_CONTROL_PASSWORD: "browser-token" }), "bulletin-token");
});
test("cron token falls back to the existing browser and preview credentials", () => {
  assert.equal(resolveCronToken({ APOLLO_BROWSER_CONTROL_PASSWORD: "browser-token", APOLLO_PREVIEW_PASSWORD: "preview-token" }), "browser-token");
  assert.equal(resolveCronToken({ APOLLO_PREVIEW_PASSWORD: "preview-token" }), "preview-token");
});
test("cron token is empty when no nonblank credential is configured", () => {
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN: " ", APOLLO_BROWSER_CONTROL_PASSWORD: "\n" }), "");
});

test("cron dispatcher requires an explicit accepted or busy response", async () => {
  const { assertCronTickResponse } = await import("./cron-auth.mjs");
  assert.deepEqual(assertCronTickResponse({ accepted: true }), { accepted: true });
  assert.deepEqual(assertCronTickResponse({ accepted: false, busy: true }), { accepted: false, busy: true });
  for (const value of [null, {}, { accepted: false }, { accepted: true, busy: true }, "ok", []]) {
    assert.throws(() => assertCronTickResponse(value), /did not confirm an accepted or busy tick/);
  }
});
test("cron token falls back to the existing BOSS_KEY owner credential", () => {
  assert.equal(resolveCronToken({ BOSS_KEY: "existing-owner-key" }), "existing-owner-key");
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN: "  ", APOLLO_BROWSER_CONTROL_PASSWORD: " ", APOLLO_PREVIEW_PASSWORD: "\n", BOSS_KEY: " existing-owner-key " }), "existing-owner-key");
});
