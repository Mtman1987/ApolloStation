import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNebulaArcadeSandboxHost } from "../apps/nebula-arcade/dist/nebula-arcade-sandbox-server.js";

function hostOrigin(server) { const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; }

test("Nebula enhanced host gives all games shared runtime actions and Game Mix overlays", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-parity-"));
  const host = createNebulaArcadeSandboxHost({ databasePath: join(directory, "nebula.sqlite"), tenantId: "tenant-a", channelId: "captain", port: 0, host: "127.0.0.1", buildSha: "test" });
  try {
    await host.listen();
    const origin = hostOrigin(host.server);
    const post = (path, body) => fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

    const started = await post("/v1/nebula/game-actions", { gameId: "chaosmode", action: "start", channel: "captain", username: "captain", displayName: "Captain", userId: "1", isBroadcaster: true });
    assert.equal(started.status, 200);
    assert.ok((await started.json()).activeGameIds.includes("chaosmode"));

    const action = await post("/v1/nebula/game-actions", { gameId: "chaosmode", action: "explode", channel: "captain", username: "viewer", displayName: "Viewer", userId: "2", message: "!explode" });
    assert.equal(action.status, 200);
    assert.equal((await action.json()).action.action, "explode");

    const feed = await fetch(`${origin}/v1/nebula/game-actions?channel=captain&gameId=chaosmode`);
    const feedBody = await feed.json();
    assert.ok(feedBody.actions.some((item) => item.action === "explode"));

    const mixResponse = await post("/v1/nebula/game-mixes", { id: "community-night", name: "Community Night", mode: "simultaneous", layers: [{ gameId: "chaosmode", x: 0, y: 0, width: 50, height: 100, style: "full" }, { gameId: "chatgarden", x: 50, y: 0, width: 50, height: 100, style: "compact" }] });
    assert.equal(mixResponse.status, 200);
    const mixBody = await mixResponse.json();
    assert.equal(mixBody.rendererUrl, "/apps/nebula-arcade?surface=overlay&mix=community-night");

    const overlay = await fetch(`${origin}${mixBody.rendererUrl}`);
    const overlayHtml = await overlay.text();
    assert.equal(overlay.status, 200);
    assert.match(overlayHtml, /Chaos Mode/);
    assert.match(overlayHtml, /Chat Garden/);
    assert.doesNotMatch(overlayHtml, /Runtime widget pending/);

    const state = await fetch(`${origin}/v1/nebula/game-mix-state?mix=community-night`);
    const stateBody = await state.json();
    assert.equal(stateBody.games.chaosmode.latestAction.action, "explode");

    const oldEditor = await fetch(`${origin}/apps/nebula-arcade?view=overlay`);
    assert.match(await oldEditor.text(), /Overlay editing lives in Overlay Bay/);

    const app = await fetch(`${origin}/apps/nebula-arcade?view=game&game=chatgarden`);
    const appHtml = await app.text();
    assert.match(appHtml, /src="\/overlay\/arcade\/chatgarden"/);
    assert.doesNotMatch(appHtml, /Catalog registered/);
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Nebula action validation retains donor-specific commands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-actions-"));
  const host = createNebulaArcadeSandboxHost({ databasePath: join(directory, "nebula.sqlite"), tenantId: "tenant-a", channelId: "captain", port: 0, host: "127.0.0.1" });
  try {
    await host.listen(); const origin = hostOrigin(host.server);
    const post = (body) => fetch(`${origin}/v1/nebula/game-actions`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    await post({ gameId: "pixelbattle", action: "start", channel: "captain", username: "captain", userId: "1", isBroadcaster: true });
    assert.equal((await post({ gameId: "pixelbattle", action: "paint", args: ["red", "10", "5"], channel: "captain", username: "viewer", userId: "2" })).status, 200);
    assert.equal((await post({ gameId: "pixelbattle", action: "paint", args: ["chartreuse", "999", "5"], channel: "captain", username: "viewer", userId: "2" })).status, 500);
  } finally { await host.close(); rmSync(directory, { recursive: true, force: true }); }
});
