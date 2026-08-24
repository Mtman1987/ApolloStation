import { createSpmtServiceWithProviderIdentity } from "./provider-identity-host.js";

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.SPMT_DATABASE_PATH ?? "./data/spmt.sqlite";
const publicBaseUrl = process.env.SPMT_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const service = createSpmtServiceWithProviderIdentity({
  databasePath,
  port,
  publicBaseUrl,
  oauthIssuer: process.env.SPMT_OAUTH_ISSUER ?? new URL("/oauth/", publicBaseUrl).toString().replace(/\/$/, ""),
  ...(process.env.SPMT_WEBHOOK_KEY ? { webhookKey: process.env.SPMT_WEBHOOK_KEY } : {}),
});

service.server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`SPMT service with provider identity listening on ${port}\n`);
});

const shutdown = () => service.server.close(() => { service.close(); process.exit(0); });
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
