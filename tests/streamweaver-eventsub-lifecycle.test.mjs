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
