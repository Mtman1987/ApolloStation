import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchAppPlatformSnapshot, fetchAppSessionContext, readJsonBody, requireSameOrigin, safeError, sendJson } from "@spmt/app-foundation/product-web";
import { SpmtClient } from "@spmt/sdk";
import { routeSpmtSuiteAction, spmtSuiteActionDescriptor, type ChatProviderV1, type ExecutionWorkerProjectionV1, type NormalizedChatDeliveryV1, type SpmtOperationModeV1 } from "@spmt/contracts";
import { STREAMWEAVER_BOT_ACTION_CATALOG, detectStreamWeaverBotAction } from "./bot-action-runtime.js";
import { MemoryStreamWeaverCommandState } from "./command-router.js";
import { StreamWeaverDonorCommandConsumer } from "./donor-command-runtime.js";
import { DefaultStreamWeaverDonorCommandServices } from "./donor-command-services.js";
import { DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS, SqliteStreamWeaverEconomyStore, StreamWeaverEconomy } from "./economy.js";
import { StreamWeaverInstalledFlowConsumer } from "./flow-runtime.js";
import { StreamWeaverPersonaSettingsStore } from "./persona-settings.js";
import { StreamWeaverFlowPackageStore, normalizeFlowPackage } from "./flow-packages.js";

export interface StreamWeaverWebConnectionV1 { schemaVersion: 1; tenantId: string; provider: ChatProviderV1; connectionId: string; channelId: string; providerAccountId: string; desired: boolean; }
export interface StreamWeaverWebControlOptionsV1 { spmtOrigin: string; databasePath?: string; credential?: string; connections?: StreamWeaverWebConnectionV1[]; operationMode?: SpmtOperationModeV1; fetchImpl?: typeof fetch; }
type SessionContext = Awaited<ReturnType<typeof fetchAppSessionContext>>;

/** Authenticated app API behind Voice Commander, persona, economy, and integration pages. */
export class StreamWeaverWebControls {
  private readonly persona?: StreamWeaverPersonaSettingsStore;
  private readonly economy?: SqliteStreamWeaverEconomyStore;
  private readonly client?: SpmtClient;
  private readonly flows?: StreamWeaverFlowPackageStore;
  private readonly operationMode: SpmtOperationModeV1;

  constructor(private readonly options: StreamWeaverWebControlOptionsV1) {
    this.operationMode = options.operationMode ?? "active";
    if (options.databasePath) { this.persona = new StreamWeaverPersonaSettingsStore(options.databasePath); this.economy = new SqliteStreamWeaverEconomyStore(options.databasePath); this.flows = new StreamWeaverFlowPackageStore(options.databasePath); }
    if (options.credential) {
      const getAccessToken = serviceTokenProvider(options);
      this.client = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "streamweaver", getAccessToken, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
    }
  }

