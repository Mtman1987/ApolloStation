import assert from "node:assert/strict";
import test from "node:test";
import { COMPANION_RELAY_ACTION_CAPABILITIES, CompanionRelayClient } from "../apps/companion/dist/index.js";

class FakeSocket {
  readyState = 1;
  sent = [];
  listeners = new Map();
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
  on(event, listener) { this.listeners.set(event, listener); }
  emit(event, value) { this.listeners.get(event)?.(value); }
}

function fixture(overrides = {}) {
  const socket = new FakeSocket();
  const connections = [];
  const statuses = [];
  const confirmations = [];
  const factory = {
    OPEN: 1,
    connect(url, options) { connections.push({ url, options }); return socket; },
  };
  const config = { relay: { enabled: true, url: "wss://relay.spmt.test/v1/devices", deviceId: "pc-1" } };
  const client = new CompanionRelayClient({
    getConfig: () => config,
    getToken: () => "session-token",
    socketFactory: factory,
    handlers: {},
    onStatus: (value) => statuses.push(value),
    onConfirmationRequired: (value) => confirmations.push(value),
    nowMs: () => Date.parse("2026-08-25T04:20:00.000Z"),
    schedule: () => 1,
    cancelSchedule: () => {},
    ...overrides,
  });
  return { client, socket, connections, statuses, confirmations, config };
}

function command(action, overrides = {}) {
  return {
    schemaVersion: 1,
    id: `cmd-${action}`,
    expiresAt: "2026-08-25T04:25:00.000Z",
    deviceId: "pc-1",
    source: "hearmeout",
    capability: COMPANION_RELAY_ACTION_CAPABILITIES[action],
    action,
    payload: {},
    requiresConfirmation: false,
    ...overrides,
  };
}

test("Companion relay is outbound WSS only and authenticates with bearer plus device identity", () => {
  const fx = fixture();
  fx.client.start();
  assert.equal(fx.connections.length, 1);
  assert.equal(fx.connections[0].url, "wss://relay.spmt.test/v1/devices");
  assert.deepEqual(fx.connections[0].options, { headers: { Authorization: "Bearer session-token", "X-SPMT-Device": "pc-1" }, rejectUnauthorized: true });
  fx.socket.emit("open");
  assert.deepEqual(fx.socket.sent[0], { type: "companion.ready", schemaVersion: 1, deviceId: "pc-1" });
  assert.equal(fx.statuses.at(-1).state, "connected");
});

test("Companion relay disables instead of opening insecure or unauthenticated sockets", () => {
  const insecure = fixture();
  insecure.config.relay.url = "ws://relay.spmt.test";
  insecure.client.start();
  assert.equal(insecure.connections.length, 0);
  assert.equal(insecure.statuses.at(-1).state, "disabled");

  const missingToken = fixture({ getToken: () => undefined });
  missingToken.client.start();
  assert.equal(missingToken.connections.length, 0);
});

test("Companion relay rejects wrong device, capability, expiration, and replay before handlers run", async () => {
  let calls = 0;
  const fx = fixture({ handlers: { "obs.scene.set": async () => { calls += 1; return { changed: true }; } } });
  fx.client.start(); fx.socket.emit("open");
  await fx.client.handle(JSON.stringify(command("obs.scene.set", { deviceId: "other" })));
  await fx.client.handle(JSON.stringify(command("obs.scene.set", { id: "wrong-cap", capability: "media.write" })));
  await fx.client.handle(JSON.stringify(command("obs.scene.set", { id: "expired", expiresAt: "2026-08-25T04:19:00.000Z" })));
  const valid = command("obs.scene.set", { id: "valid" });
  await fx.client.handle(JSON.stringify(valid));
  await fx.client.handle(JSON.stringify(valid));
  assert.equal(calls, 1);
  assert.equal(fx.socket.sent.filter((message) => message.type === "companion.result" && message.ok).length, 1);
});

test("download and cache pruning always wait for local approval", async () => {
  const ran = [];
  const fx = fixture({ handlers: {
    "media.download": async (payload) => { ran.push(["download", payload]); return { queued: true }; },
    "media.cache.prune": async () => { ran.push(["prune"]); return { removed: 1 }; },
  } });
  fx.client.start(); fx.socket.emit("open");
  await fx.client.handle(JSON.stringify(command("media.download", { id: "download", payload: { url: "https://media.test/a.mp4" } })));
  await fx.client.handle(JSON.stringify(command("media.cache.prune", { id: "prune" })));
  assert.equal(ran.length, 0);
  assert.equal(fx.client.confirmations().length, 2);
  await fx.client.resolveConfirmation("download", true);
  await fx.client.resolveConfirmation("prune", false);
  assert.equal(ran.length, 1);
  assert.equal(fx.socket.sent.some((message) => message.id === "prune" && message.error === "Rejected by the local operator"), true);
});

test("relay failures are redacted before they leave the local machine", async () => {
  const fx = fixture({ handlers: { "companion.status": async () => { throw new Error("authorization: Bearer super-secret-token-123456 password=hunter2"); } } });
  fx.client.start(); fx.socket.emit("open");
  await fx.client.handle(JSON.stringify(command("companion.status", { id: "status" })));
  const reply = fx.socket.sent.find((message) => message.id === "status");
  assert.equal(reply.ok, false);
  assert.doesNotMatch(reply.error, /super-secret|hunter2/);
  assert.match(reply.error, /REDACTED/i);
});

test("approval after command expiry fails closed", async () => {
  const fx = fixture({ handlers: { "media.download": async () => { throw new Error("must not run"); } } });
  fx.client.start(); fx.socket.emit("open");
  await fx.client.handle(JSON.stringify(command("media.download", { id: "slow", expiresAt: "2026-08-25T04:20:01.000Z" })));
  fx.client.stop();
  const later = fixture({ nowMs: () => Date.parse("2026-08-25T04:21:00.000Z") });
  // The expiry behavior is also enforced directly on a pending command in the same client.
  const expiring = fixture({ nowMs: (() => { let now = Date.parse("2026-08-25T04:20:00.000Z"); return () => now += 61_000; })() });
  expiring.client.start(); expiring.socket.emit("open");
  await expiring.client.handle(JSON.stringify(command("media.download", { id: "expires-local", expiresAt: "2026-08-25T04:21:30.000Z" })));
  const resolved = await expiring.client.resolveConfirmation("expires-local", true);
  assert.equal(resolved.approved, false);
  assert.equal(resolved.expired, true);
  later.client.stop();
});
