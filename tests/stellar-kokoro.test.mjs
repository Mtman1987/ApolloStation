import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { StellarSpeechProvider } from "../apps/stellar-core/dist/speech-provider.js";
import { StellarSpeechWorker } from "../apps/stellar-core/dist/speech-worker.js";

const token = "kokoro-internal-test-token-1234567890";
const wav = Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ");

test("local Kokoro is available without paid credentials and never calls a paid provider", async () => {
  const calls = [];
  const provider = new StellarSpeechProvider({
    enabled: false,
    kokoroOrigin: "http://stellar-kokoro:8080",
    kokoroToken: token,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(wav, { headers: { "content-type": "audio/wav" } });
    },
  });
  assert.equal(provider.configured(), true);
  assert.equal(provider.defaultVoice(), "kokoro:af_heart");
  assert.deepEqual(provider.capabilities(), ["stellar.speech.synthesize.v1"]);
  const result = await provider.synthesize("Hello from local speech");
  assert.equal(result.contentType, "audio/wav");
  assert.equal(result.voice, "kokoro:af_heart");
  assert.deepEqual(result.providers, ["kokoro"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://stellar-kokoro:8080/v1/audio/speech");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { input: "Hello from local speech", voice: "af_heart" });
  assert.equal(provider.voices().filter((voice) => voice.provider === "kokoro").length, 28);
});

test("Kokoro-only speech worker advertises TTS but not paid transcription and claims hosted jobs", async () => {
  const reports = [], claims = [];
  const provider = new StellarSpeechProvider({ enabled: false, kokoroOrigin: "http://stellar-kokoro:8080", kokoroToken: token, fetchImpl: async () => new Response(wav, { headers: { "content-type": "audio/wav" } }) });
  const client = {
    async reportExecutionWorker(input) { reports.push(input); },
    async claimAnyExecutionJob(workerId, target, options) { claims.push({ workerId, target, options }); return null; },
  };
  await new StellarSpeechWorker(client, provider, "stellar-hosted-speech", "hosted").runOnce();
  assert.deepEqual(reports[0].capabilityIds, ["stellar.speech.synthesize.v1"]);
  assert.equal(reports[0].executionTarget, "hosted");
  assert.deepEqual(claims[0].options.capabilityIds, ["stellar.speech.synthesize.v1"]);
  assert.equal(claims[0].target, "hosted");
});

test("local Kokoro rejects public endpoints, wrong ports, and missing service authentication", () => {
  assert.throws(() => new StellarSpeechProvider({ kokoroOrigin: "http://tts.example.com:8080", kokoroToken: token }), /internal HTTP service/);
  assert.throws(() => new StellarSpeechProvider({ kokoroOrigin: "http://stellar-kokoro:9000", kokoroToken: token }), /internal HTTP service/);
  assert.throws(() => new StellarSpeechProvider({ kokoroOrigin: "http://stellar-kokoro:8080", kokoroToken: "short" }), /32\+ character/);
  assert.throws(() => new StellarSpeechProvider({ kokoroOrigin: "http://stellar-kokoro:8080" }), /32\+ character/);
});

test("Kokoro image build pins dependencies and model hashes and bounds private inference", () => {
  const root = new URL("../apps/stellar-core/kokoro/", import.meta.url);
  const server = readFileSync(new URL("server.py", root), "utf8");
  const requirements = readFileSync(new URL("requirements.txt", root), "utf8");
  const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8");
  assert.match(requirements, /kokoro-onnx==0\.4\.9/);
  assert.match(requirements, /onnxruntime==1\.22\.1/);
  assert.match(requirements, /soundfile==0\.13\.1/);
  assert.match(server, /intra_op_num_threads = 2/);
  assert.match(server, /inter_op_num_threads = 1/);
  assert.match(server, /KOKORO_AUTH_TOKEN/);
  assert.match(server, /size <= 16384/);
  assert.match(server, /len\(text\) > 2000/);
  assert.match(server, /inference_lock\.acquire\(blocking=False\)/);
  assert.match(dockerfile, /6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb/);
  assert.match(dockerfile, /bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d/);
  assert.match(dockerfile, /USER 10001:10001/);
});
