import { startHearMeOutWebServerFromEnvironment } from "./web-server-v3.js";

const host = await startHearMeOutWebServerFromEnvironment();
const port = Number(process.env.PORT ?? 3200);
process.stdout.write(`HearMeOut web server listening on ${port}\n`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await host.close();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