  close() { this.flows?.close(); this.persona?.close(); this.economy?.close(); }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/streamweaver/control")) return false;
    try {
      const context = await fetchAppSessionContext({ appId: "streamweaver", spmtOrigin: this.options.spmtOrigin, request });
      if (request.method === "GET" && url.pathname === "/api/streamweaver/control") return await this.read(request, response, context);
      if (request.method === "GET" && url.pathname === "/api/streamweaver/control/flows") return this.readFlows(response, context);
      if (request.method === "GET" && /^\/api\/streamweaver\/control\/flows\/[^/]+\/export\/streamerbot$/.test(url.pathname)) return this.exportFlow(response, context, decodeURIComponent(url.pathname.split("/").at(-3) ?? ""), "streamerbot");
      if (request.method === "GET" && /^\/api\/streamweaver\/control\/flows\/[^/]+\/export$/.test(url.pathname)) return this.exportFlow(response, context, decodeURIComponent(url.pathname.split("/").at(-2) ?? ""));
      if (request.method === "GET" && /^\/api\/streamweaver\/control\/voice\/jobs\/[^/]+$/.test(url.pathname)) return await this.job(response, context, decodeURIComponent(url.pathname.split("/").at(-1) ?? ""));
      if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
      requireSameOrigin(request);
      const body = await readJsonBody(request);
      if (url.pathname === "/api/streamweaver/control/voice") return await this.voice(response, context, body);
      this.requireOwner(context);
      if (url.pathname === "/api/streamweaver/control/flows/install") return this.installFlow(response, context, body);
      if (url.pathname === "/api/streamweaver/control/flows/uninstall") return this.uninstallFlow(response, context, body);
      if (url.pathname === "/api/streamweaver/control/flows/import") return this.importFlow(response, context, body);
      if (url.pathname === "/api/streamweaver/control/flows/approve") return this.approveFlow(response, context, body);
      if (url.pathname === "/api/streamweaver/control/flows/publish") return this.publishFlow(response, context, body);
      if (url.pathname === "/api/streamweaver/control/flows/preview") return await this.previewFlow(response, context, body);
      if (url.pathname === "/api/streamweaver/control/flows/ai") return await this.requestAiFlow(response, context, body);
      if (url.pathname === "/api/streamweaver/control/flows/ai/complete") return await this.completeAiFlow(response, context, body);
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
    const botActions = STREAMWEAVER_BOT_ACTION_CATALOG.map((action) => ({ ...action, policy: this.operationMode === "read-only" && action.risk !== "read" ? "simulated" as const : "allowed" as const, availability: (this.operationMode === "read-only" && action.id === "sw.image.generate") || suiteActionReady(suiteWorkers, tenantId, routeSpmtSuiteAction(action.id).capabilityId) ? "connected" as const : "setup-required" as const }));
    const connectedSuiteActions = botActions.filter((action) => action.availability === "connected").length;
    const suiteActions = connectedSuiteActions === botActions.length ? "connected" : connectedSuiteActions ? "partial" : "setup-required";
    const personaDocument = this.persona?.read(tenantId) ?? null;
    const persona = this.persona?.get(tenantId) ?? null;
    const economySettings = this.economy?.getSettings(tenantId) ?? DEFAULT_STREAMWEAVER_GAMBLE_SETTINGS;
    const wallet = this.economy && actorId ? this.economy.getWallet(tenantId, actorId) : null;
    const connections = (this.options.connections ?? []).filter((item) => item.tenantId === tenantId && item.desired).map(({ provider, connectionId, channelId, providerAccountId }) => ({ provider, connectionId, channelId, providerAccountId }));
    const installedFlows = this.flows?.listInstalledPackages(tenantId) ?? [];
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
      flows: { installed: installedFlows.length, community: this.flows?.listCommunity().length ?? 0 },
    });
  }

  private readFlows(response: ServerResponse, context: SessionContext) {
    const store = this.requireFlows(), installed = store.listInstalls(context.tenantId), installedIds = new Set(installed.map((item) => item.packageId));
    const community = store.listCommunity().map((item) => ({ ...item, installed: installedIds.has(item.packageId) }));
    const drafts = store.listTenantPackages(context.tenantId).filter((item) => item.visibility === "private").map((item) => ({ ...item, installed: installedIds.has(item.packageId) }));
    return sendJson(response, 200, { schemaVersion: 1, tenantId: context.tenantId, installed, community, drafts, startsEmpty: true });
  }

  private installFlow(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) { const install=this.requireFlows().install(context.tenantId,identifier(body.packageId,"packageId"));return sendJson(response,200,{schemaVersion:1,install}); }
  private uninstallFlow(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) { const removed=this.requireFlows().uninstall(context.tenantId,identifier(body.packageId,"packageId"));return sendJson(response,200,{schemaVersion:1,removed}); }
  private importFlow(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) { const actor=this.actor(context),result=this.requireFlows().importPackage(context.tenantId,body.package,actor);return sendJson(response,200,{schemaVersion:1,...result}); }
  private approveFlow(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) { const result=this.requireFlows().approveAndInstall(context.tenantId,identifier(body.packageId,"packageId"));return sendJson(response,200,{schemaVersion:1,...result}); }
  private publishFlow(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) { const value=this.requireFlows().publish(context.tenantId,identifier(body.packageId,"packageId"),this.actor(context));return sendJson(response,200,{schemaVersion:1,package:value}); }
  private exportFlow(response: ServerResponse, context: SessionContext, packageId: string, format: "streamweaver" | "streamerbot" = "streamweaver") { const store=this.requireFlows(),value=format==="streamerbot"?store.exportStreamerBot(context.tenantId,packageId):store.exportPackage(context.tenantId,packageId);response.setHeader("content-disposition",`attachment; filename="${packageId.replace(/[^A-Za-z0-9._-]/g,"-")}.${format}.json"`);return sendJson(response,200,value); }

  private async previewFlow(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const store=this.requireFlows(),client=this.requireClient(),packageId=identifier(body.packageId,"packageId"),item=store.get(context.tenantId,packageId);
    if(!item)throw new Error("Flow package does not exist or is not visible to this tenant");
    const commandId=body.commandId===undefined?(item.commands.find((entry)=>entry.role==="primary")?.id??item.commands[0]?.id):identifier(body.commandId,"commandId"),command=item.commands.find((entry)=>entry.id===commandId);
    if(!command)throw new Error("Flow preview command does not exist");
    const provider=simulationProvider(body.provider),messageText=optionalText(body.message,8_000)||command.trigger,actor=this.actor(context),now=new Date().toISOString(),nonce=`${Date.now()}:${Math.random().toString(36).slice(2)}`,roomId=`streamweaver:flow-builder:${actor.id}`;
    const mentionName=messageText.match(/(?:^|\s)@([A-Za-z0-9_]{1,40})/)?.[1];
    const delivery:NormalizedChatDeliveryV1={schemaVersion:1,deliveryId:`simulation:${nonce}`,consumerId:"streamweaver.installed-flows",attempts:1,message:{schemaVersion:1,tenantId:context.tenantId,provider,connectionId:"simulation",channelId:roomId,messageId:`simulation:${nonce}`,text:messageText,occurredAt:now,actor:{providerUserId:actor.id,canonicalUserId:actor.id,username:actor.displayName,displayName:actor.displayName,isBot:false,roles:["broadcaster"]},mentions:mentionName?[{token:`@${mentionName}`,providerUserId:`simulation:${mentionName}`,username:mentionName}]:[]}};
    const state=new MemoryStreamWeaverCommandState(),egress={send:async()=>({providerMessageId:`simulation:${nonce}`})},native=new StreamWeaverDonorCommandConsumer({services:new DefaultStreamWeaverDonorCommandServices({}),identities:{resolve:()=>actor.id},state,egress,nowMs:()=>Date.parse(now)}),runtime=new StreamWeaverInstalledFlowConsumer(store,state,egress,undefined,native),preview=await runtime.preview(item,command.id,delivery);
    const inputEvent=await client.publishSimulationRoomEvent(context.tenantId,{roomId,lane:"chat",direction:"ingress",title:`${command.trigger} preview input`,body:messageText,provider,connectionId:"simulation",channelId:roomId,data:{packageId,commandId:command.id}},`flow-preview:${nonce}:input`);
    const events=[];
    for(const [index,output] of preview.outputs.entries()){
      const lane=output.type==="obs-scene"||output.type==="obs-source"?"overlay":output.type==="send-chat"||output.type==="send-discord"||output.type==="run-native"?"chat":"app";
      events.push(await client.publishSimulationRoomEvent(context.tenantId,{roomId,lane,direction:lane==="chat"?"egress":"preview",title:`${command.trigger} · ${output.type}`,body:output.text,provider,connectionId:"simulation",channelId:roomId,replyToMessageId:delivery.message.messageId,data:{packageId,commandId:command.id,actionId:output.actionId,actionType:output.type}},`flow-preview:${nonce}:output:${index}`));
    }
    if(!preview.outputs.length)events.push(await client.publishSimulationRoomEvent(context.tenantId,{roomId,lane:"app",direction:"preview",title:`${command.trigger} completed`,body:"This command completed without a visible output.",data:{packageId,commandId:command.id}},`flow-preview:${nonce}:empty`));
    return sendJson(response,200,{schemaVersion:1,roomId,packageId,command:preview.command,input:messageText,outputs:preview.outputs,events:[inputEvent,...events]});
  }

  private async requestAiFlow(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    if (this.operationMode === "read-only") return sendJson(response, 200, { schemaVersion: 1, status: "blocked", reason: "Live-read mode accepts incoming data but does not send an AI request." });
    const idea=text(body.idea,"idea",4_000),client=this.requireClient(),userId=String(context.session.actorId??"");
    const prompt=["You are the StreamWeaver flow builder inside the SPMT developer platform.","Return one strict JSON object only. Do not use markdown.","Build exactly one disabled, reviewable StreamWeaver flow package. One package is one independently importable feature, but it may include the primary command plus only the required or optional add-on commands that make that feature work. Never return an unrelated command library.","Use kind streamweaver.flow-package, schemaVersion 1, installUnit flow, visibility private, commands[], actions[].",'Supported action types: send-chat, send-discord, wait, run-action, run-native, http-request, set-variable, execute-code, obs-scene, obs-source.',"For cross-app work use run-action with config.action and config.args so SPMT can route it to the app that registered the typed capability. Do not reimplement built-in AI or economy features.","For visual work use an overlay step that references a registered widget; Overlay Bay owns final Public/Personal composition.","Exactly one command must have role=primary and required=true. Add-on commands use role=addon. Every command must include id, trigger, aliases, role, required, actionIds, family, cooldownSeconds, matcher, runtime=flow, enabled=false. Every action must have id, type, enabled=false, config. Every actionId must reference an action in this package and no action may be orphaned.",`User request: ${idea}`].join("\n");
    const result=await client.invokeCommunityAssistant(context.tenantId,{userId,message:prompt,surface:"app",conversationId:`streamweaver:flow-builder:${userId}`,routingPreference:"automatic",remember:false},idempotency(body.idempotencyKey,"streamweaver-flow-ai"));
    return sendJson(response,result.status==="accepted"?202:503,{...result,kind:"flow-builder"});
  }

  private async completeAiFlow(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const jobId=identifier(body.jobId,"jobId"),job=await this.requireClient().getExecutionJob(context.tenantId,jobId),userId=String(context.session.actorId??"");
    if (job.billedUserId!==userId) throw new Error("AI flow job is not visible to this user");
    if (job.state!=="succeeded") return sendJson(response,202,{schemaVersion:1,state:job.state,jobId});
    const result=record(job.result),raw=String(result?.text??record(result?.output)?.text??""),parsed=parseJsonObject(raw),candidate=record(record(parsed)?.package)??parsed;
    const normalized=normalizeFlowPackage(candidate,{now:new Date().toISOString(),author:this.actor(context),visibility:"private"});
    const saved=this.requireFlows().saveDraft(context.tenantId,normalized,this.actor(context));
    return sendJson(response,200,{schemaVersion:1,state:"succeeded",package:saved});
  }

  private async voice(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const message = text(body.message, "message", 5_000), destination = destinationValue(body.destination);
    const detected = detectStreamWeaverBotAction(message);
    const userId = String(context.session.actorId ?? "");
    if (!userId) throw new Error("The signed-in user identity is unavailable");
    if (detected) {
      const descriptor = spmtSuiteActionDescriptor(detected.action);
      const client = this.requireClient();
      const provider: "twitch" | "discord" | undefined = destination === "twitch" || destination === "discord" ? destination : undefined;
      const connection = provider ? this.connection(context.tenantId, provider, body.connectionId) : undefined;
      const requestId = idempotency(body.idempotencyKey, "streamweaver-suite-source"), roomId = connection && provider ? `${provider}:${connection.connectionId}:${connection.channelId}` : `streamweaver:voice-commander:${userId}`;
      if (this.operationMode === "read-only") await client.publishSimulationRoomEvent(context.tenantId, { roomId, lane: "app", direction: "preview", title: `${detected.action} Voice Commander input`, body: message, ...(provider ? { provider } : {}), ...(connection ? { connectionId: connection.connectionId, channelId: connection.channelId } : {}), data: { action: detected.action, risk: descriptor.risk, phase: "routed", arguments: Object.entries(detected.args).map(([name, value]) => ({ name, value })) } }, `voice-simulation:${requestId}:routed`);
      if (this.operationMode === "read-only" && detected.action === "sw.image.generate") return sendJson(response, 200, { schemaVersion: 1, kind: "preview", status: "simulated", operationMode: this.operationMode, action: detected.action, risk: descriptor.risk, roomId, reason: "Image generation was previewed without contacting an external image provider." });
      const result = await client.createSuiteActionJob(context.tenantId, { schemaVersion: 1, action: detected.action, args: detected.args, actor: { userId, username: String(context.session.username ?? context.session.displayName ?? userId), role: this.role(context) }, source: { kind: "voice-commander", ...(connection && provider ? { provider, channelId: connection.channelId, connectionId: connection.connectionId } : {}), requestId, ...(this.operationMode === "read-only" ? { simulation: true } : {}) } }, idempotency(body.idempotencyKey, "streamweaver-suite-action"));
      return sendJson(response, 202, { schemaVersion: 1, kind: "suite-action", action: detected.action, duplicate: result.duplicate, jobId: result.job.id, state: result.job.state });
    }
    if (this.operationMode === "read-only" && (destination === "ai" || destination === "private")) return sendJson(response, 200, { schemaVersion: 1, kind: "preview", status: "blocked", operationMode: this.operationMode, destination, reason: "Shadow mode does not send live chat data to an external assistant. Choose a provider destination to deliver into its internal shadow room." });
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
  private requireFlows() { if (!this.flows) throw new Error("StreamWeaver flow storage is not configured"); return this.flows; }
  private actor(context: SessionContext) { const id=String(context.session.actorId??"");return{id,displayName:String(context.session.username??context.session.displayName??id)}; }
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
function simulationProvider(value: unknown): ChatProviderV1 { const provider=String(value??"twitch");if(provider!=="twitch"&&provider!=="discord"&&provider!=="kick")throw new Error("Simulation provider is invalid");return provider; }
function idempotency(value: unknown, prefix: string) { const result = String(value ?? "").trim(); return result && /^[A-Za-z0-9._:@/-]{1,300}$/.test(result) ? result : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
function suiteActionReady(workers: ExecutionWorkerProjectionV1[], tenantId: string, capabilityId: string) { const now = Date.now(); return workers.some((worker) => worker.state === "ready" && worker.providerHealthy && worker.capabilityIds.includes(capabilityId) && Date.parse(worker.leaseExpiresAt) > now && (!worker.tenantIds?.length || worker.tenantIds.includes(tenantId))); }
function parseJsonObject(value:string){const trimmed=value.trim();try{return JSON.parse(trimmed) as unknown;}catch{}const fenced=trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];if(fenced)try{return JSON.parse(fenced) as unknown;}catch{}const start=trimmed.indexOf("{"),end=trimmed.lastIndexOf("}");if(start>=0&&end>start)try{return JSON.parse(trimmed.slice(start,end+1)) as unknown;}catch{}throw new Error("AI response did not contain a valid flow package JSON object");}

export function parseStreamWeaverWebConnections(source: string | undefined): StreamWeaverWebConnectionV1[] {
  if (!source) return [];
  let value: unknown; try { value = JSON.parse(source); } catch { throw new Error("CHAT_GATEWAY_CONNECTIONS must be valid JSON"); }
  if (!Array.isArray(value) || value.length > 500) throw new Error("CHAT_GATEWAY_CONNECTIONS must be an array");
  return value.map((item) => {
    const row = record(item); if (!row || row.schemaVersion !== 1 || !["twitch", "discord", "kick"].includes(String(row.provider)) || typeof row.desired !== "boolean") throw new Error("CHAT_GATEWAY_CONNECTIONS contains an invalid connection");
    return { schemaVersion: 1, tenantId: identifier(row.tenantId, "tenantId"), provider: row.provider as ChatProviderV1, connectionId: identifier(row.connectionId, "connectionId"), channelId: identifier(row.channelId, "channelId"), providerAccountId: identifier(row.providerAccountId, "providerAccountId"), desired: row.desired };
  });
}
