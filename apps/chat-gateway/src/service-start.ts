import { SupervisedChatGatewayService, validateChatGatewayWorkerEnvironment } from "./service.js";

const controller = new AbortController();
let stopping = false;
const delay = (ms: number) => new Promise<void>((resolve) => {
  if (controller.signal.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  controller.abort();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

// Node 2 deployment recovery: Chat Gateway is a background worker, not the public Node 2 web process.
// A temporary SPMT/auth/database/provider failure must not take StreamWeaver
// offline. Keep this process supervised and retry with bounded backoff.
while (!stopping) {
  let service: SupervisedChatGatewayService | undefined;
  try {
    const checked = validateChatGatewayWorkerEnvironment(process.env);
    service = new SupervisedChatGatewayService(checked);
    const ready = await service.ready();
    process.stdout.write(`Chat Gateway worker ${checked.workerId} started with ${checked.connections.length} configured provider connection(s) and ${ready.consumers.length} consumer(s)\\n`);
    await service.run(controller.signal);
    if (!stopping) throw new Error("Chat Gateway worker loop exited unexpectedly");
  } catch (error) {
    if (stopping) break;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`Chat Gateway worker startup/runtime failed; retrying in 10 seconds: ${message}\\n`);
  } finally {
    try { await service?.close(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Chat Gateway worker cleanup failed: ${message}\\n`);
    }
  }
  if (!stopping) await delay(10_000);
}
