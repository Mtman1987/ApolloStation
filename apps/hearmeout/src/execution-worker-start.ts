import { createSupervisedHearMeOutWorker, validateHearMeOutWorkerEnvironment } from "./execution-worker.js";

const checked = validateHearMeOutWorkerEnvironment(process.env);
const { getAccessToken, worker } = createSupervisedHearMeOutWorker(checked);
const controller = new AbortController();
const startedAt = new Date().toISOString();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
await getAccessToken();
process.stdout.write(`HearMeOut ${checked.executionTarget} worker ${checked.workerId} started with ${checked.config.capabilities.length} capability(s) and ${checked.config.tenants.length} configured tenant(s)\n`);
await Promise.all([worker.run(controller.signal, checked.config.pollMs), report(controller.signal)]);

async function report(signal: AbortSignal) {
  while (!signal.aborted) {
    try { await worker.report(startedAt); } catch { /* SPMT may be restarting; the next lease renews safely. */ }
    await new Promise<void>((done) => { if (signal.aborted) return done(); const timer = setTimeout(done, 10_000); signal.addEventListener("abort", () => { clearTimeout(timer); done(); }, { once: true }); });
  }
}
