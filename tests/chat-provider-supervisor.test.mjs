import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatGatewayRuntime, ChatProviderConnectionSupervisor, SqliteChatGatewayStore, SqliteProviderConnectionStore, reconnectDelayMs } from "../apps/chat-gateway/dist/index.js";

const t0 = "2026-08-23T12:00:00.000Z";
const config = (provider, tenantId = "tenant-a") => ({ schemaVersion: 1, tenantId, provider, connectionId: `${provider}-main`, channelId: `${provider}-channel`, providerAccountId: `${provider}-account`, desired: true });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "apollo-provider-supervisor-"));
  const connectionPath = join(dir, "connections.sqlite");
  const deliveryPath = join(dir, "deliveries.sqlite");
  const connections = new SqliteProviderConnectionStore(connectionPath);
  const messages = new SqliteChatGatewayStore(deliveryPath);
  return { dir, connectionPath, deliveryPath, connections, messages, close() { connections.close(); messages.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function fakeDriver(provider, opened) {
  return { provider, async open(input) { opened.push(input); return { close() {} }; } };
}

test("one leased supervisor opens Twitch, Discord, and Kick and feeds normalized gateway consumers", async () => {
  const f = fixture();
  try {
    for (const provider of ["twitch", "discord", "kick"]) f.connections.put(config(provider), t0);
    const delivered = [];
    const gateway = new ChatGatewayRuntime(f.messages, [{ id: "capture", accepts: () => true, deliver: (delivery) => delivered.push(delivery.message) }]);
    const opened = [];
    const grants = { async getGrant() { return { status: "ready", accessToken: "ephemeral", expiresAt: "2026-08-23T13:00:00Z" }; } };
    const drivers = ["twitch", "discord", "kick"].map((provider) => fakeDriver(provider, opened));
    const first = new ChatProviderConnectionSupervisor("worker-a", f.connections, gateway, grants, drivers);
    const second = new ChatProviderConnectionSupervisor("worker-b", f.connections, gateway, grants, drivers);
    assert.deepEqual(await first.reconcile(t0), { claimed: 3, connected: 3, failed: 0, reauthorizationRequired: 0 });
    assert.deepEqual(await second.reconcile(t0), { claimed: 0, connected: 0, failed: 0, reauthorizationRequired: 0 });
    await opened[0].onEnvelope({ schemaVersion: 1, tenantId: "tenant-a", provider: opened[0].connection.provider, connectionId: opened[0].connection.connectionId, channelId: opened[0].connection.channelId, messageId: "provider-message-1", text: "hello from provider", occurredAt: t0, providerUserId: "user-1", username: "viewer" });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].text, "hello from provider");
    await first.stop("2026-08-23T12:00:01Z");
  } finally { f.close(); }
});

