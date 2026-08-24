import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatTagSandboxHost, validateChatTagSandboxEnvironment } from "../apps/nebula-arcade/dist/chat-tag-sandbox-server.js";

test("Nebula Arcade sandbox runs the Chat Tag module and OBS smoke path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-chat-tag-host-"));
  const host = createChatTagSandboxHost({ databasePath: join(directory, "chat-tag.sqlite"), tenantId: "tenant-sandbox", channelId: "channel-sandbox", port: 0, host: "127.0.0.1", buildSha: "test-sha" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${origin}/health/ready`);
    assert.deepEqual(await health.json(), { ready: true, app: "nebula-arcade", runtimeMode: "sandbox", outboundIntegrations: "disabled", buildSha: "test-sha" });
    const page = await (await fetch(origin)).text();
    assert.match(page, /NEBULA ARCADE/);
    assert.match(page, /GAMES HUB · 20 EQUAL TITLES/);
    assert.match(page, /spmt-product-backdrop/);
    assert.match(page, /spmt-star-layer/);
    assert.match(page, /Nebula Arcade settings/);
    assert.match(page, /id="workspace-settings"/);
    assert.match(page, />SpaceMountain<\/a>/);
    assert.doesNotMatch(page, /SPMT hub/);
    assert.equal((page.match(/data-game=/g) ?? []).length, 20);
    const browserScript = await (await fetch(`${origin}/assets/chat-tag-sandbox.js`)).text();
    assert.match(browserScript, /\/v1\/workspace\/profile/);
    assert.match(browserScript, /x-spmt-tenant/);
    assert.match(browserScript, /applyAppearance/);
    assert.match(browserScript, /--nebula-tint/);
    assert.match(browserScript, /response\.status===409/);
    assert.match(browserScript, /Workspace changed elsewhere; reconciling the latest revision/);
    assert.match(browserScript, /request\(workspace\.revision\)/);
    assert.match(browserScript, /settingsForm\.elements\.theme\.addEventListener\('change'/);
    assert.match(browserScript, /settingsForm\.elements\.accent\.value=preset\[0\]/);
    const themeCss = await (await fetch(`${origin}\/assets\/chat-tag-sandbox.css`)).text();
    assert.match(themeCss, /--nebula-surface:/);
    assert.match(themeCss, /filter:grayscale\(1\) saturate\(0\)/);
    const background = await fetch(`${origin}/assets/nebula-arcade/solar-system.webp`);
    assert.equal(background.status, 200);
    assert.equal(background.headers.get("content-type"), "image/webp");
    assert.ok((await background.arrayBuffer()).byteLength > 50_000);
    const joined = await fetch(`${origin}/v1/chat-tag/message`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ messageId: "join-1", userId: "alpha", username: "Alpha", text: "spmt join", roles: ["member"] }) });
    assert.equal(joined.status, 200);
    const joinedBody = await joined.json();
    assert.equal(joinedBody.outcome.kind, "executed");
    assert.equal(joinedBody.stored.state.currentItUserId, "alpha");
    const overlay = await fetch(`${origin}/v1/nebula/chat-tag/overlay`);
    assert.equal(overlay.status, 200);
    assert.match(await overlay.text(), /Chat Tag Overlay/);
    const snapshot = await fetch(`${origin}/v1/nebula/chat-tag/overlay/state`);
    assert.equal((await snapshot.json()).snapshot.playerCount, 1);
    const blocked = await fetch(`${origin}/v1/chat-tag/message`, { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: "{}" });
    assert.equal(blocked.status, 403);
  } finally { await host.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("Chat Tag sandbox environment fails closed around provider credentials", () => {
  assert.deepEqual(validateChatTagSandboxEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", CHAT_TAG_TENANT_ID: "tenant-a", CHAT_TAG_CHANNEL_ID: "channel-a" }), { databasePath: join(process.cwd(), ".sandbox-data/chat-tag-green-sandbox.sqlite"), tenantId: "tenant-a", channelId: "channel-a" });
  assert.throws(() => validateChatTagSandboxEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", TWITCH_CLIENT_ID: "secret" }), /rejects provider/);
  assert.throws(() => validateChatTagSandboxEnvironment({ SPMT_RUNTIME_MODE: "production", SPMT_OUTBOUND_MODE: "disabled" }), /sandbox is required/);
});
