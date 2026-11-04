import { SpmtClient } from "@spmt/sdk";
import { StellarSpeechProvider } from "./speech-provider.js";
import { StellarSpeechWorker, STELLAR_SPEECH_SYNTHESIS_CAPABILITY } from "./speech-worker.js";
import { createStellarWorkerTokenProvider } from "./worker.js";

const spmtOrigin = process.env.SPMT_ORIGIN ?? "";
const credential = process.env.STELLAR_WORKER_CREDENTIAL ?? "";
const kokoroUrl = process.env.STELLAR_KOKORO_TTS_URL ?? "";
if (!spmtOrigin || credential.length < 32 || !kokoroUrl) throw new Error("SPMT_ORIGIN, STELLAR_KOKORO_TTS_URL, and a 32+ character STELLAR_WORKER_CREDENTIAL are required");

const workerId = process.env.STELLAR_SPEECH_WORKER_ID ?? `stellar-kokoro-${process.pid}`;
const client = new SpmtClient({ baseUrl: spmtOrigin, appId: "stellar-core", getAccessToken: createStellarWorkerTokenProvider({ spmtOrigin, credential }) });
const provider = new StellarSpeechProvider({ enabled: true, kokoroUrl });
const worker = new StellarSpeechWorker(client, provider, workerId, {
  executionTarget: "self-hosted",
  capabilityIds: [STELLAR_SPEECH_SYNTHESIS_CAPABILITY],
});
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
process.stdout.write("Stellar Core self-hosted Kokoro speech worker starting\n");
await worker.run(controller.signal);