test("a provider resume cursor survives process restart without persisting the grant", async () => {
  const f = fixture();
  let reopened;
  let reopenedMessages;
  try {
    f.connections.put(config("discord"), t0);
    const opened = [];
    const grants = { async getGrant() { return { status: "ready", accessToken: "SUPER-SECRET-GRANT", expiresAt: "2026-08-23T13:00:00Z" }; } };
    const gateway = new ChatGatewayRuntime(f.messages);
    const first = new ChatProviderConnectionSupervisor("worker-a", f.connections, gateway, grants, [fakeDriver("discord", opened)]);
    await first.reconcile(t0);
    opened[0].onCursor("discord-session-1:sequence-42");
    await first.stop("2026-08-23T12:00:01Z");
    f.connections.close();
    f.messages.close();
    reopened = new SqliteProviderConnectionStore(f.connectionPath);
    reopenedMessages = new SqliteChatGatewayStore(f.deliveryPath);
    const resumed = [];
    const second = new ChatProviderConnectionSupervisor("worker-b", reopened, new ChatGatewayRuntime(reopenedMessages), grants, [fakeDriver("discord", resumed)]);
    await second.reconcile("2026-08-23T12:00:02Z");
    assert.equal(resumed[0].resumeCursor, "discord-session-1:sequence-42");
    assert.doesNotMatch(readFileSync(f.connectionPath).toString("latin1"), /SUPER-SECRET-GRANT/);
    await second.stop("2026-08-23T12:00:03Z");
  } finally {
    try { f.connections.close(); } catch {}
    try { f.messages.close(); } catch {}
    reopened?.close();
    reopenedMessages?.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("transient grant failure backs off durably and retries only when due", async () => {
  const f = fixture();
  try {
    f.connections.put(config("twitch"), t0);
    let ready = false;
    const grants = { async getGrant() { return ready ? { status: "ready", accessToken: "fresh", expiresAt: "2026-08-23T13:00:00Z" } : { status: "unavailable", reason: "authorization=secret-value grant service offline" }; } };
    const opened = [];
    const supervisor = new ChatProviderConnectionSupervisor("worker-a", f.connections, new ChatGatewayRuntime(f.messages), grants, [fakeDriver("twitch", opened)]);
    assert.equal((await supervisor.reconcile(t0)).failed, 1);
    const failed = f.connections.get("tenant-a", "twitch", "twitch-main");
    assert.equal(failed.state, "backoff");
    assert.equal(failed.nextAttemptAt, "2026-08-23T12:00:02.000Z");
    assert.doesNotMatch(failed.lastError, /secret-value/);
    ready = true;
    assert.equal((await supervisor.reconcile("2026-08-23T12:00:01.999Z")).claimed, 0);
    assert.equal((await supervisor.reconcile("2026-08-23T12:00:02.000Z")).connected, 1);
    assert.equal(opened.length, 1);
    await supervisor.stop("2026-08-23T12:00:03Z");
  } finally { f.close(); }
});

test("authentication failures pause reconnect until SPMT replaces the provider grant", async () => {
  const f = fixture();
  try {
    f.connections.put(config("kick"), t0);
    const grants = { async getGrant() { return { status: "reauthorization-required", reason: "token=expired-token reconnect paused" }; } };
    const supervisor = new ChatProviderConnectionSupervisor("worker-a", f.connections, new ChatGatewayRuntime(f.messages), grants, [fakeDriver("kick", [])]);
    const report = await supervisor.reconcile(t0);
    assert.equal(report.reauthorizationRequired, 1);
    const projection = f.connections.get("tenant-a", "kick", "kick-main");
    assert.equal(projection.state, "reauthorization-required");
    assert.doesNotMatch(projection.lastError, /expired-token/);
    assert.equal((await supervisor.reconcile("2026-08-24T12:00:00Z")).claimed, 0);
    f.connections.put(config("kick"), "2026-08-24T12:00:01Z");
    assert.equal(f.connections.get("tenant-a", "kick", "kick-main").state, "pending");
  } finally { f.close(); }
});

test("an active socket authentication rejection asks SPMT to rotate once before pausing the account", async () => {
  const f = fixture();
  try {
    f.connections.put(config("twitch"), t0);
    const opened = [], recoveries = [];
    let recovery = { status: "ready", accessToken: "rotated-access", expiresAt: "2026-08-23T13:00:00Z" };
    const grants = {
      async getGrant() { return { status: "ready", accessToken: "initial-access", expiresAt: "2026-08-23T13:00:00Z" }; },
      async recoverAuthentication(connection, reason) { recoveries.push({ connection, reason }); return recovery; },
    };
    const supervisor = new ChatProviderConnectionSupervisor("worker-a", f.connections, new ChatGatewayRuntime(f.messages), grants, [fakeDriver("twitch", opened)]);
    assert.equal((await supervisor.reconcile(t0)).connected, 1);
    opened[0].onDisconnect({ kind: "authentication", reason: "provider rejected token=do-not-log" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(recoveries.length, 1);
    assert.equal(f.connections.get("tenant-a", "twitch", "twitch-main").state, "pending");
    assert.doesNotMatch(JSON.stringify(f.connections.get("tenant-a", "twitch", "twitch-main")), /do-not-log/);
    assert.equal((await supervisor.reconcile("2026-08-29T12:00:00Z")).connected, 1);
    recovery = { status: "reauthorization-required", reason: "refresh token=revoked" };
    opened[1].onDisconnect({ kind: "authentication", reason: "second rejection" });
    await new Promise((resolve) => setImmediate(resolve));
    const stopped = f.connections.get("tenant-a", "twitch", "twitch-main");
    assert.equal(stopped.state, "reauthorization-required");
    assert.doesNotMatch(stopped.lastError, /revoked/);
  } finally { f.close(); }
});

test("provider backoff preserves the donor fast Twitch and fifteen-second Kick starting delays", () => {
  assert.equal(reconnectDelayMs("discord", 1), 1_000);
  assert.equal(reconnectDelayMs("twitch", 1), 2_000);
  assert.equal(reconnectDelayMs("kick", 1), 15_000);
  assert.equal(reconnectDelayMs("kick", 2), 30_000);
  assert.equal(reconnectDelayMs("kick", 20), 300_000);
});
