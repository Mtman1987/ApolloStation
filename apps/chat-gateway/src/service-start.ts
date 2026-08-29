import { SupervisedChatGatewayService, validateChatGatewayWorkerEnvironment } from "./service.js";

const checked = validateChatGatewayWorkerEnvironment(process.env);
const service = new SupervisedChatGatewayService(checked);
const controller = new AbortController();
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  controller.abort();
  await service.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
const ready = await service.ready();
process.stdout.write(`Chat Gateway worker ${checked.workerId} started with ${checked.connections.length} configured provider connection(s) and ${ready.consumers.length} consumer(s)\n`);
try { await service.run(controller.signal); }
finally { await shutdown(); }
