import { DshPlaywrightNebulaGameplayRenderer } from "./nebula-gameplay-renderer.js";
import { DshNebulaGameplayCaptureWorker } from "./nebula-gameplay-worker.js";
import { SqliteDshRoleAwareBannerService, DshRoleAwareBannerMediaSource } from "./banner-generation.js";
import { DshClipAcquisitionWorker } from "./clip-acquisition.js";
import { SqliteDshClipGifStore, DshClipGifSpotlightMediaSource } from "./clip-gif-library.js";
import { SqliteDshSignalSeekerStore, dshSignalSeekerPanelPayload, dshSignalDropInteractionPayload, dshSignalDropClue } from "./signal-seeker.js";
import { DshMtFixItIntake } from "./mtfixit-intake.js";
import { DshMemberDirectoryStore, DshMemberDirectoryWorker } from "./member-directory.js";
import {DshOnboardingPanel} from "./onboarding-panel.js";
import { DshMemberActivityStore, DshMemberActivityWorker } from "./member-activity.js";
import { DshPartnerSchedules } from "./partner-schedules.js";
import { DshChannelCleanup } from "./channel-cleanup.js";
import { DshChannelModerationService } from "./channel-moderation.js";
import { DshApplicationDecisionService } from "./application-decision.js";
import { dshEmbedTemplateOverrides, dshHttps, type DshEmbedTemplates } from "./shoutout-presentation.js";
import { DshNebulaMediaWorker } from "./nebula-media-worker.js";
import { DshCalendarDelivery } from "./calendar-delivery.js";
import { DshCalendarSync } from "./calendar-sync.js";
import { readFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { parseExecutionTargetV1, type ExecutionTargetV1, type SpmtOperationModeV1 } from "@spmt/contracts";
import { SpmtApiError, SpmtClient, buildXpIdempotencyKey } from "@spmt/sdk";
import {
  DshDiscordApi,
  DshDiscordLivePublisher,
  SqliteDshDiscordMessageStore,
  type DshDiscordBrandingSourceV1,
  type DshDiscordGrantSourceV1,
} from "./discord-live-publisher.js";
import { DshLiveRuntime, SqliteDshLiveMonitor, type DshLiveMemberV1 } from "./live-monitor.js";
import { DshTwitchLivePoller, TwitchHelixLiveClient, type DshLiveMemberDirectoryV1, type DshTwitchGrantSourceV1 } from "./twitch-live-poller.js";
import { SqliteDshCalendarStore } from "./calendar.js";
import { SqliteDshApplicationStore } from "./applications.js";
import { DshBotActionAdapter } from "./bot-action-adapter.js";
import { DshSuiteActionOperations } from "./suite-action-operations.js";
import { DshSuiteActionWorker } from "./suite-action-worker.js";
import { DshSimulationRoomDiscordTransport } from "./simulation-room.js";
import { DshTenantSettingsStore } from './settings.js';
import { dshShoutoutGroupSlug } from './shoutout-groups.js';
import { dshSystemLiveChannelByLogin } from "./system-live-channels.js";
import { DshRaidPileStore, DEFAULT_DSH_RAID_PILE_SETTINGS } from "./raid-pile.js";
import { DshPointsEventRouter, type DshProviderPointsEventV1 } from "./points-event-router.js";
import { DshPointsService } from "./points.js";
import { DshSpmtIdentityResolver } from "./provider-identity.js";
import { DshForumForwardingStore, DshForumForwardingWorker } from "./forum-forwarding.js";

export interface DshLiveRuntimeTenantV1 {
  tenantId: string;
  twitchProviderUserId: string;
  discordProviderUserId: string;
  discordGuildIds?: string[];
  branding: { communityMemberName: string; spotlightChannelId?: string; onboardingCustomId?: string; embedTemplates?: DshEmbedTemplates };
  members: DshLiveMemberV1[];
}

export interface DshLiveRuntimeConfigV1 {
  schemaVersion: 1;
  pollIntervalSeconds: number;
  tenants: DshLiveRuntimeTenantV1[];
}

export interface DshLiveWorkerEnvironmentV1 {
  runtimeMode: "production" | "sandbox";
  operationMode: SpmtOperationModeV1;
  liveIngressEnabled: boolean;
  spmtOrigin: string;
  publicOrigin?:string;
  databasePath: string;
  configPath: string;
  credential: string;
  workerId: string;
  executionTarget?: ExecutionTargetV1;
  applicationInteractionsReady: boolean;
  config: DshLiveRuntimeConfigV1;
}

export type DshLiveWorkerTenantResultV1 =
  | { tenantId: string; status: "completed"; liveCount: number; memberCount: number; delivered: number; failed: number }
  | { tenantId: string; status: "reauthorization-required" | "unavailable"; reason: string };

export function loadDshLiveRuntimeConfig(path: string): DshLiveRuntimeConfigV1 {
  if (!isAbsolute(path)) throw new Error("DSH_RUNTIME_CONFIG_PATH must be absolute");
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("DSH runtime config must be readable JSON"); }
  return validateRuntimeConfig(parsed);
}

