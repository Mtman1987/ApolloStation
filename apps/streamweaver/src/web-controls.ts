import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchAppPlatformSnapshot, fetchAppSessionContext, readJsonBody, requireSameOrigin, safeError, sendJson } from "@spmt/app-foundation/product-web";
import { SpmtClient } from "@spmt/sdk";
import { routeSpmtSuiteAction, spmtSuiteActionAllowed, spmtSuiteActionDescriptor, type ChatProviderV1, type ExecutionWorkerProjectionV1, type SpmtOperationModeV1 } from "@spmt/contracts";
import { STREAMWEAVER_BOT_ACTION_CATALOG, detectStreamWeaverBotAction } from "./bot-action-runtime.js";
import { DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS, SqliteStreamWeaverEconomyStore, StreamWeaverEconomy } from "./economy.js";
import { StreamWeaverPersonaSettingsStore } from "./persona-settings.js";

export interface StreamWeaverWebConnectionV1 { schemaVersion: 1; tenantId: string; provider: ChatProviderV1; connectionId: string; channelId: string; providerAccountId: string; desired: boolean; }
export interface StreamWeaverWebControlOptionsV1 { spmtOrigin: string; databasePath?: string; credential?: string; connections?: StreamWeaverWebConnectionV1[]; operationMode?: SpmtOperationModeV1; fetchImpl?: typeof fetch; }
type SessionContext = Awaited<ReturnType<typeof fetchAppSessionContext>>;

/** Authenticated app API behind Voice Commander, persona, economy, and integration pages. */
export class StreamWeaverWebControls {
  private readonly persona?: StreamWeaverPersonaSettingsStore;
  private readonly economy?: SqliteStreamWeaverEconomyStore;
  private readonly client?: SpmtClient;
  private readonly operationMode: SpmtOperationModeV1;

  constructor(private readonly options: StreamWeaverWebControlOptionsV1) {
    this.operationMode = options.operationMode ?? "active";
    if (options.databasePath) { this.persona = new StreamWeaverPersonaSettingsStore(options.databasePath); this.economy = new SqliteStreamWeaverEconomyStore(options.databasePath); }
    if (options.credential) {
      const getAccessToken = serviceTokenProvider(options);
      this.client = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "streamweaver", getAccessToken, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
    }
  }

