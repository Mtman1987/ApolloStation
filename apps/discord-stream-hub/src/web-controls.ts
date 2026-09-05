import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchAppPlatformSnapshot, fetchAppSessionContext, readJsonBody, requireSameOrigin, safeError, sendJson } from "@spmt/app-foundation/product-web";
import type { SpmtOperationModeV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { buildDshPublicApplicationEmbed } from "./application-flow.js";
import { SqliteDshApplicationStore } from "./applications.js";
import { renderDshCalendarDiscordSummary, SqliteDshCalendarStore } from "./calendar.js";
import { DshDiscordApi, SqliteDshDiscordMessageStore, type DshDiscordGrantSourceV1, type DshDiscordTransportV1 } from "./discord-live-publisher.js";
import { createDshWorkerTokenProvider, loadDshLiveRuntimeConfig, type DshLiveRuntimeConfigV1 } from "./live-worker.js";
import { DshSimulationRoomDiscordTransport } from "./simulation-room.js";
import { DshTenantSettingsStore } from "./settings.js";

export interface DshWebControlOptionsV1 {
  spmtOrigin: string;
  databasePath?: string;
  runtimeConfigPath?: string;
  credential?: string;
  operationMode?: SpmtOperationModeV1;
  applicationInteractionsReady?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

type SessionContext = Awaited<ReturnType<typeof fetchAppSessionContext>>;

/** Authenticated, app-owned controls used by the DSH browser surface. */
export class DshWebControls {
  private readonly calendar?: SqliteDshCalendarStore;
  private readonly settings?: DshTenantSettingsStore;
  private readonly messages?: SqliteDshDiscordMessageStore;
  private readonly applications?: SqliteDshApplicationStore;
  private readonly config?: DshLiveRuntimeConfigV1;
  private readonly discord?: DshDiscordTransportV1;
  private readonly now: () => string;

  constructor(private readonly options: DshWebControlOptionsV1) {
    this.now = options.now ?? (() => new Date().toISOString());
    if (options.databasePath) {
      this.calendar = new SqliteDshCalendarStore(options.databasePath);
      this.settings = new DshTenantSettingsStore(options.databasePath, this.now);
      this.messages = new SqliteDshDiscordMessageStore(options.databasePath);
      this.applications = new SqliteDshApplicationStore(options.databasePath);
    }
    if (options.runtimeConfigPath) this.config = loadDshLiveRuntimeConfig(options.runtimeConfigPath);
    if (options.credential && this.config) {
      const getAccessToken = createDshWorkerTokenProvider({ spmtOrigin: options.spmtOrigin, credential: options.credential, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
      const client = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "discord-stream-hub", getAccessToken, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
      const grants: DshDiscordGrantSourceV1 = { getGrant: async ({ tenantId, capability }) => {
        const providerUserId = this.config?.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordProviderUserId;
        if (!providerUserId) throw new Error("Connect the tenant's Discord bot before using Discord delivery");
        const grant = await client.issueProviderGrant(tenantId, "discord", providerUserId, "dsh-discord-control", [capability], 300);
        const scheme = grant.credential.metadata.authorizationScheme ?? "Bot";
        if (scheme !== "Bot" && scheme !== "Bearer") throw new Error("Discord grant authorization scheme is invalid");
        return { authorization: `${scheme} ${grant.credential.accessToken}`, expiresAt: grant.expiresAt };
      } };
      const liveDiscord = new DshDiscordApi(grants, options.fetchImpl);
      this.discord = options.operationMode === "read-only"
        ? new DshSimulationRoomDiscordTransport(liveDiscord, client, { guildIds: (tenantId) => this.config?.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds ?? [], now: this.now })
        : liveDiscord;
    }
  }

  close() { this.calendar?.close(); this.settings?.close(); this.messages?.close(); this.applications?.close(); }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/discord-stream-hub/control")) return false;
    try {
      const context = await fetchAppSessionContext({ appId: "discord-stream-hub", spmtOrigin: this.options.spmtOrigin, request });
      if (request.method === "GET" && url.pathname === "/api/discord-stream-hub/control") return await this.read(request, response, context, url);
      if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
      requireSameOrigin(request);
      const body = await readJsonBody(request);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/captain") return this.captain(response, context, body);
      this.requireOwner(context);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/mission") return this.mission(response, context, body);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/publish") return await this.publishCalendar(response, context, body);
      if (url.pathname === "/api/discord-stream-hub/control/applications/publish") return await this.publishApplications(response, context, body);
      if (url.pathname === "/api/discord-stream-hub/control/applications/decide") return await this.decideApplication(response, context, body);
      if (url.pathname === "/api/discord-stream-hub/control/settings") return this.updateSettings(response, context, body);
      return sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      const message = safeError(error);
      const status = /sign in|session/i.test(message) ? 401 : /owner access/i.test(message) ? 403 : /configured for this tenant/i.test(message) ? 400 : /connect.*discord|grant|discord/i.test(message) ? 502 : 400;
      return sendJson(response, status, { error: "dsh_control_failed", message });
    }
  }

  private async read(request: IncomingMessage, response: ServerResponse, context: SessionContext, url: URL) {
    const tenantId = context.tenantId;
    const guildId = optionalSnowflake(url.searchParams.get("guildId"));
    const allowedGuildIds = new Set(this.config?.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds ?? []);
    if (guildId && !allowedGuildIds.has(guildId)) throw new Error("Choose a Discord server configured for this tenant");
    let guilds: Array<Record<string, unknown>> = [], channels: Array<Record<string, unknown>> = [];
    let providerState: "ready" | "setup-required" | "unavailable" = this.discord ? "ready" : "setup-required";
    let providerMessage = this.discord ? (this.options.operationMode === "read-only" ? "Live Discord servers and channels are connected. Delivery opens in Simulation Rooms." : "Discord delivery is connected.") : "Connect the DSH Discord bot to load servers and channels.";
    if (this.discord) {
      try {
        guilds = (await this.discord.listGuilds(tenantId)).filter((item) => typeof item.id === "string" && allowedGuildIds.has(item.id)).map((item) => ({ id: item.id, name: item.name ?? item.id, icon: item.icon ?? null }));
        if (guildId) channels = (await this.discord.listGuildChannels(tenantId, guildId)).filter((item) => typeof item.id === "string" && (item.type === 0 || item.type === 5)).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)).map((item) => ({ id: item.id, name: item.name ?? item.id, type: item.type ?? 0 }));
      } catch (error) { providerState = "unavailable"; providerMessage = safeError(error); }
    }
    const calendar = this.calendar && guildId ? this.calendar.list(tenantId, guildId, { from: dayOffset(-31), to: dayOffset(366), limit: 300 }) : [];
    const snapshot = await fetchAppPlatformSnapshot({ appId: "discord-stream-hub", spmtOrigin: this.options.spmtOrigin, request, sources: ["providerLinks"] }).catch(() => undefined);
    return sendJson(response, 200, {
      schemaVersion: 1,
      tenantId,
      session: context.session,
      role: this.role(context),
      storageReady: Boolean(this.calendar && this.settings),
      applicationInteractionsReady: Boolean(this.options.applicationInteractionsReady),
      operationMode: this.options.operationMode ?? "active",
      provider: { state: providerState, message: providerMessage },
      providerLinks: snapshot?.providerLinks ?? [],
      guilds,
      channels,
      selectedGuildId: guildId ?? "",
      calendar,
      applications: this.role(context) === "owner" ? this.applications?.list(tenantId, undefined, 100) ?? [] : [],
      settings: this.settings?.read(tenantId) ?? null,
    });
  }

  private captain(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const store = this.requireCalendar();
    const result = store.scheduleCaptainsLog({ tenantId: context.tenantId, serverId: this.guild(context.tenantId, body.serverId), selectedDate: day(body.selectedDate), member: this.member(context), now: this.now() });
    return sendJson(response, 201, result);
  }

  private mission(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const result = this.requireCalendar().scheduleMission({ tenantId: context.tenantId, serverId: this.guild(context.tenantId, body.serverId), missionName: text(body.missionName, "missionName", 120), missionDescription: text(body.missionDescription, "missionDescription", 2_000), missionDate: day(body.missionDate), missionTime: clock(body.missionTime), member: this.member(context), now: this.now() });
    return sendJson(response, 201, result);
  }

  private async publishCalendar(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const serverId = this.guild(context.tenantId, body.serverId), channelId = snowflake(body.channelId, "channelId");
    const events = this.requireCalendar().list(context.tenantId, serverId, { from: dayOffset(-1), to: dayOffset(90), limit: 300 });
    const summary = renderDshCalendarDiscordSummary(events, { from: dayOffset(0), to: dayOffset(90) });
    const messageId = await this.upsertDiscord(context.tenantId, "calendar", serverId, channelId, { embeds: [{ title: `📅 ${summary.title}`, description: summary.description, color: 0xf97316, footer: { text: `${summary.eventCount} scheduled item${summary.eventCount === 1 ? "" : "s"} · Discord Stream Hub` }, timestamp: this.now() }], allowed_mentions: { parse: [] } });
    return sendJson(response, 200, { schemaVersion: 1, messageId, channelId, eventCount: events.length });
  }

  private async publishApplications(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    if (this.options.operationMode !== "read-only" && !this.options.applicationInteractionsReady) throw new Error("Configure the Discord application interaction endpoint before publishing the application embed");
    const serverId = this.guild(context.tenantId, body.serverId), channelId = snowflake(body.channelId, "channelId");
    const messageId = await this.upsertDiscord(context.tenantId, "applications", serverId, channelId, buildDshPublicApplicationEmbed(serverId));
    return sendJson(response, 200, { schemaVersion: 1, messageId, channelId });
  }

  private async decideApplication(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    if (!this.applications) throw new Error("DSH application storage is not configured");
    const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : undefined;
    if (!decision) throw new Error("Application decision is invalid");
    const application = this.applications.decide(context.tenantId, text(body.applicationId, "applicationId", 300), decision, String(context.session.actorId ?? ""), optionalText(body.note, 1_000), this.now());
    let notification: "sent" | "unavailable" = "unavailable";
    if (this.discord) {
      const label = decision === "approved" ? "approved" : "not approved";
      await this.discord.sendDirectMessage(context.tenantId, application.applicantDiscordId, { embeds: [{ title: `SPMT ${application.type} application update`, description: `Your application was ${label}.${application.decisionNote ? `\n\n${application.decisionNote}` : ""}`, color: decision === "approved" ? 0x22c55e : 0xef4444 }], allowed_mentions: { parse: [] } }).then(() => { notification = "sent"; }).catch(() => undefined);
    }
    return sendJson(response, 200, { schemaVersion: 1, application, notification });
  }

  private updateSettings(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const store = this.requireSettings(), current = store.readDocument(context.tenantId), values: Record<string, string | number | boolean | null> = {};
    for (const key of ["spotlightChannelId", "signalChannelId", "gifStorageChannelId"] as const) if (body[key] !== undefined) values[key] = body[key] === "" ? "" : snowflake(body[key], key);
    for (const key of ["spotlightEnabled", "signalSeekerEnabled"] as const) if (typeof body[key] === "boolean") values[key] = body[key];
    if (body.pollIntervalSeconds !== undefined) values.pollIntervalSeconds = integer(body.pollIntervalSeconds, 15, 900, "pollIntervalSeconds");
    const next = store.patch(context.tenantId, { schemaVersion: 1, expectedRevision: current.revision, values });
    return sendJson(response, 200, next);
  }

  private async upsertDiscord(tenantId: string, kind: "calendar" | "applications", key: string, channelId: string, payload: Record<string, unknown>) {
    if (!this.discord || !this.messages) throw new Error("Connect the DSH Discord bot before publishing");
    const tracked = this.messages.get(tenantId, kind, key);
    if (tracked && tracked.channelId === channelId) {
      try { await this.discord.editMessage(tenantId, channelId, tracked.messageId, payload); this.messages.put({ ...tracked, updatedAt: this.now() }); return tracked.messageId; }
      catch { this.messages.remove(tenantId, kind, key); }
    } else if (tracked) {
      await this.discord.deleteMessage(tenantId, tracked.channelId, tracked.messageId).catch(() => undefined);
      this.messages.remove(tenantId, kind, key);
    }
    const messageId = await this.discord.createMessage(tenantId, channelId, payload);
    this.messages.put({ tenantId, kind, key, channelId, messageId, updatedAt: this.now() });
    return messageId;
  }

  private requireOwner(context: SessionContext) { if (this.role(context) !== "owner") throw new Error("Tenant owner access is required for this action"); }
  private role(context: SessionContext) { const roles = record(context.session.tenantRoles); return roles?.[context.tenantId] === "owner" ? "owner" : "member"; }
  private member(context: SessionContext) { return { userId: String(context.session.actorId ?? ""), username: String(context.session.displayName ?? context.session.username ?? context.session.actorId ?? "SPMT member") }; }
  private requireCalendar() { if (!this.calendar) throw new Error("DSH calendar storage is not configured"); return this.calendar; }
  private requireSettings() { if (!this.settings) throw new Error("DSH settings storage is not configured"); return this.settings; }
  private guild(tenantId: string, value: unknown) { const guildId = snowflake(value, "serverId"); if (!this.config?.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds?.includes(guildId)) throw new Error("Choose a Discord server configured for this tenant"); return guildId; }
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function snowflake(value: unknown, name: string) { const result = String(value ?? "").trim(); if (!/^\d{5,30}$/.test(result)) throw new Error(`${name} must be a Discord server or channel id`); return result; }
function optionalSnowflake(value: unknown) { const result = String(value ?? "").trim(); return /^\d{5,30}$/.test(result) ? result : undefined; }
function day(value: unknown) { const result = String(value ?? "").trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || new Date(`${result}T12:00:00.000Z`).toISOString().slice(0, 10) !== result) throw new Error("A valid calendar date is required"); return result; }
function clock(value: unknown) { const result = String(value ?? "12:00").trim(); if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new Error("A valid 24-hour time is required"); return result; }
function text(value: unknown, name: string, max: number) { const result = String(value ?? "").replace(/\0/g, "").trim(); if (!result || result.length > max) throw new Error(`${name} is required`); return result; }
function optionalText(value: unknown, max: number) { const result = String(value ?? "").replace(/\0/g, "").trim(); if (result.length > max) throw new Error("Value is too long"); return result; }
function integer(value: unknown, min: number, max: number, name: string) { const result = Number(value); if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name} is invalid`); return result; }
function dayOffset(offset: number) { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)).toISOString().slice(0, 10); }
