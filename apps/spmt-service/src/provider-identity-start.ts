import { createSpmtServiceWithProviderIdentity } from "./provider-identity-host.js";

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.SPMT_DATABASE_PATH ?? process.env.DATABASE_PATH ?? "./data/spmt.sqlite";
const publicBaseUrl = process.env.SPMT_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const webhookKeySource = process.env.SPMT_WEBHOOK_KEY;
if (!webhookKeySource) throw new Error("SPMT_WEBHOOK_KEY is required");
const webhookKey = Buffer.from(webhookKeySource, "base64url");
if (webhookKey.byteLength !== 32) throw new Error("SPMT_WEBHOOK_KEY must decode to exactly 32 bytes");

const service = createSpmtServiceWithProviderIdentity({
  databasePath,
  port,
  publicBaseUrl,
  webhookKey,
});

service.server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`SPMT service with provider identity listening on ${port}\n`);
});

const shutdown = () => service.server.close(() => { service.close(); process.exit(0); });
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
