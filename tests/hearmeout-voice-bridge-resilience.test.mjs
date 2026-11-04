import assert from "node:assert/strict";
import test from "node:test";
import {
  HEARMEOUT_DISCORD_JOIN_COOLDOWN_MS,
  HEARMEOUT_LIVEKIT_CONNECT_MAX_ATTEMPTS,
  HEARMEOUT_LIVEKIT_RATE_LIMIT_BASE_MS,
  ResilientHearMeOutVoiceBridgeWorker,
  isHearMeOutLiveKitRateLimitError,
} from "../apps/hearmeout/dist/index.js";

function startInput(roomId = "room-a") {
  return { tenantId: "tenant-a", roomId, guildId: "123456789012345678", voiceChannelId: "987654321098765432", audioProfile: "balanced" };
}

class FakeWorker {
  constructor() { this.calls = []; this.startFailures = []; this.startGate = undefined; }
  async status(input) { this.calls.push(["status", input]); return { running: false }; }
  async start(input) {
    this.calls.push(["start", input]);
    const failure = this.startFailures.shift();
    if (failure) throw failure;
    if (this.startGate) await this.startGate;
    return { running: true, roomId: input.roomId };
  }
  async stop(input) { this.calls.push(["stop", input]); return { running: false }; }
  async setRoomOutbound(input) { this.calls.push(["gate", input]); return { running: true }; }
  async setAudioProfile(input) { this.calls.push(["profile", input]); return { running: true }; }
}

test("voice resilience preserves donor five-attempt LiveKit 429 retry with exponential backoff", async () => {
  const worker = new FakeWorker();
  worker.startFailures = [new Error("429 rate limit"), new Error("too many requests"), new Error("rate-limited"), new Error("429")];
  const delays = [];
  const resilient = new ResilientHearMeOutVoiceBridgeWorker(worker, { sleep: async (milliseconds) => delays.push(milliseconds) });
  const result = await resilient.start(startInput());
  assert.equal(result.running, true);
  assert.equal(worker.calls.filter(([kind]) => kind === "start").length, HEARMEOUT_LIVEKIT_CONNECT_MAX_ATTEMPTS);
  assert.deepEqual(delays, [
    HEARMEOUT_LIVEKIT_RATE_LIMIT_BASE_MS,
    HEARMEOUT_LIVEKIT_RATE_LIMIT_BASE_MS * 2,
    HEARMEOUT_LIVEKIT_RATE_LIMIT_BASE_MS * 4,
    HEARMEOUT_LIVEKIT_RATE_LIMIT_BASE_MS * 8,
  ]);
});

test("non-rate-limit voice start failures fail immediately without retry storm", async () => {
  const worker = new FakeWorker();
  worker.startFailures = [new Error("bad Discord permission")];
  const delays = [];
  const resilient = new ResilientHearMeOutVoiceBridgeWorker(worker, { sleep: async (milliseconds) => delays.push(milliseconds) });
  await assert.rejects(() => resilient.start(startInput()), /bad Discord permission/);
  assert.equal(worker.calls.filter(([kind]) => kind === "start").length, 1);
  assert.deepEqual(delays, []);
});

test("concurrent duplicate bridge starts collapse onto one worker operation", async () => {
  const worker = new FakeWorker();
  let release;
  worker.startGate = new Promise((resolve) => { release = resolve; });
  const resilient = new ResilientHearMeOutVoiceBridgeWorker(worker);
  const first = resilient.start(startInput());
  const second = resilient.start(startInput());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.calls.filter(([kind]) => kind === "start").length, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
});

test("Discord bot disconnect applies donor sixty-second rejoin cooldown per tenant room", async () => {
  const worker = new FakeWorker();
  let now = 1_000_000;
  const resilient = new ResilientHearMeOutVoiceBridgeWorker(worker, { nowMs: () => now });
  const marked = resilient.markDiscordDisconnect({ tenantId: "tenant-a", roomId: "room-a", reason: "Bot left configured voice channel token=secret-value" });
  assert.equal(marked.retryAfterMs, HEARMEOUT_DISCORD_JOIN_COOLDOWN_MS);
  await assert.rejects(() => resilient.start(startInput()), /rejoin cooldown/);
  assert.equal(worker.calls.filter(([kind]) => kind === "start").length, 0);
  now += HEARMEOUT_DISCORD_JOIN_COOLDOWN_MS;
  assert.equal((await resilient.start(startInput())).running, true);
});

test("reconnect delay preserves donor 1.5s exponential curve capped at 20s", () => {
  const worker = new FakeWorker();
  const resilient = new ResilientHearMeOutVoiceBridgeWorker(worker);
  assert.equal(resilient.reconnectDelayMs(1), 1500);
  assert.equal(resilient.reconnectDelayMs(2), 3000);
  assert.equal(resilient.reconnectDelayMs(3), 6000);
  assert.equal(resilient.reconnectDelayMs(4), 12000);
  assert.equal(resilient.reconnectDelayMs(5), 20000);
  assert.equal(resilient.reconnectDelayMs(20), 20000);
});

test("rate-limit classifier and non-start worker operations remain narrow passthroughs", async () => {
  assert.equal(isHearMeOutLiveKitRateLimitError(new Error("HTTP 429")), true);
  assert.equal(isHearMeOutLiveKitRateLimitError(new Error("Too Many Requests")), true);
  assert.equal(isHearMeOutLiveKitRateLimitError(new Error("permission denied")), false);
  const worker = new FakeWorker();
  const resilient = new ResilientHearMeOutVoiceBridgeWorker(worker);
  await resilient.status({ tenantId: "tenant-a", roomId: "room-a" });
  await resilient.setAudioProfile({ tenantId: "tenant-a", roomId: "room-a", audioProfile: "resilient" });
  await resilient.setRoomOutbound({ tenantId: "tenant-a", roomId: "room-a", roomVoiceOutboundEnabled: false });
  await resilient.stop({ tenantId: "tenant-a", roomId: "room-a" });
  assert.deepEqual(worker.calls.map(([kind]) => kind), ["status", "profile", "gate", "stop"]);
});
