import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatTagSandboxHost, validateChatTagSandboxEnvironment } from "../apps/nebula-arcade/dist/chat-tag-sandbox-server.js";

test("Chat Tag standalone sandbox runs a complete command and OBS smoke path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-chat-tag-host-"));
  const host = createChatTagSandboxHost({ databasePath: join(directory, "chat-tag.sqlite"), tenantId: "tenant-sandbox", channelId: "channel-sandbox", port: 0, host: "127.0.0.1", buildSha: "test-sha" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${origin}/health/ready`);
    assert.deepEqual(await health.json(), { ready: true, app: "chat-tag", runtimeMode: "sandbox", outboundIntegrations: "disabled", buildSha: "test-sha" });
    const page = await fetch(origin);
    assert.match(await page.text(), /FIRST COMPLETE APP COHORT/);
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
