import test from "node:test";
import assert from "node:assert/strict";
import { resolveCronToken, assertCronTickResponse } from "./cron-auth.mjs";

test("cron token prefers the dedicated token and trims whitespace", () => {
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN:"  bulletin-token  ", APOLLO_BROWSER_CONTROL_PASSWORD:"browser-token" }), "bulletin-token");
});
test("cron token falls back only to existing browser and preview credentials", () => {
  assert.equal(resolveCronToken({ APOLLO_BROWSER_CONTROL_PASSWORD:"browser-token", APOLLO_PREVIEW_PASSWORD:"preview-token" }), "browser-token");
  assert.equal(resolveCronToken({ APOLLO_PREVIEW_PASSWORD:"preview-token" }), "preview-token");
});
test("cron token is empty without a configured supported credential", () => {
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN:" ", APOLLO_BROWSER_CONTROL_PASSWORD:"\n", BOSS_KEY:"legacy-key" }), "");
});
test("cron dispatcher requires an explicit accepted or busy response", () => {
  assert.deepEqual(assertCronTickResponse({ accepted:true }), { accepted:true });
  assert.deepEqual(assertCronTickResponse({ accepted:false, busy:true }), { accepted:false, busy:true });
  for (const value of [null, {}, { accepted:false }, { accepted:true, busy:true }, "ok", []]) {
    assert.throws(() => assertCronTickResponse(value), /did not confirm an accepted or busy tick/);
  }
});

test("browser control password skips blank values and never uses the retired Boss Key", async () => {
  const { resolveBrowserControlPassword } = await import("./cron-auth.mjs");
  assert.equal(resolveBrowserControlPassword({ APOLLO_BROWSER_CONTROL_PASSWORD: " browser-secret ", APOLLO_PREVIEW_PASSWORD: "preview-secret" }), "browser-secret");
  assert.equal(resolveBrowserControlPassword({ APOLLO_BROWSER_CONTROL_PASSWORD: "  ", APOLLO_PREVIEW_PASSWORD: " preview-secret " }), "preview-secret");
  assert.equal(resolveBrowserControlPassword({ APOLLO_BROWSER_CONTROL_PASSWORD: "\t", BOSS_KEY: "legacy-key" }), "");
});