  close() { this.persona?.close(); this.economy?.close(); }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/streamweaver/control")) return false;
    try {
      const context = await fetchAppSessionContext({ appId: "streamweaver", spmtOrigin: this.options.spmtOrigin, request });
      if (request.method === "GET" && url.pathname === "/api/streamweaver/control") return await this.read(request, response, context);
      if (request.method === "GET" && /^\/api\/streamweaver\/control\/voice\/jobs\/[^/]+$/.test(url.pathname)) return await this.job(response, context, decodeURIComponent(url.pathname.split("/").at(-1) ?? ""));
      if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
      requireSameOrigin(request);
      const body = await readJsonBody(request);
      if (url.pathname === "/api/streamweaver/control/voice") return await this.voice(response, context, body);
      this.requireOwner(context);
      if (url.pathname === "/api/streamweaver/control/persona") return this.updatePersona(response, context, body);
      if (url.pathname === "/api/streamweaver/control/economy") return this.updateEconomy(response, context, body);
      return sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      const message = safeError(error);
      const status = /sign in|session/i.test(message) ? 401 : /owner access/i.test(message) ? 403 : /runtime is not configured|unavailable/i.test(message) ? 503 : 400;
      return sendJson(response, status, { error: "streamweaver_control_failed", message });
    }
  }

  private async read(request: IncomingMessage, response: ServerResponse, context: SessionContext) {
    const snapshot = await fetchAppPlatformSnapshot({ appId: "streamweaver", spmtOrigin: this.options.spmtOrigin, request, sources: ["providerLinks", "workers", "stellarCapabilities"] });
    const tenantId = context.tenantId, actorId = String(context.session.actorId ?? "");
    const suiteWorkers = this.client ? await this.client.listExecutionWorkers({ tenantId }).catch(() => [] as ExecutionWorkerProjectionV1[]) : [];
    const botActions = STREAMWEAVER_BOT_ACTION_CATALOG.map((action) => ({ ...action, policy: spmtSuiteActionAllowed(this.operationMode, action.id) ? "allowed" as const : "blocked" as const, availability: spmtSuiteActionAllowed(this.operationMode, action.id) && suiteActionReady(suiteWorkers, tenantId, routeSpmtSuiteAction(action.id).capabilityId) ? "connected" as const : "setup-required" as const }));
    const connectedSuiteActions = botActions.filter((action) => action.availability === "connected").length;
    const suiteActions = connectedSuiteActions === botActions.length ? "connected" : connectedSuiteActions ? "partial" : "setup-required";
    const personaDocument = this.persona?.read(tenantId) ?? null;
    const persona = this.persona?.get(tenantId) ?? null;
    const economySettings = this.economy?.getSettings(tenantId) ?? DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS;
    const wallet = this.economy && actorId ? this.economy.getWallet(tenantId, actorId) : null;
    const connections = (this.options.connections ?? []).filter((item) => item.tenantId === tenantId && item.desired).map(({ provider, connectionId, channelId, providerAccountId }) => ({ provider, connectionId, channelId, providerAccountId }));
    return sendJson(response, 200, {
      schemaVersion: 1,
      tenantId,
      session: context.session,
      role: this.role(context),
      operationMode: this.operationMode,
      runtimeReady: Boolean(this.client && this.persona && this.economy),
      providerLinks: snapshot.providerLinks,
      connections,
      workers: snapshot.workers,
      stellarCapabilities: snapshot.stellarCapabilities,
      personaDocument,
      persona,
      economy: { settings: economySettings, wallet, leaderboard: this.economy?.listLeaderboard(tenantId, 10) ?? [] },
      botRuntime: {
        publicCommands: connections.length ? "connected" : "setup-required",
        suiteActions,
        suiteActionsMessage: `${connectedSuiteActions} of ${botActions.length} cross-app actions have a ready app-owned worker. Commands from Voice Commander, chat, MountainView, and Companion use the same SPMT job pipeline.`,
      },
      botActions,
    });
  }

  private async voice(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const message = text(body.message, "message", 5_000), destination = destinationValue(body.destination);
    const detected = detectStreamWeaverBotAction(message);
    const userId = String(context.session.actorId ?? "");
    if (!userId) throw new Error("The signed-in user identity is unavailable");
    if (detected) {
      const descriptor = spmtSuiteActionDescriptor(detected.action);
      if (!spmtSuiteActionAllowed(this.operationMode, detected.action)) return sendJson(response, 200, { schemaVersion: 1, kind: "preview", status: "blocked", operationMode: this.operationMode, action: detected.action, risk: descriptor.risk, reason: "Read-only mode accepts live input but does not run write or broadcast actions." });
      const client = this.requireClient();
      const provider: "twitch" | "discord" | undefined = destination === "twitch" || destination === "discord" ? destination : undefined;
      const connection = provider ? this.connection(context.tenantId, provider, body.connectionId) : undefined;
      const result = await client.createSuiteActionJob(context.tenantId, { schemaVersion: 1, action: detected.action, args: detected.args, actor: { userId, username: String(context.session.username ?? context.session.displayName ?? userId), role: this.role(context) }, source: { kind: "voice-commander", ...(connection && provider ? { provider, channelId: connection.channelId, connectionId: connection.connectionId } : {}), requestId: idempotency(body.idempotencyKey, "streamweaver-suite-source") } }, idempotency(body.idempotencyKey, "streamweaver-suite-action"));
      return sendJson(response, 202, { schemaVersion: 1, kind: "suite-action", action: detected.action, duplicate: result.duplicate, jobId: result.job.id, state: result.job.state });
    }
    if (this.operationMode === "read-only") return sendJson(response, 200, { schemaVersion: 1, kind: "preview", status: "blocked", operationMode: this.operationMode, destination, reason: "Read-only mode accepts live input but does not send messages or invoke external assistants." });
    const client = this.requireClient();
    if (destination === "ai" || destination === "private") {
      const configured = this.persona?.get(context.tenantId);
      const result = await client.invokeCommunityAssistant(context.tenantId, { userId, message, surface: "app", conversationId: `streamweaver:voice:${destination}:${userId}`, routingPreference: "automatic", remember: destination === "ai", ...(configured ? { presentation: { personaId: configured.personaId, displayName: configured.displayName, instructions: configured.instructions, memoryPolicy: configured.memoryPolicy } } : {}) }, idempotency(body.idempotencyKey, "streamweaver-voice-ai"));
      return sendJson(response, result.status === "accepted" ? 202 : 503, { ...result, kind: "assistant", destination });
    }
    const connection = this.connection(context.tenantId, destination, body.connectionId);
    const result = await client.createExecutionJob(context.tenantId, { ownerAppId: "streamweaver", capabilityId: "streamweaver.voice-egress.v1", executionOwner: "streamweaver", billedUserId: userId, meteredResource: "hosted-worker-minutes", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", input: { schemaVersion: 1, destination, connectionId: connection.connectionId, channelId: connection.channelId, text: message, actorUserId: userId } }, idempotency(body.idempotencyKey, "streamweaver-voice-egress"));
    return sendJson(response, 202, { schemaVersion: 1, kind: "egress", destination, duplicate: result.duplicate, jobId: result.job.id, state: result.job.state });
  }

  private async job(response: ServerResponse, context: SessionContext, jobId: string) {
    if (!/^[A-Za-z0-9._:@/-]{1,300}$/.test(jobId)) throw new Error("Voice job id is invalid");
    const job = await this.requireClient().getExecutionJob(context.tenantId, jobId);
    if (job.billedUserId !== String(context.session.actorId ?? "")) throw new Error("Voice job is not visible to this user");
    return sendJson(response, 200, { schemaVersion: 1, job });
  }

  private updatePersona(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    if (!this.persona) throw new Error("StreamWeaver runtime is not configured");
    const current = this.persona.read(context.tenantId);
    const values: Record<string, string | number | boolean | null> = {
      personaId: identifier(body.personaId, "personaId"),
      displayName: text(body.displayName, "displayName", 120),
      aliases: text(body.aliases, "aliases", 1_000),
      ownerCanonicalUserId: String(context.session.actorId ?? ""),
      homeChannelIds: optionalText(body.homeChannelIds, 2_000),
      summonWindowMinutes: integer(body.summonWindowMinutes, 1, 120, "summonWindowMinutes"),
      instructions: text(body.instructions, "instructions", 4_000),
      memoryPolicy: body.memoryPolicy === "off" ? "off" : "conversation",
    };
    return sendJson(response, 200, this.persona.patch(context.tenantId, { schemaVersion: 1, expectedRevision: current.revision, values }));
  }

  private updateEconomy(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    if (!this.economy) throw new Error("StreamWeaver runtime is not configured");
    const economy = new StreamWeaverEconomy({ tenantId: context.tenantId, store: this.economy });
    const settings = economy.configureCurrency({ currencyName: text(body.currencyName, "currencyName", 32), defaultBet: integer(body.defaultBet, 1, Number.MAX_SAFE_INTEGER, "defaultBet"), minBet: integer(body.minBet, 0, Number.MAX_SAFE_INTEGER, "minBet"), maxBet: integer(body.maxBet, 0, Number.MAX_SAFE_INTEGER, "maxBet"), jackpotPercent: integer(body.jackpotPercent, 0, 100, "jackpotPercent"), jackpotMultiplier: integer(body.jackpotMultiplier, 1, 1_000_000, "jackpotMultiplier"), winPercent: integer(body.winPercent, 0, 100, "winPercent"), spmtExchangeEnabled: body.spmtExchangeEnabled === true, baseLocalPerSpmt: integer(body.baseLocalPerSpmt, 1, Number.MAX_SAFE_INTEGER, "baseLocalPerSpmt"), referenceSupply: integer(body.referenceSupply, 1, Number.MAX_SAFE_INTEGER, "referenceSupply"), maxSpmtPerExchange: integer(body.maxSpmtPerExchange, 1, Number.MAX_SAFE_INTEGER, "maxSpmtPerExchange") });
    return sendJson(response, 200, settings);
  }

  private connection(tenantId: string, provider: "twitch" | "discord", requested: unknown) {
    const options = (this.options.connections ?? []).filter((item) => item.tenantId === tenantId && item.provider === provider && item.desired);
    const request = String(requested ?? "");
    const match = request ? options.find((item) => item.connectionId === request) : options.length === 1 ? options[0] : undefined;
    if (!match) throw new Error(`Choose a connected ${provider} channel before sending`);
    return match;
  }
  private requireClient() { if (!this.client) throw new Error("StreamWeaver runtime is not configured"); return this.client; }
  private requireOwner(context: SessionContext) { if (this.role(context) !== "owner") throw new Error("Tenant owner access is required for this action"); }
  private role(context: SessionContext) { const roles = record(context.session.tenantRoles); return roles?.[context.tenantId] === "owner" ? "owner" : "member"; }
}

function serviceTokenProvider(options: StreamWeaverWebControlOptionsV1) {
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    const response = await (options.fetchImpl ?? fetch)(`${options.spmtOrigin.replace(/\/$/, "")}/v1/auth/service-token`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ serviceId: "streamweaver", credential: options.credential }), redirect: "manual", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`StreamWeaver authentication failed (${response.status})`);
    const value = await response.json() as { accessToken?: unknown; accessExpiresAt?: unknown };
    if (typeof value.accessToken !== "string" || typeof value.accessExpiresAt !== "string") throw new Error("StreamWeaver authentication returned an invalid token");
    cached = { token: value.accessToken, expiresAt: Date.parse(value.accessExpiresAt) }; return cached.token;
  };
}
function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown, name: string, max: number) { const result = String(value ?? "").replace(/\0/g, "").trim(); if (!result || result.length > max) throw new Error(`${name} is required`); return result; }
function optionalText(value: unknown, max: number) { const result = String(value ?? "").replace(/\0/g, "").trim(); if (result.length > max) throw new Error("Value is too long"); return result; }
function identifier(value: unknown, name: string) { const result = String(value ?? "").trim(); if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(result)) throw new Error(`${name} is invalid`); return result; }
function integer(value: unknown, min: number, max: number, name: string) { const result = Number(value); if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name} is invalid`); return result; }
function destinationValue(value: unknown): "private" | "ai" | "twitch" | "discord" { if (value !== "private" && value !== "ai" && value !== "twitch" && value !== "discord") throw new Error("Voice destination is invalid"); return value; }
function idempotency(value: unknown, prefix: string) { const result = String(value ?? "").trim(); return result && /^[A-Za-z0-9._:@/-]{1,300}$/.test(result) ? result : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
function suiteActionReady(workers: ExecutionWorkerProjectionV1[], tenantId: string, capabilityId: string) { const now = Date.now(); return workers.some((worker) => worker.state === "ready" && worker.providerHealthy && worker.capabilityIds.includes(capabilityId) && Date.parse(worker.leaseExpiresAt) > now && (!worker.tenantIds?.length || worker.tenantIds.includes(tenantId))); }

export function parseStreamWeaverWebConnections(source: string | undefined): StreamWeaverWebConnectionV1[] {
  if (!source) return [];
  let value: unknown; try { value = JSON.parse(source); } catch { throw new Error("CHAT_GATEWAY_CONNECTIONS must be valid JSON"); }
  if (!Array.isArray(value) || value.length > 500) throw new Error("CHAT_GATEWAY_CONNECTIONS must be an array");
  return value.map((item) => {
    const row = record(item); if (!row || row.schemaVersion !== 1 || !["twitch", "discord", "kick"].includes(String(row.provider)) || typeof row.desired !== "boolean") throw new Error("CHAT_GATEWAY_CONNECTIONS contains an invalid connection");
    return { schemaVersion: 1, tenantId: identifier(row.tenantId, "tenantId"), provider: row.provider as ChatProviderV1, connectionId: identifier(row.connectionId, "connectionId"), channelId: identifier(row.channelId, "channelId"), providerAccountId: identifier(row.providerAccountId, "providerAccountId"), desired: row.desired };
  });
}
