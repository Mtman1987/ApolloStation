import { SupervisedDshLiveService, validateDshLiveWorkerEnvironment } from "./live-worker.js";

const checked = validateDshLiveWorkerEnvironment(process.env);
const service = new SupervisedDshLiveService(checked);
const controller = new AbortController();
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  controller.abort();
  service.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
const ready = await service.ready();
process.stdout.write(`Discord Stream Hub worker ${ready.workerId} started with ${ready.configuredTenants} configured tenant(s) on a ${ready.pollIntervalSeconds}-second cycle\n`);
try { await service.run(controller.signal); }
finally { await shutdown(); }
