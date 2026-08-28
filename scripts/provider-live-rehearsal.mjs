import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGatewayRuntime, ChatProviderConnectionSupervisor, SpmtChatProviderGrantSource, SqliteChatGatewayStore, SqliteProviderConnectionStore, createFirstPartyChatProviderAdapters } from "../apps/chat-gateway/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

if (process.env.SPMT_PROVIDER_LIVE_REHEARSAL !== "1") throw new Error("SPMT_PROVIDER_LIVE_REHEARSAL=1 is required; live provider sockets remain disabled");
if (process.env.SPMT_RUNTIME_MODE !== "production") throw new Error("Provider live rehearsal requires SPMT_RUNTIME_MODE=production");
const origin = required(process.env.SPMT_ORIGIN, "SPMT_ORIGIN");
if (!origin.startsWith("https://")) throw new Error("SPMT_ORIGIN must use HTTPS");
const serviceToken = required(process.env.SPMT_CHAT_GATEWAY_TOKEN, "SPMT_CHAT_GATEWAY_TOKEN");
const owner = required(process.env.SPMT_PROVIDER_REHEARSAL_ID, "SPMT_PROVIDER_REHEARSAL_ID");
const connections = connectionList(process.env.SPMT_PROVIDER_REHEARSAL_CONNECTIONS);
if (new Set(connections.map((connection) => connection.tenantId)).size < 2) throw new Error("The credentialed rehearsal requires at least two tenants");
const durationMs = boundedDuration(process.env.SPMT_PROVIDER_REHEARSAL_DURATION_MS ?? "10000");
const directory = mkdtempSync(join(tmpdir(), "apollo-provider-live-rehearsal-"));
const connectionStore = new SqliteProviderConnectionStore(join(directory, "connections.sqlite"));
const messageStore = new SqliteChatGatewayStore(join(directory, "messages.sqlite"));
const adapters = createFirstPartyChatProviderAdapters();
const client = new SpmtClient({ baseUrl: origin, appId: "chat-gateway", getAccessToken: () => serviceToken });
const supervisor = new ChatProviderConnectionSupervisor(owner, connectionStore, new ChatGatewayRuntime(messageStore, [], adapters.senders), new SpmtChatProviderGrantSource(client), adapters.drivers);

try {
  for (const connection of connections) connectionStore.put(connection);
  const opened = await supervisor.reconcile();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  const projections = connections.map((connection) => connectionStore.get(connection.tenantId, connection.provider, connection.connectionId));
  const failures = projections.filter((projection) => projection?.state !== "connected");
  if (failures.length) throw new Error(`Live provider rehearsal did not keep ${failures.length} connection(s) healthy`);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, result: "passed", tenants: new Set(connections.map((connection) => connection.tenantId)).size, providers: [...new Set(connections.map((connection) => connection.provider))].sort(), connections: projections.length, initiallyConnected: opened.connected })}\n`);
} catch (error) {
  process.stderr.write(`Provider live rehearsal failed: ${safeReason(error)}\n`);
  process.exitCode = 1;
} finally {
  await supervisor.stop();
  connectionStore.close();
  messageStore.close();
  rmSync(directory, { recursive: true, force: true });
}

function connectionList(source) {
  if (!source) throw new Error("SPMT_PROVIDER_REHEARSAL_CONNECTIONS is required");
  let value;
  try { value = JSON.parse(source); } catch { throw new Error("SPMT_PROVIDER_REHEARSAL_CONNECTIONS must be valid JSON"); }
  if (!Array.isArray(value) || value.length < 2 || value.length > 30) throw new Error("SPMT_PROVIDER_REHEARSAL_CONNECTIONS must contain 2 to 30 connections");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || item.schemaVersion !== 1 || !["twitch", "discord", "kick"].includes(item.provider) || item.desired !== true) throw new Error("Provider rehearsal connection is invalid");
    for (const field of ["tenantId", "connectionId", "channelId", "providerAccountId"]) if (typeof item[field] !== "string" || !/^[A-Za-z0-9._:@/-]{1,200}$/.test(item[field])) throw new Error(`Provider rehearsal ${field} is invalid`);
    return { schemaVersion: 1, tenantId: item.tenantId, provider: item.provider, connectionId: item.connectionId, channelId: item.channelId, providerAccountId: item.providerAccountId, desired: true };
  });
}
function required(value, name) { if (!value || value.length < 8 || value.length > 8192) throw new Error(`${name} is required`); return value; }
function boundedDuration(source) { const value = Number(source); if (!Number.isSafeInteger(value) || value < 5_000 || value > 60_000) throw new Error("SPMT_PROVIDER_REHEARSAL_DURATION_MS must be 5000 to 60000"); return value; }
function safeReason(value) { return (value instanceof Error ? value.message : String(value)).replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 500); }
