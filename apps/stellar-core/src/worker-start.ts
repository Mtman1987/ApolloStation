import { SpmtClient } from "@spmt/sdk";
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
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
process.stdout.write(`Stellar Core ${executionTarget} worker started\n`);
await worker.run(controller.signal);
