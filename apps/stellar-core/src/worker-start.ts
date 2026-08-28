import { readFile } from "node:fs/promises";
import { SpmtClient } from "@spmt/sdk";
import { STELLAR_CHAT_CAPABILITY_ID } from "./contracts.js";
import { OpenAiCompatibleChatProvider, StellarChatWorker, createStellarWorkerTokenProvider } from "./worker.js";

const spmtOrigin = process.env.SPMT_ORIGIN ?? "";
const providerOrigin = process.env.STELLAR_PROVIDER_ORIGIN ?? "";
const credential = process.env.STELLAR_WORKER_CREDENTIAL ?? "";
const model = process.env.STELLAR_PROVIDER_MODEL ?? "Qwen/Qwen3-8B-GGUF:Q4_K_M";
const executionTarget = process.env.STELLAR_EXECUTION_TARGET === "companion" ? "companion" : "sprite";
if (!spmtOrigin || !providerOrigin || credential.length < 32) throw new Error("SPMT_ORIGIN, STELLAR_PROVIDER_ORIGIN, and a 32+ character STELLAR_WORKER_CREDENTIAL are required");
const workerId = process.env.STELLAR_WORKER_ID ?? `stellar-${executionTarget}-${process.pid}`;
const client = new SpmtClient({ baseUrl: spmtOrigin, appId: "stellar-core", getAccessToken: createStellarWorkerTokenProvider({ spmtOrigin, credential }) });
const provider = new OpenAiCompatibleChatProvider({ origin: providerOrigin, model });
const worker = new StellarChatWorker(client, provider, { workerId, executionTarget });
const controller = new AbortController();
const startedAt = new Date().toISOString();
const startedMs = Date.now();
let coldStartMs: number | undefined;
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
process.stdout.write(`Stellar Core ${executionTarget} worker started\n`);
await Promise.all([worker.run(controller.signal), reportReadiness(controller.signal)]);

async function reportReadiness(signal: AbortSignal) {
  while (!signal.aborted) {
    const providerHealthy = await provider.healthy();
    if (providerHealthy && coldStartMs === undefined) coldStartMs = Date.now() - startedMs;
    const memoryRssBytes = await providerRssBytes(process.env.STELLAR_PROVIDER_PID);
    try {
      await client.reportExecutionWorker({ executionOwner: "stellar-core", workerId, executionTarget, state: providerHealthy ? "ready" : coldStartMs === undefined ? "starting" : "degraded", capabilityIds: [STELLAR_CHAT_CAPABILITY_ID], providerHealthy, startedAt, metrics: { ...worker.metrics(), ...(coldStartMs === undefined ? {} : { coldStartMs }), ...(memoryRssBytes === undefined ? {} : { memoryRssBytes }) }, leaseMs: 30_000 });
    } catch { /* SPMT may still be starting; the next leased report retries safely. */ }
    await pause(10_000, signal);
  }
}

async function providerRssBytes(value: string | undefined) { if (!value || !/^\d+$/.test(value)) return undefined; try { const status = await readFile(`/proc/${value}/status`, "utf8"); const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status); return match ? Number(match[1]) * 1024 : undefined; } catch { return undefined; } }
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((resolve) => { if (signal.aborted) return resolve(); const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
