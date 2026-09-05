import { SimulationRoomRuntime, SimulationRoomWorker } from "./simulation-runtime.js";
import { basename, isAbsolute, dirname, join } from "node:path";
import { createSpmtCommlinkLiveChatConsumer } from "@spmt/commlink-core";
import { SpmtClient } from "@spmt/sdk";
import { NodeSeaArtCommandRunner, SeaArtCliProvider, StreamWeaverImageGenerationService, StreamWeaverImageWorker, StreamWeaverProviderRuntime, StreamWeaverSuiteActionJobExecutor, type StreamWeaverBotActionExecutorV1 } from "@spmt/streamweaver";
import { NebulaArcadeProviderRuntime, loadNebulaArcadeProviderConfig, type NebulaArcadeProviderConfigV1, type NebulaDiscordDashboardEgressV1 } from "@spmt/nebula-arcade";
import { ChatGatewayRuntime, SqliteChatGatewayStore, createShadowChatProviderSenders, type ChatGatewayConsumerV1 } from "./index.js";
import { ChatProviderConnectionSupervisor, SqliteProviderConnectionStore, type ProviderConnectionConfigV1 } from "./connection-supervisor.js";
import { createFirstPartyChatProviderAdapters } from "./provider-drivers.js";
import { SpmtChatProviderGrantSource } from "./spmt-provider-grants.js";
import { spmtSuiteActionDescriptor, type SpmtOperationModeV1 } from "@spmt/contracts";

export interface ChatGatewayWorkerEnvironmentV1 {
  runtimeMode: "production" | "sandbox";
  operationMode: SpmtOperationModeV1;
  liveIngressEnabled: boolean;
  spmtOrigin: string;
  databasePath: string;
  credential: string;
  workerId: string;
  connections: ProviderConnectionConfigV1[];
  reconcileMs: number;
  streamweaver?: { databasePath: string; credential: string; image?: { token: string; modelNo: string; modelVerNo: string; binary: string } };
  nebulaArcade?: { databasePath: string; credential: string; configPath: string; config: NebulaArcadeProviderConfigV1; publicOrigin?: string; gameplayOrigin?: string; webhookName: string; avatarUrl?: string };
}

