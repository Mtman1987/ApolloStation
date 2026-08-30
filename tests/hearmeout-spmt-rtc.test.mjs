import assert from "node:assert/strict";
import test from "node:test";
import { SpmtRtcBrokerV1, SpmtRtcUnavailableError, classifySpmtRtcFailure } from "../apps/hearmeout/dist/index.js";

function transport(kind, priority, connect, supports = () => true) {
  return { kind, priority, supports, connect };
}
function session(kind, roomKey = "tenant-a:room-a") {
  return { transport: kind, roomKey, connectedAt: "2026-08-30T00:00:00.000Z", close() {} };
}
const context = { tenantId: "tenant-a", roomId: "room-a", purpose: "human-voice" };

test("SPMT RTC fails over from LiveKit Cloud 429 to self-hosted LiveKit", async () => {
  const calls = [];
  let now = 1_000_000;
  const broker = new SpmtRtcBrokerV1([
    transport("livekit-cloud", 10, async () => { calls.push("cloud"); throw new Error("engine: ws failure: HTTP error: 429 Too Many Requests"); }),
    transport("livekit-self-hosted", 20, async () => { calls.push("self"); return session("livekit-self-hosted"); }),
    transport("peer-webrtc", 30, async () => { calls.push("peer"); return session("peer-webrtc"); }),
    transport("wss-relay", 40, async () => { calls.push("relay"); return session("wss-relay"); }),
  ], { now: () => now, rateLimitCooldownMs: 300_000, roomStickinessMs: 300_000 });

  const first = await broker.connect(context);
  assert.equal(first.session.transport, "livekit-self-hosted");
  assert.equal(first.failedOver, true);
  assert.deepEqual(calls, ["cloud", "self"]);
  assert.deepEqual(first.attempts.map((attempt) => [attempt.transport, attempt.outcome, attempt.failureClass]), [
    ["livekit-cloud", "failed", "rate-limited"],
    ["livekit-self-hosted", "connected", undefined],
  ]);

  calls.length = 0;
  const second = await broker.connect(context);
  assert.equal(second.session.transport, "livekit-self-hosted");
  assert.deepEqual(calls, ["self"]);

  now += 301_000;
  broker.clearRoomPreference(context);
  calls.length = 0;
  const third = await broker.connect(context);
  assert.equal(third.session.transport, "livekit-self-hosted");
  assert.deepEqual(calls, ["cloud", "self"]);
});

test("SPMT RTC continues through P2P and WSS when both LiveKit transports fail", async () => {
  const calls = [];
  const broker = new SpmtRtcBrokerV1([
    transport("livekit-cloud", 10, async () => { calls.push("cloud"); throw new Error("503 unavailable"); }),
    transport("livekit-self-hosted", 20, async () => { calls.push("self"); throw new Error("socket timeout"); }),
    transport("peer-webrtc", 30, async () => { calls.push("peer"); throw new Error("ICE failed"); }),
    transport("wss-relay", 40, async () => { calls.push("relay"); return session("wss-relay"); }),
  ]);

  const result = await broker.connect({ ...context, purpose: "discord-bridge" });
  assert.equal(result.session.transport, "wss-relay");
  assert.deepEqual(calls, ["cloud", "self", "peer", "relay"]);
  assert.equal(result.attempts[0].failureClass, "unavailable");
  assert.equal(result.attempts[1].failureClass, "network");
  assert.equal(result.attempts[2].failureClass, "network");
});

test("SPMT RTC respects transport support boundaries without treating unsupported as a failure", async () => {
  const broker = new SpmtRtcBrokerV1([
    transport("livekit-cloud", 10, async () => session("livekit-cloud"), (value) => value.purpose !== "discord-bridge"),
    transport("peer-webrtc", 30, async () => session("peer-webrtc"), (value) => value.purpose === "human-voice"),
    transport("wss-relay", 40, async () => session("wss-relay")),
  ]);
  const result = await broker.connect({ ...context, purpose: "discord-bridge" });
  assert.equal(result.session.transport, "wss-relay");
  assert.equal(result.attempts[0].outcome, "skipped-unsupported");
  assert.equal(result.attempts[1].outcome, "skipped-unsupported");
  assert.equal(result.attempts[2].outcome, "connected");
});

test("SPMT RTC fails closed and preserves sanitized attempt history when every transport is unavailable", async () => {
  const broker = new SpmtRtcBrokerV1([
    transport("livekit-cloud", 10, async () => { throw new Error("authorization=super-secret-token 401"); }),
    transport("wss-relay", 40, async () => { throw new Error("relay network timeout"); }),
  ]);

  await assert.rejects(
    () => broker.connect(context),
    (error) => {
      assert.ok(error instanceof SpmtRtcUnavailableError);
      assert.equal(error.attempts.length, 2);
      assert.equal(error.attempts[0].failureClass, "auth");
      assert.match(error.attempts[0].message, /authorization=\[redacted\]/);
      assert.ok(!error.attempts[0].message.includes("super-secret-token"));
      return true;
    },
  );
});

test("SPMT RTC classifies provider failures used by automatic failover", () => {
  assert.equal(classifySpmtRtcFailure(new Error("429 Too Many Requests")), "rate-limited");
  assert.equal(classifySpmtRtcFailure(new Error("resource quota exhausted")), "quota-exhausted");
  assert.equal(classifySpmtRtcFailure(new Error("websocket timeout")), "network");
  assert.equal(classifySpmtRtcFailure(new Error("503 unavailable")), "unavailable");
  assert.equal(classifySpmtRtcFailure(new Error("401 Unauthorized")), "auth");
});
