import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBulletinServer } from "../tools/apollo-bulletin/server.mjs";

test("Apollo browser proof is owner-gated and records an inspectable simulated activity log", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-browser-proof-"));
  const previousPassword = process.env.APOLLO_BROWSER_CONTROL_PASSWORD;
  const password = "test-only-browser-control-password";
  process.env.APOLLO_BROWSER_CONTROL_PASSWORD = password;
  const authorization = "Basic " + Buffer.from("owner:" + password).toString("base64");
  const app = createBulletinServer({ statePath: join(directory, "state.json"), port: 0 });
  try {
    const address = await app.listen();
    const base = "http://127.0.0.1:" + address.port;
    const locked = await fetch(base + "/browser");
    assert.equal(locked.status, 401, "browser control must require owner authentication");

    const page = await fetch(base + "/browser", { headers: { authorization } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Dedicated ChatGPT browser/);

    const statusResponse = await fetch(base + "/api/browser/status", { headers: { authorization } });
    assert.equal(statusResponse.status, 503, "the proof must not claim Chromium is connected when no worker was started");
    const status = await statusResponse.json();
    assert.equal(status.connected, false);
    assert.equal(status.mode, "chromium");
    assert.equal(status.reason, "browser-not-started");

    const view = await fetch(base + "/api/browser/view", { headers: { authorization } });
    assert.equal(view.status, 200);
    assert.match(await view.text(), /SIMULATION/);

    const prompt = "Please confirm Apollo browser is working.";
    const sent = await fetch(base + "/api/browser/send", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    }).then(r => r.json());
    assert.equal(sent.simulated, true);
    assert.match(sent.reply, /SIMULATED CHATGPT REPLY/);

    const log = await fetch(base + "/api/browser/log", { headers: { authorization } }).then(r => r.json());
    assert.ok(log.activity.some(item => item.event === "browser-message-sent" && item.detail === prompt));
    assert.ok(log.activity.some(item => item.event === "browser-simulated-reply" && /SIMULATED CHATGPT REPLY/.test(item.detail)));
  } finally {
    await app.close();
    if (previousPassword === undefined) delete process.env.APOLLO_BROWSER_CONTROL_PASSWORD;
    else process.env.APOLLO_BROWSER_CONTROL_PASSWORD = previousPassword;
    await rm(directory, { recursive: true, force: true });
  }
});