export function validateChatGatewayWorkerEnvironment(environment: NodeJS.ProcessEnv): ChatGatewayWorkerEnvironmentV1 {
  const runtimeMode = environment.SPMT_RUNTIME_MODE === "sandbox" ? "sandbox" : "production";
  const operationMode: SpmtOperationModeV1 = environment.SPMT_OUTBOUND_MODE === "disabled" ? "read-only" : "active";
  const liveIngressEnabled = environment.SPMT_LIVE_INGRESS_MODE === "enabled";
  const spmtOrigin = loopbackOrigin(environment.SPMT_ORIGIN ?? "");
  const databasePath = environment.CHAT_GATEWAY_DATABASE_PATH ?? "";
  if (!databasePath || !isAbsolute(databasePath)) throw new Error("CHAT_GATEWAY_DATABASE_PATH must be absolute");
  const credential = environment.CHAT_GATEWAY_WORKER_CREDENTIAL ?? "";
  if (credential.length < 32) throw new Error("A 32+ character CHAT_GATEWAY_WORKER_CREDENTIAL is required");
  const connections = parseChatGatewayConnections(environment.CHAT_GATEWAY_CONNECTIONS);
  if (runtimeMode === "sandbox") {
    if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("Sandbox Chat Gateway requires SPMT_OUTBOUND_MODE=disabled");
    if (!basename(databasePath).toLowerCase().includes("sandbox")) throw new Error("Sandbox Chat Gateway requires a sandbox-named database");
    if (connections.length && !liveIngressEnabled) throw new Error("Sandbox Chat Gateway rejects live provider connections unless SPMT_LIVE_INGRESS_MODE=enabled");
  }
  if (liveIngressEnabled && operationMode !== "read-only") throw new Error("Live ingress requires SPMT_OUTBOUND_MODE=disabled");
  const reconcileMs = environment.CHAT_GATEWAY_RECONCILE_MS === undefined ? 1_000 : Number(environment.CHAT_GATEWAY_RECONCILE_MS);
  if (!Number.isSafeInteger(reconcileMs) || reconcileMs < 250 || reconcileMs > 60_000) throw new Error("CHAT_GATEWAY_RECONCILE_MS is invalid");
  const workerId = environment.CHAT_GATEWAY_WORKER_ID ?? `chat-gateway-${process.pid}`;
  requireId(workerId, "CHAT_GATEWAY_WORKER_ID");
  const streamweaverEnabled = environment.STREAMWEAVER_PROVIDER_RUNTIME_ENABLED === "1";
  const streamweaverCredential = environment.STREAMWEAVER_WORKER_CREDENTIAL;
  const streamweaverDatabasePath = environment.STREAMWEAVER_DATABASE_PATH;
  if (!streamweaverEnabled && (streamweaverCredential || streamweaverDatabasePath)) throw new Error("StreamWeaver provider runtime settings require STREAMWEAVER_PROVIDER_RUNTIME_ENABLED=1");
  let streamweaver: ChatGatewayWorkerEnvironmentV1["streamweaver"];
  if (streamweaverEnabled) {
    if (!streamweaverCredential || streamweaverCredential.length < 32) throw new Error("A 32+ character STREAMWEAVER_WORKER_CREDENTIAL is required");
    if (!streamweaverDatabasePath || !isAbsolute(streamweaverDatabasePath)) throw new Error("STREAMWEAVER_DATABASE_PATH must be absolute");
    if (runtimeMode === "sandbox" && !basename(streamweaverDatabasePath).toLowerCase().includes("sandbox")) throw new Error("Sandbox StreamWeaver requires a sandbox-named database");
    const imageValues=[environment.STREAMWEAVER_SEAART_CLI_TOKEN,environment.STREAMWEAVER_SEAART_MODEL_NO,environment.STREAMWEAVER_SEAART_MODEL_VER_NO].filter(Boolean);
    if(imageValues.length!==0&&imageValues.length!==3)throw new Error("StreamWeaver SeaArt token, model, and model version must be configured together");
    if(runtimeMode==="sandbox"&&imageValues.length)throw new Error("Sandbox StreamWeaver rejects external image generation");
    const image=imageValues.length?{token:String(environment.STREAMWEAVER_SEAART_CLI_TOKEN),modelNo:modelIdentifier(environment.STREAMWEAVER_SEAART_MODEL_NO,"STREAMWEAVER_SEAART_MODEL_NO"),modelVerNo:modelIdentifier(environment.STREAMWEAVER_SEAART_MODEL_VER_NO,"STREAMWEAVER_SEAART_MODEL_VER_NO"),binary:environment.STREAMWEAVER_SEAART_CLI_BINARY||"seaart"}:undefined;
    streamweaver = { databasePath: streamweaverDatabasePath, credential: streamweaverCredential, ...(image?{image}:{}) };
  }
  const nebulaEnabled = environment.NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED === "1";
  const nebulaCredential = environment.NEBULA_ARCADE_WORKER_CREDENTIAL;
  const nebulaDatabasePath = environment.NEBULA_ARCADE_DATABASE_PATH;
  const nebulaConfigPath = environment.NEBULA_ARCADE_RUNTIME_CONFIG_PATH;
  const nebulaPublicOriginValue = environment.NEBULA_ARCADE_PUBLIC_ORIGIN ?? environment.SPMT_PUBLIC_ORIGIN;
  const nebulaGameplayOriginValue = environment.NEBULA_GAMEPLAY_PUBLIC_ORIGIN;
  const legacyTagKey = ["CHAT", "TAG"].join("_");
  const nebulaAvatarValue = environment.NEBULA_ARCADE_AVATAR_URL ?? environment[`${legacyTagKey}_AVATAR_URL`] ?? environment[`DISCORD_${legacyTagKey}_AVATAR_URL`];
  const nebulaWebhookName = String(environment.NEBULA_ARCADE_WEBHOOK_NAME ?? environment[`${legacyTagKey}_WEBHOOK_NAME`] ?? "Nebula Arcade").replace(/[\r\n]/g, " ").trim().slice(0, 80);
  if (!nebulaEnabled && (nebulaCredential || nebulaDatabasePath || nebulaConfigPath || nebulaPublicOriginValue || nebulaGameplayOriginValue || nebulaAvatarValue)) throw new Error("Nebula Arcade provider runtime settings require NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED=1");
  let nebulaArcade: ChatGatewayWorkerEnvironmentV1["nebulaArcade"];
  if (nebulaEnabled) {
    if (!nebulaCredential || nebulaCredential.length < 32) throw new Error("A 32+ character NEBULA_ARCADE_WORKER_CREDENTIAL is required");
    if (!nebulaDatabasePath || !isAbsolute(nebulaDatabasePath)) throw new Error("NEBULA_ARCADE_DATABASE_PATH must be absolute");
    if (!nebulaConfigPath || !isAbsolute(nebulaConfigPath)) throw new Error("NEBULA_ARCADE_RUNTIME_CONFIG_PATH must be absolute");
    const config = loadNebulaArcadeProviderConfig(nebulaConfigPath);
    const publicOrigin = nebulaPublicOriginValue ? httpsOrigin(nebulaPublicOriginValue, "NEBULA_ARCADE_PUBLIC_ORIGIN") : undefined;
    const gameplayOrigin = nebulaGameplayOriginValue ? httpsOrigin(nebulaGameplayOriginValue, "NEBULA_GAMEPLAY_PUBLIC_ORIGIN") : undefined;
    const avatarUrl = nebulaAvatarValue ? httpsAssetUrl(nebulaAvatarValue, "NEBULA_ARCADE_AVATAR_URL") : undefined;
    if (!nebulaWebhookName) throw new Error("NEBULA_ARCADE_WEBHOOK_NAME is invalid");
    if (runtimeMode === "sandbox") {
      if (!basename(nebulaDatabasePath).toLowerCase().includes("sandbox") || !basename(nebulaConfigPath).toLowerCase().includes("sandbox")) throw new Error("Sandbox Nebula Arcade requires sandbox-named database and config files");
      if (config.tenants.length && !liveIngressEnabled) throw new Error("Sandbox Nebula Arcade rejects live provider tenants unless shadow live ingress is enabled");
    }
    nebulaArcade = { databasePath: nebulaDatabasePath, credential: nebulaCredential, configPath: nebulaConfigPath, config, webhookName: nebulaWebhookName, ...(publicOrigin ? { publicOrigin } : {}), ...(gameplayOrigin ? { gameplayOrigin } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
  }
  return { runtimeMode, operationMode, liveIngressEnabled, spmtOrigin, databasePath, credential, workerId, connections, reconcileMs, ...(streamweaver ? { streamweaver } : {}), ...(nebulaArcade ? { nebulaArcade } : {}) };
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

export function createInternalServiceTokenProvider(options: { spmtOrigin: string; serviceId: string; credential: string; fetchImpl?: typeof fetch }) {
  const origin = loopbackOrigin(options.spmtOrigin);
  requireId(options.serviceId, "serviceId");
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    const response = await (options.fetchImpl ?? fetch)(`${origin}/v1/auth/service-token`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ serviceId: options.serviceId, credential: options.credential }), redirect: "manual", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`${options.serviceId} authentication failed (${response.status})`);
    const value = await response.json() as { accessToken?: unknown; accessExpiresAt?: unknown };
    if (typeof value.accessToken !== "string" || typeof value.accessExpiresAt !== "string") throw new Error("Chat Gateway authentication returned an invalid token");
    cached = { token: value.accessToken, expiresAt: Date.parse(value.accessExpiresAt) };
    return cached.token;
  };
}

