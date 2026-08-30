import assert from "node:assert/strict";
import test from "node:test";
import { SpmtRtcRelayHubV1, SpmtRtcRelaySocketAdapterV1 } from "../apps/hearmeout/dist/index.js";

function socket() {
  const sent = [];
  const closed = [];
  let binaryHandler = () => {};
  let closeHandler = () => {};
  return {
    sent,
    closed,
    api: {
      send(data) { sent.push(Buffer.from(data)); return true; },
      close(code, reason) { closed.push({ code, reason }); },
      onBinary(handler) { binaryHandler = handler; },
      onClose(handler) { closeHandler = handler; },
    },
    binary(data) { binaryHandler(Uint8Array.from(data)); },
    end() { closeHandler(); },
  };
}

const base = {
  tenantId: "tenant-a",
  roomId: "room-a",
  authorization: "Bearer valid-relay-authorization-token",
};

test("SPMT RTC socket adapter authorizes participants and routes audio through the relay hub", async () => {
  const hub = new SpmtRtcRelayHubV1();
  const seenAuth = [];
  const adapter = new SpmtRtcRelaySocketAdapterV1(hub, { authorize(input) { seenAuth.push(input); return true; } });
  const a = socket();
  const b = socket();

  assert.equal((await adapter.attach(a.api, { ...base, participantId: "a", role: "browser" })).accepted, true);
  assert.equal((await adapter.attach(b.api, { ...base, participantId: "b", role: "discord-bridge" })).accepted, true);
  a.binary([1, 2, 3]);
  assert.equal(a.sent.length, 0);
  assert.equal(b.sent.length, 1);
  assert.deepEqual([...b.sent[0]], [1, 2, 3]);
  assert.equal(seenAuth.length, 2);
  assert.equal(seenAuth[0].authorization, base.authorization);
  assert.equal(hub.snapshot()[0].participantCount, 2);

  b.end();
  assert.equal(hub.snapshot()[0].participantCount, 1);
});

test("SPMT RTC socket adapter rejects unauthorized joins without creating room membership", async () => {
  const hub = new SpmtRtcRelayHubV1();
  const adapter = new SpmtRtcRelaySocketAdapterV1(hub, { authorize() { return false; } });
  const client = socket();
  const result = await adapter.attach(client.api, { ...base, participantId: "blocked", role: "browser" });
  assert.deepEqual(result, { accepted: false, reason: "unauthorized" });
  assert.deepEqual(client.closed, [{ code: 4401, reason: "SPMT RTC authorization failed" }]);
  assert.equal(hub.snapshot().length, 0);
});

test("SPMT RTC socket adapter closes malformed binary producers and removes membership", async () => {
  const hub = new SpmtRtcRelayHubV1({ maxFrameBytes: 256 });
  const adapter = new SpmtRtcRelaySocketAdapterV1(hub, { authorize() { return true; } });
  const client = socket();
  await adapter.attach(client.api, { ...base, participantId: "noisy", role: "persona" });
  client.binary(new Array(257).fill(1));
  assert.equal(client.closed.length, 1);
  assert.equal(client.closed[0].code, 4400);
  assert.match(client.closed[0].reason, /frame size is invalid/);
  assert.equal(hub.snapshot()[0].participantCount, 0);
});
