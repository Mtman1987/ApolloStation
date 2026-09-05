import { DshCalendarDelivery } from "./calendar-delivery.js";
import { DshCalendarSync } from "./calendar-sync.js";
import { readFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import type { SpmtOperationModeV1 } from "@spmt/contracts";
import { SpmtApiError, SpmtClient } from "@spmt/sdk";
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

export interface DshLiveRuntimeTenantV1 {
  tenantId: string;
  twitchProviderUserId: string;
  discordProviderUserId: string;
  discordGuildIds?: string[];
  branding: { communityMemberName: string; spotlightChannelId?: string; onboardingCustomId?: string };
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

class ConfigDirectory implements DshLiveMemberDirectoryV1, DshDiscordBrandingSourceV1 {
  private readonly tenants = new Map<string, DshLiveRuntimeTenantV1>();
  constructor(config: DshLiveRuntimeConfigV1) { config.tenants.forEach((tenant) => this.tenants.set(tenant.tenantId, tenant)); }
  async listLiveTrackedMembers(tenantId: string) { return structuredClone(this.require(tenantId).members); }
  getBranding(tenantId: string) { return structuredClone(this.require(tenantId).branding); }
  providerUserId(tenantId: string, provider: "twitch" | "discord") { const tenant = this.require(tenantId); return provider === "twitch" ? tenant.twitchProviderUserId : tenant.discordProviderUserId; }
  private require(tenantId: string) { const value = this.tenants.get(tenantId); if (!value) throw new Error(`DSH tenant ${tenantId} is not configured`); return value; }
}

export class SpmtDshTwitchGrantSource implements DshTwitchGrantSourceV1 {
  constructor(private readonly client: SpmtClient, private readonly directory: ConfigDirectory) {}
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
  async getGrant(input: { tenantId: string; capability: "messages:write" | "channels:read" | "guilds:read" | "events:read" | "events:write" }) {
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
  private readonly calendar: SqliteDshCalendarStore;
  private readonly calendarSync: DshCalendarSync;
  private readonly calendarDelivery:DshCalendarDelivery;
  private calendarCycle:Promise<void>|undefined;
  private readonly applications: SqliteDshApplicationStore;
  private readonly runtime: DshLiveRuntime;
  private readonly poller: DshTwitchLivePoller;
  private readonly suiteActions: DshSuiteActionWorker;
  private activeCycle: Promise<{ schemaVersion: 1; skipped: false; results: DshLiveWorkerTenantResultV1[] }> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  constructor(private readonly options: DshLiveWorkerEnvironmentV1, fetchImpl: typeof fetch = fetch, private readonly now: () => string = () => new Date().toISOString()) {
    this.getAccessToken = createDshWorkerTokenProvider({ spmtOrigin: options.spmtOrigin, credential: options.credential, fetchImpl });
    this.client = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "discord-stream-hub", getAccessToken: this.getAccessToken, fetchImpl });
    const directory = new ConfigDirectory(options.config);
    this.monitor = new SqliteDshLiveMonitor(options.databasePath, options.config.pollIntervalSeconds * 1_000);
    this.messages = new SqliteDshDiscordMessageStore(options.databasePath);
    const liveDiscord = new DshDiscordApi(new SpmtDshDiscordGrantSource(this.client, directory), fetchImpl);
    const simulationDiscord = new DshSimulationRoomDiscordTransport(liveDiscord, this.client, { guildIds: (tenantId) => options.config.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds ?? [], now });
    const discord = options.operationMode === "read-only" ? simulationDiscord : liveDiscord;
    const publisher = new DshDiscordLivePublisher(discord, this.messages, directory, undefined, now);
    this.runtime = new DshLiveRuntime(this.monitor, publisher);
    this.poller = new DshTwitchLivePoller(directory, new SpmtDshTwitchGrantSource(this.client, directory), new TwitchHelixLiveClient(fetchImpl), this.runtime);
    this.calendar = new SqliteDshCalendarStore(options.databasePath);
    this.calendarSync = new DshCalendarSync(options.databasePath, this.calendar, discord, now, options.publicOrigin);
    this.calendarDelivery=new DshCalendarDelivery(this.calendar,this.messages,discord,now,this.client,options.operationMode==="read-only");
    this.applications = new SqliteDshApplicationStore(options.databasePath);
    const operations = new DshSuiteActionOperations({ config: options.config, monitor: this.monitor, messages: this.messages, calendar: this.calendar, applications: this.applications, discord, simulationDiscord, applicationInteractionsReady: options.applicationInteractionsReady, now });
    this.suiteActions = new DshSuiteActionWorker(this.client, new DshBotActionAdapter(operations), { workerId: `${options.workerId}-suite-actions`, tenantIds: options.config.tenants.map((tenant) => tenant.tenantId) });
  }
  async ready() { await this.getAccessToken(); return { schemaVersion: 1 as const, workerId: this.options.workerId, operationMode: this.options.operationMode, liveIngressEnabled: this.options.liveIngressEnabled, egressMode: this.options.operationMode === "read-only" ? "shadow" as const : "provider" as const, configuredTenants: this.options.config.tenants.length, pollIntervalSeconds: this.options.config.pollIntervalSeconds }; }
  async runOnce(): Promise<{ schemaVersion: 1; skipped: boolean; results: DshLiveWorkerTenantResultV1[] }> {
    if (this.closed) throw new Error("Discord Stream Hub worker is closed");
    if (this.activeCycle) return { schemaVersion: 1, skipped: true, results: [] };
    const cycle = this.executeCycle();
    this.activeCycle = cycle;
    try { return await cycle; }
    finally { if (this.activeCycle === cycle) this.activeCycle = undefined; }
  }
  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      await this.runOnce();
      await pause(dshMillisecondsUntilNextPeriod(this.now(), this.options.config.pollIntervalSeconds), signal);
    }
  }
  async runCalendar(signal:AbortSignal) {while(!signal.aborted&&!this.closed){const cycle=this.syncCalendars();this.calendarCycle=cycle;try{await cycle;}finally{this.calendarCycle=undefined;}await pause(5000,signal);}}
  private async syncCalendars(){for(const tenant of this.options.config.tenants){for(const guild of tenant.discordGuildIds??[]){const last=this.calendarSync.state(tenant.tenantId,guild).checkedAt;if(!last||Date.parse(this.now())-Date.parse(last)>=30000)await this.calendarSync.sync(tenant.tenantId,guild).catch(()=>undefined);}await this.calendarDelivery.flush(tenant.tenantId);}}
  runSuiteActions(signal: AbortSignal) { return this.suiteActions.run(signal); }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    const activeCycle = this.activeCycle;
    this.closing = (async () => {
      let failure: unknown;
      let failed = false;
      try { await this.calendarCycle; await activeCycle; } catch (error) { failure = error; failed = true; }
      try { this.messages.close(); } catch (error) { if (!failed) { failure = error; failed = true; } }
      try { this.calendarSync?.close(); this.calendar.close(); } catch (error) { if (!failed) { failure = error; failed = true; } }
      try { this.applications.close(); } catch (error) { if (!failed) { failure = error; failed = true; } }
      try { this.monitor.close(); } catch (error) { if (!failed) { failure = error; failed = true; } }
      if (failed) throw failure;
    })();
    return this.closing;
  }
  private async executeCycle(): Promise<{ schemaVersion: 1; skipped: false; results: DshLiveWorkerTenantResultV1[] }> {
    const results: DshLiveWorkerTenantResultV1[] = [];
    const observedAt = new Date(this.now()).toISOString();
    const period = Math.floor(Date.parse(observedAt) / (this.options.config.pollIntervalSeconds * 1_000));
    for (const tenant of this.options.config.tenants) {
      const result = await this.poller.poll(tenant.tenantId, `dsh-live:${period}`, observedAt);
      if (result.status === "completed") results.push({ tenantId: tenant.tenantId, status: "completed", liveCount: result.poll.liveCount, memberCount: result.poll.memberCount, delivered: result.result.delivery.delivered, failed: result.result.delivery.failed });
      else results.push({ tenantId: tenant.tenantId, status: result.status, reason: safeReason(result.reason) });
      await this.reportRuntime(tenant.tenantId, result.status === "completed" ? (result.result.delivery.failed ? "degraded" : "ready") : "degraded", result.status === "completed" ? `${result.poll.liveCount}/${result.poll.memberCount} tracked members live; ${result.result.delivery.failed} Discord deliveries pending` : safeReason(result.reason));
    }
    return { schemaVersion: 1, skipped: false, results };
  }
  private async reportRuntime(tenantId: string, state: "ready" | "degraded", detail: string) { try { await this.client.reportRuntimeState(tenantId, state, detail); } catch { /* A status projection cannot invalidate a completed provider cycle. */ } }
}