export function createChatGatewayWorkerTokenProvider(options: { spmtOrigin: string; credential: string; fetchImpl?: typeof fetch }) { return createInternalServiceTokenProvider({ ...options, serviceId: "chat-gateway" }); }

export class SupervisedChatGatewayService {
  private readonly startedAt = new Date().toISOString();
  private readonly simulationWorker: SimulationRoomWorker;
  private readonly chatStore: SqliteChatGatewayStore;
  private readonly connectionStore: SqliteProviderConnectionStore;
  private readonly supervisor: ChatProviderConnectionSupervisor;
  private readonly gateway: ChatGatewayRuntime;
  private readonly tenants: string[];
  private readonly getAccessToken: () => Promise<string>;
  private readonly getStreamWeaverAccessToken?: () => Promise<string>;
  private readonly streamweaverClient?: SpmtClient;
  private readonly streamweaver?: StreamWeaverProviderRuntime;
  private readonly streamweaverImage?: StreamWeaverImageWorker;
  private readonly getNebulaArcadeAccessToken?: () => Promise<string>;
  private readonly nebulaArcade?: NebulaArcadeProviderRuntime;
  constructor(private readonly options: ChatGatewayWorkerEnvironmentV1, fetchImpl?: typeof fetch) {
    this.getAccessToken = createChatGatewayWorkerTokenProvider({ spmtOrigin: options.spmtOrigin, credential: options.credential, ...(fetchImpl ? { fetchImpl } : {}) });
    const client = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "chat-gateway", getAccessToken: this.getAccessToken, ...(fetchImpl ? { fetchImpl } : {}) });
    this.simulationWorker = new SimulationRoomWorker(client, new SimulationRoomRuntime({ directory: join(dirname(options.databasePath), "simulation-rooms"), ...(options.nebulaArcade?.publicOrigin ? { publicOrigin: options.nebulaArcade.publicOrigin } : {}), ...(options.streamweaver ? { streamweaverDatabasePath: options.streamweaver.databasePath } : {}), publish: (event, key) => client.publishSimulationRoomEvent(String((event.data as Record<string, unknown>)?.tenantId ?? ""), event, key) }), `${options.workerId}-simulation`);
    const adapters = createFirstPartyChatProviderAdapters(fetchImpl ? { fetch: async (url, init) => fetchImpl(url, init) } : {});
    this.chatStore = new SqliteChatGatewayStore(options.databasePath);
    const egressMode = options.operationMode === "active" ? "provider" as const : "shadow" as const;
    const publishShadow = async (message: import("./index.js").ShadowChatMessageV1) => {
      await client.publishSimulationRoomEvent(message.tenantId, {
        roomId: message.roomId,
        lane: "chat",
        direction: "egress",
        title: `${message.provider} shadow output`,
        body: message.text,
        provider: message.provider,
        connectionId: message.connectionId,
        channelId: message.channelId,
        ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
        data: { providerMessageId: message.providerMessageId },
        occurredAt: message.createdAt,
      }, `shadow-chat:${message.id}`).catch(() => undefined);
    };
    const senders = egressMode === "provider" ? adapters.senders : createShadowChatProviderSenders(this.chatStore, publishShadow);
    const shadowDashboard: NebulaDiscordDashboardEgressV1 = { upsertDiscordDashboard: async (message) => {
      const timestamp = message.payload.embeds[0]?.timestamp ?? new Date().toISOString();
      const recorded = this.chatStore.recordShadow({ schemaVersion: 1, tenantId: message.tenantId, provider: "discord", connectionId: message.connectionId, channelId: message.channelId, text: JSON.stringify(message.payload).slice(0, 8_000), idempotencyKey: `nebula-dashboard:${message.connectionId}:${message.channelId}:${timestamp}` });
      if (!recorded.duplicate) await publishShadow(recorded.message);
      return { providerMessageId: message.previousMessageId ?? String(Date.now()), transport: "bot" };
    } };
    const discordDashboard = egressMode === "provider" ? adapters.discord : shadowDashboard;
    this.connectionStore = new SqliteProviderConnectionStore(options.databasePath);
    const consumers: ChatGatewayConsumerV1[] = [createSpmtCommlinkLiveChatConsumer(client)];
    const observers: Array<{ id: string; observe(message: import("@spmt/contracts").NormalizedChatMessageV1): void | Promise<void> }> = [];
    let connectedGateway: ChatGatewayRuntime | undefined;
    if (options.operationMode === "read-only") observers.push({ id: "simulation-rooms.provider-ingress", observe: async (message) => {
      const roomId = `${message.provider}:${message.connectionId}:${message.channelId}`;
      await client.publishSimulationRoomEvent(message.tenantId, {
        roomId,
        lane: "chat",
        direction: "ingress",
        title: `${message.provider} live input`,
        body: message.text,
        provider: message.provider,
        connectionId: message.connectionId,
        channelId: message.channelId,
        data: {
          messageId: message.messageId,
          ...(message.sourceChannelId ? { sourceChannelId: message.sourceChannelId } : {}),
          actor: { providerUserId: message.actor.providerUserId, username: message.actor.username, displayName: message.actor.displayName ?? message.actor.username, roles: message.actor.roles },
          consumers: connectedGateway?.consumerIds() ?? [],
        },
        occurredAt: message.occurredAt,
      }, `simulation-ingress:${message.provider}:${message.connectionId}:${message.messageId}`).catch(() => undefined);
    } });
    if (options.streamweaver) {
      this.getStreamWeaverAccessToken = createInternalServiceTokenProvider({ spmtOrigin: options.spmtOrigin, serviceId: "streamweaver", credential: options.streamweaver.credential, ...(fetchImpl ? { fetchImpl } : {}) });
      const streamweaverClient = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "streamweaver", getAccessToken: this.getStreamWeaverAccessToken, ...(fetchImpl ? { fetchImpl } : {}) });
      this.streamweaverClient = streamweaverClient;
      const suiteActions = new StreamWeaverSuiteActionJobExecutor(streamweaverClient);
      const guardedSuiteActions: StreamWeaverBotActionExecutorV1 = options.operationMode === "active" ? suiteActions : { execute: async (request, context) => {
        const descriptor = spmtSuiteActionDescriptor(request.action), roomId = `${context.source}:${context.connectionId ?? "chat"}:${context.channelId}`;
        const argumentList = Object.entries(request.args).map(([name, value]) => ({ name, value }));
        await streamweaverClient.publishSimulationRoomEvent(context.tenantId, {
          roomId,
          lane: "app",
          direction: "preview",
          title: `${request.action} shadow route`,
          body: `StreamWeaver recognized ${request.action} and routed it without provider egress.`,
          provider: context.source,
          ...(context.connectionId ? { connectionId: context.connectionId } : {}),
          channelId: context.channelId,
          data: { action: request.action, risk: descriptor.risk, phase: "routed", arguments: argumentList },
        }, `shadow-suite:${context.requestId}:routed`).catch(() => undefined);
        if (request.action === "sw.image.generate") return { response: "Image generation was previewed but not sent to an external provider in shadow mode." };
        try {
          const result = await suiteActions.execute(request, { ...context, simulation: true });
          await streamweaverClient.publishSimulationRoomEvent(context.tenantId, {
            roomId,
            lane: request.action.startsWith("hmo.") ? "app" : "chat",
            direction: "preview",
            title: `${request.action} shadow result`,
            body: result.response,
            provider: context.source,
            ...(context.connectionId ? { connectionId: context.connectionId } : {}),
            channelId: context.channelId,
            data: { action: request.action, risk: descriptor.risk, phase: "completed" },
          }, `shadow-suite:${context.requestId}:completed`).catch(() => undefined);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : `${request.action} could not be simulated`;
          await streamweaverClient.publishSimulationRoomEvent(context.tenantId, { roomId, lane: "app", direction: "preview", title: `${request.action} shadow failure`, body: message.slice(0, 8_000), provider: context.source, ...(context.connectionId ? { connectionId: context.connectionId } : {}), channelId: context.channelId, data: { action: request.action, risk: descriptor.risk, phase: "failed" } }, `shadow-suite:${context.requestId}:failed`).catch(() => undefined);
          return { response: message };
        }
      } };
      this.streamweaver = new StreamWeaverProviderRuntime({ databasePath: options.streamweaver.databasePath, client: streamweaverClient, botActions: guardedSuiteActions, allowAssistant: !options.liveIngressEnabled, egress: { send: (message) => { if (!connectedGateway) throw new Error("Chat Gateway egress is not ready"); return connectedGateway.send(message); } } });
      if(options.streamweaver.image){const image=options.streamweaver.image,provider=new SeaArtCliProvider(image.token,new NodeSeaArtCommandRunner(image.binary)),tenantIds=[...new Set(options.connections.map(connection=>connection.tenantId))];this.streamweaverImage=new StreamWeaverImageWorker(streamweaverClient,new StreamWeaverImageGenerationService([provider]),{workerId:`${options.workerId}-image`,modelNo:image.modelNo,modelVerNo:image.modelVerNo,...(tenantIds.length?{tenantIds}:{})});}
      consumers.push(...this.streamweaver.consumers);
      observers.push(...this.streamweaver.messageObservers);
    }
    if (options.nebulaArcade) {
      this.getNebulaArcadeAccessToken = createInternalServiceTokenProvider({ spmtOrigin: options.spmtOrigin, serviceId: "nebula-arcade", credential: options.nebulaArcade.credential, ...(fetchImpl ? { fetchImpl } : {}) });
      const nebulaClient = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "nebula-arcade", getAccessToken: this.getNebulaArcadeAccessToken, ...(fetchImpl ? { fetchImpl } : {}) });
      this.nebulaArcade = new NebulaArcadeProviderRuntime({ databasePath: options.nebulaArcade.databasePath, config: options.nebulaArcade.config, client: nebulaClient, simulation: options.operationMode === "read-only", egress: { send: (message) => { if (!connectedGateway) throw new Error("Chat Gateway egress is not ready"); return connectedGateway.send(message); } }, ...(options.nebulaArcade.publicOrigin ? { discordDashboard: { egress: discordDashboard, publicOrigin: options.nebulaArcade.publicOrigin, ...(options.nebulaArcade.gameplayOrigin ? { gameplayOrigin: options.nebulaArcade.gameplayOrigin } : {}), webhookName: options.nebulaArcade.webhookName, ...(options.nebulaArcade.avatarUrl ? { avatarUrl: options.nebulaArcade.avatarUrl } : {}) } } : {}) });
      consumers.push(...this.nebulaArcade.consumers);
    }
    this.gateway = new ChatGatewayRuntime(this.chatStore, consumers, senders, observers);
    connectedGateway = this.gateway;
    this.supervisor = new ChatProviderConnectionSupervisor(options.workerId, this.connectionStore, this.gateway, new SpmtChatProviderGrantSource(client, options.operationMode === "read-only" ? { requiredScopes: { twitch: ["chat:read"], discord: ["gateway"], kick: ["chat:read"] } } : {}), adapters.drivers);
    options.connections.forEach((connection) => this.connectionStore.put(connection));
    this.tenants = [...new Set(options.connections.map((connection) => connection.tenantId))];
  }
  async ready() { await Promise.all([this.getAccessToken(), this.getStreamWeaverAccessToken?.(), this.getNebulaArcadeAccessToken?.()]); if(this.streamweaverClient&&this.tenants.length)await this.streamweaverClient.reportExecutionWorker({executionOwner:"streamweaver",workerId:`${this.options.workerId}-voice-egress`,executionTarget:"sprite",state:"ready",capabilityIds:["streamweaver.voice-egress.v1"],tenantIds:this.tenants,providerHealthy:true,startedAt:this.startedAt,leaseMs:60_000,metrics:{completedJobs:0,failedJobs:0,inputUnits:0,outputUnits:0}});await this.streamweaverImage?.report();return { schemaVersion: 1 as const, workerId: this.options.workerId, operationMode: this.options.operationMode, liveIngressEnabled: this.options.liveIngressEnabled, egressMode: this.options.operationMode === "active" ? "provider" as const : "shadow" as const, shadowMessages: this.chatStore.countShadowMessages(), configuredConnections: this.options.connections.length, consumers: this.gateway.consumerIds() }; }
  listShadowMessages(tenantId:string,limit=200){return this.chatStore.listShadowMessages(tenantId,limit);}
  async reconcile() {
    const connections = await this.supervisor.reconcile();
    const deliveries = { attempted: 0, delivered: 0, failed: 0 };
    for (const tenantId of new Set([...this.tenants, ...this.chatStore.listPendingTenants()])) {
      const report = await this.gateway.flush(tenantId);
      deliveries.attempted += report.attempted; deliveries.delivered += report.delivered; deliveries.failed += report.failed;
    }
    const streamweaver = await this.streamweaver?.reconcile();
    const voiceEgress = await this.drainStreamWeaverVoiceEgress();
    const nebulaArcade = await this.nebulaArcade?.reconcile();
    return { schemaVersion: 1 as const, connections, deliveries, ...(streamweaver ? { streamweaver } : {}), ...(voiceEgress ? { voiceEgress } : {}), ...(nebulaArcade ? { nebulaArcade } : {}) };
  }
  private async drainStreamWeaverVoiceEgress(limit=20){const client=this.streamweaverClient;if(!client)return undefined;const report={observed:0,sent:0,failed:0};if(!this.tenants.length)return report;const workerId=`${this.options.workerId}-voice-egress`;await client.reportExecutionWorker({executionOwner:"streamweaver",workerId,executionTarget:"sprite",state:"ready",capabilityIds:["streamweaver.voice-egress.v1"],tenantIds:this.tenants,providerHealthy:true,startedAt:this.startedAt,leaseMs:60_000,metrics:{completedJobs:0,failedJobs:0,inputUnits:0,outputUnits:0}});for(let index=0;index<limit;index+=1){const job=await client.claimAnyExecutionJob(workerId,"sprite",{executionOwner:"streamweaver",capabilityIds:["streamweaver.voice-egress.v1"],leaseMs:30_000});if(!job)break;report.observed+=1;try{const input=job.input,destination=input.destination;if(destination!=="twitch"&&destination!=="discord")throw new Error("Voice egress destination is invalid");const connectionId=requiredInput(input.connectionId,"connectionId"),channelId=requiredInput(input.channelId,"channelId"),text=boundedInput(input.text,"text",5_000);const configured=this.options.connections.find((item)=>item.tenantId===job.tenantId&&item.provider===destination&&item.connectionId===connectionId&&item.channelId===channelId&&item.desired);if(!configured)throw new Error("The selected provider connection is no longer configured");const sent=await this.gateway.send({schemaVersion:1,tenantId:job.tenantId,provider:destination,connectionId,channelId,text,idempotencyKey:`streamweaver-voice-egress:${job.id}`});if(!job.leaseId)throw new Error("Voice egress job lease is unavailable");await client.succeedExecutionJob(job.tenantId,job.id,workerId,job.leaseId,job.fencingEpoch,{schemaVersion:1,provider:destination,providerMessageId:sent.providerMessageId});report.sent+=1;}catch(error){const message=error instanceof Error?error.message:"Voice egress failed";if(!job.leaseId)throw error;await client.failExecutionJob(job.tenantId,job.id,workerId,job.leaseId,job.fencingEpoch,"voice_egress_failed",message,!/invalid|no longer configured/i.test(message));report.failed+=1;}}return report;}
  async run(signal: AbortSignal) { await Promise.all([this.runGateway(signal),this.runSimulation(signal),this.streamweaverImage?.run(signal)??Promise.resolve()]); }
  private async runSimulation(signal:AbortSignal){while(!signal.aborted){await this.simulationWorker.runOnce();await pause(this.options.reconcileMs,signal);}}
  private async runGateway(signal:AbortSignal){while(!signal.aborted){await this.reconcile();await pause(this.options.reconcileMs,signal);}}
  async close() { await this.supervisor.stop(); this.nebulaArcade?.close(); this.streamweaver?.close(); this.connectionStore.close(); this.chatStore.close(); }
}

function loopbackOrigin(value: string) { const url = new URL(value); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_ORIGIN must be a credential-free loopback HTTP origin"); return url.origin; }
function httpsOrigin(value: string, name: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} must be a credential-free HTTPS origin`); return url.origin; }
function httpsAssetUrl(value: string, name: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${name} must be a credential-free HTTPS URL`); return url.toString(); }
function requireId(value: string, name: string) { if (!value || !/^[A-Za-z0-9._:@/-]{1,300}$/.test(value)) throw new Error(`${name} is invalid`); }
function modelIdentifier(value:unknown,name:string){const result=String(value??"");if(!/^[A-Za-z0-9._:-]{1,160}$/.test(result))throw new Error(`${name} is invalid`);return result;}
function requiredInput(value:unknown,name:string){const result=String(value??"").trim();requireId(result,name);return result;}
function boundedInput(value:unknown,name:string,max:number){const result=String(value??"").trim();if(!result||result.length>max||/\0/.test(result))throw new Error(`${name} is invalid`);return result;}
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((resolve) => { if (signal.aborted) return resolve(); const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
