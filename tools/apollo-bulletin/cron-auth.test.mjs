import test from "node:test";
import assert from "node:assert/strict";
import { resolveCronToken, assertCronTickResponse } from "./cron-auth.mjs";
import { dispatchCronTick } from "./cron-tick.mjs";

test("cron token prefers the dedicated token and trims whitespace", () => {
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN: "  bulletin-token  ", APOLLO_BROWSER_CONTROL_PASSWORD: "browser-token" }), "bulletin-token");
});
test("cron token falls back only to the existing browser and preview credentials", () => {
  assert.equal(resolveCronToken({ APOLLO_BROWSER_CONTROL_PASSWORD: "browser-token", APOLLO_PREVIEW_PASSWORD: "preview-token" }), "browser-token");
  assert.equal(resolveCronToken({ APOLLO_PREVIEW_PASSWORD: "preview-token" }), "preview-token");
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN: " ", APOLLO_BROWSER_CONTROL_PASSWORD: "\n" }), "");
});
test("cron tick response accepts only accepted or busy confirmations", () => {
  assert.deepEqual(assertCronTickResponse({ accepted: true }), { accepted: true });
  assert.deepEqual(assertCronTickResponse({ accepted: false, busy: true }), { accepted: false, busy: true });
  for (const value of [null, {}, { accepted: false }, { accepted: true, busy: true }, "ok", []]) {
    assert.throws(() => assertCronTickResponse(value), /did not confirm an accepted or busy tick/);
  }
});
test("cron dispatcher refuses non-HTTPS or non-origin targets", async () => {
  for (const APOLLO_BULLETIN_PUBLIC_URL of ["http://example.com", "https://example.com/path", "https://user:pass@example.com", "https://example.com/?x=1"]) {
    await assert.rejects(dispatchCronTick({ APOLLO_BULLETIN_CRON_TOKEN: "test", APOLLO_BULLETIN_PUBLIC_URL }, async () => { throw new Error("fetch must not be called"); }), /credential-free HTTPS origin/);
  }
});
test("cron dispatcher rejects non-JSON and unconfirmed 200 responses", async () => {
  const env = { APOLLO_BULLETIN_CRON_TOKEN: "test", APOLLO_BULLETIN_PUBLIC_URL: "https://apollo-node-1.hostless.app" };
  await assert.rejects(dispatchCronTick(env, async () => ({ ok: true, json: async () => { throw new Error("invalid"); } })), /invalid JSON/);
  await assert.rejects(dispatchCronTick(env, async () => ({ ok: true, json: async () => ({}) })), /did not confirm/);
});
test("cron dispatcher accepts the server's 202 accepted and busy responses", async () => {
  const env = { APOLLO_BULLETIN_CRON_TOKEN: "test", APOLLO_BULLETIN_PUBLIC_URL: "https://apollo-node-1.hostless.app" };
  let seen;
  const accepted = await dispatchCronTick(env, async (url, options) => { seen = { url: String(url), authorization: options.headers.authorization }; return { ok: true, json: async () => ({ accepted: true }) }; });
  assert.deepEqual(accepted, { endpoint: "https://apollo-node-1.hostless.app/bulletin/api/cron/tick", accepted: true });
  assert.deepEqual(seen, { url: "https://apollo-node-1.hostless.app/bulletin/api/cron/tick", authorization: "Bearer test" });
  const busy = await dispatchCronTick(env, async () => ({ ok: true, json: async () => ({ accepted: false, busy: true }) }));
  assert.deepEqual(busy, { endpoint: "https://apollo-node-1.hostless.app/bulletin/api/cron/tick", accepted: false, busy: true });
});