export function validateDshLiveWorkerEnvironment(environment: NodeJS.ProcessEnv): DshLiveWorkerEnvironmentV1 {
  const runtimeMode = environment.SPMT_RUNTIME_MODE === "sandbox" ? "sandbox" : "production";
  const operationMode: SpmtOperationModeV1 = environment.SPMT_OUTBOUND_MODE === "disabled" ? "read-only" : "active";
  const liveIngressEnabled = environment.SPMT_LIVE_INGRESS_MODE === "enabled";
  const spmtOrigin = loopbackOrigin(environment.SPMT_ORIGIN ?? "");
  const databasePath = environment.DSH_DATABASE_PATH ?? "";
  if (!databasePath || !isAbsolute(databasePath)) throw new Error("DSH_DATABASE_PATH must be absolute");
  const configPath = environment.DSH_RUNTIME_CONFIG_PATH ?? "";
  if (!configPath || !isAbsolute(configPath)) throw new Error("DSH_RUNTIME_CONFIG_PATH must be absolute");
  const credential = environment.DSH_WORKER_CREDENTIAL ?? "";
  if (credential.length < 32) throw new Error("A 32+ character DSH_WORKER_CREDENTIAL is required");
  const workerId = identifier(environment.DSH_WORKER_ID ?? `discord-stream-hub-${process.pid}`, "DSH_WORKER_ID");
  const config = loadDshLiveRuntimeConfig(configPath);
  if (runtimeMode === "sandbox") {
    if (operationMode !== "read-only") throw new Error("Sandbox DSH requires SPMT_OUTBOUND_MODE=disabled");
    if (!basename(databasePath).toLowerCase().includes("sandbox")) throw new Error("Sandbox DSH requires a sandbox-named database");
    if (!basename(configPath).toLowerCase().includes("sandbox")) throw new Error("Sandbox DSH requires a sandbox-named runtime config");
    if (config.tenants.length && !liveIngressEnabled) throw new Error("Sandbox DSH rejects live provider tenants unless SPMT_LIVE_INGRESS_MODE=enabled");
  }
  if (liveIngressEnabled && operationMode !== "read-only") throw new Error("Live ingress requires SPMT_OUTBOUND_MODE=disabled");
  return { runtimeMode, operationMode, liveIngressEnabled, spmtOrigin, ...(environment.SPMT_PUBLIC_ORIGIN?{publicOrigin:environment.SPMT_PUBLIC_ORIGIN}:{}), databasePath, configPath, credential, workerId, applicationInteractionsReady: Boolean(environment.DSH_DISCORD_PUBLIC_KEY && environment.SPMT_PUBLIC_ORIGIN), config };
}

/** Authenticates DSH without sharing Chat Gateway's service credential. */
export function createDshWorkerTokenProvider(options: { spmtOrigin: string; credential: string; fetchImpl?: typeof fetch }) {
  const origin = loopbackOrigin(options.spmtOrigin);
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    const response = await (options.fetchImpl ?? fetch)(`${origin}/v1/auth/service-token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ serviceId: "discord-stream-hub", credential: options.credential }),
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Discord Stream Hub authentication failed (${response.status})`);
    const value = await response.json() as { accessToken?: unknown; accessExpiresAt?: unknown };
    if (typeof value.accessToken !== "string" || typeof value.accessExpiresAt !== "string" || !Number.isFinite(Date.parse(value.accessExpiresAt))) throw new Error("Discord Stream Hub authentication returned an invalid token");
    cached = { token: value.accessToken, expiresAt: Date.parse(value.accessExpiresAt) };
    return cached.token;
  };
}

export class ConfigDirectory implements DshLiveMemberDirectoryV1, DshDiscordBrandingSourceV1 {
  private readonly tenants = new Map<string, DshLiveRuntimeTenantV1>();
  constructor(private readonly config: DshLiveRuntimeConfigV1, private readonly settings?: DshTenantSettingsStore, private readonly memberDirectory?: DshMemberDirectoryStore) { config.tenants.forEach((tenant) => this.tenants.set(tenant.tenantId, tenant)); }
  async listLiveTrackedMembers(tenantId: string) { this.require(tenantId); const saved = this.settings?.read(tenantId); return (this.memberDirectory?.trackedMembers(tenantId) ?? structuredClone(this.require(tenantId).members)).map(member => ({ ...member, spotlightEligible: dshSystemLiveChannelByLogin(member.twitchLogin)?.spotlightEligible ?? member.spotlightEligible ?? true, shoutoutChannelId: saved?.groupChannels[dshShoutoutGroupSlug(member.group) || ''] || member.shoutoutChannelId })); }
  members(tenantId: string, guild?: string) { this.require(tenantId); return this.memberDirectory?.members(tenantId, guild) ?? structuredClone(this.require(tenantId).members); }
  getBranding(tenantId: string) { const saved = this.settings?.read(tenantId), base = structuredClone(this.require(tenantId).branding); return { ...base, ...(saved?.spotlightChannelId ? { spotlightChannelId: saved.spotlightChannelId } : {}), ...(saved?.embedTemplates ? { embedTemplates: saved.embedTemplates } : {}), ...(saved ? { spotlightEnabled: saved.spotlightEnabled, groupChannels: saved.groupChannels } : {}) }; }
  getPollSettings(tenantId: string) { const saved = this.settings?.read(tenantId); return { intervalSeconds: saved?.revision ? saved.pollIntervalSeconds : this.config.pollIntervalSeconds, revision: saved?.revision ?? 0, spotlightEnabled: saved?.spotlightEnabled ?? true }; }
  providerUserId(tenantId: string, provider: "twitch" | "discord") { const tenant = this.require(tenantId); return provider === "twitch" ? tenant.twitchProviderUserId : tenant.discordProviderUserId; }
  private require(tenantId: string) { const value = this.tenants.get(tenantId); if (!value) throw new Error(`DSH tenant ${tenantId} is not configured`); return value; }
}

