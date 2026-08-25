import { createSpmtServiceWithProviderIdentity } from "./provider-identity-host.js";
import { validateSandboxServiceEnvironment } from "./index.js";

const port = Number(process.env.PORT ?? 3000);
const runtimeMode = process.env.SPMT_RUNTIME_MODE === "sandbox" ? "sandbox" : "production";
const checked = runtimeMode === "sandbox" ? validateSandboxServiceEnvironment(process.env) : undefined;
const databasePath = checked?.databasePath ?? process.env.SPMT_DATABASE_PATH ?? process.env.DATABASE_PATH;
if (!databasePath) throw new Error("DATABASE_PATH is required; SPMT will not fall back to a local production database");
const publicBaseUrl = checked?.publicBaseUrl ?? process.env.SPMT_PUBLIC_URL ?? "https://spmt.live";
const webhookKeySource = process.env.SPMT_WEBHOOK_KEY;
if (!webhookKeySource) throw new Error("SPMT_WEBHOOK_KEY is required");
const webhookKey = Buffer.from(webhookKeySource, "base64url");
if (webhookKey.byteLength !== 32) throw new Error("SPMT_WEBHOOK_KEY must decode to exactly 32 bytes");

const buildSha = process.env.BUILD_SHA;
const twitchClientId = process.env.TWITCH_CLIENT_ID;
const twitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const service = createSpmtServiceWithProviderIdentity({
  databasePath,
  webhookKey,
  port,
  publicBaseUrl,
  runtimeMode,
  sandboxFixtures: runtimeMode === "sandbox" && process.env.SPMT_SANDBOX_FIXTURES === "1",
  ...(checked?.sandboxOwnerUsername ? { sandboxOwnerUsername: checked.sandboxOwnerUsername } : {}),
  ...(checked?.sandboxApps.length ? { sandboxApps: checked.sandboxApps } : {}),
  ...(checked?.host ? { host: checked.host } : {}),
  ...(buildSha ? { buildSha } : {}),
  ...(twitchClientId ? { twitchClientId } : {}),
  ...(twitchClientSecret ? { twitchClientSecret } : {}),
  ...(discordBotToken ? { discordBotToken } : {}),
});

await service.listen();
process.stdout.write(`SPMT service with provider identity listening on ${port}\n`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  try {
    await service.close();
    process.exit(0);
  } catch (error) {
    process.stderr.write(`SPMT shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
