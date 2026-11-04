import assert from "node:assert/strict";
import test from "node:test";
import { StellarSpeechWorker } from "../apps/stellar-core/dist/speech-worker.js";

test("Stellar speech worker reports and claims the configured hosted execution target", async () => {
  const reported = [], claimed = [], completed = [];
  const job = { id: "speech-job", tenantId: "tenant-a", capabilityId: "stellar.speech.synthesize.v1", leaseId: "lease-a", fencingEpoch: 3, input: { text: "Hello from a hosted worker", voice: "kokoro:af_heart" } };
  const client = {
    async reportExecutionWorker(input) { reported.push(input); },
    async claimAnyExecutionJob(workerId, executionTarget, options) { claimed.push({ workerId, executionTarget, options }); return job; },
    async heartbeatExecutionJob() {},
    async uploadMediaAsset() { return { id: "speech-asset" }; },
    async succeedExecutionJob(...args) { completed.push(args.at(-1)); },
    async failExecutionJob(...args) { assert.fail(JSON.stringify(args)); },
  };
  const provider = { configured: () => true, capabilities: () => ["stellar.speech.synthesize.v1", "stellar.speech.transcribe.v1"], defaultVoice: () => "kokoro:af_heart", async synthesize() { return { bytes: Buffer.from("audio"), contentType: "audio/wav", voice: "kokoro:af_heart", providers: ["kokoro"] }; } };
  const worker = new StellarSpeechWorker(client, provider, "stellar-hosted-speech", "hosted");
  await worker.runOnce();
  assert.equal(reported[0].executionTarget, "hosted");
  assert.equal(claimed[0].executionTarget, "hosted");
  assert.equal(claimed[0].workerId, "stellar-hosted-speech");
  assert.equal(completed[0].mediaAssetId, "speech-asset");
  assert.equal(completed[0].voice, "kokoro:af_heart");
});