export class SpmtDshTwitchGrantSource implements DshTwitchGrantSourceV1 {
  constructor(private readonly client: SpmtClient, private readonly directory: ConfigDirectory) {}
  async getClipGrant(tenantId:string){
    try{
      const grant=await this.client.issueProviderGrant(tenantId,"twitch",this.directory.providerUserId(tenantId,"twitch"),"dsh-clip-media",["clips:read"],300);
      const clientId=grant.credential.metadata.clientId;
      if(!clientId)return {status:"reauthorization-required" as const,reason:"Twitch grant does not include its public client id"};
      return {status:"ready" as const,clientId,accessToken:grant.credential.accessToken,expiresAt:grant.expiresAt};
    }catch(error){
      if(error instanceof SpmtApiError&&error.status===403)return {status:"reauthorization-required" as const,reason:"Twitch clips are not authorized for Discord Stream Hub"};
      if(error instanceof SpmtApiError&&error.status===503)return {status:"unavailable" as const,reason:"SPMT could not issue a Twitch clips grant"};
      throw error;
    }
  }
  async getGrant(tenantId: string) {
    try {
      const grant = await this.client.issueProviderGrant(tenantId, "twitch", this.directory.providerUserId(tenantId, "twitch"), "dsh-live-monitor", ["streams:read"], 300);
      const clientId = grant.credential.metadata.clientId;
      if (!clientId) return { status: "reauthorization-required" as const, reason: "Twitch grant does not include its public client id" };
      return { status: "ready" as const, clientId, accessToken: grant.credential.accessToken, expiresAt: grant.expiresAt };
    } catch (error) {
      if (error instanceof SpmtApiError && error.status === 403) return { status: "reauthorization-required" as const, reason: "Twitch is no longer authorized for Discord Stream Hub" };
      if (error instanceof SpmtApiError && error.status === 503) return { status: "unavailable" as const, reason: "SPMT could not issue a current Twitch grant" };
      throw error;
    }
  }
}

export class SpmtDshDiscordGrantSource implements DshDiscordGrantSourceV1 {
  constructor(private readonly client: SpmtClient, private readonly directory: ConfigDirectory) {}
  async getGrant(input: { tenantId: string; capability: "messages:write" | "channels:read" | "guilds:read" | "guilds:write" | "events:read" | "events:write" }) {
    const grant = await this.client.issueProviderGrant(input.tenantId, "discord", this.directory.providerUserId(input.tenantId, "discord"), "dsh-discord-live", [input.capability], 300);
    const scheme = grant.credential.metadata.authorizationScheme ?? "Bot";
    if (scheme !== "Bot" && scheme !== "Bearer") throw new Error("Discord grant authorization scheme is invalid");
    return { authorization: `${scheme} ${grant.credential.accessToken}`, expiresAt: grant.expiresAt };
  }
}

