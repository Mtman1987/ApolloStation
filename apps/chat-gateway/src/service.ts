import { basename, isAbsolute } from "node:path";
import { createSpmtCommlinkLiveChatConsumer } from "@spmt/commlink-core";
import { SpmtClient } from "@spmt/sdk";
import { ChatGatewayRuntime, SqliteChatGatewayStore } from "./index.js";
import { ChatProviderConnectionSupervisor, SqliteProviderConnectionStore, type ProviderConnectionConfigV1 } from "./connection-supervisor.js";
import { createFirstPartyChatProviderAdapters } from "./provider-drivers.js";
import { SpmtChatProviderGrantSource } from "./spmt-provider-grants.js";

export interface ChatGatewayWorkerEnvironmentV1 {
  runtimeMode: "production" | "sandbox";
  spmtOrigin: string;
  databasePath: string;
  credential: string;
  workerId: string;
  connections: ProviderConnectionConfigV1[];
  reconcileMs: number;
}

export function validateChatGatewayWorkerEnvironment(environment: NodeJS.ProcessEnv): ChatGatewayWorkerEnvironmentV1 {
  const runtimeMode = environment.SPMT_RUNTIME_MODE === "sandbox" ? "sandbox" : "production";
  const spmtOrigin = loopbackOrigin(environment.SPMT_ORIGIN ?? "");
  const databasePath = environment.CHAT_GATEWAY_DATABASE_PATH ?? "";
  if (!databasePath || !isAbsolute(databasePath)) throw new Error("CHAT_GATEWAY_DATABASE_PATH must be absolute");
  const credential = environment.CHAT_GATEWAY_WORKER_CREDENTIAL ?? "";
  if (credential.length < 32) throw new Error("A 32+ character CHAT_GATEWAY_WORKER_CREDENTIAL is required");
  const connections = parseChatGatewayConnections(environment.CHAT_GATEWAY_CONNECTIONS);
  if (runtimeMode === "sandbox") {
    if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("Sandbox Chat Gateway requires SPMT_OUTBOUND_MODE=disabled");
    if (!basename(databasePath).toLowerCase().includes("sandbox")) throw new Error("Sandbox Chat Gateway requires a sandbox-named database");
    if (connections.length) throw new Error("Sandbox Chat Gateway rejects live provider connections");
  }
  const reconcileMs = environment.CHAT_GATEWAY_RECONCILE_MS === undefined ? 1_000 : Number(environment.CHAT_GATEWAY_RECONCILE_MS);
  if (!Number.isSafeInteger(reconcileMs) || reconcileMs < 250 || reconcileMs > 60_000) throw new Error("CHAT_GATEWAY_RECONCILE_MS is invalid");
  const workerId = environment.CHAT_GATEWAY_WORKER_ID ?? `chat-gateway-${process.pid}`;
  requireId(workerId, "CHAT_GATEWAY_WORKER_ID");
  return { runtimeMode, spmtOrigin, databasePath, credential, workerId, connections, reconcileMs };
}

export function parseChatGatewayConnections(source: string | undefined): ProviderConnectionConfigV1[] {
  if (!source) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error("CHAT_GATEWAY_CONNECTIONS must be valid JSON"); }
  if (!Array.isArray(parsed) || parsed.length > 500) throw new Error("CHAT_GATEWAY_CONNECTIONS must be an array of at most 500 connections");
  const keys = new Set<string>();
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`CHAT_GATEWAY_CONNECTIONS[${index}] is invalid`);
    const item = value as Record<string, unknown>;
    if (item.schemaVersion !== 1 || !["twitch", "discord", "kick"].includes(String(item.provider)) || typeof item.desired !== "boolean") throw new Error(`CHAT_GATEWAY_CONNECTIONS[${index}] is invalid`);
    const connection = item as unknown as ProviderConnectionConfigV1;
    for (const [field, name] of [[connection.tenantId, "tenantId"], [connection.connectionId, "connectionId"], [connection.channelId, "channelId"], [connection.providerAccountId, "providerAccountId"]] as const) requireId(field, name);
    const key = `${connection.tenantId}:${connection.provider}:${connection.connectionId}`;
    if (keys.has(key)) throw new Error("CHAT_GATEWAY_CONNECTIONS contains a duplicate connection");
    keys.add(key);
    return { ...connection };
  });
}

