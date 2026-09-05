import { communityCalendarMissions } from "@spmt/ui";
import { DshCalendarSync } from "./calendar-sync.js";
import { DshCalendarDelivery } from "./calendar-delivery.js";
import { respondDshCalendarInteraction } from "./calendar-interactions.js";
import { resolveProviderIdentity } from "@spmt/sdk/provider-identity";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dshCaptainParticipation, renderDshCalendarPng } from "./calendar-presentation.js";
import { canonicalDshShoutoutGroup } from "./shoutout-groups.js";
import { fetchAppPlatformSnapshot, fetchAppSessionContext, readJsonBody, requireSameOrigin, safeError, sendJson } from "@spmt/app-foundation/product-web";
import type { SpmtOperationModeV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { buildDshPublicApplicationEmbed } from "./application-flow.js";
import { SqliteDshApplicationStore } from "./applications.js";
import { SqliteDshCalendarStore } from "./calendar.js";
import { DshDiscordApi, DshDiscordError, SqliteDshDiscordMessageStore, type DshDiscordGrantSourceV1, type DshDiscordTransportV1 } from "./discord-live-publisher.js";
import { createDshWorkerTokenProvider, loadDshLiveRuntimeConfig, type DshLiveRuntimeConfigV1 } from "./live-worker.js";
import { DshSimulationRoomDiscordTransport } from "./simulation-room.js";
import { DshTenantSettingsStore } from "./settings.js";

export interface DshWebControlOptionsV1 {
  spmtOrigin: string;
  publicOrigin?: string;
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
  private client?:SpmtClient;
  private sync?:DshCalendarSync;
  private delivery?:DshCalendarDelivery;
  private liveDiscord?:DshDiscordApi;
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
      this.client=client;this.liveDiscord=liveDiscord;
      this.discord = options.operationMode === "read-only"
        ? new DshSimulationRoomDiscordTransport(liveDiscord, client, { guildIds: (tenantId) => this.config?.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds ?? [], now: this.now })
        : liveDiscord;
      if(this.calendar&&this.messages){this.sync=new DshCalendarSync(options.databasePath!,this.calendar,this.discord as DshDiscordApi,this.now,options.publicOrigin);this.delivery=new DshCalendarDelivery(this.calendar,this.messages,this.discord,this.now,client,options.operationMode==="read-only");}
    }
  }

  close() { this.calendar?.close(); this.settings?.close(); this.messages?.close(); this.applications?.close(); }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/discord-stream-hub/control")) return false;
    try {
      const context = await fetchAppSessionContext({ appId: "discord-stream-hub", spmtOrigin: this.options.spmtOrigin, request });
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/calendar-image"){
        const guild=url.searchParams.get("guildId")?this.guild(context.tenantId,url.searchParams.get("guildId")):"workspace",month=String(url.searchParams.get("month")??this.now().slice(0,7));
        const png=await renderDshCalendarPng(this.requireCalendar().month(context.tenantId,guild,month),month,this.options.fetchImpl,this.now().slice(0,10));response.writeHead(200,{"content-type":"image/png","cache-control":"no-store","content-disposition":`attachment; filename="community-calendar-${month}.png"`});response.end(png);return true;
      }
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/calendar")return sendJson(response,200,this.calendarView(context.tenantId,url.searchParams.get("guildId"),String(url.searchParams.get("month")??this.now().slice(0,7))));
      if (request.method === "GET" && url.pathname === "/api/discord-stream-hub/control") return await this.read(request, response, context, url);
      if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
      requireSameOrigin(request);
      const body = await readJsonBody(request);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/captain") return await this.captain(response, context, body,request);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/update") return await this.changeCalendar(response, context, body, false);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/delete") return await this.changeCalendar(response, context, body, true);
      this.requireOwner(context);
      if(url.pathname==="/api/discord-stream-hub/control/calendar/sync"){if(!this.sync)throw new Error("Connect Discord before synchronizing events");await this.sync.sync(context.tenantId,this.guild(context.tenantId,body.serverId));await this.delivery?.flush(context.tenantId);return sendJson(response,200,{saved:true});}
      if(url.pathname==="/api/discord-stream-hub/control/calendar/resolve"){if(!this.sync)throw new Error("Connect Discord before synchronizing events");if(!["calendar","discord","retry"].includes(String(body.choice)))throw new Error("Choose a calendar or Discord version");await this.sync.resolve(context.tenantId,this.guild(context.tenantId,body.serverId),text(body.eventId,"eventId",180),body.choice as "calendar"|"discord"|"retry");await this.delivery?.flush(context.tenantId);return sendJson(response,200,{saved:true});}
      if (url.pathname === "/api/discord-stream-hub/control/calendar/mission") return await this.mission(response, context, body,request);
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
    const month = String(url.searchParams.get("month") ?? this.now().slice(0, 7));
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error("Choose a valid calendar month");
    const from = `${month}-01`;
    const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    await this.member(context,request);
    const calendar = this.calendar?.month(tenantId,guildId??"workspace",month)??[];
    const view=this.calendarView(tenantId,guildId,month);
    const snapshot = await fetchAppPlatformSnapshot({ appId: "discord-stream-hub", spmtOrigin: this.options.spmtOrigin, request, sources: ["providerLinks", "communityLive"] }).catch(() => undefined);
    const community = record(snapshot?.communityLive);
    const presenceAvailable = Boolean(snapshot?.availability.communityLive?.available && Array.isArray(community?.shoutouts));
    const liveMembers = presenceAvailable ? (community!.shoutouts as unknown[]).flatMap((entry) => {
      const row = record(entry);
      if (!row || row.isLive !== true || typeof row.twitchLogin !== "string" || !/^[a-zA-Z0-9_]{1,32}$/.test(row.twitchLogin)) return [];
      return [{ twitchLogin: row.twitchLogin, displayName: String(row.displayName ?? row.twitchLogin).slice(0, 100), group: canonicalDshShoutoutGroup(String(row.groupName ?? row.category ?? "Community")) ?? "Community", isSpotlight: row.isSpotlight === true, title: String(row.title ?? "").slice(0, 200), gameName: String(row.gameName ?? "").slice(0, 100), viewerCount: Math.max(0, Number(row.viewerCount) || 0) }];
    }) : [];
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
      ...view,
      participation: dshCaptainParticipation(calendar, this.config?.tenants.find(tenant => tenant.tenantId === tenantId)?.members.filter(member => member.group === "Crew").map(member => ({userId: member.canonicalUserId, username: member.twitchLogin})) ?? [], this.settings?.read(tenantId).captainMinimumDays ?? 0),
      calendarMonth: month,
      presence: { source: "ecosystem", state: presenceAvailable ? "ready" : "unavailable" },
      liveMembers,
      spotlight: liveMembers.find((member) => member.isSpotlight) ?? null,
      trackedMessages: this.messages?.list(tenantId) ?? [],
      applications: this.role(context) === "owner" ? this.applications?.list(tenantId, undefined, 100) ?? [] : [],
      settings: this.settings?.read(tenantId) ?? null,
    });
  }

  private calendarView(tenant:string,rawGuild:unknown,month:string){
    const guild=rawGuild?this.guild(tenant,rawGuild):"workspace",events=this.calendar?.month(tenant,guild,month)??[],missions=communityCalendarMissions({month,today:this.now().slice(0,10),events});
    const colors=new Map(missions.map(e=>[e.id,e]));
    const guildIds=this.config?.tenants.find(t=>t.tenantId===tenant)?.discordGuildIds??[];
    return {calendar:events.map(e=>({...e,...(colors.has(e.id)?{color:colors.get(e.id)!.color,number:colors.get(e.id)!.number}:{})})),calendarMonth:month,calendarSync:guildIds.filter(g=>guild==="workspace"||g===guild).map(g=>({guildId:g,...this.sync?.status(tenant,g),imageError:this.calendar?.state(tenant,`image-error:${g}`)??null})),participation:dshCaptainParticipation(events,this.config?.tenants.find(t=>t.tenantId===tenant)?.members.filter(m=>m.group==="Crew").map(m=>({userId:m.canonicalUserId,username:m.twitchLogin}))??[],this.settings?.read(tenant).captainMinimumDays??0)};
  }
  private async captain(response:ServerResponse,context:SessionContext,body:Record<string,unknown>,request:IncomingMessage){
    const member=await this.member(context,request),store=this.requireCalendar();
    const result=store.once(context.tenantId,this.requestKey(context,body),()=>store.scheduleCaptainsLog({tenantId:context.tenantId,serverId:this.calendarScope(context.tenantId,body.serverId),selectedDate:day(body.selectedDate),member,now:this.now()}));
    return sendJson(response,201,{...result,effects:await this.changed(context.tenantId)});
  }
  private async mission(response:ServerResponse,context:SessionContext,body:Record<string,unknown>,request:IncomingMessage){
    const member=await this.member(context,request),store=this.requireCalendar();
    const result=store.once(context.tenantId,this.requestKey(context,body),()=>store.scheduleMission({tenantId:context.tenantId,serverId:this.calendarScope(context.tenantId,body.serverId),missionName:text(body.missionName,"missionName",100),missionDescription:text(body.missionDescription,"missionDescription",2000),missionDate:day(body.missionDate),missionTime:clock(body.missionTime),...(body.endDateTime?{endDateTime:String(body.endDateTime).replace(/Z?$/,"Z")}:{}),...(body.location?{location:text(body.location,"location",100)}:{}),member,now:this.now()}));
    return sendJson(response,201,{...result,effects:await this.changed(context.tenantId)});
  }
  private async publishCalendar(response:ServerResponse,context:SessionContext,body:Record<string,unknown>){
    if(!this.delivery)throw new Error("Connect the DSH Discord bot before publishing");
    const guild=this.guild(context.tenantId,body.serverId),channel=snowflake(body.channelId,"channelId");
    return sendJson(response,200,{schemaVersion:1,...await this.delivery.publish(context.tenantId,guild,channel,String(body.month??this.now().slice(0,7)))});
  }
  async changed(tenant:string){
    const failures:string[]=[];
    for(const guild of this.config?.tenants.find(t=>t.tenantId===tenant)?.discordGuildIds??[])try{await this.sync?.sync(tenant,guild);const status=this.sync?.status(tenant,guild);for(const issue of status?.issues??[])if(issue.message)failures.push(issue.message);}catch(error){failures.push(safeError(error));}
    const effects=await this.delivery?.flush(tenant);if(effects?.pending)failures.push(effects.message);
    return {pending:failures.length>0,message:failures.join("; ")};
  }
  async interaction(interaction:Record<string,any>){
    if(!this.config||!this.calendar)return undefined;
    return respondDshCalendarInteraction({config:this.config,calendar:this.calendar,now:this.now,changed:tenant=>this.changed(tenant),resolve:async(tenant,id)=>{
      if(!this.client)throw new Error("Connect the DSH service before using calendar controls");
      const identity=await resolveProviderIdentity(this.client,tenant,"discord",id);
      return {userId:identity.userId,username:identity.profile.displayName||identity.profile.username,role:identity.tenantRole??null};
    }},interaction);
  }
  private requestKey(context:SessionContext,body:Record<string,unknown>){return body.requestId?`${String(context.session.actorId)}:${text(body.requestId,"requestId",100)}`:undefined;}

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
    if (body.captainMinimumDays !== undefined) values.captainMinimumDays = integer(body.captainMinimumDays, 0, 31, "captainMinimumDays");
    if (body.pollIntervalSeconds !== undefined) values.pollIntervalSeconds = integer(body.pollIntervalSeconds, 15, 900, "pollIntervalSeconds");
    const next = store.patch(context.tenantId, { schemaVersion: 1, expectedRevision: current.revision, values });
    return sendJson(response, 200, next);
  }

  private async upsertDiscord(tenantId: string, kind: "calendar" | "applications", key: string, channelId: string, payload: Record<string, unknown>) {
    if (!this.discord || !this.messages) throw new Error("Connect the DSH Discord bot before publishing");
    const tracked = this.messages.get(tenantId, kind, key);
    if (tracked && tracked.channelId === channelId) {
      try { await this.discord.editMessage(tenantId, channelId, tracked.messageId, payload); this.messages.put({ ...tracked, updatedAt: this.now() }); return tracked.messageId; }
      catch (error) { if (!(error instanceof DshDiscordError) || error.status !== 404) throw error; this.messages.remove(tenantId, kind, key); }
    } else if (tracked) {
      await this.discord.deleteMessage(tenantId, tracked.channelId, tracked.messageId).catch(() => undefined);
      this.messages.remove(tenantId, kind, key);
    }
    const messageId = await this.discord.createMessage(tenantId, channelId, payload);
    this.messages.put({ tenantId, kind, key, channelId, messageId, updatedAt: this.now() });
    return messageId;
  }

  private requireOwner(context: SessionContext) { if (this.role(context) !== "owner") throw new Error("Tenant owner access is required for this action"); }
  private calendarScope(tenantId: string, value: unknown) { return !value || value === "workspace" ? "workspace" : this.guild(tenantId, value); }
  private async changeCalendar(response: ServerResponse, context: SessionContext, body: Record<string, unknown>, remove: boolean) {
    const store = this.requireCalendar(), scope = this.calendarScope(context.tenantId, body.serverId), eventId = text(body.eventId, "eventId", 180);
    const current = store.get(context.tenantId, scope, eventId);
    if (!current) throw new Error("Calendar event not found");
    const owner = this.role(context) === "owner";
    if (!owner && (current.type !== "captains-log" || current.userId !== context.session.actorId)) throw new Error("Tenant owner access is required to change another member's event");
    if (remove) {const deleted=store.deleteEvent(context.tenantId,scope,eventId);return sendJson(response,200,{deleted,effects:await this.changed(context.tenantId)});}
    const patch = { ...(owner&&body.endDateTime?{endDateTime:String(body.endDateTime).replace(/Z?$/,"Z")}:{}),...(owner&&body.location?{location:text(body.location,"location",100)}:{}),...(body.eventDate !== undefined ? { eventDate: day(body.eventDate) } : {}), ...(owner && body.eventName !== undefined ? { eventName: text(body.eventName, "eventName", 120) } : {}), ...(owner && body.description !== undefined ? { description: text(body.description, "description", 2_000) } : {}), ...(owner && body.eventTime !== undefined ? { eventTime: clock(body.eventTime) } : {}) };
    const event=store.updateEvent(context.tenantId,scope,eventId,patch,this.now());return sendJson(response,200,{event,effects:await this.changed(context.tenantId)});
  }
  private role(context: SessionContext) { const roles = record(context.session.tenantRoles); return roles?.[context.tenantId] === "owner" ? "owner" : "member"; }
  private async member(context:SessionContext,request:IncomingMessage){
    let avatarUrl:string|undefined;
    if(this.liveDiscord)try{const snapshot=await fetchAppPlatformSnapshot({appId:"discord-stream-hub",spmtOrigin:this.options.spmtOrigin,request,sources:["providerLinks"],liveRead:null});const value=snapshot.providerLinks as any,links=Array.isArray(value)?value:value?.providers??value?.links??[];const link=links.find((l:any)=>l.provider==="discord"&&!l.revokedAt);if(link?.providerUserId){const user=await this.liveDiscord.getUser(context.tenantId,link.providerUserId);if(user.avatar)avatarUrl=`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;}}catch{}
    if(avatarUrl)this.calendar?.setAvatar(context.tenantId,String(context.session.actorId),avatarUrl);
    return {userId:String(context.session.actorId??""),username:String(context.session.displayName??context.session.username??context.session.actorId??"SPMT member"),...(avatarUrl?{avatarUrl}:{})};
  }
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