export function dshMillisecondsUntilNextPeriod(now: string, intervalSeconds: number) {
  const at = Date.parse(now), intervalMs = intervalSeconds * 1_000;
  if (!Number.isFinite(at) || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 3_600) throw new Error("DSH period calculation input is invalid");
  const remainder = ((at % intervalMs) + intervalMs) % intervalMs;
  return remainder === 0 ? intervalMs : intervalMs - remainder;
}

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
    exactKeys(brand, ["communityMemberName", "spotlightChannelId", "onboardingCustomId"], "branding");
    const communityMemberName = boundedText(brand.communityMemberName, "communityMemberName", 100);
    const spotlightChannelId = brand.spotlightChannelId === undefined ? undefined : snowflake(brand.spotlightChannelId, "spotlightChannelId");
    const onboardingCustomId = brand.onboardingCustomId === undefined ? undefined : boundedText(brand.onboardingCustomId, "onboardingCustomId", 100);
    if (!Array.isArray(tenant.members) || tenant.members.length > 10_000) throw new Error("DSH tenant members must be an array of at most 10000 entries");
    const users = new Set<string>(), logins = new Set<string>();
    const members = tenant.members.map((memberValue, memberIndex) => {
      const member = record(memberValue, `members[${memberIndex}]`);
      exactKeys(member, ["canonicalUserId", "discordUserId", "twitchLogin", "group", "shoutoutChannelId"], `members[${memberIndex}]`);
      const normalized: DshLiveMemberV1 = { canonicalUserId: identifier(member.canonicalUserId, "canonicalUserId"), discordUserId: snowflake(member.discordUserId, "discordUserId"), twitchLogin: twitchLogin(member.twitchLogin), group: memberGroup(member.group), shoutoutChannelId: snowflake(member.shoutoutChannelId, "shoutoutChannelId") };
      if (users.has(normalized.canonicalUserId) || logins.has(normalized.twitchLogin)) throw new Error("DSH tenant members must have unique canonical users and Twitch logins");
      users.add(normalized.canonicalUserId); logins.add(normalized.twitchLogin); return normalized;
    });
    const discordGuildIds = tenant.discordGuildIds === undefined ? undefined : (() => { if (!Array.isArray(tenant.discordGuildIds) || tenant.discordGuildIds.length > 100) throw new Error("discordGuildIds must be an array of at most 100 Discord ids"); const values = [...new Set(tenant.discordGuildIds.map((value) => snowflake(value, "discordGuildId")))]; return values; })();
    return { tenantId, twitchProviderUserId: identifier(tenant.twitchProviderUserId, "twitchProviderUserId"), discordProviderUserId: identifier(tenant.discordProviderUserId, "discordProviderUserId"), ...(discordGuildIds ? { discordGuildIds } : {}), branding: { communityMemberName, ...(spotlightChannelId ? { spotlightChannelId } : {}), ...(onboardingCustomId ? { onboardingCustomId } : {}) }, members };
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
