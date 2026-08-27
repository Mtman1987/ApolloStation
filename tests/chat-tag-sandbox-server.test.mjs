import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatTagSandboxHost, validateChatTagSandboxEnvironment } from "../apps/nebula-arcade/dist/chat-tag-sandbox-server.js";

function originFor(server) { const address = server.address(); assert.ok(address && typeof address === "object"); return `http://127.0.0.1:${address.port}`; }

test("Nebula sandbox keeps legacy Chat Tag compatibility while all games report shared runtime readiness", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-nebula-host-"));
  const host = createChatTagSandboxHost({ databasePath: join(directory, "nebula.sqlite"), tenantId: "tenant-sandbox", channelId: "channel-sandbox", port: 0, host: "127.0.0.1", buildSha: "test-sha" });
  try {
    await host.listen(); const origin = originFor(host.server);
    const health = await fetch(`${origin}/health/ready`);
    assert.deepEqual(await health.json(), { ready: true, app: "nebula-arcade", runtimeMode: "sandbox", outboundIntegrations: "disabled", buildSha: "test-sha" });

    const home = await (await fetch(origin)).text();
    assert.match(home, /NEBULA ARCADE/);
    assert.match(home, /GAMES HUB · 20 EQUAL TITLES/);
    assert.match(home, /class="hero-logo"/);
    assert.match(home, /spmt-star-layer/);

    const games = await (await fetch(`${origin}/?view=games`)).text();
    assert.equal((games.match(/data-game=/g) ?? []).length, 20);
    assert.match(games, /Chat Garden/);
    assert.doesNotMatch(games, /Runtime widget pending|Catalog registered/);

    const chatTagPage = await (await fetch(`${origin}/?view=game&game=chat-tag`)).text();
    assert.match(chatTagPage, /Chat Tag game module/);
    assert.match(chatTagPage, /id="game-console"/);

    const garden = await (await fetch(`${origin}/?view=game&game=chatgarden`)).text();
    assert.match(garden, /Shared runtime ready|shared persistent runtime/i);
    assert.doesNotMatch(garden, /This page does not fake gameplay|runtime will plug/i);

    const overlay = await (await fetch(`${origin}/?view=overlay`)).text();
    assert.match(overlay, /Overlay editing lives in Overlay Bay/);
    assert.doesNotMatch(overlay, /overlay-scene-form|Select one or more games/);
  } finally { await host.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("legacy saved scene/output APIs remain callable for migration evidence while canonical editing moves to Overlay Bay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-nebula-legacy-"));
  const host = createChatTagSandboxHost({ databasePath: join(directory, "nebula.sqlite"), tenantId: "tenant-sandbox", channelId: "channel-sandbox", port: 0, host: "127.0.0.1" });
  try {
    await host.listen(); const origin = originFor(host.server);
    const created = await fetch(`${origin}/v1/nebula/overlay-scenes`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ id: "main-stream", name: "Main Stream", gameIds: ["chat-tag", "chatgarden"] }) });
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    assert.equal(createdBody.scene.name, "Main Stream");
    assert.deepEqual(createdBody.scene.layers.map((layer) => layer.gameId), ["chat-tag", "chatgarden"]);
    const directOutput = await (await fetch(`${origin}/overlay/main-stream`)).text();
    assert.match(directOutput, /Chat Tag overlay/);
  } finally { await host.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("sandbox environment validation requires explicit isolated storage and tenant/channel", () => {
  assert.throws(() => validateChatTagSandboxEnvironment({}), /database path/i);
  assert.throws(() => validateChatTagSandboxEnvironment({ CHAT_TAG_DATABASE_PATH: "/tmp/test.sqlite" }), /tenant/i);
  const checked = validateChatTagSandboxEnvironment({ CHAT_TAG_DATABASE_PATH: "/tmp/test.sqlite", CHAT_TAG_TENANT_ID: "tenant", CHAT_TAG_CHANNEL_ID: "channel" });
  assert.equal(checked.tenantId, "tenant");
  assert.equal(checked.channelId, "channel");
});
