import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatTagSandboxHost, validateChatTagSandboxEnvironment } from "../apps/nebula-arcade/dist/chat-tag-sandbox-server.js";

test("Nebula Arcade sandbox exposes the cosmic hub, game pages, saved overlay scenes, and Chat Tag runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-chat-tag-host-"));
  const host = createChatTagSandboxHost({ databasePath: join(directory, "chat-tag.sqlite"), tenantId: "tenant-sandbox", channelId: "channel-sandbox", port: 0, host: "127.0.0.1", buildSha: "test-sha" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${origin}/health/ready`);
    assert.deepEqual(await health.json(), { ready: true, app: "nebula-arcade", runtimeMode: "sandbox", outboundIntegrations: "disabled", buildSha: "test-sha" });

    const home = await (await fetch(origin)).text();
    assert.match(home, /NEBULA ARCADE/);
    assert.match(home, /GAMES HUB · 20 EQUAL TITLES/);
    assert.match(home, /class="hero-logo"/);
    assert.match(home, />Games<\/a>/);
    assert.match(home, />Overlay Bay<\/a>/);
    assert.match(home, />Arcade Stats<\/a>/);
    assert.match(home, /spmt-product-backdrop/);
    assert.match(home, /spmt-star-layer/);
    assert.match(home, /Nebula Arcade settings/);
    assert.match(home, /data-surface="standalone"/);
    assert.match(home, /class="nebula-rocket-dock"/);
    assert.match(home, />SpaceMountain<\/a>/);
    assert.doesNotMatch(home, /SPMT hub/);

    const games = await (await fetch(`${origin}/?view=games`)).text();
    assert.equal((games.match(/data-game=/g) ?? []).length, 20);
    assert.match(games, /Choose a game/);
    assert.match(games, /Chat Garden/);
    assert.match(games, /catalog ready/);

    const chatTagPage = await (await fetch(`${origin}/?view=game&game=chat-tag`)).text();
    assert.match(chatTagPage, /Playable in Review/);
    assert.match(chatTagPage, /id="game-console"/);
    assert.match(chatTagPage, /Screenshots &amp; use examples|Screenshots & use examples/);
    assert.match(chatTagPage, /Attributions, socials &amp; sources|Attributions, socials & sources/);

    const catalogOnlyPage = await (await fetch(`${origin}/?view=game&game=chatgarden`)).text();
    assert.match(catalogOnlyPage, /Catalog registered/);
    assert.match(catalogOnlyPage, /deliberately does not fake gameplay/);

    const overlayBay = await (await fetch(`${origin}/?view=overlay`)).text();
    assert.match(overlayBay, /One URL\. Any combination of games\./);
    assert.match(overlayBay, /id="overlay-scene-form"/);
    assert.equal((overlayBay.match(/name="gameId"/g) ?? []).length, 20);

    const created = await fetch(`${origin}/v1/nebula/overlay-scenes`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ id: "main-stream", name: "Main Stream", gameIds: ["chat-tag", "chatgarden"] }) });
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    assert.equal(createdBody.scene.name, "Main Stream");
    assert.deepEqual(createdBody.scene.layers.map((layer) => layer.gameId), ["chat-tag", "chatgarden"]);
    assert.equal(createdBody.outputUrl, "/apps/nebula-arcade?surface=overlay&scene=main-stream");

    const listed = await (await fetch(`${origin}/v1/nebula/overlay-scenes`)).json();
    assert.equal(listed.scenes.length, 1);

    const appAliasList = await (await fetch(`${origin}/apps/nebula-arcade?action=overlay-scenes`)).json();
    assert.equal(appAliasList.scenes.length, 1);
    const proxyNormalizedList = await (await fetch(`${origin}/?action=overlay-scenes`)).json();
    assert.equal(proxyNormalizedList.scenes.length, 1);

    const directOutput = await (await fetch(`${origin}/overlay/main-stream`)).text();
    assert.match(directOutput, /Chat Tag overlay/);
    assert.match(directOutput, /Chat Garden/);
    assert.match(directOutput, /runtime widget pending/);

    const appOutput = await (await fetch(`${origin}/apps/nebula-arcade?surface=overlay&scene=main-stream`)).text();
    assert.match(appOutput, /\/assets\/nebula-arcade\/overlay\.css/);
    assert.match(appOutput, /Chat Tag overlay/);
    assert.match(appOutput, /Chat Garden/);
    assert.doesNotMatch(appOutput, /style="--layer:/);
    const proxyNormalizedOutput = await (await fetch(`${origin}/?surface=overlay&scene=main-stream`)).text();
    assert.match(proxyNormalizedOutput, /Chat Tag overlay/);
    assert.match(proxyNormalizedOutput, /Chat Garden/);

    const browserScript = await (await fetch(`${origin}/assets/chat-tag-sandbox.js`)).text();
    assert.match(browserScript, /\/v1\/workspace\/profile/);
    assert.match(browserScript, /\/apps\/nebula-arcade\?action=overlay-scenes/);
    assert.match(browserScript, /surface=overlay&scene=/);
    assert.doesNotMatch(browserScript, /\/v1\/nebula\/overlay-scenes/);
    assert.match(browserScript, /x-spmt-tenant/);
    assert.match(browserScript, /--spmt-glass-opacity/);
    assert.match(browserScript, /response\.status===409/);
    assert.match(browserScript, /Workspace changed elsewhere; reconciling the latest revision/);

    const themeCss = await (await fetch(`${origin}/assets/chat-tag-sandbox.css`)).text();
    assert.match(themeCss, /--spmt-depth-4-alpha/);
    assert.match(themeCss, /--nebula-depth-4/);
    assert.match(themeCss, /\.hero,.view-heading,.games,.overlay-bay/);
    assert.match(themeCss, /data-surface="shell"/);
    const overlayCss = await (await fetch(`${origin}/assets/nebula-arcade/overlay.css`)).text();
    assert.match(overlayCss, /display:flex/);
    assert.match(overlayCss, /nebula-output-placeholder\{position:relative/);

    const shellPage = await (await fetch(`${origin}/apps/nebula-arcade?surface=shell`)).text();
    assert.match(shellPage, /data-surface="shell"/);
    const background = await fetch(`${origin}/assets/nebula-arcade/solar-system.webp`);
    assert.equal(background.status, 200);
    assert.equal(background.headers.get("content-type"), "image/webp");
    assert.ok((await background.arrayBuffer()).byteLength > 50_000);

    const joined = await fetch(`${origin}/v1/chat-tag/message`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ messageId: "join-1", userId: "alpha", username: "Alpha", text: "!join", roles: ["member"] }) });
    assert.equal(joined.status, 200);
    const joinedBody = await joined.json();
    assert.equal(joinedBody.outcome.kind, "executed");
    assert.equal(joinedBody.stored.state.currentItUserId, "alpha");
    const overlay = await fetch(`${origin}/v1/nebula/chat-tag/overlay`);
    assert.equal(overlay.status, 200);
    assert.match(await overlay.text(), /Chat Tag Overlay/);
    const snapshot = await fetch(`${origin}/v1/nebula/chat-tag/overlay/state`);
    assert.equal((await snapshot.json()).snapshot.playerCount, 1);

    const deleted = await fetch(`${origin}/apps/nebula-arcade?action=overlay-scenes&scene=main-stream`, { method: "DELETE", headers: { origin } });
    assert.equal(deleted.status, 200);
    assert.equal((await (await fetch(`${origin}/?action=overlay-scenes`)).json()).scenes.length, 0);

    const blocked = await fetch(`${origin}/v1/chat-tag/message`, { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: "{}" });
    assert.equal(blocked.status, 403);
  } finally { await host.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("Chat Tag sandbox environment fails closed around provider credentials", () => {
  assert.deepEqual(validateChatTagSandboxEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", CHAT_TAG_TENANT_ID: "tenant-a", CHAT_TAG_CHANNEL_ID: "channel-a" }), { databasePath: join(process.cwd(), ".sandbox-data/chat-tag-green-sandbox.sqlite"), tenantId: "tenant-a", channelId: "channel-a" });
  assert.throws(() => validateChatTagSandboxEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", TWITCH_CLIENT_ID: "secret" }), /rejects provider/);
  assert.throws(() => validateChatTagSandboxEnvironment({ SPMT_RUNTIME_MODE: "production", SPMT_OUTBOUND_MODE: "disabled" }), /sandbox is required/);
});
