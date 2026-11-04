import assert from "node:assert/strict";
import test from "node:test";
import { StellarCommunityAssistantRuntime } from "../apps/stellar-core/dist/index.js";
import { SpmtAssistantApi } from "../apps/spmt-service/dist/assistant-api.js";

test("Stellar community readiness and default job routing follow the configured hosted target", () => {
  const calls = { ready: [], created: [] };
  const jobs = {
    hasReadyWorker(input) { calls.ready.push(input); return input.executionTarget === "hosted"; },
    findIdempotent() { return undefined; },
    create(input) { calls.created.push(input); return { job: { id: "hosted-chat-job" }, duplicate: false }; },
  };
  const runtime = new StellarCommunityAssistantRuntime(jobs, { enabled: true, executionTarget: "hosted" });
  assert.deepEqual(runtime.status(), { availability: "available" });
  const accepted = runtime.accept({
    tenantId: "tenant-a", requestedByType: "user", requestedById: "user-a", userId: "user-a",
    message: "Use the hosted worker", callerAppId: "streamweaver", surface: "app",
    idempotencyKey: "hosted-chat-1", routingPreference: "automatic",
  });
  assert.equal(accepted.executionTarget, "hosted");
  assert.equal(calls.ready[0].executionTarget, "hosted");
  assert.equal(calls.created[0].executionTarget, "hosted");
});

test("speech status and accepted speech jobs use the configured hosted target", async () => {
  const readyChecks = [], created = [];
  const jobs = {
    hasReadyWorker(input) { readyChecks.push(input); return input.capabilityId === "stellar.speech.synthesize.v1" && input.executionTarget === "hosted"; },
    findIdempotent() { return undefined; },
    create(input) { created.push(input); return { job: { id: "hosted-speech-job" }, duplicate: false }; },
  };
  const api = new SpmtAssistantApi({
    store: { preferences: () => ({ voice: "kokoro:af_heart" }) },
    auth: { authorize: () => ({ actorType: "user", actorId: "user-a" }) },
    control: { getTenant: () => ({ status: "active" }), listInstalls: () => [{ appId: "streamweaver", enabled: true }] },
    jobs, assets: {}, enabled: true, executionTarget: "hosted", accessToken: () => "test-token",
  });
  const invoke = async (method, path, headers, body) => {
    let result;
    const request = {
      method, headers,
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); },
    };
    const response = { writeHead(status, responseHeaders) { result = { status, headers: responseHeaders }; }, end(text) { result.body = JSON.parse(text); } };
    await api.handle(request, response, new URL("http://spmt.test" + path));
    return result;
  };
  const status = await invoke("GET", "/v1/assistant/speech/status", { "x-spmt-tenant": "tenant-a" });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { synthesis: true, transcription: false });
  assert.ok(readyChecks.every(check => check.executionTarget === "hosted"));
  const accepted = await invoke("POST", "/v1/assistant/speech/synthesize", {
    "x-spmt-tenant": "tenant-a", "x-spmt-app": "streamweaver", "idempotency-key": "hosted-speech-1",
  }, { text: "Speak locally" });
  assert.equal(accepted.status, 202);
  assert.equal(created[0].executionTarget, "hosted");
  assert.equal(created[0].input.voice, "kokoro:af_heart");
});
