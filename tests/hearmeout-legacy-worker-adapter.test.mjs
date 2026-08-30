import assert from "node:assert/strict";
import test from "node:test";
import { HttpHearMeOutVoiceBridgeWorker, HttpHearMeOutVoiceBridgeWorkerError } from "../apps/hearmeout/dist/index.js";

const base = { tenantId: "tenant-a", roomId: "discord-activity" };

test("legacy HMO worker adapter sends bounded authenticated requests without credentials in URLs", async () => {
  const calls = [];
  const worker = new HttpHearMeOutVoiceBridgeWorker({
    workerOrigin: "https://worker.example",
    getAuthorization: () => "Bearer canary-worker-secret-value",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: true, running: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await worker.start({ ...base, guildId: "123456789012345678", voiceChannelId: "987654321098765432", audioProfile: "clean", discordReceiveGain: 1 });
  await worker.setRoomOutbound({ ...base, roomVoiceOutboundEnabled: false });
  await worker.setAudioProfile({ ...base, audioProfile: "resilient" });
  await worker.stop(base);

  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, "https://worker.example/voice-bridge");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer canary-worker-secret-value");
  assert.equal(calls[0].init.redirect, "manual");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "start",
    roomId: "discord-activity",
    guildId: "123456789012345678",
    voiceChannelId: "987654321098765432",
    audioProfile: "clean",
  });
  assert.ok(calls.every((call) => !call.url.includes("canary-worker-secret-value")));
  assert.deepEqual(JSON.parse(calls[1].init.body), { roomId: "discord-activity", roomVoiceOutboundEnabled: false });
  assert.deepEqual(JSON.parse(calls[2].init.body), { roomId: "discord-activity", audioProfile: "resilient" });
  assert.deepEqual(JSON.parse(calls[3].init.body), { action: "stop", roomId: "discord-activity" });
});

test("legacy HMO worker adapter status uses query only for room identity and refuses redirects", async () => {
  let seen;
  const worker = new HttpHearMeOutVoiceBridgeWorker({
    workerOrigin: "https://worker.example/",
    getAuthorization: async () => "Bearer canary-worker-secret-value",
    fetchImpl: async (url, init) => {
      seen = { url: String(url), init };
      return new Response("", { status: 302, headers: { location: "https://other.example" } });
    },
  });
  await assert.rejects(() => worker.status(base), /redirect refused/);
  assert.equal(seen.url, "https://worker.example/voice-bridge?roomId=discord-activity");
  assert.equal(seen.init.headers.authorization, "Bearer canary-worker-secret-value");
});

test("legacy HMO worker adapter rejects unsafe origins and redacts worker error detail", async () => {
  assert.throws(() => new HttpHearMeOutVoiceBridgeWorker({ workerOrigin: "http://worker.example", getAuthorization: () => "Bearer canary-worker-secret-value" }), /credential-free HTTPS/);
  assert.throws(() => new HttpHearMeOutVoiceBridgeWorker({ workerOrigin: "https://user:pass@worker.example", getAuthorization: () => "Bearer canary-worker-secret-value" }), /credential-free HTTPS/);
  assert.throws(() => new HttpHearMeOutVoiceBridgeWorker({ workerOrigin: "https://worker.example/private", getAuthorization: () => "Bearer canary-worker-secret-value" }), /credential-free HTTPS/);

  const worker = new HttpHearMeOutVoiceBridgeWorker({
    workerOrigin: "https://worker.example",
    getAuthorization: () => "Bearer canary-worker-secret-value",
    fetchImpl: async () => new Response(JSON.stringify({ error: "authorization=super-secret-token failed" }), { status: 503, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(
    () => worker.stop(base),
    (error) => error instanceof HttpHearMeOutVoiceBridgeWorkerError && error.status === 503 && /authorization=\[redacted\]/.test(error.message) && !error.message.includes("super-secret-token"),
  );
});

test("legacy HMO worker adapter validates Discord and authorization inputs before provider calls", async () => {
  let calls = 0;
  const worker = new HttpHearMeOutVoiceBridgeWorker({
    workerOrigin: "https://worker.example",
    getAuthorization: () => "Bearer too-short",
    fetchImpl: async () => { calls += 1; return new Response("{}", { status: 200 }); },
  });
  await assert.rejects(() => worker.status(base), /authorization is unavailable/);
  await assert.rejects(() => worker.start({ ...base, guildId: "abc", voiceChannelId: "987654321098765432", audioProfile: "clean", discordReceiveGain: 1 }), /guildId must be a Discord snowflake/);
  assert.equal(calls, 0);
});