/** Composes the frozen DSH monitor and Discord publisher into one supervised worker. */
export class SupervisedDshLiveService {
  private readonly getAccessToken: () => Promise<string>;
  private readonly client: SpmtClient;
  private readonly monitor: SqliteDshLiveMonitor;
  private readonly messages: SqliteDshDiscordMessageStore;
  private readonly cleanup:DshChannelCleanup;
  private readonly calendar: SqliteDshCalendarStore;
  private readonly calendarSync: DshCalendarSync;
  private readonly calendarDelivery:DshCalendarDelivery;
  private readonly partnerSchedules:DshPartnerSchedules;
  private readonly onboarding?:DshOnboardingPanel;
  private readonly activityStore:DshMemberActivityStore;
  private readonly activity:DshMemberActivityWorker;
  private readonly mtFixIt:DshMtFixItIntake;
  private readonly forumForwardingStore:DshForumForwardingStore;
  private readonly forumForwardingWorker:DshForumForwardingWorker;
  private readonly signalSeekers:SqliteDshSignalSeekerStore;
  private readonly liveDiscord:DshDiscordApi;
  private calendarCycle:Promise<void>|undefined;
  private readonly applications: SqliteDshApplicationStore;
  private readonly applicationDecisions: DshApplicationDecisionService;
  private readonly runtime: DshLiveRuntime;
  private readonly poller: DshTwitchLivePoller;
  private nebulaMediaCycle:Promise<void>|undefined;
  private readonly nebulaMediaAbort=new AbortController();
  private readonly nebulaMedia?:DshNebulaMediaWorker;
  private readonly nebulaGameplayCapture?:DshNebulaGameplayCaptureWorker;
  private readonly roleBanners?:DshRoleAwareBannerMediaSource;
  private readonly clipSpotlightMedia:DshClipGifSpotlightMediaSource;
  private readonly clipAcquisition:DshClipAcquisitionWorker;
  private readonly suiteActions: DshSuiteActionWorker;
  private readonly settings: DshTenantSettingsStore;
  private readonly raidPile: DshRaidPileStore;
  private readonly identities: DshSpmtIdentityResolver;
  private readonly pointsRouter: DshPointsEventRouter;
  private readonly directory: ConfigDirectory;
  private readonly memberDirectory: DshMemberDirectoryStore;
  private readonly memberSync: DshMemberDirectoryWorker;
  private readonly scheduledPeriods = new Map<string, string>();
  private activeCycle: Promise<{ schemaVersion: 1; skipped: false; results: DshLiveWorkerTenantResultV1[] }> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  constructor(private readonly options: DshLiveWorkerEnvironmentV1, fetchImpl: typeof fetch = fetch, private readonly now: () => string = () => new Date().toISOString()) {
    const executionTarget = options.executionTarget ?? parseExecutionTargetV1(process.env.STELLAR_EXECUTION_TARGET);
    this.getAccessToken = createDshWorkerTokenProvider({ spmtOrigin: options.spmtOrigin, credential: options.credential, fetchImpl });
    this.client = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "discord-stream-hub", getAccessToken: this.getAccessToken, fetchImpl });
    this.identities = new DshSpmtIdentityResolver(this.client);
    this.pointsRouter = new DshPointsEventRouter(this.identities, tenantId => new DshPointsService(this.client,tenantId,{getSettings:id=>{const saved=this.settings.read(id);return {raidPoints:saved.raidPoints,followPoints:saved.followPoints,subPoints:saved.subPoints,giftedSubPoints:saved.giftedSubPoints,bitPoints:saved.bitPoints,chatActivityPoints:saved.chatActivityPoints,firstMessagePoints:saved.firstMessagePoints,messageReactionPoints:saved.messageReactionPoints,adminEventPoints:saved.adminEventPoints,adminLogPoints:saved.adminLogPoints,adminMessagePoints:saved.adminMessagePoints};}}));
    if(options.operationMode==="active"&&options.publicOrigin)this.nebulaMedia=new DshNebulaMediaWorker(this.client,{databasePath:options.databasePath,publicOrigin:options.publicOrigin,workerId:`${options.workerId}-nebula-media`,tenantIds:options.config.tenants.map(tenant=>tenant.tenantId),executionTarget,sourceOrigins:(process.env.DSH_MEDIA_SOURCE_ORIGINS||"").split(",").filter(Boolean)},fetchImpl);
    const nebulaOrigin=String(process.env.NEBULA_ARCADE_PUBLIC_ORIGIN??"").trim();
    if(this.nebulaMedia&&nebulaOrigin){const manifestUrl=new URL("/v1/nebula/gameplay/showcase-manifest",nebulaOrigin);this.nebulaGameplayCapture=new DshNebulaGameplayCaptureWorker(options.databasePath,manifestUrl.toString(),new DshPlaywrightNebulaGameplayRenderer(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),fetchImpl);}
    this.activityStore=new DshMemberActivityStore(options.databasePath);this.activity=new DshMemberActivityWorker(this.activityStore,this.client,options.config,async(tenant,eventId,message)=>{await this.mtFixIt.handle(tenant,eventId,message);},this.pointsRouter);
    this.settings = new DshTenantSettingsStore(options.databasePath, now);
    this.memberDirectory = new DshMemberDirectoryStore(options.databasePath, options.config, this.settings);
    const directory = this.directory = new ConfigDirectory(options.config, this.settings, this.memberDirectory);
    this.monitor = new SqliteDshLiveMonitor(options.databasePath, options.config.pollIntervalSeconds * 1_000);
    this.raidPile = new DshRaidPileStore(options.databasePath, tenantId => { const saved=this.settings.read(tenantId); return { maxSize:saved.raidPileMaxSize??DEFAULT_DSH_RAID_PILE_SETTINGS.maxSize, minSize:saved.raidPileMinSize??DEFAULT_DSH_RAID_PILE_SETTINGS.minSize, pointsReward:saved.raidPilePointsReward??DEFAULT_DSH_RAID_PILE_SETTINGS.pointsReward, handoffHours:saved.raidPileHandoffHours??DEFAULT_DSH_RAID_PILE_SETTINGS.handoffHours, monthlyStrikeLimit:saved.raidPileMonthlyStrikeLimit??DEFAULT_DSH_RAID_PILE_SETTINGS.monthlyStrikeLimit }; }, now);
    this.messages = new SqliteDshDiscordMessageStore(options.databasePath);
    const liveDiscord = this.liveDiscord = new DshDiscordApi(new SpmtDshDiscordGrantSource(this.client, directory), fetchImpl);
    this.mtFixIt=new DshMtFixItIntake(this.client,liveDiscord,options.databasePath);
    this.signalSeekers = new SqliteDshSignalSeekerStore(options.databasePath, now);
    this.forumForwardingStore=new DshForumForwardingStore(options.databasePath);
    this.forumForwardingWorker=new DshForumForwardingWorker(this.forumForwardingStore,this.client,liveDiscord,tenantId=>options.config.tenants.find(tenant=>tenant.tenantId===tenantId)?.discordGuildIds??[]);
    this.cleanup=new DshChannelCleanup(options.databasePath,new DshChannelModerationService(liveDiscord.moderationPort()));
    const simulationDiscord = new DshSimulationRoomDiscordTransport(liveDiscord, this.client, { guildIds: (tenantId) => options.config.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds ?? [], now });
    const discord = options.operationMode === "read-only" ? simulationDiscord : new DshSimulationRoomDiscordTransport(liveDiscord, this.client, { guildIds: (tenantId) => options.config.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds ?? [], now, liveWrites: true });
    this.clipSpotlightMedia=new DshClipGifSpotlightMediaSource(new SqliteDshClipGifStore(options.databasePath),this.nebulaMedia);
    if(this.nebulaMedia)this.roleBanners=new DshRoleAwareBannerMediaSource(new SqliteDshRoleAwareBannerService(options.databasePath,this.nebulaMedia,now),this.nebulaMedia);
    this.clipAcquisition=new DshClipAcquisitionWorker(directory,new SpmtDshTwitchGrantSource(this.client,directory),new SqliteDshClipGifStore(options.databasePath),fetchImpl,()=>Date.parse(this.now()));
    const publisher = new DshDiscordLivePublisher(discord, this.messages, directory, this.clipSpotlightMedia, now,this.monitor.guests,this.roleBanners);
    this.runtime = new DshLiveRuntime(this.monitor, publisher);
    const twitchGrants=new SpmtDshTwitchGrantSource(this.client,directory),twitch=new TwitchHelixLiveClient(fetchImpl);
    this.memberSync = new DshMemberDirectoryWorker(this.memberDirectory, this.client, options.config, liveDiscord, twitchGrants, twitch, now);
    this.poller = new DshTwitchLivePoller(directory,twitchGrants,twitch,this.runtime);
    this.calendar = new SqliteDshCalendarStore(options.databasePath);
    this.calendarSync = new DshCalendarSync(options.databasePath, this.calendar, discord, now, options.publicOrigin);
    this.calendarDelivery=new DshCalendarDelivery(this.calendar,this.messages,discord,now,this.client,options.operationMode==="read-only");
    if(options.publicOrigin)this.onboarding=new DshOnboardingPanel(this.calendar,this.messages,discord,this.client,options.config,options.publicOrigin,now);
    this.partnerSchedules=new DshPartnerSchedules(this.calendar,this.messages,this.client,options.config,discord,fetchImpl,now,(tenant,guild)=>directory.members(tenant,guild));
    this.applications = new SqliteDshApplicationStore(options.databasePath);
    this.applicationDecisions=new DshApplicationDecisionService(this.applications,{discord,publicOrigin:options.publicOrigin,preview:options.operationMode==="read-only",now});
    const operations = new DshSuiteActionOperations({ memberSource:(tenant,guild)=>directory.members(tenant,guild), cleanup:this.cleanup,cleanupLiveWrites:options.operationMode==="active",guestLookup:async(tenantId,twitchLogin)=>{const grant=await twitchGrants.getGrant(tenantId);if(grant.status!=="ready")throw Error(grant.reason);return twitch.getGuest({...grant,twitchLogin});},config: options.config, monitor: this.monitor, messages: this.messages, calendar: this.calendar, applications: this.applications, discord, simulationDiscord, applicationInteractionsReady: options.applicationInteractionsReady, ...(options.publicOrigin?{publicOrigin:options.publicOrigin}:{}), now });
    this.suiteActions = new DshSuiteActionWorker(this.client, new DshBotActionAdapter(operations), { workerId: `${options.workerId}-suite-actions`, tenantIds: options.config.tenants.map((tenant) => tenant.tenantId), executionTarget });
  }
  async ready() { await this.getAccessToken(); return { schemaVersion: 1 as const, workerId: this.options.workerId, operationMode: this.options.operationMode, liveIngressEnabled: this.options.liveIngressEnabled, egressMode: this.options.operationMode === "read-only" ? "shadow" as const : "provider" as const, configuredTenants: this.options.config.tenants.length, pollIntervalSeconds: this.options.config.pollIntervalSeconds }; }
  async runOnce(scheduled = false): Promise<{ schemaVersion: 1; skipped: boolean; results: DshLiveWorkerTenantResultV1[] }> {
    if (this.closed) throw new Error("Discord Stream Hub worker is closed");
    if (this.activeCycle) return { schemaVersion: 1, skipped: true, results: [] };
    const cycle = this.executeCycle(scheduled);
    this.activeCycle = cycle;
    try { return await cycle; }
    finally { if (this.activeCycle === cycle) this.activeCycle = undefined; }
  }
  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      const due = this.options.config.tenants.some(tenant => this.scheduledPeriods.get(tenant.tenantId) !== this.period(tenant.tenantId));
      if (due) await this.runOnce(true);
      // Saved settings become visible without restarting or issuing extra provider polls.
      await pause(15000, signal);
    }
  }
  async runCalendar(signal:AbortSignal) {while(!signal.aborted&&!this.closed){const cycle=this.syncCalendars();this.calendarCycle=cycle;try{await cycle;}finally{this.calendarCycle=undefined;}await pause(5000,signal);}}
  private async syncCalendars(){for(const drop of this.signalSeekers.expire(this.now()))await this.liveDiscord.deleteMessage(drop.tenantId,drop.channelId,drop.messageId).catch(()=>undefined);for(const tenant of this.options.config.tenants){await this.processSignalCommands(tenant.tenantId).catch(()=>undefined);await this.memberSync.sync(tenant.tenantId).catch(()=>undefined);if(this.options.operationMode==="active"&&this.nebulaMedia)await this.clipAcquisition.runOnce(tenant.tenantId).catch(()=>undefined);await this.activity.runOnce(tenant.tenantId).catch(()=>undefined);await this.forumForwardingWorker.runOnce(tenant.tenantId).catch(()=>undefined);for(const guild of tenant.discordGuildIds??[]){const last=this.calendarSync.state(tenant.tenantId,guild).checkedAt;if(!last||Date.parse(this.now())-Date.parse(last)>=30000)await this.calendarSync.sync(tenant.tenantId,guild).catch(()=>undefined);}await this.onboarding?.flush(tenant.tenantId);await this.partnerSchedules.flush(tenant.tenantId);await this.calendarDelivery.flush(tenant.tenantId);await this.applicationDecisions.flush(tenant.tenantId);await this.runtime.flushGuests(tenant.tenantId,this.now());await this.processRaidPileHandoffs(tenant.tenantId);await this.processProviderPoints(tenant.tenantId);}}
  private async processSignalCommands(tenantId:string){
    if(this.options.operationMode!=="active")return;
    let cursor=this.signalSeekers.cursor(tenantId),processed=0,posted=0;
    if(!cursor){const latest=await this.client.listEvents(tenantId,{sourceAppId:"chat-gateway",limit:1});const latestId=String(latest[0]?.id??latest[0]?.eventId??"");if(latestId){this.signalSeekers.advanceCursor(tenantId,latestId);return{processed:0,posted:0,cursor:latestId};}}
    const allowedGuilds=this.options.config.tenants.find(item=>item.tenantId===tenantId)?.discordGuildIds??[];
    for(let page=0;page<10;page++){
      const events=await this.client.listEvents(tenantId,{sourceAppId:"chat-gateway",...(cursor?{afterId:cursor}:{}),limit:200});
      if(!events.length)break;
      for(const event of events){
        const eventId=String(event.id??event.eventId??"");if(!eventId)continue;
        if(event.type==="spmt.chat.message.received.v1"){
          const payload=(event.payload&&typeof event.payload==="object"?event.payload:{}) as Record<string,unknown>;
          if(payload.provider==="discord"&&typeof payload.channelId==="string"&&typeof payload.messageId==="string"){
            const records=await this.client.listCommlinkLiveChat(tenantId,{provider:"discord",channelId:payload.channelId,limit:500});
            const record=records.find(row=>row.messageId===payload.messageId),guildId=String(record?.guildId??payload.guildId??""),dropId="signal-"+eventId;
            if(record&&!record.isBot&&record.text.trim().toLowerCase()==="!signal"&&allowedGuilds.includes(guildId)&&!this.signalSeekers.get(tenantId,dropId)){
              const channel=await this.liveDiscord.getChannel(tenantId,record.channelId);
              if(channel.guild_id===guildId&&[0,5].includes(Number(channel.type))){
                const roles=await this.liveDiscord.listGuildRoles(tenantId,guildId);
                let role=roles.find(item=>!item.managed&&item.name.toLowerCase()==="signal seeker");
                if(!role)role=await this.liveDiscord.createGuildRole(tenantId,guildId,{name:"Signal Seeker",color:0x5865f2,mentionable:true,hoist:false});
                await this.liveDiscord.createMessage(tenantId,record.channelId,dshSignalSeekerPanelPayload(role.id));
                const clue=dshSignalDropClue(),messageId=await this.liveDiscord.createMessage(tenantId,record.channelId,dshSignalDropInteractionPayload(role.id,dropId));
                this.signalSeekers.createDrop({dropId,tenantId,guildId,channelId:record.channelId,messageId,roleId:role.id,clue,now:this.now()});
                posted++;
              }
            }
          }
        }
        this.signalSeekers.advanceCursor(tenantId,eventId);cursor=eventId;processed++;
      }
      if(events.length<200)break;
    }
    return{processed,posted,cursor};
  }
  private async processProviderPoints(tenantId:string){
    let cursor=this.monitor.providerActivityCursor(tenantId);
    for(let page=0;page<10;page++){
      const events=await this.client.listEvents(tenantId,{...(cursor?{afterId:cursor}:{}),type:"streamweaver.provider.activity.v1",sourceAppId:"streamweaver",limit:100});
      if(!events.length)return;
      for(const event of events){
        const cursorId=String(event.id??event.eventId??"");if(!cursorId)continue;
        const payload=asRecord(event.payload),actor=asRecord(payload?.actor),target=asRecord(payload?.target),provider=String(payload?.provider??""),kind=String(payload?.kind??"");
        const eventType=kind==="follow"?"follow":kind==="subscribe"||kind==="resubscribe"?"subscription":kind==="gift-sub"||kind==="gift-bomb"?"gifted_subscription":kind==="cheer"?"bits":kind==="raid"?"raid":undefined;
        if(provider==="twitch"&&eventType&&actor&&!actor.anonymous&&typeof actor.providerUserId==="string"){
          const activityId=String(payload?.eventId??cursorId),quantity=eventType==="bits"?Number(payload?.amount??1):eventType==="gifted_subscription"||eventType==="raid"?Number(payload?.count??1):1;
          const input:DshProviderPointsEventV1={tenantId,provider:"twitch",providerUserId:actor.providerUserId,eventId:activityId,eventType,...(typeof actor.displayName==="string"?{displayName:actor.displayName}:{}),...(typeof payload?.occurredAt==="string"?{metadata:{occurredAt:payload.occurredAt,activityKind:kind,...(target?{target}:{}),...(asRecord(payload?.metadata)??{})}}:{metadata:{activityKind:kind,...(target?{target}:{}),...(asRecord(payload?.metadata)??{})}}),...(Number.isFinite(quantity)&&quantity>0?{quantity:Math.min(100_000,Math.trunc(quantity))}:{})};
          const result=await this.pointsRouter.handle(input);
          if(eventType==="raid"&&target&&typeof target.providerUserId==="string"){
            const targetIdentity=await this.identities.resolveOrGrandfather({tenantId,provider:"twitch",providerUserId:target.providerUserId,...(typeof target.displayName==="string"?{displayName:target.displayName}:{})});
            const outcome=this.raidPile.recordRaidOut(tenantId,result.identity.userId,targetIdentity.userId,activityId);
            if(outcome.member&&outcome.compliant&&outcome.canonicalTarget){
              const reward=this.raidPile.settingsForTenant(tenantId).pointsReward;
              if(reward>0){const key=buildXpIdempotencyKey({sourceApp:"discord-stream-hub",eventType:"dsh-raid-pile-compliant",upstreamEventId:activityId,userId:result.identity.userId});await this.client.awardXp(tenantId,result.identity.userId,reward,"dsh-raid-pile-compliant",key,{eventType:"dsh-raid-pile-compliant",metadata:{raidEventId:activityId,pileId:outcome.canonicalTarget.pileId,targetUserId:targetIdentity.userId}});}
            }
          }
        }
        this.monitor.setProviderActivityCursor(tenantId,cursorId,this.now());cursor=cursorId;
      }
      if(events.length<100)return;
    }
  }
  private async processRaidPileHandoffs(tenantId:string){
    for(const pile of this.raidPile.piles(tenantId))for(const member of pile.members){const stream=this.monitor.getLiveStream(tenantId,member.userId);this.raidPile.updatePresence(tenantId,member.userId,stream?.viewerCount??0,Boolean(stream));}
    this.raidPile.ensureTargets(tenantId);
    const handoffs=this.raidPile.dueHandoffs(tenantId);
    for(const handoff of handoffs){const nextAt=handoff.nextTarget.lastRaidedAt??this.now();const action={schemaVersion:1 as const,type:"raid-pile.handoff" as const,tenantId,pileId:handoff.pileId,priorTargetName:handoff.priorTarget.displayName,nextTargetName:handoff.nextTarget.displayName,nextTargetLogin:handoff.nextTarget.twitchLogin,heldHours:handoff.heldHours,message:handoff.message,idempotencyKey:"dsh:raid-pile:"+tenantId+":"+handoff.pileId+":"+handoff.nextTarget.userId+":"+nextAt};this.monitor.enqueueAction(action,this.now());}
    await this.runtime.flush(tenantId);
  }
  async runNebulaMedia(signal:AbortSignal){const combined=AbortSignal.any([signal,this.nebulaMediaAbort.signal]);this.nebulaMediaCycle=Promise.all([this.nebulaMedia?.run(combined),this.nebulaGameplayCapture?.run(combined)]).then(()=>undefined);await this.nebulaMediaCycle;}
  runSuiteActions(signal: AbortSignal) { return this.suiteActions.run(signal); }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.nebulaMediaAbort.abort();
    const activeCycle = this.activeCycle;
    this.closing = (async () => {
      let failure: unknown;
      let failed = false;
      try { await this.nebulaMediaCycle; await this.calendarCycle; await activeCycle; } catch (error) { failure = error; failed = true; }
      this.nebulaMedia?.close();this.nebulaGameplayCapture?.close();this.clipSpotlightMedia.close();this.clipAcquisition.close();this.roleBanners?.close();
      this.memberDirectory.close();this.settings.close();this.raidPile.close();this.cleanup.close();this.activityStore.close();this.mtFixIt.close();this.forumForwardingStore.close();this.signalSeekers.close();
      try { this.messages.close(); } catch (error) { if (!failed) { failure = error; failed = true; } }
      try { this.calendarSync?.close(); this.calendar.close(); } catch (error) { if (!failed) { failure = error; failed = true; } }
      try { this.applications.close(); } catch (error) { if (!failed) { failure = error; failed = true; } }
      try { this.monitor.close(); } catch (error) { if (!failed) { failure = error; failed = true; } }
      if (failed) throw failure;
    })();
    return this.closing;
  }
  private async executeCycle(scheduled: boolean): Promise<{ schemaVersion: 1; skipped: false; results: DshLiveWorkerTenantResultV1[] }> {
    const results: DshLiveWorkerTenantResultV1[] = [];
    const observedAt = new Date(this.now()).toISOString();
    for (const tenant of this.options.config.tenants) {
      const period = this.period(tenant.tenantId);
      if (scheduled && this.scheduledPeriods.get(tenant.tenantId) === period) continue;
      const directoryState = await this.memberSync.sync(tenant.tenantId);
      const result = await this.poller.poll(tenant.tenantId, period, observedAt);
      this.scheduledPeriods.set(tenant.tenantId, period);
      if (result.status === "completed") results.push({ tenantId: tenant.tenantId, status: "completed", liveCount: result.poll.liveCount, memberCount: result.poll.memberCount, delivered: result.result.delivery.delivered, failed: result.result.delivery.failed });
      else results.push({ tenantId: tenant.tenantId, status: result.status, reason: safeReason(result.reason) });
      await this.reportRuntime(tenant.tenantId, result.status === "completed" ? (result.result.delivery.failed || directoryState.error ? "degraded" : "ready") : "degraded", result.status === "completed" ? `${result.poll.liveCount}/${result.poll.memberCount} tracked members live; ${result.result.delivery.failed} Discord deliveries pending${directoryState.error ? "; member refresh pending" : ""}` : safeReason(result.reason));
    }
    return { schemaVersion: 1, skipped: false, results };
  }
  private period(tenantId: string) { const settings = this.directory.getPollSettings(tenantId); return `dsh-live:${settings.intervalSeconds}:${settings.revision}:${Math.floor(Date.parse(this.now()) / (settings.intervalSeconds * 1000))}`; }
  private async reportRuntime(tenantId: string, state: "ready" | "degraded", detail: string) { try { await this.client.reportRuntimeState(tenantId, state, detail); } catch { /* A status projection cannot invalidate a completed provider cycle. */ } }
}

