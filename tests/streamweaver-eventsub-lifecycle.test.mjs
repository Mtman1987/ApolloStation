import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StreamWeaverTwitchEventSub } from "../apps/streamweaver/dist/twitch-eventsub.js";

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
class FakeSocket {
  listeners = new Map();
  closed = false;
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  close() {
    this.closed = true;
    for (const listener of this.listeners.get("close") || []) listener();
  }
  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

test("EventSub does not open a stale socket when subscription config changes during grant lookup", async t => {
  const directory = mkdtempSync(join(tmpdir(), "sw-eventsub-stale-"));
  const grantsPending = [];
  const sockets = [];
  const grants = {
    getGrant: () => {
      const pending = deferred();
      grantsPending.push(pending);
      return pending.promise;
    },
  };
  const eventsub = new StreamWeaverTwitchEventSub(
    join(directory, "events.db"),
    grants,
    async () => { throw new Error("unexpected fetch"); },
    () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
  );
  t.after(() => {
    eventsub.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const retired = eventsub.reconcile([{ tenantId: "tenant-a", types: ["follow"] }], async () => {});
  assert.equal(grantsPending.length, 1);
  const current = eventsub.reconcile([{ tenantId: "tenant-a", types: ["cheer"] }], async () => {});
  assert.equal(grantsPending.length, 2);

  const grant = { status: "ready", broadcasterId: "100", moderatorId: "100", accessToken: "token", clientId: "client" };
  grantsPending[0].resolve(grant);
  await retired;
  assert.equal(sockets.length, 0, "retired connection must not open a WebSocket");

  grantsPending[1].resolve(grant);
  await current;
  assert.equal(sockets.length, 1, "only the current subscription config opens a WebSocket");
  assert.equal(sockets[0].closed, false);
});


test("EventSub persists Twitch reward notifications and delivers each redemption once", async t => {
  const directory = mkdtempSync(join(tmpdir(), "sw-eventsub-reward-"));
  const sockets = [];
  const grants = {
    async getGrant({ capability }) {
      return { status: "ready", broadcasterId: "100", moderatorId: "100", accessToken: "provider-token", clientId: "shared-client", expiresAt: "2099-01-01T00:00:00Z" };
    },
  };
  const requests = [];
  const eventsub = new StreamWeaverTwitchEventSub(
    join(directory, "events.db"),
    grants,
    async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ data: [] });
    },
    () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
  );
  t.after(() => {
    eventsub.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const subscription = [{ tenantId: "tenant-a", types: ["reward:reward-1"] }];
  const delivered = [];
  await eventsub.reconcile(subscription, async event => { delivered.push(event); });
  assert.equal(sockets.length, 1);
  sockets[0].emit("message", { data: JSON.stringify({
    metadata: { message_type: "session_welcome" },
    payload: { session: { id: "eventsub-session", keepalive_timeout_seconds: 30 } },
  }) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /eventsub\/subscriptions$/);
  const subscriptionBody = JSON.parse(requests[0].init.body);
  assert.equal(subscriptionBody.type, "channel.channel_points_custom_reward_redemption.add");
  assert.deepEqual(subscriptionBody.condition, { broadcaster_user_id: "100" });

  const notification = {
    metadata: { message_type: "notification", message_id: "eventsub-message-1", message_timestamp: "2026-11-03T20:00:00.000Z" },
    payload: {
      subscription: { type: "channel.channel_points_custom_reward_redemption.add" },
      event: { id: "redemption-1", user_id: "200", user_login: "viewer", user_name: "Viewer", user_input: "spmt 10", reward: { id: "reward-1" } },
    },
  };
  sockets[0].emit("message", { data: JSON.stringify(notification) });
  await new Promise(resolve => setTimeout(resolve, 0));
  await eventsub.reconcile(subscription, async event => { delivered.push(event); });
  await eventsub.reconcile(subscription, async event => { delivered.push(event); });

  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0], {
    id: "eventsub-message-1", tenantId: "tenant-a", type: "reward", units: 1,
    userId: "200", username: "viewer", displayName: "Viewer", input: "spmt 10",
    occurredAt: "2026-11-03T20:00:00.000Z", rewardId: "reward-1", redemptionId: "redemption-1",
  });
});
