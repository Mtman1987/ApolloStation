import { StellarSpeechProvider } from "./speech-provider.js";
import { StellarSpeechWorker } from "./speech-worker.js";
import {BraveStellarSearchProvider,StellarResearchService} from "./research.js";
import { readFile } from "node:fs/promises";
import { SpmtClient } from "@spmt/sdk";
import { STELLAR_CHAT_CAPABILITY_ID } from "./contracts.js";
import { OpenAiCompatibleChatProvider, StellarChatWorker, createStellarWorkerTokenProvider, type StellarChatProviderV1 } from "./worker.js";
import { OpenAiResponsesChatProvider } from "./openai-responses-provider.js";

const spmtOrigin = process.env.SPMT_ORIGIN ?? "";
const providerOrigin = process.env.STELLAR_PROVIDER_ORIGIN ?? "";
const credential = process.env.STELLAR_WORKER_CREDENTIAL ?? "";
const hostedOpenAiKey = process.env.OPENAI_API_KEY ?? "";
const hostedModel = process.env.STELLAR_HOSTED_MODEL ?? "gpt-5.6-luna";
const localModel = process.env.STELLAR_PROVIDER_MODEL ?? "Qwen/Qwen3-8B-GGUF:Q4_K_M";
const executionTarget = process.env.STELLAR_EXECUTION_TARGET === "companion" ? "companion" : "sprite";
if (!spmtOrigin || credential.length < 32) throw new Error("SPMT_ORIGIN and a 32+ character STELLAR_WORKER_CREDENTIAL are required");
if (!hostedOpenAiKey && !providerOrigin) throw new Error("Stellar requires OPENAI_API_KEY or STELLAR_PROVIDER_ORIGIN");
const workerId = process.env.STELLAR_WORKER_ID ?? `stellar-${executionTarget}-${process.pid}`;
const client = new SpmtClient({ baseUrl: spmtOrigin, appId: "stellar-core", getAccessToken: createStellarWorkerTokenProvider({ spmtOrigin, credential }) });
const provider: StellarChatProviderV1 = hostedOpenAiKey
  ? new OpenAiResponsesChatProvider({ apiKey: hostedOpenAiKey, model: hostedModel })
  : new OpenAiCompatibleChatProvider({ origin: providerOrigin, model: localModel });
const research=new StellarResearchService(process.env.SPMT_OUTBOUND_MODE!=="disabled"&&process.env.STELLAR_BRAVE_SEARCH_CREDENTIAL?new BraveStellarSearchProvider(process.env.STELLAR_BRAVE_SEARCH_CREDENTIAL):undefined);
const worker = new StellarChatWorker(client, provider, { workerId, executionTarget,research });
const speech = new StellarSpeechWorker(client, new StellarSpeechProvider({ enabled: process.env.SPMT_OUTBOUND_MODE !== "disabled" || process.env.SPMT_SPEECH_OUTBOUND_ENABLED === "1", ...(process.env.DEEPGRAM_API_KEY ? { deepgramKey: process.env.DEEPGRAM_API_KEY } : {}), ...(process.env.EDENAI_API_KEY ? { edenKey: process.env.EDENAI_API_KEY } : {}) }), `${workerId}-speech`);
const controller = new AbortController();
const startedAt = new Date().toISOString();
const startedMs = Date.now();
let coldStartMs: number | undefined;
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
process.stdout.write(`Stellar Core ${executionTarget} worker started with ${hostedOpenAiKey ? hostedModel : localModel}\n`);
await Promise.all([worker.run(controller.signal), speech.run(controller.signal), reportReadiness(controller.signal)]);

async function reportReadiness(signal: AbortSignal) {
  while (!signal.aborted) {
    const providerHealthy = await provider.healthy();
    if (providerHealthy && coldStartMs === undefined) coldStartMs = Date.now() - startedMs;
    const memoryRssBytes = hostedOpenAiKey ? undefined : await providerRssBytes(process.env.STELLAR_PROVIDER_PID);
    try {
      await client.reportExecutionWorker({ executionOwner: "stellar-core", workerId, executionTarget, state: providerHealthy ? "ready" : coldStartMs === undefined ? "starting" : "degraded", capabilityIds: [STELLAR_CHAT_CAPABILITY_ID], providerHealthy, startedAt, metrics: { ...worker.metrics(), ...(coldStartMs === undefined ? {} : { coldStartMs }), ...(memoryRssBytes === undefined ? {} : { memoryRssBytes }) }, leaseMs: 30_000 });
    } catch { /* SPMT may still be starting; the next leased report retries safely. */ }
    await pause(10_000, signal);
  }
}

async function providerRssBytes(value: string | undefined) { if (!value || !/^\d+$/.test(value)) return undefined; try { const status = await readFile(`/proc/${value}/status`, "utf8"); const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status); return match ? Number(match[1]) * 1024 : undefined; } catch { return undefined; } }
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((resolve) => { if (signal.aborted) return resolve(); const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