export function dshMillisecondsUntilNextPeriod(now: string, intervalSeconds: number) {
  const at = Date.parse(now), intervalMs = intervalSeconds * 1_000;
  if (!Number.isFinite(at) || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 3_600) throw new Error("DSH period calculation input is invalid");
  const remainder = ((at % intervalMs) + intervalMs) % intervalMs;
  return remainder === 0 ? intervalMs : intervalMs - remainder;
}

function asRecord(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}

function validateRuntimeConfig(value: unknown): DshLiveRuntimeConfigV1 {
  const root = record(value, "DSH runtime config");
  exactKeys(root, ["schemaVersion", "pollIntervalSeconds", "tenants"], "DSH runtime config");
  if (root.schemaVersion !== 1) throw new Error("Unsupported DSH runtime config version");
  if (!Number.isSafeInteger(root.pollIntervalSeconds) || Number(root.pollIntervalSeconds) < 60 || Number(root.pollIntervalSeconds) > 3_600) throw new Error("DSH pollIntervalSeconds must be from 60 to 3600");
  if (!Array.isArray(root.tenants) || root.tenants.length > 500) throw new Error("DSH tenants must be an array of at most 500 entries");
  const tenantIds = new Set<string>();
  const tenants = root.tenants.map((entry, index) => {
    const tenant = record(entry, `DSH tenants[${index}]`);
    exactKeys(tenant, ["tenantId", "twitchProviderUserId", "discordProviderUserId", "discordGuildIds", "branding", "members"], `DSH tenants[${index}]`);
    const tenantId = identifier(tenant.tenantId, "tenantId");
    if (tenantIds.has(tenantId)) throw new Error("DSH runtime config contains a duplicate tenant");
    tenantIds.add(tenantId);
    const brand = record(tenant.branding, "branding");
    exactKeys(brand, ["communityMemberName", "spotlightChannelId", "onboardingCustomId", "embedTemplates"], "branding");
    const embedTemplates=dshEmbedTemplateOverrides(brand.embedTemplates);
    const communityMemberName = boundedText(brand.communityMemberName, "communityMemberName", 100);
    const spotlightChannelId = brand.spotlightChannelId === undefined ? undefined : snowflake(brand.spotlightChannelId, "spotlightChannelId");
    const onboardingCustomId = brand.onboardingCustomId === undefined ? undefined : boundedText(brand.onboardingCustomId, "onboardingCustomId", 100);
    if (!Array.isArray(tenant.members) || tenant.members.length > 10_000) throw new Error("DSH tenant members must be an array of at most 10000 entries");
    const users = new Set<string>(), logins = new Set<string>();
    const members = tenant.members.map((memberValue, memberIndex) => {
      const member = record(memberValue, `members[${memberIndex}]`);
      exactKeys(member, ["canonicalUserId", "discordUserId", "twitchLogin", "group", "shoutoutChannelId", "bannerUrl", "partnerDiscordUrl"], `members[${memberIndex}]`);
      const normalized: DshLiveMemberV1 = { canonicalUserId: identifier(member.canonicalUserId, "canonicalUserId"), discordUserId: snowflake(member.discordUserId, "discordUserId"), twitchLogin: twitchLogin(member.twitchLogin), group: memberGroup(member.group), shoutoutChannelId: snowflake(member.shoutoutChannelId, "shoutoutChannelId") };
      for(const field of ['bannerUrl','partnerDiscordUrl'] as const)if(member[field]!==undefined){const url=dshHttps(member[field]);if(!url)throw new Error(`${field} must be a credential-free HTTPS URL`);normalized[field]=url;}
      if (users.has(normalized.canonicalUserId) || logins.has(normalized.twitchLogin)) throw new Error("DSH tenant members must have unique canonical users and Twitch logins");
      users.add(normalized.canonicalUserId); logins.add(normalized.twitchLogin); return normalized;
    });
    const discordGuildIds = tenant.discordGuildIds === undefined ? undefined : (() => { if (!Array.isArray(tenant.discordGuildIds) || tenant.discordGuildIds.length > 100) throw new Error("discordGuildIds must be an array of at most 100 Discord ids"); const values = [...new Set(tenant.discordGuildIds.map((value) => snowflake(value, "discordGuildId")))]; return values; })();
    return { tenantId, twitchProviderUserId: identifier(tenant.twitchProviderUserId, "twitchProviderUserId"), discordProviderUserId: identifier(tenant.discordProviderUserId, "discordProviderUserId"), ...(discordGuildIds ? { discordGuildIds } : {}), branding: { communityMemberName, ...(embedTemplates?{embedTemplates}:{}), ...(spotlightChannelId ? { spotlightChannelId } : {}), ...(onboardingCustomId ? { onboardingCustomId } : {}) }, members };
  });
  return { schemaVersion: 1, pollIntervalSeconds: Number(root.pollIntervalSeconds), tenants };
}

