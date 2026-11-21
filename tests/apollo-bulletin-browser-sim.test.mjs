import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBulletinServer } from "../tools/apollo-bulletin/server.mjs";

test("Apollo browser proof serves simulated chat and records an inspectable activity log", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-browser-proof-"));
  const app = createBulletinServer({ statePath: join(directory, "state.json"), port: 0 });
  try {
    const address = await app.listen();
    const base = "http://127.0.0.1:" + address.port;
    const page = await fetch(base + "/browser");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Simulated ChatGPT/);

    const status = await fetch(base + "/api/browser/status").then(r => r.json());
    assert.equal(status.connected, true);
    assert.equal(status.mode, "simulated");
    assert.equal(status.externalService, false);

    const view = await fetch(base + "/api/browser/view");
    assert.equal(view.status, 200);
    assert.match(await view.text(), /SIMULATION/);

    const sent = await fetch(base + "/api/browser/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Please confirm Apollo browser is working." }),
    }).then(r => r.json());
    assert.equal(sent.simulated, true);
    assert.match(sent.reply, /SIMULATED CHATGPT REPLY/);

    const log = await fetch(base + "/api/browser/log").then(r => r.json());
    assert.equal(log.messages.length, 1);
    assert.equal(log.messages[0].prompt, "Please confirm Apollo browser is working.");
    assert.deepEqual(log.activity.map(item => item.event), ["browser-simulated-reply", "browser-message-sent"]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
