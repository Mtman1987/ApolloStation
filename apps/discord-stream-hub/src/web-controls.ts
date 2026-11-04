import { DshSignalControlSigner, SqliteDshSignalControlStore, dshSignalRemovalUrl, removeDshSignal } from "./signal-control.js";
import { SqliteDshClipGifStore } from "./clip-gif-library.js";
import { DshRaidTrainStore, dshRaidTrainPayload } from "./raid-train.js";
import { buildDshSignalPresentation } from "./signal-presentation.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { forwardDshForumPost, importDshDiscordForumThreads, DshForumForwardingStore, DshForumForwardingService, type DshForumForwardRuleV1, type DshForumForwardMutationV1 } from "./forum-forwarding.js";
import { DshMemberDirectoryStore } from "./member-directory.js";
import { DshRaidPileStore, DEFAULT_DSH_RAID_PILE_SETTINGS, type DshRaidPileSettingsV1 } from "./raid-pile.js";
import {DshOnboardingPanel} from "./onboarding-panel.js";
import { DshMemberActivityStore } from "./member-activity.js";
import { DshPartnerSchedules } from "./partner-schedules.js";
import { respondDshPartnerSchedule } from "./partner-schedule-interactions.js";
import { DshChannelCleanup } from "./channel-cleanup.js";
import { dshGuestLogin } from "./guest-shoutouts.js";
import { SqliteDshLiveMonitor } from "./live-monitor.js";
import { dshShoutoutGroupSlug } from './shoutout-groups.js';
import { communityCalendarMissions } from "@spmt/ui";
import { DshCalendarSync } from "./calendar-sync.js";
import { DshCalendarDelivery } from "./calendar-delivery.js";
import { respondDshCalendarInteraction } from "./calendar-interactions.js";
import { resolveProviderIdentity, listCommunityIdentities } from "@spmt/sdk/provider-identity";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dshCaptainParticipation, renderDshCalendarPng, renderDshLeaderboardPng } from "./calendar-presentation.js";
import { buildDshTierShoutout, DSH_LIVE_EMBED_TEMPLATES, dshShoutoutView, type DshShoutoutView } from "./shoutout-presentation.js";
import { DshShoutoutGenerationStore } from "./shoutout-generation.js";
import { fetchAppPlatformSnapshot, fetchAppSessionContext, readJsonBody, requireSameOrigin, safeError, sendJson } from "@spmt/app-foundation/product-web";
import { isSimulationDiscordId, simulationDiscordIds, type SpmtOperationModeV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { buildDshPublicApplicationEmbed } from "./application-flow.js";
import { SqliteDshApplicationStore } from "./applications.js";
import { SqliteDshCalendarStore } from "./calendar.js";
import { DshDiscordApi, DshDiscordError, SqliteDshDiscordMessageStore, type DshDiscordGrantSourceV1 } from "./discord-live-publisher.js";
import { createDshWorkerTokenProvider, loadDshLiveRuntimeConfig, type DshLiveRuntimeConfigV1 } from "./live-worker.js";
import { DshSimulationRoomDiscordTransport } from "./simulation-room.js";
import { DshTenantSettingsStore } from "./settings.js";
import { DshPointsService, buildDshLeaderboardPayload } from "./points.js";
import { dshSignalSeekerPanelPayload, dshSignalDropInteractionPayload, dshSignalDropClue, SqliteDshSignalSeekerStore } from "./signal-seeker.js";
import { DshVoidwalkerRewardWorker, SqliteDshVoidwalkerRewardStore } from "./voidwalker-reward-worker.js";

export interface DshWebControlOptionsV1 {
  spmtOrigin: string;
  publicOrigin?: string;
  databasePath?: string;
  runtimeConfigPath?: string;
  credential?: string;
  serviceCredential?: string;
  operationMode?: SpmtOperationModeV1;
  applicationInteractionsReady?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

type SessionContext = Awaited<ReturnType<typeof fetchAppSessionContext>>;

/** Authenticated, app-owned controls used by the DSH browser surface. */
export class DshWebControls {
  private readonly memberDirectory?:DshMemberDirectoryStore;
  private readonly cleanup?:DshChannelCleanup;
  private readonly activity?:DshMemberActivityStore;
  private readonly monitor?:SqliteDshLiveMonitor;
  private readonly calendar?: SqliteDshCalendarStore;
  private readonly settings?: DshTenantSettingsStore;
  private readonly messages?: SqliteDshDiscordMessageStore;
  private readonly applications?: SqliteDshApplicationStore;
  private readonly shoutouts?: DshShoutoutGenerationStore;
  private readonly clipGifs?: SqliteDshClipGifStore;
  private readonly signalControlStore?:SqliteDshSignalControlStore;
  private readonly signalSeekers?:SqliteDshSignalSeekerStore;
  private readonly forumForwardingStore?:DshForumForwardingStore;
  private readonly forumForwarding?:DshForumForwardingService;
  private readonly raidPile?:DshRaidPileStore;
  private readonly raidTrain?:DshRaidTrainStore;
  private readonly config?: DshLiveRuntimeConfigV1;
  private readonly discord?: DshSimulationRoomDiscordTransport;
  private client?:SpmtClient;
  private sync?:DshCalendarSync;
  private partners?:DshPartnerSchedules;
  private onboarding?:DshOnboardingPanel;
  private delivery?:DshCalendarDelivery;
  private liveDiscord?:DshDiscordApi;
  private voidwalkerRewards?:DshVoidwalkerRewardWorker;
  private readonly now: () => string;

  constructor(private readonly options: DshWebControlOptionsV1) {
    this.now = options.now ?? (() => new Date().toISOString());
    if (options.databasePath) {
      this.activity=new DshMemberActivityStore(options.databasePath);
      this.cleanup=new DshChannelCleanup(options.databasePath);
      this.monitor=new SqliteDshLiveMonitor(options.databasePath);
      this.calendar = new SqliteDshCalendarStore(options.databasePath);
      this.settings = new DshTenantSettingsStore(options.databasePath, this.now);
      this.messages = new SqliteDshDiscordMessageStore(options.databasePath);
      this.applications = new SqliteDshApplicationStore(options.databasePath);
      this.shoutouts = new DshShoutoutGenerationStore(options.databasePath, this.now);
      this.signalSeekers = new SqliteDshSignalSeekerStore(options.databasePath, this.now);
      this.forumForwardingStore = new DshForumForwardingStore(options.databasePath);
      this.raidPile = new DshRaidPileStore(options.databasePath, (tenantId) => this.raidPileSettings(tenantId));
      this.raidTrain = new DshRaidTrainStore(options.databasePath, this.now);
      this.clipGifs = new SqliteDshClipGifStore(options.databasePath);
      this.signalControlStore=new SqliteDshSignalControlStore(options.databasePath);
    }
    if (options.runtimeConfigPath) this.config = loadDshLiveRuntimeConfig(options.runtimeConfigPath);
    if(options.databasePath&&this.config&&this.settings)this.memberDirectory=new DshMemberDirectoryStore(options.databasePath,this.config,this.settings);
    if (options.credential) {
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
      if(options.databasePath&&this.config){this.voidwalkerRewards=new DshVoidwalkerRewardWorker(client,liveDiscord,new SqliteDshVoidwalkerRewardStore(options.databasePath),this.config.tenants, this.now, options.operationMode==="read-only");this.voidwalkerRewards.start();}
      if(this.forumForwardingStore)this.forumForwarding=new DshForumForwardingService(this.forumForwardingStore,liveDiscord,this.now);
      this.discord = new DshSimulationRoomDiscordTransport(liveDiscord, client, { guildIds: (tenantId) => this.config?.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds ?? [], now: this.now, liveWrites: options.operationMode !== "read-only" });
      if(this.calendar&&this.messages){this.sync=new DshCalendarSync(options.databasePath!,this.calendar,this.discord,this.now,options.publicOrigin);if(this.config&&options.publicOrigin)this.onboarding=new DshOnboardingPanel(this.calendar,this.messages,this.discord,client,this.config,options.publicOrigin,this.now);if(this.config)this.partners=new DshPartnerSchedules(this.calendar,this.messages,client,this.config,this.discord,options.fetchImpl,this.now,(tenant,guild)=>this.members(tenant,guild));this.delivery=new DshCalendarDelivery(this.calendar,this.messages,this.discord,this.now,client,options.operationMode==="read-only");}
    }
  }

  close() { this.voidwalkerRewards?.close();this.memberDirectory?.close();this.activity?.close();this.cleanup?.close();this.monitor?.close(); this.calendar?.close(); this.settings?.close(); this.messages?.close(); this.applications?.close(); this.shoutouts?.close();this.signalSeekers?.close();this.forumForwardingStore?.close();this.raidPile?.close();this.raidTrain?.close();this.clipGifs?.close();this.signalControlStore?.close(); }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if(url.pathname==="/api/internal/media/clip"){
      if(request.method!=="POST")return sendJson(response,405,{message:"Use POST"});
      if(!this.authorizeWorker(request))return sendJson(response,401,{message:"Unauthorized"});
      try{
        if(this.options.operationMode!=="active"||!this.clipGifs||!this.config)return sendJson(response,503,{message:"Clip media ingestion is unavailable"});
        const tenantId=String(url.searchParams.get("tenantId")??"").trim(),tenant=this.config.tenants.find(item=>item.tenantId===tenantId);
        if(!tenant)return sendJson(response,403,{message:"Unknown DSH tenant"});
        const streamerLogin=String(url.searchParams.get("streamerLogin")??"").trim().toLowerCase(),clipId=String(url.searchParams.get("clipId")??"").trim(),durationSeconds=Number(url.searchParams.get("durationSeconds")??"60");
        if(!/^[a-z0-9_]{1,32}$/.test(streamerLogin)||!/^[A-Za-z0-9_-]{1,120}$/.test(clipId)||!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>60)return sendJson(response,400,{message:"Invalid clip metadata"});
        const contentType=(String(request.headers["content-type"]??"").split(";")[0]??"").trim().toLowerCase();
        if(contentType!=="image/gif")return sendJson(response,415,{message:"Upload a GIF image"});
        const declared=Number(request.headers["content-length"]??0);if(declared>50*1024*1024)return sendJson(response,413,{message:"GIF exceeds the 50 MB upload limit"});
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of request){const part=Buffer.from(chunk);size+=part.length;if(size>50*1024*1024)return sendJson(response,413,{message:"GIF exceeds the 50 MB upload limit"});chunks.push(part);}
        const gif=Buffer.concat(chunks);if(!gif.length)return sendJson(response,400,{message:"GIF body is empty"});
        const capturedAt=String(url.searchParams.get("capturedAt")??this.now());
        const sourceRaw=url.searchParams.get("sourceUrl")??undefined,sourceUrl=sourceRaw?new URL(sourceRaw):undefined;
        if(sourceUrl&&(sourceUrl.protocol!=="https:"||sourceUrl.username||sourceUrl.password))return sendJson(response,400,{message:"sourceUrl must be credential-free HTTPS"});
        const saved=this.clipGifs.put({schemaVersion:1,tenantId,streamerLogin,clipId,capturedAt,durationSeconds,...(sourceUrl?{sourceUrl:sourceUrl.toString()}:{}),gif});
        return sendJson(response,201,{ok:true,tenantId,streamerLogin,clipId,capturedAt,bytes:saved.gif.byteLength});
      }catch(error){return sendJson(response,400,{message:safeError(error)});}
    }
    if (url.pathname === "/api/internal/signal/transmit") {
      if (request.method !== "POST") return sendJson(response, 405, { message: "Use POST" });
      if (!this.authorizeWorker(request)) return sendJson(response, 401, { message: "Unauthorized" });
      try {
        if(this.options.operationMode!=="active"||!this.liveDiscord||!this.config)return sendJson(response,503,{message:"Live Signal transmission is unavailable"});
        const body=record(await readJsonBody(request))??{},tenantId=text(body.tenantId,"tenantId",180),guild=this.guild(tenantId,body.guildId),channelId=snowflake(body.channelId,"channelId");
        const channel=await this.liveDiscord.getChannel(tenantId,channelId);
        if(channel.guild_id!==guild||Number(channel.type)!==0)return sendJson(response,400,{message:"Signal destination must be a text channel in the selected server"});
        const username=text(body.requesterName,"requesterName",80),signalText=text(body.signalText,"signalText",2000);
        const presentation=buildDshSignalPresentation({displayName:username,username,signalText,...(body.userAvatarUrl?{userAvatarUrl:String(body.userAvatarUrl)}:{}),signalBadgeUrl:String(body.signalBadgeUrl??"https://cdn.discordapp.com/emojis/1284931162896334929.gif")});
        const embed={...presentation.embeds[0],author:{name:presentation.webhookUsername,icon_url:presentation.webhookAvatarUrl}};
        const messageId=await this.liveDiscord.createMessage(tenantId,channelId,{content:"",embeds:[embed],allowed_mentions:{parse:[]}});
        const requesterDiscordUserId=optionalSnowflake(body.requesterDiscordId),requesterTwitchUserId=optionalSnowflake(body.requesterTwitchUserId),requesterIdentities=await Promise.all([requesterDiscordUserId&&this.client?resolveProviderIdentity(this.client,tenantId,"discord",requesterDiscordUserId).catch(()=>undefined):undefined,requesterTwitchUserId&&this.client?resolveProviderIdentity(this.client,tenantId,"twitch",requesterTwitchUserId).catch(()=>undefined):undefined]),requesterIds=[...new Set(requesterIdentities.map(identity=>identity?.userId).filter((id):id is string=>Boolean(id)))],requesterUserId=requesterIds.length===1?requesterIds[0]:undefined,dropId=randomUUID();
        let removalControl=false;
        if(this.signalControlStore&&this.options.serviceCredential&&this.options.publicOrigin){
          try{
            const signer=this.signalControlSigner(),token=signer.issue({tenantId,dropId,channelId,messageId,...(requesterUserId?{requesterUserId}:{}),...(requesterDiscordUserId?{requesterDiscordUserId}:{})}),url=dshSignalRemovalUrl(this.options.publicOrigin,token),targetName=String(body.targetName??"").trim().slice(0,100)||"Signal";
            this.signalControlStore.put({schemaVersion:1,tenantId,dropId,guildId:guild,channelId,messageId,requesterName:username,targetName,...(requesterUserId?{requesterUserId}:{}),...(requesterDiscordUserId?{requesterDiscordUserId}:{}),createdAt:this.now()});
            await this.liveDiscord.editMessage(tenantId,channelId,messageId,{content:"",embeds:[{...embed,fields:[{name:"\\u200b",value:"[🗑️]("+url+")",inline:false}]}],allowed_mentions:{parse:[]}}).catch(()=>undefined);
            removalControl=true;
          }catch{/* A failed optional removal control must not undo a successfully posted Signal. */}
        }
        return sendJson(response,201,{ok:true,messageId,removalControl});
      } catch(error) { return sendJson(response,502,{message:safeError(error)}); }
    }
    if (url.pathname === "/api/internal/signal/channel") {
      if (request.method !== "GET") return sendJson(response, 405, { message: "Use GET" });
      if (!this.authorizeWorker(request)) return sendJson(response, 401, { message: "Unauthorized" });
      if (this.options.operationMode !== "active" || !this.liveDiscord || !this.config) return sendJson(response, 503, { message: "Live Signal destination lookup is unavailable" });
      try {
        const tenantId=String(url.searchParams.get("tenantId")??"").trim();
        if(!tenantId)return sendJson(response,400,{message:"tenantId is required"});
        const tenant=this.config.tenants.find(item=>item.tenantId===tenantId);
        if(!tenant)return sendJson(response,404,{message:"Signal tenant is not configured"});
        for(const guildId of tenant.discordGuildIds??[]){
          const channels=await this.liveDiscord.listGuildChannels(tenantId,guildId);
          const channel=channels.find(item=>Number(item.type)===0&&String(item.name??"").toLowerCase()==="comms-lounge");
          if(channel?.id)return sendJson(response,200,{source:"discord-stream-hub",kind:"signal-destination",guildId,channelId:channel.id,channelName:String(channel.name??"comms-lounge")});
        }
        return sendJson(response,404,{message:"comms-lounge was not found in the tenant's configured Discord servers",tenantId});
      } catch(error) { return sendJson(response,502,{message:safeError(error)}); }
    }
    if (url.pathname === "/api/internal/signal/seekers") {
      if (request.method !== "POST") return sendJson(response, 405, { message: "Use POST" });
      if (!this.authorizeWorker(request)) return sendJson(response, 401, { message: "Unauthorized" });
      try { return await this.updateSignalSeekerFromTwitch(request, response); }
      catch (error) { return sendJson(response, 502, { message: safeError(error) }); }
    }
    if (url.pathname === "/api/internal/signal/drop") {
      if (request.method !== "POST") return sendJson(response, 405, { message: "Use POST" });
      if (!this.authorizeWorker(request)) return sendJson(response, 401, { message: "Unauthorized" });
      try {
        if(this.options.operationMode!=="active"||!this.liveDiscord||!this.signalSeekers)return sendJson(response,503,{message:"Live Signal drops are unavailable"});
        const body=record(await readJsonBody(request))??{},tenantId=text(body.tenantId,"tenantId",180),guild=this.guild(tenantId,body.guildId),channelId=snowflake(body.channelId,"channelId");
        const channel=await this.liveDiscord.getChannel(tenantId,channelId);
        if(channel.guild_id!==guild||![0,5].includes(Number(channel.type)))return sendJson(response,400,{message:"Choose a text channel in the selected Discord server"});
        const roles=await this.liveDiscord.listGuildRoles(tenantId,guild);
        let role=roles.find(item=>!item.managed&&item.name.toLowerCase()==="signal seeker");
        if(!role)role=await this.liveDiscord.createGuildRole(tenantId,guild,{name:"Signal Seeker",color:0x5865f2,mentionable:true,hoist:false});
        const clue=text(body.clue,"clue",1800),botName=String(body.botName??"StreamWeaver").trim().slice(0,80)||"StreamWeaver",avatarUrl=body.avatarUrl?new URL(String(body.avatarUrl)):undefined;
        if(avatarUrl&&(avatarUrl.protocol!=="https:"||avatarUrl.username||avatarUrl.password))return sendJson(response,400,{message:"Avatar URL must be credential-free HTTPS"});
        const dropId=randomUUID(),payload=dshSignalDropInteractionPayload(role.id,dropId,{name:botName,...(avatarUrl?{iconUrl:avatarUrl.toString()}:{})});
        const messageId=await this.liveDiscord.createMessage(tenantId,channelId,payload);
        try {
          const drop=this.signalSeekers.createDrop({dropId,tenantId,guildId:guild,channelId,messageId,roleId:role.id,clue,now:this.now()});
          return sendJson(response,201,{ok:true,dropId,messageId,expiresAt:drop.expiresAt});
        } catch(error) { await this.liveDiscord.deleteMessage(tenantId,channelId,messageId).catch(()=>undefined); throw error; }
      } catch(error) { return sendJson(response,502,{message:safeError(error)}); }
    }
    if(url.pathname==="/signal/remove"){
      if(request.method!=="GET")return sendJson(response,405,{message:"Use GET"});
      try{
        const context=await fetchAppSessionContext({appId:"discord-stream-hub",spmtOrigin:this.options.spmtOrigin,request}),token=String(url.searchParams.get("control")??"");
        if(!this.liveDiscord||!this.signalControlStore)return sendJson(response,503,{message:"Signal removal is unavailable"});
        const result=await removeDshSignal(this.signalControlSigner(),{
          deleteMessage:async(tenant,channel,message)=>{try{await this.liveDiscord!.deleteMessage(tenant,channel,message);}catch(error){if(!(error instanceof DshDiscordError&&error.status===404))throw error;}},
          removeDrop:(tenant,id)=>this.signalControlStore!.suppress(tenant,id,this.now()),
        },{tenantId:context.tenantId,role:this.role(context),userId:String(context.session.actorId??""),discordUserId:String((context.session as any).discordUserId??"")},token);
        return sendJson(response,200,{...result,message:result.removed?"Signal removed from the live shoutout rotation.":"Signal was already removed from the live shoutout rotation."});
      }catch(error){return sendJson(response,403,{message:safeError(error)});}
    }
    if (!url.pathname.startsWith("/api/discord-stream-hub/control")) return false;
    try {
      const context = await fetchAppSessionContext({ appId: "discord-stream-hub", spmtOrigin: this.options.spmtOrigin, request });
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/raid-train"){
        if(!this.raidTrain)return sendJson(response,503,{message:"Raid Train storage is unavailable"});
        const guild=this.guild(context.tenantId,url.searchParams.get("guildId")),date=String(url.searchParams.get("date")??new Date(Date.parse(this.now())+86400000).toISOString().slice(0,10));
        return sendJson(response,200,{guildId:guild,date,slots:this.raidTrain.schedule(context.tenantId,guild,date)});
      }
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/forum/rules"){this.requireOwner(context);if(!this.client)throw new Error("Connect DSH to read canonical forum forwarding rules");return sendJson(response,200,await this.client.listCommlinkForumForwardRules(context.tenantId));}
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/raid-pile") return sendJson(response,200,await this.raidPileState(context,request));
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/moderation") {this.requireOwner(context);return sendJson(response,200,{plans:this.cleanup?.list(context.tenantId,String(context.session.actorId),"owner")??[]});}
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/moderation/job") {
        this.requireOwner(context);if(!this.client)throw new Error("Connect DSH to read cleanup job status");
        const job=await this.client.getExecutionJob(context.tenantId,text(url.searchParams.get("id"),"jobId",180));
        if(job.executionOwner!=="discord-stream-hub"||!String(job.input.action).startsWith("dsh.moderation."))throw new Error("Choose a DSH cleanup job");
        return sendJson(response,200,{jobId:job.id,state:job.state,result:job.result,error:job.error});
      }
      if(url.pathname==="/api/discord-stream-hub/control/checkin-members"){
        this.requireOwner(context);if(request.method!=="GET")return sendJson(response,405,{message:"Use GET"});
        if(this.options.operationMode!=="active")throw new Error("Live Discord role lookup is disabled in this environment");
        if(!this.liveDiscord)throw new Error("Connect Discord Stream Hub before importing role members");
        const guild=this.guild(context.tenantId,url.searchParams.get("guildId"));if(isSimulationDiscordId(guild))throw new Error("Choose a live Discord server for role import");
        return sendJson(response,200,{tenantId:context.tenantId,...await this.liveDiscord.checkinRoleMembers(context.tenantId,guild,String(url.searchParams.get("roleId")??""))});
      }
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/calendar-image"){
        const guild=url.searchParams.get("guildId")?this.guild(context.tenantId,url.searchParams.get("guildId")):"workspace",month=String(url.searchParams.get("month")??this.now().slice(0,7));
        const png=await renderDshCalendarPng(this.requireCalendar().month(context.tenantId,guild,month),month,this.options.fetchImpl,this.now().slice(0,10));response.writeHead(200,{"content-type":"image/png","cache-control":"no-store","content-disposition":`attachment; filename="community-calendar-${month}.png"`});response.end(png);return true;
      }
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/calendar/partner-image"){
        if(!this.partners)throw Error("Connect DSH to view partner calendars");const guild=this.guild(context.tenantId,url.searchParams.get("guildId")),month=String(url.searchParams.get("month")??this.now().slice(0,7)),view=this.partners.view(context.tenantId,guild,text(url.searchParams.get("userId"),"userId",180),month);
        const png=await renderDshCalendarPng(view.events,month,this.options.fetchImpl,this.now().slice(0,10));response.writeHead(200,{"content-type":"image/png","cache-control":"no-store"});response.end(png);return true;
      }
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/calendar")return sendJson(response,200,this.calendarView(context.tenantId,url.searchParams.get("guildId"),String(url.searchParams.get("month")??this.now().slice(0,7))));
      if(request.method==="GET"&&url.pathname==="/api/discord-stream-hub/control/calendar/raid-train")return sendJson(response,200,{slots:this.requireCalendar().raidTrainSlots(context.tenantId,this.calendarScope(context.tenantId,url.searchParams.get("guildId")),day(url.searchParams.get("date")))});
      if (request.method === "GET" && url.pathname === "/api/discord-stream-hub/control") return await this.read(request, response, context, url);
      if (request.method === "GET" && url.pathname === "/api/discord-stream-hub/control/shoutouts") return sendJson(response, 200, await this.shoutoutView(request, context));
      if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
      requireSameOrigin(request);
      const body = await readJsonBody(request);
      if(url.pathname==="/api/discord-stream-hub/control/raid-pile/join"||url.pathname==="/api/discord-stream-hub/control/raid-pile/leave"||url.pathname==="/api/discord-stream-hub/control/raid-pile/advance"){
        const store=this.requireRaidPile(),actor=String(context.session.actorId??"");
        if(url.pathname.endsWith("/join")){const linked=await this.raidPileIdentity(context,request);const result=store.join(context.tenantId,{userId:actor,twitchLogin:linked.twitchLogin,displayName:linked.displayName??linked.twitchLogin});return sendJson(response,200,{...result,message:result.duplicate?"You are already in the Raid Pile.":"You joined the Raid Pile."});}
        if(url.pathname.endsWith("/leave")){const result=store.leave(context.tenantId,actor);return sendJson(response,200,{...result,message:result.removed?"You left the Raid Pile.":"You were not in the Raid Pile."});}
        this.requireOwner(context);const pileId=text(body.pileId,"pileId",180),requestId=text(body.requestId,"requestId",120);
        const target=this.requireCalendar().once(context.tenantId,`raid-pile-advance:${this.requestKey(context,body)??requestId}`,()=>store.advance(context.tenantId,pileId,"manual"));
        return sendJson(response,200,{target:target??null,piles:store.piles(context.tenantId),message:target?`Next announced target: ${target.displayName}. Twitch raid remains voluntary.`:"No other live member is available."});
      }
      if(url.pathname==="/api/discord-stream-hub/control/raid-train/publish"){
        this.requireOwner(context);requireSameOrigin(request);
        if(this.options.operationMode!=="active"||!this.liveDiscord||!this.raidTrain)throw new Error("Live Raid Train publishing is unavailable");
        const input=record(body)??{},guild=this.guild(context.tenantId,input.serverId),channelId=snowflake(input.channelId,"channelId");
        const date=String(input.date||new Date(Date.parse(this.now())+86400000).toISOString().slice(0,10));
        const channel=await this.liveDiscord.getChannel(context.tenantId,channelId);
        if(channel.guild_id!==guild||![0,5].includes(Number(channel.type)))throw new Error("Choose a text channel in the selected Discord server");
        const tenant=this.config?.tenants.find(item=>item.tenantId===context.tenantId),payload=dshRaidTrainPayload(this.raidTrain.schedule(context.tenantId,guild,date),date,tenant?.branding.communityMemberName??"Space Mountain");
        const messageId=await this.liveDiscord.createMessage(context.tenantId,channelId,payload);
        this.raidTrain.setPanel({tenantId:context.tenantId,guildId:guild,date,channelId,messageId});
        return sendJson(response,201,{ok:true,guildId:guild,channelId,date,messageId});
      }
      if(url.pathname==="/api/discord-stream-hub/control/forum/rules"){
        this.requireOwner(context);if(!this.forumForwardingStore||!this.liveDiscord||!this.client)throw new Error("Connect DSH before configuring forum forwarding");
        const rule=body.rule as DshForumForwardRuleV1;
        const sourceGuild=this.guild(context.tenantId,rule.sourceGuildId),destinationGuild=this.guild(context.tenantId,rule.destinationGuildId);
        const destination=rule.mode==="single-thread"?await this.liveDiscord.getChannel(context.tenantId,String(rule.sharedThreadId??"")):await this.liveDiscord.getChannel(context.tenantId,rule.forumChannelId);
        if(rule.mode==="single-thread"){if(destination.guild_id!==destinationGuild||![10,11,12].includes(Number(destination.type)))throw new Error("Choose a thread in the configured destination server");}
        else if(destination.guild_id!==destinationGuild||![15,16].includes(Number(destination.type)))throw new Error("Choose a forum or media channel in the configured destination server");
        const saved=(await this.client.putCommlinkForumForwardRule(context.tenantId,{...rule,tenantId:context.tenantId,sourceGuildId:sourceGuild,destinationGuildId:destinationGuild})).rule;this.forumForwardingStore.putRule(saved);
        if(!this.forumForwardingStore.cursor(context.tenantId)&&this.client){const latest=await this.client.listEvents(context.tenantId,{sourceAppId:"chat-gateway",limit:1});const eventId=String(latest[0]?.id??"");if(eventId)this.forumForwardingStore.advanceCursor(context.tenantId,eventId);}
        return sendJson(response,200,{rule:saved});
      }
      if(url.pathname==="/api/discord-stream-hub/control/forum/import"){
        this.requireOwner(context);if(!this.liveDiscord||!this.client)throw new Error("Connect DSH before importing Discord forum threads");
        const sourceGuild=this.guild(context.tenantId,body.serverId),forumChannelId=snowflake(body.forumChannelId,"forumChannelId");
        const result=await importDshDiscordForumThreads(this.client,this.liveDiscord,context.tenantId,sourceGuild,forumChannelId);
        return sendJson(response,200,{...result,message:"Discord forum topics and replies imported into native Commlink."});
      }
      if(url.pathname==="/api/discord-stream-hub/control/forum/discord-forward"){
        this.requireOwner(context);if(!this.liveDiscord||!this.forumForwarding)throw new Error("Connect DSH before forwarding Discord messages");
        const sourceGuild=this.guild(context.tenantId,body.guildId),channelId=snowflake(body.channelId,"channelId");
        const [guild,channel]=await Promise.all([this.liveDiscord.getGuild(context.tenantId,sourceGuild),this.liveDiscord.getChannel(context.tenantId,channelId)]);
        if(channel.guild_id!==sourceGuild)throw new Error("Source channel does not belong to the selected server");
        const publicSource=isPublicDshForumSource(guild,channel);
        const messageId=snowflake(body.messageId,"messageId"),author=record(body.author)??{};
        const event:DshForumForwardMutationV1={tenantId:context.tenantId,guildId:sourceGuild,channelId,channelName:String(channel.name??channelId),channelType:Number(channel.type??0),messageId,authorId:String(author.id??"unknown"),authorName:String(author.global_name??author.username??body.authorName??"Discord member"),...(typeof author.avatarUrl==="string"?{authorAvatar:author.avatarUrl}:{}),content:String(body.content??""),...(Array.isArray(body.attachments)?{attachments:body.attachments as NonNullable<DshForumForwardMutationV1["attachments"]>} : {}),...(Array.isArray(body.embeds)?{embeds:body.embeds as NonNullable<DshForumForwardMutationV1["embeds"]>}:{}),sourceMessageUrl:"https://discord.com/channels/"+sourceGuild+"/"+channelId+"/"+messageId,occurredAt:String(body.occurredAt??this.now()),sourceIsPublic:publicSource,authorIsBot:Boolean(author.bot),originatedFromForwarder:Boolean(body.originatedFromForwarder),operation:body.operation==="edit"||body.operation==="delete"?body.operation:"create"};
        const result=await this.forumForwarding.apply(event);
        if((result.status==="forwarded"||result.status==="edited"||result.status==="deleted")&&this.client)await forwardDshForumPost(this.client,context.tenantId,{sourceApp:"discord-stream-hub",sourceServerId:sourceGuild,sourceChannelId:channelId,sourceChannelName:event.channelName,sourceMessageId:messageId,sourceMessageUrl:event.sourceMessageUrl,authorId:event.authorId,authorName:event.authorName,title:guild.name+" / #"+event.channelName,content:event.content,postedAt:event.occurredAt,attachments:event.attachments??[],embeds:event.embeds??[],operation:event.operation});
        return sendJson(response,200,{result});
      }
      if(url.pathname==="/api/discord-stream-hub/control/forum/forward"){
        this.requireOwner(context);if(!this.client)throw new Error("Connect DSH before forwarding forum posts");
        const result=await forwardDshForumPost(this.client,context.tenantId,body.post??body);
        return sendJson(response,result.duplicate?200:201,{...result,message:result.duplicate?"This forum post was already forwarded.":"Forum post forwarded to the canonical SPMT event stream."});
      }
      if(url.pathname.startsWith("/api/discord-stream-hub/control/calendar/partner/")){
        if(!this.partners)throw Error("Connect DSH to use partner calendars");
        const guild=this.guild(context.tenantId,body.serverId),user=text(body.userId,"userId",180),month=String(body.month??this.now().slice(0,7)),actor=String(context.session.actorId),owner=this.role(context)==="owner",action=url.pathname.split("/").at(-1);
        if(action==="refresh")return sendJson(response,200,{...await this.partners.sync(context.tenantId,guild,user,month),message:"Schedule refreshed. Provider status is shown with the calendar."});
        if(action==="add")return sendJson(response,200,this.partners.add(context.tenantId,guild,user,actor,owner,{name:text(body.name,"name",100),date:day(body.date),time:clock(body.time),description:String(body.description??"Personal event"),requestId:text(body.requestId,"requestId",100)}));
        if(action==="remove")return sendJson(response,200,this.partners.remove(context.tenantId,guild,user,actor,owner,text(body.eventId,"eventId",180)));
        if(action==="publish"){this.requireOwner(context);return sendJson(response,200,await this.partners.publish(context.tenantId,guild,user,snowflake(body.channelId,"channelId"),month));}
        return sendJson(response,404,{error:"not_found"});
      }
      if(url.pathname==="/api/discord-stream-hub/control/calendar/raid-train/reserve"||url.pathname==="/api/discord-stream-hub/control/calendar/raid-train/cancel") {
        const store=this.requireCalendar(),serverId=this.calendarScope(context.tenantId,body.serverId),member=await this.member(context,request),reserve=url.pathname.endsWith("/reserve");
        const result=store.once(context.tenantId,`raid:${reserve?"reserve":"cancel"}:${this.requestKey(context,body)??text(body.requestId,"requestId",100)}`,()=>reserve?
          store.reserveRaidTrain({tenantId:context.tenantId,serverId,member,date:day(body.date),hour:integer(body.hour,0,23,"hour"),now:this.now()}):
          store.cancelRaidTrain(context.tenantId,serverId,text(body.eventId,"eventId",180),member.userId,this.role(context)==="owner"));
        return sendJson(response,200,{...result,effects:await this.changed(context.tenantId)});
      }
      if (url.pathname === "/api/discord-stream-hub/control/calendar/captain") return await this.captain(response, context, body,request);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/update") return await this.changeCalendar(response, context, body, false);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/delete") return await this.changeCalendar(response, context, body, true);
      this.requireOwner(context);
      if(url.pathname==="/api/discord-stream-hub/control/onboarding/publish"){if(!this.onboarding)throw Error("Connect SPMT and configure its public address before publishing a linking panel");if(!this.options.applicationInteractionsReady)throw Error("Configure the Discord interaction endpoint before publishing a linking panel");return sendJson(response,200,await this.onboarding.publish(context.tenantId,this.guild(context.tenantId,body.serverId),snowflake(body.channelId,"channelId")));}
      if(url.pathname==="/api/discord-stream-hub/control/moderation/preview"||url.pathname==="/api/discord-stream-hub/control/moderation/execute") {
        if(!this.client)throw new Error("Connect DSH before using channel cleanup");
        const preview=url.pathname.endsWith("/preview"),userId=String(context.session.actorId),requestId=text(body.requestId,"requestId",100),action=preview?"dsh.moderation.preview":"dsh.moderation.execute";
        let args:Record<string,string>;
        if(preview){const guildId=this.guild(context.tenantId,body.serverId);if(isSimulationDiscordId(guildId))throw new Error("Choose a live Discord server to preview its messages");args={guildId,channelId:snowflake(body.channelId,"channelId"),mode:text(body.mode,"mode",10),...(body.mode==="until"?{untilMessageId:snowflake(body.untilMessageId,"untilMessageId")}: {})};}
        else args={planId:text(body.planId,"planId",180)};
        const result=await this.client.createSuiteActionJob(context.tenantId,{schemaVersion:1,action,args,actor:{userId,username:String(context.session.username??context.session.displayName??userId),role:"owner"},source:{kind:"api",requestId,...(this.options.operationMode==="read-only"?{simulation:true}:{})}},`${action}:${userId}:${requestId}`);
        return sendJson(response,202,{jobId:result.job.id,state:result.job.state,message:preview?"Cleanup preview queued. Its exact selection will appear below.":"Cleanup queued. Its progress will appear below."});
      }
      if (url.pathname === "/api/discord-stream-hub/control/shoutouts/generate") {
        if (!this.client || !this.shoutouts) throw new Error("The shoutout writer is not connected yet");
        const feed = await this.shoutoutView(request, context), member = feed.liveMembers.find(row => row.id === body.eventId && row.twitchLogin === body.twitchLogin);
        if (!member) throw new Error("This shoutout is no longer in the live feed. Refresh and try again.");
        const requestId = text(body.requestId, "requestId", 300);
        return sendJson(response, 202, {generated: await this.shoutouts.start(context.tenantId, String(context.session.actorId), member, requestId, this.client)});
      }
      if (url.pathname === "/api/discord-stream-hub/control/shoutouts/post") {
        if (!this.client) throw new Error("Connect DSH before posting a shoutout");
        const tenant=this.config?.tenants.find(t=>t.tenantId===context.tenantId), target=dshGuestLogin(text(body.twitchLogin,"twitchLogin",300));
        const guildId=this.guild(context.tenantId,body.serverId),requestId=text(body.requestId,"requestId",100),userId=String(context.session.actorId);
        if(isSimulationDiscordId(guildId)){
          const room=await this.discord?.target(context.tenantId,guildId);if(!room||!this.discord)throw new Error("The shadow room is no longer available");
          const channelId=simulationDiscordIds(context.tenantId,room.roomId).channelId;
          await this.validateDestination(context.tenantId,guildId,channelId);
          const feed=await this.shoutoutView(request,context),member=feed.liveMembers.find(m=>m.twitchLogin===target);
          const saved=this.requireCalendar().once(context.tenantId,`shoutout-preview:${userId}:${requestId}`,()=>({target,channelId,payload:member?buildDshTierShoutout(member,{timestamp:this.now(),...(tenant?.branding.embedTemplates?{templates:tenant.branding.embedTemplates}:{})}):{embeds:[{title:`Temporary guest shoutout · ${target}`,description:"Preview: Twitch will supply the creator profile and live status before posting.",url:`https://twitch.tv/${target}`}],allowed_mentions:{parse:[]}}}));
          if(saved.target!==target||saved.channelId!==channelId)throw new Error("This request belongs to another shoutout destination");
          const messageId=await this.discord.createMessage(context.tenantId,channelId,saved.payload);
          return sendJson(response,200,{messageId,simulation:true,shadowRoomId:room.roomId});
        }
        if(!tenant)throw new Error("DSH is not configured for this tenant");
        const channelId=body.channelId?snowflake(body.channelId,"channelId"):this.members(context.tenantId,String(body.serverId??"")||undefined).find(member=>member.twitchLogin===target)?.shoutoutChannelId;
        if(!channelId)throw new Error("Choose a channel for the temporary guest shoutout");
        const result=await this.client.createSuiteActionJob(context.tenantId,{schemaVersion:1,action:"dsh.shoutouts.post",args:{target,guildId,...(body.channelId?{channelId}:{})},actor:{userId,username:String(context.session.username??context.session.displayName??userId),role:"owner"},source:{kind:"api",requestId,...(this.options.operationMode==="read-only"?{simulation:true}:{})}},`dsh-post:${userId}:${requestId}`);
        return sendJson(response,202,{jobId:result.job.id,state:result.job.state,simulation:this.options.operationMode==="read-only"});
      }
      if(url.pathname==="/api/discord-stream-hub/control/shoutouts/guest/remove") {
        if(!this.monitor)throw new Error("DSH shoutout storage is unavailable");
        const result=this.monitor.guests.remove(context.tenantId,text(body.targetId,"targetId",100),String(context.session.actorId),`web-remove:${this.requestKey(context,body)??text(body.requestId,"requestId",100)}`,this.now());
        return sendJson(response,200,{...result,message:"Guest shoutout removed. Discord deletion is queued and will retry if needed."});
      }
      if(url.pathname==="/api/discord-stream-hub/control/calendar/sync"){if(!this.sync)throw new Error("Connect Discord before synchronizing events");await this.sync.sync(context.tenantId,this.guild(context.tenantId,body.serverId));await this.delivery?.flush(context.tenantId);return sendJson(response,200,{saved:true});}
      if(url.pathname==="/api/discord-stream-hub/control/calendar/resolve"){if(!this.sync)throw new Error("Connect Discord before synchronizing events");if(!["calendar","discord","retry"].includes(String(body.choice)))throw new Error("Choose a calendar or Discord version");await this.sync.resolve(context.tenantId,this.guild(context.tenantId,body.serverId),text(body.eventId,"eventId",180),body.choice as "calendar"|"discord"|"retry");await this.delivery?.flush(context.tenantId);return sendJson(response,200,{saved:true});}
      if (url.pathname === "/api/discord-stream-hub/control/calendar/mission") return await this.mission(response, context, body,request);
      if (url.pathname === "/api/discord-stream-hub/control/calendar/publish") return await this.publishCalendar(response, context, body);
      if (url.pathname === "/api/discord-stream-hub/control/applications/publish") return await this.publishApplications(response, context, body);
      if (url.pathname === "/api/discord-stream-hub/control/points/leaderboard/publish") return await this.publishLeaderboard(response, context, body);

      if (url.pathname === "/api/discord-stream-hub/control/signal-seeker/drop") {
        this.requireOwner(context);
        if (request.method !== "POST") return sendJson(response, 405, { message: "Use POST" });
        if (this.options.operationMode !== "active" || !this.liveDiscord || !this.signalSeekers) throw new Error("Live Signal drops require active Discord delivery");
        await this.sweepSignalDrops();
        const guild = this.guild(context.tenantId, body.serverId);
        if (isSimulationDiscordId(guild)) throw new Error("Choose a live Discord server for Signal drops");
        const channelId = snowflake(body.channelId, "channelId"), requestedRoleId = body.roleId ? snowflake(body.roleId, "roleId") : undefined;
        const signalUrl = body.signalUrl ? new URL(String(body.signalUrl)) : undefined;
        if (signalUrl && (signalUrl.protocol !== "https:" || signalUrl.username || signalUrl.password)) throw new Error("Signal URL must be credential-free HTTPS");
        const clue = String(body.clue || dshSignalDropClue()).trim().slice(0, 1800);
        if (!clue) throw new Error("Signal clue is required");
        const [channels, roles] = await Promise.all([this.liveDiscord.listGuildChannels(context.tenantId, guild), this.liveDiscord.listGuildRoles(context.tenantId, guild)]);
        if (!channels.some(channel => channel.id === channelId && [0, 5].includes(Number(channel.type)))) throw new Error("Choose a text channel in the selected Discord server");
        let role = roles.find(item => item.id === requestedRoleId && !item.managed && item.name.toLowerCase() === "signal seeker") ?? roles.find(item => !item.managed && item.name.toLowerCase() === "signal seeker");
        if (!role) role = await this.liveDiscord.createGuildRole(context.tenantId, guild, { name: "Signal Seeker", color: 0x5865f2, mentionable: true, hoist: false });
        const roleId = role.id;
        const dropId = randomUUID(), payload = dshSignalDropInteractionPayload(roleId, dropId);
        const messageId = await this.liveDiscord.createMessage(context.tenantId, channelId, payload);
        try {
          const drop = this.signalSeekers.createDrop({ dropId, tenantId: context.tenantId, guildId: guild, channelId, messageId, roleId, ...(signalUrl ? { signalUrl: signalUrl.toString() } : {}), clue, now: this.now() });
          return sendJson(response, 201, { drop });
        } catch (error) { await this.liveDiscord.deleteMessage(context.tenantId, channelId, messageId).catch(() => undefined); throw error; }
      }
      if (url.pathname === "/api/discord-stream-hub/control/signal-seeker/publish") {
        this.requireOwner(context);
        if (request.method !== "POST") return sendJson(response, 405, { message: "Use POST" });
        if (this.options.operationMode !== "active") throw new Error("Signal Seeker panel publishing requires active Discord delivery");
        if (!this.liveDiscord) throw new Error("Connect Discord Stream Hub before publishing the Signal Seeker panel");
        const guild = this.guild(context.tenantId, body.serverId);
        if (isSimulationDiscordId(guild)) throw new Error("Choose a live Discord server for the Signal Seeker panel");
        const channelId = snowflake(body.channelId, "channelId"), requestedRoleId = body.roleId ? snowflake(body.roleId, "roleId") : undefined;
        const channels = await this.liveDiscord.listGuildChannels(context.tenantId, guild);
        if (!channels.some(channel => channel.id === channelId && [0, 5].includes(Number(channel.type)))) throw new Error("Choose a text channel in the selected Discord server");
        const roles = await this.liveDiscord.listGuildRoles(context.tenantId, guild);
        let role = roles.find(item => item.id === requestedRoleId && !item.managed && item.name.toLowerCase() === "signal seeker") ?? roles.find(item => !item.managed && item.name.toLowerCase() === "signal seeker");
        if (!role) role = await this.liveDiscord.createGuildRole(context.tenantId, guild, { name: "Signal Seeker", color: 0x5865f2, mentionable: true, hoist: false });
        const roleId = role.id;
        const messageId = await this.liveDiscord.createMessage(context.tenantId, channelId, dshSignalSeekerPanelPayload(roleId));
        return sendJson(response, 201, { schemaVersion: 1, guildId: guild, channelId, messageId, roleId, roleName: role.name });
      }
      if (url.pathname === "/api/discord-stream-hub/control/settings/roles") { if (body.roleGuildId === undefined) throw Error("Choose a Discord server for role groups"); return await this.updateSettings(response, context, body); }
      if (url.pathname === "/api/discord-stream-hub/control/settings") return await this.updateSettings(response, context, body);
      return sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      const message = safeError(error);
      const status = /sign in|session/i.test(message) ? 401 : /owner access/i.test(message) ? 403 : /configured for this tenant|^Choose |shadow room is no longer available/i.test(message) ? 400 : /connect.*discord|grant|discord/i.test(message) ? 502 : 400;
      return sendJson(response, status, { error: "dsh_control_failed", message });
    }
  }

  private async read(request: IncomingMessage, response: ServerResponse, context: SessionContext, url: URL) {
    const tenantId = context.tenantId;
    const guildId = optionalSnowflake(url.searchParams.get("guildId"));
    const allowedGuildIds = new Set(this.config?.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds ?? []);
    if (guildId && isSimulationDiscordId(guildId)) await this.discord?.target(tenantId, guildId);
    if (guildId && !isSimulationDiscordId(guildId) && !allowedGuildIds.has(guildId)) throw new Error("Choose a Discord server configured for this tenant");
    let guilds: Array<Record<string, unknown>> = [], channels: Array<Record<string, unknown>> = [];
    let providerState: "ready" | "setup-required" | "unavailable" = this.discord ? "ready" : "setup-required";
    let providerMessage = this.discord ? (this.options.operationMode === "read-only" ? "Live Discord servers and channels are connected. Delivery opens in Simulation Rooms." : "Discord delivery is connected.") : "Connect the DSH Discord bot to load servers and channels.";
    if (this.discord) {
      try {
        guilds = (await this.discord.listGuilds(tenantId)).filter((item) => typeof item.id === "string" && (allowedGuildIds.has(item.id) || isSimulationDiscordId(item.id))).map((item) => ({ id: item.id, name: item.name ?? item.id, icon: item.icon ?? null, ...(isSimulationDiscordId(String(item.id)) ? { shadow: true } : {}) }));
        if (guildId) {
          const voice = url.searchParams.get("channelKind") === "voice", allowedTypes = voice ? new Set([2, 13]) : new Set([0, 5]);
          channels = (await this.discord.listGuildChannels(tenantId, guildId)).filter((item) => typeof item.id === "string" && allowedTypes.has(Number(item.type))).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)).map((item) => ({ id: item.id, name: item.name ?? item.id, type: item.type ?? 0 }));
        }
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
    const shoutouts = await this.shoutoutView(request, context, snapshot);
    const points = await this.pointsView(tenantId,String(context.session.actorId??""));
    return sendJson(response, 200, {
      schemaVersion: 1,
      tenantId,
      session: context.session,
      role: this.role(context),
      storageReady: Boolean(this.calendar && this.settings),
      applicationInteractionsReady: Boolean(this.options.applicationInteractionsReady),
      operationMode: this.options.operationMode ?? "active",
      provider: { state: providerState, message: guildId && isSimulationDiscordId(guildId) ? "Messages and embeds stay in this shadow room." : providerMessage },
      providerLinks: snapshot?.providerLinks ?? [],
      guilds,
      channels,
      selectedGuildId: guildId ?? "",
      selectedShadowRoomId: guildId && isSimulationDiscordId(guildId) ? (await this.discord?.target(tenantId,guildId))?.roomId : null,
      ...view,
      participation: dshCaptainParticipation(calendar, this.members(tenantId,guildId).filter(member => member.group === "Crew").map(member => ({userId: member.canonicalUserId, username: member.twitchLogin})) ?? [], this.settings?.read(tenantId).captainMinimumDays ?? 0),
      partnerSchedules:guildId&&!isSimulationDiscordId(guildId)?this.partners?.partners(tenantId,guildId).map(p=>this.partners!.view(tenantId,guildId,p.userId,month))??[]:[],
      onboardingPanels:(this.config?.tenants.find(t=>t.tenantId===tenantId)?.discordGuildIds??[]).map(g=>this.onboarding?.view(tenantId,g)).filter(Boolean),
      memberActivity:this.activity?.list(tenantId,guildId&&!isSimulationDiscordId(guildId)?guildId:undefined)??[],
      memberDirectory:this.memberDirectory?.view(tenantId,guildId)??null,
      activityStatus:this.activity?.cursor(tenantId).error??null,
      calendarMonth: month,
      ...shoutouts,
      points,
      raidPile: await this.raidPileState(context,request),
      trackedMessages: this.messages?.list(tenantId) ?? [],
      cleanupPlans:this.role(context)==="owner"?this.cleanup?.list(tenantId,String(context.session.actorId),"owner")??[]:[],
      applications: this.role(context) === "owner" ? this.applications?.list(tenantId, undefined, 100) ?? [] : [],
      settings: this.settings ? this.effectiveSettings(tenantId) : null,
    });
  }

  private async shoutoutView(request: IncomingMessage, context: SessionContext, supplied?: Awaited<ReturnType<typeof fetchAppPlatformSnapshot>>) {
    const snapshot=supplied??await fetchAppPlatformSnapshot({appId:"discord-stream-hub",spmtOrigin:this.options.spmtOrigin,request,sources:["communityLive"]}).catch(()=>undefined);
    const community=record(snapshot?.communityLive), available=Boolean(snapshot?.availability.communityLive?.available&&Array.isArray(community?.shoutouts));
    const members:DshShoutoutView[]=available?(community!.shoutouts as unknown[]).flatMap(row=>{const view=dshShoutoutView(row);return view?[view]:[]}):[];
    const tracked=new Set(this.members(context.tenantId).map(m=>m.twitchLogin)??[]);
    const liveMembers=await Promise.all(members.map(async member=>{const generated=await this.shoutouts?.latest(context.tenantId,member,this.client);return {...member,...(generated?{generated}:{}),canPost:this.role(context)==="owner"&&tracked.has(member.twitchLogin)}}));
    const guests=(this.monitor?.guests.list(context.tenantId,false)??[]).flatMap(target=>{const message=this.messages?.get(context.tenantId,"guest-shoutout",target.id);return target.state==="active"||message?[{...target,...(message?{messageId:message.messageId}:{}),deliveryPending:target.state!=="active"||!message||message.updatedAt<target.updatedAt}]:[]});
    return {guests,presence:{source:"ecosystem",state:available?"ready":"unavailable"},liveMembers,spotlight:liveMembers.find(m=>m.isSpotlight)??null,shoutoutPostingReady:Boolean(this.client&&this.calendar)&&this.role(context)==="owner",shoutoutWriterReady:Boolean(this.client&&this.shoutouts)&&this.role(context)==="owner"};
  }

  private calendarView(tenant:string,rawGuild:unknown,month:string){
    const guild=rawGuild?this.guild(tenant,rawGuild):"workspace",events=this.calendar?.month(tenant,guild,month)??[],missions=communityCalendarMissions({month,today:this.now().slice(0,10),events});
    const colors=new Map(missions.map(e=>[e.id,e]));
    const guildIds=this.config?.tenants.find(t=>t.tenantId===tenant)?.discordGuildIds??[];
    return {calendar:events.map(e=>({...e,...(colors.has(e.id)?{color:colors.get(e.id)!.color,number:colors.get(e.id)!.number}:{})})),calendarMonth:month,calendarSync:guildIds.filter(g=>guild==="workspace"||g===guild).map(g=>({guildId:g,...this.sync?.status(tenant,g),imageError:this.calendar?.state(tenant,`image-error:${g}`)??null})),participation:dshCaptainParticipation(events,this.members(tenant,guild==="workspace"?undefined:guild).filter(m=>m.group==="Crew").map(m=>({userId:m.canonicalUserId,username:m.twitchLogin}))??[],this.settings?.read(tenant).captainMinimumDays??0)};
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
    await this.validateDestination(context.tenantId,guild,channel);
    return sendJson(response,200,{schemaVersion:1,...(isSimulationDiscordId(guild) ? {shadowRoomId:(await this.discord?.target(context.tenantId,guild))?.roomId} : {}),...await this.delivery.publish(context.tenantId,guild,channel,String(body.month??this.now().slice(0,7)))});
  }
  private async sweepSignalDrops(){
    if(!this.signalSeekers||!this.liveDiscord)return;
    for(const drop of this.signalSeekers.expire(this.now())){
      try{await this.liveDiscord.deleteMessage(drop.tenantId,drop.channelId,drop.messageId);}catch(error){if(!(error instanceof DshDiscordError&&error.status===404))continue;}
    }
  }
  async changed(tenant:string){
    const failures:string[]=[];
    for(const guild of this.config?.tenants.find(t=>t.tenantId===tenant)?.discordGuildIds??[])try{await this.sync?.sync(tenant,guild);const status=this.sync?.status(tenant,guild);for(const issue of status?.issues??[])if(issue.message)failures.push(issue.message);}catch(error){failures.push(safeError(error));}
    const effects=await this.delivery?.flush(tenant);if(effects?.pending)failures.push(effects.message);
    return {pending:failures.length>0,message:failures.join("; ")};
  }
  async interaction(interaction:Record<string,any>){
    if(!this.config)return undefined;
    await this.sweepSignalDrops();
    const customId=String(interaction.data?.custom_id??""),signal=/^signal_seekers:(join|leave):(\d{5,30})$/.exec(customId);
    const leaderboard=/^(check_rank|points_info)_(\d{5,30})$/.exec(customId);

    const raidTrain=/^raid_(signup|view|cancel|day)_(\d{4}-\d{2}-\d{2})$/.exec(customId),raidSlot=/^raid_slot_(\d{4}-\d{2}-\d{2})_(\d{2})$/.exec(customId),raidCancelSlot=/^raid_cancel_slot_(\d{4}-\d{2}-\d{2})_(\d{2})$/.exec(customId);
    if(interaction.type===3&&(raidTrain||raidSlot||raidCancelSlot)){
      const guildId=String(interaction.guild_id??""),userId=String(interaction.member?.user?.id??interaction.user?.id??""),tenant=this.config.tenants.find(item=>item.discordGuildIds?.includes(guildId));
      const ephemeral=(content:string,components?:unknown[])=>({type:4,data:{flags:64,content,allowed_mentions:{parse:[]},...(components?{components}:{})}});
      if(!tenant||!this.raidTrain||!this.liveDiscord||!this.client||!/^[0-9]{5,30}$/.test(userId))return ephemeral("Raid Train is unavailable in this Discord server.");
      try{
        const date=raidTrain?.[2]??raidSlot?.[1]??raidCancelSlot?.[1]??"";
        const slots=this.raidTrain.schedule(tenant.tenantId,guildId,date);
        if(raidTrain?.[1]==="day"){const messageId=optionalSnowflake(interaction.message?.id),channelId=optionalSnowflake(interaction.channel_id);if(messageId&&channelId)this.raidTrain.setPanel({tenantId:tenant.tenantId,guildId,date,channelId,messageId});return {type:7,data:dshRaidTrainPayload(slots,date)};}
        if(raidTrain?.[1]==="view")return {type:4,data:{flags:64,...dshRaidTrainPayload(slots,date)}};
        if(raidTrain?.[1]==="signup"){
          if(date<=this.now().slice(0,10))return ephemeral("Raid Train signups open the day before. Choose a future date.");
          const open=slots.filter(slot=>!slot.userId),rows=[] as Array<{type:number;components:Array<Record<string,unknown>>}>;
          for(let i=0;i<open.length;i+=5)rows.push({type:1,components:open.slice(i,i+5).map(slot=>({type:2,style:1,label:String(slot.hour).padStart(2,"0")+":00",custom_id:"raid_slot_"+date+"_"+String(slot.hour).padStart(2,"0")}))});
          return ephemeral(open.length?"Choose an available UTC hour:":"Every hour is already claimed.",rows);
        }
        if(raidTrain?.[1]==="cancel"){
          const identity=await this.raidTrainIdentity(tenant.tenantId,guildId,userId),owned=slots.filter(slot=>slot.userId===identity.userId),rows=[] as Array<{type:number;components:Array<Record<string,unknown>>}>;
          for(let i=0;i<owned.length;i+=5)rows.push({type:1,components:owned.slice(i,i+5).map(slot=>({type:2,style:4,label:"Cancel "+String(slot.hour).padStart(2,"0")+":00",custom_id:"raid_cancel_slot_"+date+"_"+String(slot.hour).padStart(2,"0")}))});
          return ephemeral(owned.length?"Choose the slot to cancel:":"You have no reservations on this date.",rows);
        }
        if(raidSlot){
          const identity=await this.raidTrainIdentity(tenant.tenantId,guildId,userId),hour=Number(raidSlot[2]);
          const result=this.raidTrain.signup({tenantId:tenant.tenantId,guildId,date:raidSlot[1]!,hour,userId:identity.userId,twitchUserId:identity.twitchUserId,username:identity.twitchLogin,displayName:identity.displayName,...(identity.avatarUrl?{avatarUrl:identity.avatarUrl}:{})});
          if(result.success)await this.refreshRaidTrainPanel(tenant.tenantId,guildId,raidSlot[1]!);
          return ephemeral(result.success?"🚂 Your Raid Train slot is reserved for "+String(hour).padStart(2,"0")+":00 UTC.":result.reason==="same-day"?"Same-day Raid Train signups are closed.":"That hour was just claimed by someone else.");
        }
        if(raidCancelSlot){
          const identity=await this.raidTrainIdentity(tenant.tenantId,guildId,userId),result=this.raidTrain.cancel({tenantId:tenant.tenantId,guildId,date:raidCancelSlot[1]!,hour:Number(raidCancelSlot[2]),userId:identity.userId});
          if(result.success)await this.refreshRaidTrainPanel(tenant.tenantId,guildId,raidCancelSlot[1]!);
          return ephemeral(result.success?"Your Raid Train reservation was cancelled.":"That slot is not yours or is no longer reserved.");
        }
      }catch(error){return ephemeral(safeError(error));}
    }
    if(interaction.type===3&&customId.startsWith("signal_intercept:")){
      const guildId=String(interaction.guild_id??""),userId=String(interaction.member?.user?.id??interaction.user?.id??""),tenant=this.config.tenants.find(item=>item.discordGuildIds?.includes(guildId)),dropId=customId.slice("signal_intercept:".length);
      const ephemeral=(content:string)=>({type:4,data:{flags:64,content,allowed_mentions:{parse:[]}}});
      if(!tenant||!/^[0-9]{5,30}$/.test(guildId)||!/^[0-9]{5,30}$/.test(userId)||!this.signalSeekers)return ephemeral("That Signal carrier is no longer valid.");
      try{
        const drop=this.signalSeekers.get(tenant.tenantId,dropId);
        if(!drop||drop.guildId!==guildId||drop.state!=="open"||Date.parse(drop.expiresAt)<=Date.parse(this.now())){this.signalSeekers.expire(this.now());if(drop&&this.liveDiscord)await this.liveDiscord.deleteMessage(tenant.tenantId,drop.channelId,drop.messageId).catch(()=>undefined);return ephemeral("📡 That Signal faded after 10 minutes.");}
        const identity=await resolveProviderIdentity(this.client!,tenant.tenantId,"discord",userId).catch(()=>undefined);
        const result=this.signalSeekers.claim({dropId,tenantId:tenant.tenantId,providerUserId:userId,...(identity?.userId?{canonicalUserId:identity.userId}:{}),at:this.now()});
        if(!result.won)return ephemeral(result.reason==="claimed"?"Another seeker already claimed this Signal.":"That Signal has faded.");
        return ephemeral("📡 **SIGNAL OPENED**\n\n"+(result.drop.clue??"The transmission dissolved into static.")+(result.drop.signalUrl?"\n\n"+result.drop.signalUrl:"")+"\n\nThis opens the Signal only; it does not perform an egg roll.");
      }catch(error){return ephemeral(safeError(error));}
    }
    if(interaction.type===3&&signal){
      const guildId=String(interaction.guild_id??""),userId=String(interaction.member?.user?.id??interaction.user?.id??""),tenant=this.config.tenants.find(item=>item.discordGuildIds?.includes(guildId));
      const ephemeral=(content:string)=>({type:4,data:{flags:64,content,allowed_mentions:{parse:[]}}});
      if(!tenant||!/^\d{5,30}$/.test(guildId)||!/^\d{5,30}$/.test(userId))return ephemeral("This Signal Seeker control is not connected to an SPMT server.");
      if(this.options.operationMode!=="active"||!this.liveDiscord||!this.signalSeekers)return ephemeral("Signal Seeker role changes are unavailable in this environment.");
      try{
        const roleId=signal[2]!,roles=await this.liveDiscord.listGuildRoles(tenant.tenantId,guildId),role=roles.find(item=>item.id===roleId&&!item.managed&&item.name.toLowerCase()==="signal seeker");
        if(!role)return ephemeral("This Signal Seeker role is no longer configured. Ask a moderator to republish the panel.");
        const [member,identity]=await Promise.all([this.liveDiscord.getGuildMember(tenant.tenantId,guildId,userId),resolveProviderIdentity(this.client!,tenant.tenantId,"discord",userId).catch(()=>undefined)]);
        const winnerRole=roles.find(item=>item.name.toLowerCase()==="voidwalker"),isWinner=Boolean(winnerRole&&member?.roles?.includes(winnerRole.id));
        if(signal[1]==="join"&&isWinner)return ephemeral("You already hold the Voidwalker title; the Signal Seeker role is reserved for the active hunt.");
        const enabled=signal[1]==="join";
        await this.liveDiscord.setGuildMemberRole(tenant.tenantId,guildId,userId,roleId,enabled);
        this.signalSeekers.setSeeking({tenantId:tenant.tenantId,providerUserId:userId,...(identity?.userId?{canonicalUserId:identity.userId}:{}),enabled,at:this.now()});
        return ephemeral(enabled?"🥚 You are now a Signal Seeker. You will be notified when a new Signal appears.":"You left the Signal Seekers. You can rejoin any time from this panel.");
      }catch(error){return ephemeral(safeError(error));}
    }
    if(interaction.type===3&&leaderboard){
      const guildId=String(interaction.guild_id??""),userId=String(interaction.member?.user?.id??interaction.user?.id??""),tenant=this.config.tenants.find(item=>item.discordGuildIds?.includes(guildId));
      const ephemeral=(content:string)=>({type:4,data:{flags:64,content,allowed_mentions:{parse:[]}}});
      if(!tenant||!/^\d{5,30}$/.test(guildId)||!/^[0-9]{5,30}$/.test(userId))return ephemeral("This leaderboard belongs to a Discord server that is not connected to DSH.");
      if(leaderboard[1]==="points_info")return ephemeral("🏆 **How Points Work**\nLifetime XP determines your community rank. Spendable XP is available for supported community rewards; spending it does not reduce your Lifetime XP rank. DSH reads the canonical SPMT wallet—there is no separate DSH points balance.");
      if(!this.client)return ephemeral("The canonical SPMT wallet is temporarily unavailable.");
      try{
        const identity=await resolveProviderIdentity(this.client,tenant.tenantId,"discord",userId),rank=await new DshPointsService(this.client,tenant.tenantId).getUserRank(identity.userId);
        return ephemeral("🏆 **Your Rank:** #"+rank.rank+"\n📊 **Lifetime XP:** "+rank.lifetimeXp.toLocaleString("en-US")+"\n💠 **Spendable XP:** "+rank.points.toLocaleString("en-US")+"\n⭐ **Level:** "+rank.level);
      }catch(error){return ephemeral(error instanceof Error?error.message:"Your SPMT wallet could not be loaded.");}
    }
    if(!this.calendar)return undefined;
    if(this.onboarding){const result=await this.onboarding.interaction(interaction);if(result)return result;}
    if(this.partners){const result=await respondDshPartnerSchedule({schedules:this.partners,config:this.config,now:this.now,resolve:async(tenant,id)=>{if(!this.client)throw Error("Connect DSH first");const identity=await resolveProviderIdentity(this.client,tenant,"discord",id);return {userId:identity.userId,role:identity.tenantRole??null};}},interaction);if(result)return result;}
    return respondDshCalendarInteraction({config:this.config,calendar:this.calendar,now:this.now,changed:tenant=>this.changed(tenant),resolve:async(tenant,id)=>{
      if(!this.client)throw new Error("Connect the DSH service before using calendar controls");
      const identity=await resolveProviderIdentity(this.client,tenant,"discord",id);
      return {userId:identity.userId,username:identity.profile.displayName||identity.profile.username,role:identity.tenantRole??null};
    }},interaction);
  }
  private requestKey(context:SessionContext,body:Record<string,unknown>){return body.requestId?`${String(context.session.actorId)}:${text(body.requestId,"requestId",100)}`:undefined;}

  private async publishApplications(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    if (!isSimulationDiscordId(String(body.serverId)) && this.options.operationMode !== "read-only" && !this.options.applicationInteractionsReady) throw new Error("Configure the Discord application interaction endpoint before publishing the application embed");
    const serverId = this.guild(context.tenantId, body.serverId), channelId = snowflake(body.channelId, "channelId");
    await this.validateDestination(context.tenantId,serverId,channelId);
    const messageId = await this.upsertDiscord(context.tenantId, "applications", serverId, channelId, buildDshPublicApplicationEmbed(serverId));
    return sendJson(response, 200, { schemaVersion: 1, messageId, channelId, ...(isSimulationDiscordId(serverId) ? {shadowRoomId:(await this.discord?.target(context.tenantId,serverId))?.roomId} : {}) });
  }

  private async publishLeaderboard(response:ServerResponse,context:SessionContext,body:Record<string,unknown>){
    this.requireOwner(context);
    if(!this.client)throw new Error("Connect DSH before publishing the canonical XP leaderboard");
    const guild=this.guild(context.tenantId,body.serverId),channelId=snowflake(body.channelId,"channelId");
    await this.validateDestination(context.tenantId,guild,channelId);
    const rows=await new DshPointsService(this.client,context.tenantId).getLeaderboard(50),members=new Map(this.members(context.tenantId).map(member=>[member.canonicalUserId,member.displayName??member.twitchLogin])),leaderboard=rows.map(row=>({...row,displayName:members.get(row.userId)??row.userId}));
    const updatedAt=this.now(),interactive=!isSimulationDiscordId(guild),tenant=this.config?.tenants.find(item=>item.tenantId===context.tenantId);
    const image=interactive?renderDshLeaderboardPng(leaderboard,{communityName:tenant?.branding.communityMemberName??"Community",updatedAt}):undefined;
    const payload={...buildDshLeaderboardPayload(leaderboard,guild,updatedAt,interactive,Boolean(image)),...(image?{leaderboardImage:image}:{})};
    const messageId=await this.upsertDiscord(context.tenantId,"leaderboard",guild,channelId,payload);
    return sendJson(response,200,{schemaVersion:1,messageId,channelId,entries:leaderboard.length,...(isSimulationDiscordId(guild)?{shadowRoomId:(await this.discord?.target(context.tenantId,guild))?.roomId}:{})});
  }
  private async pointsView(tenantId:string,userId:string){
    if(!this.client)return{leaderboard:[],me:null};
    const service=new DshPointsService(this.client,tenantId),members=new Map(this.members(tenantId).map(member=>[member.canonicalUserId,member.displayName??member.twitchLogin]));
    const [rows,me]=await Promise.all([service.getLeaderboard(50).catch(()=>[]),userId?service.getUserRank(userId).catch(()=>null):Promise.resolve(null)]);
    return{leaderboard:rows.map(row=>({...row,displayName:members.get(row.userId)??row.userId})),me};
  }
  private members(tenant:string,guild?:string){return this.memberDirectory?.members(tenant,guild)??this.config?.tenants.find(t=>t.tenantId===tenant)?.members??[];}
  private effectiveSettings(tenantId: string) {
    const saved = this.requireSettings().read(tenantId), tenant = this.config?.tenants.find(value => value.tenantId === tenantId);
    return { ...saved, pollIntervalSeconds: saved.revision ? saved.pollIntervalSeconds : this.config?.pollIntervalSeconds ?? saved.pollIntervalSeconds,
      spotlightChannelId: saved.spotlightChannelId ?? tenant?.branding.spotlightChannelId ?? '',
      groupChannels: { ...Object.fromEntries((tenant?.members ?? []).map(member => [dshShoutoutGroupSlug(member.group) || '', member.shoutoutChannelId])), ...saved.groupChannels },
      embedTemplates: saved.embedTemplates ?? tenant?.branding.embedTemplates ?? DSH_LIVE_EMBED_TEMPLATES };
  }

  private async updateSettings(response: ServerResponse, context: SessionContext, body: Record<string, unknown>) {
    const store = this.requireSettings(), current = store.readDocument(context.tenantId), effective = this.effectiveSettings(context.tenantId), values: Record<string, string | number | boolean | null> = current.revision ? {} : { pollIntervalSeconds: effective.pollIntervalSeconds };
    for (const key of ["spotlightChannelId", "signalChannelId", "gifStorageChannelId"] as const) if (body[key] !== undefined) values[key] = body[key] === "" ? "" : snowflake(body[key], key);
    for (const value of Object.values(values)) if (typeof value === "string" && isSimulationDiscordId(value)) { if (!this.discord) throw new Error("Shadow room delivery is unavailable"); await this.discord.target(context.tenantId,value); }
    for (const key of ["spotlightEnabled", "signalSeekerEnabled"] as const) if (typeof body[key] === "boolean") values[key] = body[key];
    const groups = { ...effective.groupChannels }, templates = structuredClone(effective.embedTemplates);
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('group:')) { const slug = dshShoutoutGroupSlug(key.slice(6)); if (!slug) throw new Error('Choose a shoutout group'); if (value === '') delete groups[slug]; else groups[slug] = snowflake(value, 'Group channel'); values.groupChannels = JSON.stringify(groups); }
      if (key.startsWith('template:')) { const [,group,field] = key.split(':'); if (!group || !field || !Object.hasOwn(templates,group) || !Object.hasOwn(templates[group as keyof typeof templates],field)) throw new Error('Unknown shoutout template field'); (templates[group as keyof typeof templates] as Record<string,string>)[field] = String(value); values.embedTemplates = JSON.stringify(templates); }
    }
    if (body.groupChannels !== undefined) values.groupChannels = typeof body.groupChannels === 'string' ? body.groupChannels : JSON.stringify(body.groupChannels);
    if (body.embedTemplates !== undefined) values.embedTemplates = typeof body.embedTemplates === 'string' ? body.embedTemplates : JSON.stringify(body.embedTemplates);
    if (body.roleGuildId !== undefined) {
      const guild=this.guild(context.tenantId,body.roleGuildId);if(isSimulationDiscordId(guild))throw Error("Choose a live Discord server for role groups");
      const roles=this.memberDirectory?.view(context.tenantId,guild).roles[0]?.roles;if(!roles)throw Error("Wait for the server member directory to refresh before changing role groups");
      const mappings=structuredClone(effective.roleMappings), selected:Record<string,string>={};
      for(const [key,value] of Object.entries(body))if(key.startsWith("role:")){
        const id=snowflake(key.slice(5),"roleId");if(!roles.some(role=>role.id===id))throw Error("Choose a role from the selected server");
        if(value!=="")selected[id]=String(value);
      }
      mappings[guild]=selected as typeof mappings[string];values.roleMappings=JSON.stringify(mappings);
    }
    if (body.captainMinimumDays !== undefined) values.captainMinimumDays = integer(body.captainMinimumDays, 0, 31, "captainMinimumDays");
    if (body.pollIntervalSeconds !== undefined) values.pollIntervalSeconds = integer(body.pollIntervalSeconds, 15, 3600, "pollIntervalSeconds");
    for(const [key,min,max] of [["raidPileMaxSize",2,500],["raidPileMinSize",1,499],["raidPilePointsReward",0,100000],["raidPileHandoffHours",1,48],["raidPileMonthlyStrikeLimit",1,20],["raidPoints",0,100000],["followPoints",0,100000],["subPoints",0,100000],["giftedSubPoints",0,100000],["bitPoints",0,100000],["chatActivityPoints",0,100000],["firstMessagePoints",0,100000],["messageReactionPoints",0,100000],["adminEventPoints",0,100000],["adminLogPoints",0,100000],["adminMessagePoints",0,100000]] as const)if(body[key]!==undefined)values[key]=integer(body[key],min,max,key);
    const next = store.patch(context.tenantId, { schemaVersion: 1, expectedRevision: current.revision, values });
    return sendJson(response, 200, next);
  }

  private async upsertDiscord(tenantId: string, kind: "calendar" | "applications" | "leaderboard", key: string, channelId: string, payload: Record<string, unknown>) {
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

  private async validateDestination(tenantId:string,guildId:string,channelId:string) {
    if (!this.discord) throw new Error("Discord delivery is unavailable");
    if (isSimulationDiscordId(guildId) || isSimulationDiscordId(channelId)) {
      const room = await this.discord.target(tenantId,guildId);
      if (!room || simulationDiscordIds(tenantId,room.roomId).guildId !== guildId || simulationDiscordIds(tenantId,room.roomId).channelId !== channelId) throw new Error("Choose the Discord channel belonging to this shadow room");
    } else if (!(await this.discord.listGuildChannels(tenantId,guildId)).some(channel => channel.id === channelId && (channel.type === 0 || channel.type === 5))) throw new Error("Choose a text channel in the selected Discord server");
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
  private signalControlSigner(){
    const secret=String(this.options.serviceCredential??"").trim();if(secret.length<32)throw new Error("Signal removal signing secret is unavailable");
    return new DshSignalControlSigner(createHash("sha256").update(secret).digest(),()=>Date.parse(this.now()));
  }
  private requireRaidPile(){if(!this.raidPile)throw new Error("DSH Raid Pile storage is not configured");return this.raidPile;}
  private raidPileSettings(tenantId:string):DshRaidPileSettingsV1 {const saved=this.settings?.read(tenantId);return {maxSize:saved?.raidPileMaxSize??DEFAULT_DSH_RAID_PILE_SETTINGS.maxSize,minSize:saved?.raidPileMinSize??DEFAULT_DSH_RAID_PILE_SETTINGS.minSize,pointsReward:saved?.raidPilePointsReward??DEFAULT_DSH_RAID_PILE_SETTINGS.pointsReward,handoffHours:saved?.raidPileHandoffHours??DEFAULT_DSH_RAID_PILE_SETTINGS.handoffHours,monthlyStrikeLimit:saved?.raidPileMonthlyStrikeLimit??DEFAULT_DSH_RAID_PILE_SETTINGS.monthlyStrikeLimit};}

  private async refreshRaidTrainPanel(tenantId:string,guildId:string,date:string){
    const panel=this.raidTrain?.panel(tenantId,guildId,date);if(!panel||!this.liveDiscord||!this.raidTrain)return;
    const tenant=this.config?.tenants.find(item=>item.tenantId===tenantId),payload=dshRaidTrainPayload(this.raidTrain.schedule(tenantId,guildId,date),date,tenant?.branding.communityMemberName??"Space Mountain");
    await this.liveDiscord.editMessage(tenantId,panel.channelId,panel.messageId,payload);
  }
  private async raidTrainIdentity(tenantId:string,guildId:string,discordUserId:string){
    if(!this.client||!this.liveDiscord)throw new Error("Connect DSH to resolve Raid Train identity");
    const identity=await resolveProviderIdentity(this.client,tenantId,"discord",discordUserId);
    let after="",person:any;
    for(let page=0;page<51&&!person;page++){
      const directory=await listCommunityIdentities(this.client,tenantId,after);
      person=directory.members.find(item=>item.userId===identity.userId);
      if(person||directory.nextAfterUserId===null)break;
      if(!directory.nextAfterUserId||directory.nextAfterUserId<=after)throw new Error("Community identity pagination is invalid");
      after=directory.nextAfterUserId;
    }
    const twitch=person?.providers.find((link:any)=>link.provider==="twitch");
    if(!twitch)throw new Error("Raid Train requires a Twitch account linked to this Discord identity in SPMT");
    const member:any=await this.liveDiscord.getGuildMember(tenantId,guildId,discordUserId);
    const directoryRow=this.memberDirectory?.view(tenantId,guildId).rows.find(row=>row.discordUserId===discordUserId);
    const user=member.user as {username?:string;global_name?:string;avatar?:string}|undefined;
    const displayName=String(member.nick??user?.global_name??user?.username??directoryRow?.displayName??discordUserId).slice(0,100);
    const twitchLogin=String(directoryRow?.twitchLogin??"").toLowerCase();
    if(!/^[a-z0-9_]{1,32}$/.test(twitchLogin))throw new Error("Refresh the DSH community member directory before reserving a Raid Train slot");
    return {userId:identity.userId,twitchUserId:twitch.providerUserId,twitchLogin,displayName,avatarUrl:undefined as string|undefined};
  }
  private async raidPileIdentity(context:SessionContext,_request:IncomingMessage){
    const actor=String(context.session.actorId??""),member=this.members(context.tenantId).find(item=>item.canonicalUserId===actor);
    if(!member||!/^[a-z0-9_]{1,32}$/.test(member.twitchLogin))throw new Error("Raid Pile is available to members with a linked Twitch account in this Discord workspace");
    return {twitchLogin:member.twitchLogin,displayName:member.displayName};
  }
  private async raidPileState(context:SessionContext,request:IncomingMessage){
    const store=this.requireRaidPile(),piles=store.piles(context.tenantId);
    for(const pile of piles)for(const member of pile.members){const stream=this.monitor?.getLiveStream(context.tenantId,member.userId);store.updatePresence(context.tenantId,member.userId,stream?.viewerCount??0,Boolean(stream));}
    const refreshed=store.piles(context.tenantId),userId=String(context.session.actorId??""),membership=refreshed.flatMap(pile=>pile.members.map(member=>({pileId:pile.id,member}))).find(item=>item.member.userId===userId);
    const next=membership?store.next(context.tenantId,membership.pileId,userId):undefined;
    return {piles:refreshed,membership:membership??null,next:next??null,settings:this.raidPileSettings(context.tenantId),canAdvance:this.role(context)==="owner"};
  }

  private authorizeWorker(request: IncomingMessage): boolean {
    const expected=this.options.serviceCredential??"",header=String(request.headers.authorization??"");
    if(!expected||!header.startsWith("Bearer "))return false;
    const supplied=header.slice(7);if(!supplied||supplied.length!==expected.length)return false;
    return timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
  }
  private async updateSignalSeekerFromTwitch(request:IncomingMessage,response:ServerResponse){
    if(this.options.operationMode!=="active"||!this.client||!this.liveDiscord||!this.signalSeekers||!this.config)return sendJson(response,503,{message:"Live Signal Seeker membership is unavailable"});
    const body=record(await readJsonBody(request))??{},twitchUserId=String(body.twitchUserId??"").trim(),twitchUsername=String(body.twitchUsername??"").trim().toLowerCase(),action=["join","leave"].includes(String(body.action))?String(body.action):"toggle";
    if(!/^\d{5,30}$/.test(twitchUserId)&&! /^[a-z0-9_]{1,25}$/.test(twitchUsername))return sendJson(response,400,{message:"A Twitch identity is required"});
    const tenantId=String(body.tenantId??"").trim();
    if(!tenantId)return sendJson(response,400,{message:"tenantId is required"});
    const tenants=this.config.tenants.filter(item=>item.tenantId===tenantId&&Array.isArray(item.discordGuildIds)&&item.discordGuildIds.length>0);
    if(!tenants.length)return sendJson(response,200,{ok:true,linked:false});
    let matched=false,updated=0,status:"joined"|"left"="left";
    for(const tenant of tenants){
      let after="",person:any;
      for(let page=0;page<51&&!person;page++){
        const directory=await listCommunityIdentities(this.client,tenant.tenantId,after);
        person=directory.members.find(item=>item.providers.some(link=>link.provider==="twitch"&&((twitchUserId&&link.providerUserId===twitchUserId)||(!twitchUserId&&link.providerUserId.toLowerCase()===twitchUsername))));
        if(person||directory.nextAfterUserId===null)break;
        if(!directory.nextAfterUserId||directory.nextAfterUserId<=after)throw new Error("Community identity pagination is invalid");
        after=directory.nextAfterUserId;
      }
      if(!person)continue;
      const discordIds=person.providers.filter((link:{provider:string;providerUserId:string})=>link.provider==="discord").map((link:{provider:string;providerUserId:string})=>link.providerUserId);if(!discordIds.length)continue;
      matched=true;
      for(const guildId of tenant.discordGuildIds??[]){
        const roleList=await this.liveDiscord.listGuildRoles(tenant.tenantId,guildId);
        let role=roleList.find(item=>!item.managed&&item.name.toLowerCase()==="signal seeker");
        if(!role)role=await this.liveDiscord.createGuildRole(tenant.tenantId,guildId,{name:"Signal Seeker",color:0x5865f2,mentionable:true,hoist:false});
        const winnerRole=roleList.find(item=>item.name.toLowerCase()==="voidwalker");
        for(const discordId of discordIds){
          const member=await this.liveDiscord.getGuildMember(tenant.tenantId,guildId,discordId).catch(()=>undefined);if(!member?.user?.id)continue;
          const isWinner=Boolean(winnerRole&&member.roles?.includes(winnerRole.id));
          const hasRole=member.roles?.includes(role.id)??false;
          const enable=action==="join"||(action==="toggle"&&!hasRole);
          const shouldJoin=enable&&!isWinner;
          if(hasRole!==shouldJoin)await this.liveDiscord.setGuildMemberRole(tenant.tenantId,guildId,discordId,role.id,shouldJoin);
          this.signalSeekers.setSeeking({tenantId:tenant.tenantId,providerUserId:twitchUserId||twitchUsername,canonicalUserId:person.userId,enabled:shouldJoin,at:this.now()});
          status=shouldJoin?"joined":"left";updated++;
        }
      }
    }
    return sendJson(response,200,{ok:true,linked:matched,...(matched?{status,updated}:{})});
  }

  private requireCalendar() { if (!this.calendar) throw new Error("DSH calendar storage is not configured"); return this.calendar; }
  private requireSettings() { if (!this.settings) throw new Error("DSH settings storage is not configured"); return this.settings; }
  private guild(tenantId: string, value: unknown) { const guildId = snowflake(value, "serverId"); if (isSimulationDiscordId(guildId)) return guildId; if (!this.config?.tenants.find((tenant) => tenant.tenantId === tenantId)?.discordGuildIds?.includes(guildId)) throw new Error("Choose a Discord server configured for this tenant"); return guildId; }
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

function isPublicDshForumSource(guild:any,channel:any){
  try{
    if(!guild?.id||channel?.guild_id!==guild.id||![0,2,5,13].includes(Number(channel.type))||!Array.isArray(guild.roles)||!Array.isArray(channel.permission_overwrites))return false;
    const everyone=guild.roles.find((role:any)=>role.id===guild.id);if(!everyone)return false;
    const view=BigInt("1024");let permissions=BigInt(everyone.permissions);
    const own=channel.permission_overwrites.find((item:any)=>item.id===guild.id&&Number(item.type)===0);
    if(own)permissions=(permissions&~BigInt(own.deny))|BigInt(own.allow);
    if((permissions&view)===BigInt(0))return false;
    return !channel.permission_overwrites.some((item:any)=>item.id!==guild.id&&(BigInt(item.deny)&view)!==BigInt(0));
  }catch{return false;}
}