function record(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, allowed: string[], name: string) { const extras = Object.keys(value).filter((key) => !allowed.includes(key)); if (extras.length) throw new Error(`${name} contains unsupported fields: ${extras.join(", ")}`); }
function identifier(value: unknown, name: string) { if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,300}$/.test(value)) throw new Error(`${name} is invalid`); return value; }
function boundedText(value: unknown, name: string, maximum: number) { if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > maximum || /[\r\n\0]/.test(value)) throw new Error(`${name} is invalid`); return value; }
function snowflake(value: unknown, name: string) { if (typeof value !== "string" || !/^\d{5,30}$/.test(value)) throw new Error(`${name} must be a Discord snowflake`); return value; }
function twitchLogin(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z0-9_]{1,25}$/.test(value)) throw new Error("twitchLogin is invalid"); return value.toLowerCase(); }
function memberGroup(value: unknown): DshLiveMemberV1["group"] { if (value !== "Crew" && value !== "Partners" && value !== "Honored Guests" && value !== "Raid Pile" && value !== "Everyone Else") throw new Error("member group is invalid"); return value; }
function loopbackOrigin(value: string) { const url = new URL(value); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_ORIGIN must be a credential-free loopback HTTP origin"); return url.origin; }
function safeReason(value: string) { return value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 500); }
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((resolve) => { if (signal.aborted) return resolve(); const timer = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