export function createChatGatewayWorkerTokenProvider(options: { spmtOrigin: string; credential: string; fetchImpl?: typeof fetch }) {
  const origin = loopbackOrigin(options.spmtOrigin);
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    const response = await (options.fetchImpl ?? fetch)(`${origin}/v1/auth/service-token`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ serviceId: "chat-gateway", credential: options.credential }), redirect: "manual", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Chat Gateway authentication failed (${response.status})`);
    const value = await response.json() as { accessToken?: unknown; accessExpiresAt?: unknown };
    if (typeof value.accessToken !== "string" || typeof value.accessExpiresAt !== "string") throw new Error("Chat Gateway authentication returned an invalid token");
    cached = { token: value.accessToken, expiresAt: Date.parse(value.accessExpiresAt) };
    return cached.token;
  };
}

export class SupervisedChatGatewayService {
  private readonly chatStore: SqliteChatGatewayStore;
  private readonly connectionStore: SqliteProviderConnectionStore;
  private readonly supervisor: ChatProviderConnectionSupervisor;
  private readonly gateway: ChatGatewayRuntime;
  private readonly tenants: string[];
  private readonly getAccessToken: () => Promise<string>;
  constructor(private readonly options: ChatGatewayWorkerEnvironmentV1, fetchImpl?: typeof fetch) {
    this.getAccessToken = createChatGatewayWorkerTokenProvider({ spmtOrigin: options.spmtOrigin, credential: options.credential, ...(fetchImpl ? { fetchImpl } : {}) });
    const client = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "chat-gateway", getAccessToken: this.getAccessToken, ...(fetchImpl ? { fetchImpl } : {}) });
    const adapters = createFirstPartyChatProviderAdapters();
    this.chatStore = new SqliteChatGatewayStore(options.databasePath);
    this.connectionStore = new SqliteProviderConnectionStore(options.databasePath);
    this.gateway = new ChatGatewayRuntime(this.chatStore, [createSpmtCommlinkLiveChatConsumer(client)], adapters.senders);
    this.supervisor = new ChatProviderConnectionSupervisor(options.workerId, this.connectionStore, this.gateway, new SpmtChatProviderGrantSource(client), adapters.drivers);
    options.connections.forEach((connection) => this.connectionStore.put(connection));
    this.tenants = [...new Set(options.connections.map((connection) => connection.tenantId))];
  }
  async ready() { await this.getAccessToken(); return { schemaVersion: 1 as const, workerId: this.options.workerId, configuredConnections: this.options.connections.length }; }
  async reconcile() {
    const connections = await this.supervisor.reconcile();
    const deliveries = { attempted: 0, delivered: 0, failed: 0 };
    for (const tenantId of new Set([...this.tenants, ...this.chatStore.listPendingTenants()])) {
      const report = await this.gateway.flush(tenantId);
      deliveries.attempted += report.attempted; deliveries.delivered += report.delivered; deliveries.failed += report.failed;
    }
    return { schemaVersion: 1 as const, connections, deliveries };
  }
  async run(signal: AbortSignal) { while (!signal.aborted) { await this.reconcile(); await pause(this.options.reconcileMs, signal); } }
  async close() { await this.supervisor.stop(); this.connectionStore.close(); this.chatStore.close(); }
}

function loopbackOrigin(value: string) { const url = new URL(value); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_ORIGIN must be a credential-free loopback HTTP origin"); return url.origin; }
function requireId(value: string, name: string) { if (!value || !/^[A-Za-z0-9._:@/-]{1,300}$/.test(value)) throw new Error(`${name} is invalid`); }
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((resolve) => { if (signal.aborted) return resolve(); const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
