import assert from "node:assert/strict";
import test from "node:test";
import { SpmtRtcRelayHubV1, SpmtRtcRelayRoomV1 } from "../apps/hearmeout/dist/index.js";

function participant(participantId, role, sink, accept = true) {
  return { participantId, role, send(frame) { sink.push(Buffer.from(frame)); return accept; } };
}

test("SPMT RTC relay forwards binary audio without echoing it to the sender", () => {
  let now = 1_000;
  const room = new SpmtRtcRelayRoomV1("tenant-a:room-a:human-voice", { now: () => now });
  const a = [];
  const b = [];
  room.join(participant("a", "browser", a));
  room.join(participant("b", "discord-bridge", b));
  const frame = Uint8Array.from([1, 2, 3, 4]);
  const result = room.publish("a", frame);
  assert.deepEqual(result, { accepted: true, delivered: 1, dropped: 0 });
  assert.equal(a.length, 0);
  assert.equal(b.length, 1);
  assert.deepEqual([...b[0]], [1, 2, 3, 4]);
});

test("SPMT RTC relay enforces participant, frame-size, and frame-rate bounds", () => {
  let now = 5_000;
  const room = new SpmtRtcRelayRoomV1("room", { now: () => now, maxParticipants: 2, maxFrameBytes: 256, maxFramesPerSecond: 10 });
  room.join(participant("a", "browser", []));
  room.join(participant("b", "browser", []));
  assert.throws(() => room.join(participant("c", "browser", [])), /room is full/);
  assert.throws(() => room.publish("a", new Uint8Array(0)), /frame size is invalid/);
  assert.throws(() => room.publish("a", new Uint8Array(257)), /frame size is invalid/);
  for (let i = 0; i < 10; i += 1) assert.equal(room.publish("a", new Uint8Array([i + 1])).accepted, true);
  assert.deepEqual(room.publish("a", new Uint8Array([99])), { accepted: false, delivered: 0, dropped: 1, reason: "rate-limit" });
  now += 1_001;
  assert.equal(room.publish("a", new Uint8Array([100])).accepted, true);
});

test("SPMT RTC relay treats backpressure as a dropped target frame rather than room failure", () => {
  const room = new SpmtRtcRelayRoomV1("room");
  const delivered = [];
  room.join(participant("sender", "persona", []));
  room.join(participant("slow", "browser", [], false));
  room.join(participant("fast", "browser", delivered, true));
  const result = room.publish("sender", Uint8Array.from([7]));
  assert.deepEqual(result, { accepted: true, delivered: 1, dropped: 1 });
  const snapshot = room.snapshot();
  assert.equal(snapshot.participants.find((value) => value.participantId === "slow").droppedFrames, 1);
  assert.equal(delivered.length, 1);
});

test("SPMT RTC relay replaces duplicate participant connections safely", () => {
  const closed = [];
  const room = new SpmtRtcRelayRoomV1("room");
  room.join({ participantId: "same", role: "browser", send() { return true; }, close(code, reason) { closed.push({ code, reason }); } });
  room.join({ participantId: "same", role: "browser", send() { return true; } });
  assert.equal(room.snapshot().participantCount, 1);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].code, 4001);
});

test("SPMT RTC relay hub prunes only empty idle rooms", () => {
  let now = 10_000;
  const hub = new SpmtRtcRelayHubV1({ now: () => now, idleRoomMs: 5_000 });
  const room = hub.room("tenant-a:room-a");
  room.join(participant("a", "browser", []));
  now += 6_000;
  assert.equal(hub.pruneIdle(), 0);
  room.leave("a");
  now += 5_001;
  assert.equal(hub.pruneIdle(), 1);
  assert.equal(hub.snapshot().length, 0);
});
