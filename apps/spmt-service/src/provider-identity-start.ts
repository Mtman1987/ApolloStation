import { createSpmtServiceWithProviderIdentity } from "./provider-identity-host.js";
import { createSpmtOutputGateway } from "./output-gateway.js";
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
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const kickClientId = process.env.KICK_CLIENT_ID;
const kickClientSecret = process.env.KICK_CLIENT_SECRET;
const providerCredentialKeySource = process.env.SPMT_PROVIDER_CREDENTIAL_KEY;
const providerCredentialKey = providerCredentialKeySource ? Buffer.from(providerCredentialKeySource, "base64url") : undefined;
if (providerCredentialKey && providerCredentialKey.byteLength !== 32) throw new Error("SPMT_PROVIDER_CREDENTIAL_KEY must decode to exactly 32 bytes");
const providerOAuthClients = {
  ...(twitchClientId && twitchClientSecret ? { twitch: { clientId: twitchClientId, clientSecret: twitchClientSecret } } : {}),
  ...(discordClientId && discordClientSecret ? { discord: { clientId: discordClientId, clientSecret: discordClientSecret } } : {}),
  ...(kickClientId && kickClientSecret ? { kick: { clientId: kickClientId, clientSecret: kickClientSecret } } : {}),
};
const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const stellarWorkerCredential = process.env.STELLAR_WORKER_CREDENTIAL;
const stellarChatEnabled = process.env.SPMT_STELLAR_CHAT_ENABLED === "1";
if (stellarChatEnabled && !stellarWorkerCredential) throw new Error("SPMT_STELLAR_CHAT_ENABLED=1 requires STELLAR_WORKER_CREDENTIAL");
const chatGatewayCredential = process.env.CHAT_GATEWAY_WORKER_CREDENTIAL;
const chatGatewayEnabled = process.env.SPMT_CHAT_GATEWAY_ENABLED === "1";
if (chatGatewayEnabled && !chatGatewayCredential) throw new Error("SPMT_CHAT_GATEWAY_ENABLED=1 requires CHAT_GATEWAY_WORKER_CREDENTIAL");
const streamweaverWorkerCredential = process.env.STREAMWEAVER_WORKER_CREDENTIAL;
const streamweaverProviderRuntimeEnabled = process.env.SPMT_STREAMWEAVER_PROVIDER_RUNTIME_ENABLED === "1";
if (streamweaverProviderRuntimeEnabled && !streamweaverWorkerCredential) throw new Error("SPMT_STREAMWEAVER_PROVIDER_RUNTIME_ENABLED=1 requires STREAMWEAVER_WORKER_CREDENTIAL");
const dshWorkerCredential = process.env.DSH_WORKER_CREDENTIAL;
const dshLiveRuntimeEnabled = process.env.SPMT_DSH_LIVE_RUNTIME_ENABLED === "1";
if (dshLiveRuntimeEnabled && !dshWorkerCredential) throw new Error("SPMT_DSH_LIVE_RUNTIME_ENABLED=1 requires DSH_WORKER_CREDENTIAL");
const nebulaArcadeWorkerCredential = process.env.NEBULA_ARCADE_WORKER_CREDENTIAL;
const nebulaArcadeProviderRuntimeEnabled = process.env.SPMT_NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED === "1";
if (nebulaArcadeProviderRuntimeEnabled && !nebulaArcadeWorkerCredential) throw new Error("SPMT_NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED=1 requires NEBULA_ARCADE_WORKER_CREDENTIAL");
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
  ...(providerCredentialKey ? { providerCredentialKey, providerOAuthClients } : {}),
  ...(discordBotToken ? { discordBotToken } : {}),
  stellarChatEnabled,
  ...(stellarWorkerCredential ? { stellarWorkerCredential } : {}),
  chatGatewayEnabled,
  ...(chatGatewayCredential ? { chatGatewayCredential } : {}),
  streamweaverProviderRuntimeEnabled,
  ...(streamweaverWorkerCredential ? { streamweaverWorkerCredential } : {}),
  dshLiveRuntimeEnabled,
  ...(dshWorkerCredential ? { dshWorkerCredential } : {}),
  nebulaArcadeProviderRuntimeEnabled,
  ...(nebulaArcadeWorkerCredential ? { nebulaArcadeWorkerCredential } : {}),
});
const gateway = createSpmtOutputGateway(service, { port, host: checked?.host ?? process.env.SPMT_HOST ?? "0.0.0.0", publicBaseUrl });

await gateway.listen();
process.stdout.write(`SPMT service with provider identity and overlay output gateway listening on ${port}\n`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  try {
    await gateway.close();
    process.exit(0);
  } catch (error) {
    process.stderr.write(`SPMT shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
