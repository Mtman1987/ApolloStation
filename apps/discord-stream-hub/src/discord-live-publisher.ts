import { dshShoutoutGroupSlug } from './shoutout-groups.js';
import { buildDshTierShoutout, dshStreamShoutout, type DshEmbedTemplates } from "./shoutout-presentation.js";
import { DatabaseSync } from "node:sqlite";
import { dshDiscordRequestBody } from "./calendar-presentation.js";
import type { DshScheduledEventV1, DshCalendarTransportV1 } from "./calendar-sync.js";
import type { DshLiveActionPublisherV1, DshLiveActionV1, DshLiveMemberV1, DshTwitchStreamV1 } from "./live-monitor.js";

export interface DshDiscordGrantV1 { authorization:string; expiresAt?:string; }
export interface DshDiscordGrantSourceV1 { getGrant(input:{tenantId:string;capability:"messages:write"|"channels:read"|"guilds:read"|"events:read"|"events:write"}):Promise<DshDiscordGrantV1>; }
export interface DshDiscordTransportV1 extends Partial<DshCalendarTransportV1> {
  createMessage(tenantId:string,channelId:string,payload:Record<string,unknown>):Promise<string>;
  listGuilds(tenantId:string):Promise<Array<{id?:string;name?:string;icon?:string|null}>>;
  listGuildChannels(tenantId:string,guildId:string):Promise<Array<{id?:string;name?:string;type?:number;position?:number}>>;
  editMessage(tenantId:string,channelId:string,messageId:string,payload:Record<string,unknown>):Promise<unknown>;
  deleteMessage(tenantId:string,channelId:string,messageId:string):Promise<void>;
  sendDirectMessage(tenantId:string,userId:string,payload:Record<string,unknown>):Promise<string>;
}
export interface DshDiscordBrandingV1 { communityMemberName:string; spotlightChannelId?:string; spotlightEnabled?:boolean; groupChannels?:Record<string,string>; onboardingCustomId?:string; embedTemplates?:DshEmbedTemplates; }
export interface DshDiscordBrandingSourceV1 { getBranding(tenantId:string):Promise<DshDiscordBrandingV1>|DshDiscordBrandingV1; }
export interface DshSpotlightMediaSourceV1 { getImage(input:{tenantId:string;member:DshLiveMemberV1;stream:DshTwitchStreamV1}):Promise<string|undefined>|string|undefined; }

export interface DshTrackedDiscordMessageV1 { tenantId:string; kind:"shoutout"|"spotlight"|"calendar"|"applications"; key:string; channelId:string; messageId:string; updatedAt:string; }

export class SqliteDshDiscordMessageStore {
  private readonly db:DatabaseSync;
  constructor(path:string){if(!path)throw new Error("DSH Discord state database path is required");this.db=new DatabaseSync(path,{timeout:5000});this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");this.db.exec(`CREATE TABLE IF NOT EXISTS dsh_discord_messages(tenant_id TEXT NOT NULL,kind TEXT NOT NULL,message_key TEXT NOT NULL,channel_id TEXT NOT NULL,message_id TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,kind,message_key)) STRICT;`);}
  close(){this.db.close();}
  get(tenantId:string,kind:DshTrackedDiscordMessageV1["kind"],key:string):DshTrackedDiscordMessageV1|undefined{const row=this.db.prepare("SELECT tenant_id AS tenantId,kind,message_key AS key,channel_id AS channelId,message_id AS messageId,updated_at AS updatedAt FROM dsh_discord_messages WHERE tenant_id=? AND kind=? AND message_key=?").get(cleanId(tenantId,"tenantId"),kind,cleanId(key,"key")) as DshTrackedDiscordMessageV1|undefined;return row?structuredClone(row):undefined;}
  list(tenantId:string,kind?:DshTrackedDiscordMessageV1["kind"]):DshTrackedDiscordMessageV1[]{const rows=(kind?this.db.prepare("SELECT tenant_id AS tenantId,kind,message_key AS key,channel_id AS channelId,message_id AS messageId,updated_at AS updatedAt FROM dsh_discord_messages WHERE tenant_id=? AND kind=? ORDER BY updated_at DESC").all(cleanId(tenantId,"tenantId"),kind):this.db.prepare("SELECT tenant_id AS tenantId,kind,message_key AS key,channel_id AS channelId,message_id AS messageId,updated_at AS updatedAt FROM dsh_discord_messages WHERE tenant_id=? ORDER BY updated_at DESC").all(cleanId(tenantId,"tenantId"))) as unknown as DshTrackedDiscordMessageV1[];return structuredClone(rows);}
  put(value:DshTrackedDiscordMessageV1){this.db.prepare("INSERT INTO dsh_discord_messages(tenant_id,kind,message_key,channel_id,message_id,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,kind,message_key) DO UPDATE SET channel_id=excluded.channel_id,message_id=excluded.message_id,updated_at=excluded.updated_at").run(cleanId(value.tenantId,"tenantId"),value.kind,cleanId(value.key,"key"),snowflake(value.channelId,"channelId"),snowflake(value.messageId,"messageId"),iso(value.updatedAt));return value;}
  remove(tenantId:string,kind:DshTrackedDiscordMessageV1["kind"],key:string){this.db.prepare("DELETE FROM dsh_discord_messages WHERE tenant_id=? AND kind=? AND message_key=?").run(cleanId(tenantId,"tenantId"),kind,cleanId(key,"key"));}
}

export class DshDiscordApi {
  constructor(private readonly grants:DshDiscordGrantSourceV1,private readonly fetchImpl:typeof fetch=fetch,private readonly origin="https://discord.com/api/v10"){
    const url=new URL(origin);if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)throw new Error("Discord API origin must be credential-free HTTPS");
  }
  async createMessage(tenantId:string,channelId:string,payload:Record<string,unknown>){const body=await this.request<{id?:string}>(tenantId,`/channels/${snowflake(channelId,"channelId")}/messages`,"POST",payload);if(!body?.id)throw new Error("Discord did not return a message id");return body.id;}
  async getUser(tenantId:string,userId:string){return (await this.request<{id:string;avatar?:string|null}>(tenantId,`/users/${snowflake(userId,"userId")}`,"GET",undefined,"guilds:read"))!;}
  async listGuilds(tenantId:string){return await this.request<Array<{id?:string;name?:string;icon?:string|null}>>(tenantId,"/users/@me/guilds","GET",undefined,"guilds:read")??[];}
  async checkinRoleMembers(tenantId:string,guildId:string,roleId:string){
    const guild=snowflake(guildId,"guildId"),role=snowflake(roleId,"roleId");
    const roles=await this.request<Array<{id:string;name:string}>>(tenantId,`/guilds/${guild}/roles`,"GET",undefined,"guilds:read");
    const selected=roles?.find(r=>r.id===role);if(!selected)throw new Error("Choose a role in the configured Discord server");
    const members:Array<{id:string;name:string;imageUrl:string}>=[];let after="0";
    for(let page=0;page<10;page++){
      const rows=await this.request<Array<{user?:{id:string;username:string;global_name?:string;avatar?:string;bot?:boolean};nick?:string;roles?:string[]}>>(tenantId,`/guilds/${guild}/members?limit=1000&after=${after}`,"GET",undefined,"guilds:read");
      if(!Array.isArray(rows)||rows.length>1000)throw new Error("Discord returned an invalid member page");
      for(const row of rows){const u=row.user;if(!u||u.bot||!row.roles?.includes(role))continue;snowflake(u.id,"memberId");members.push({id:u.id,name:String(row.nick||u.global_name||u.username).slice(0,120),imageUrl:u.avatar&&/^[a-zA-Z0-9_]{1,100}$/.test(u.avatar)?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`:""});}
      if(rows.length<1000)return {guildId:guild,roleId:role,roleName:selected.name,members,syncedAt:new Date().toISOString()};
      const next=snowflake(rows.at(-1)?.user?.id??"","memberId");if(BigInt(next)<=BigInt(after))throw new Error("Discord member pagination did not advance");after=next;
    }
    throw new Error("The member list exceeds 10000 entries; no partial role import was returned");
  }
  async listGuildChannels(tenantId:string,guildId:string){return await this.request<Array<{id?:string;name?:string;type?:number;position?:number}>>(tenantId,`/guilds/${snowflake(guildId,"guildId")}/channels`,"GET",undefined,"channels:read")??[];}
  async editMessage(tenantId:string,channelId:string,messageId:string,payload:Record<string,unknown>){return this.request(tenantId,`/channels/${snowflake(channelId,"channelId")}/messages/${snowflake(messageId,"messageId")}`,"PATCH",payload);}
  async deleteMessage(tenantId:string,channelId:string,messageId:string){await this.request(tenantId,`/channels/${snowflake(channelId,"channelId")}/messages/${snowflake(messageId,"messageId")}`,"DELETE");}
  async sendDirectMessage(tenantId:string,userId:string,payload:Record<string,unknown>){const channel=await this.request<{id?:string}>(tenantId,"/users/@me/channels","POST",{recipient_id:snowflake(userId,"userId")});if(!channel?.id)throw new Error("Discord did not return a direct-message channel");return this.createMessage(tenantId,channel.id,payload);}
  async listScheduledEvents(tenantId:string,guildId:string){return await this.request<DshScheduledEventV1[]>(tenantId,`/guilds/${snowflake(guildId,"guildId")}/scheduled-events`,"GET",undefined,"events:read")??[];}
  async getScheduledEvent(tenantId:string,guildId:string,eventId:string){const event=await this.request<DshScheduledEventV1>(tenantId,`/guilds/${snowflake(guildId,"guildId")}/scheduled-events/${snowflake(eventId,"eventId")}`,"GET",undefined,"events:read");if(!event)throw new Error("Discord returned no event");return event;}
  async createScheduledEvent(tenantId:string,guildId:string,payload:Record<string,unknown>){const event=await this.request<DshScheduledEventV1>(tenantId,`/guilds/${snowflake(guildId,"guildId")}/scheduled-events`,"POST",payload,"events:write");if(!event?.id)throw new Error("Discord returned no scheduled event");return event;}
  async editScheduledEvent(tenantId:string,guildId:string,eventId:string,payload:Record<string,unknown>){const event=await this.request<DshScheduledEventV1>(tenantId,`/guilds/${snowflake(guildId,"guildId")}/scheduled-events/${snowflake(eventId,"eventId")}`,"PATCH",payload,"events:write");if(!event?.id)throw new Error("Discord returned no scheduled event");return event;}
  async deleteScheduledEvent(tenantId:string,guildId:string,eventId:string){await this.request(tenantId,`/guilds/${snowflake(guildId,"guildId")}/scheduled-events/${snowflake(eventId,"eventId")}`,"DELETE",undefined,"events:write");}
  private async request<T=unknown>(tenantId:string,path:string,method:string,body?:unknown,capability:"messages:write"|"channels:read"|"guilds:read"|"events:read"|"events:write"="messages:write"):Promise<T|undefined>{const grant=await this.grants.getGrant({tenantId:cleanId(tenantId,"tenantId"),capability});if(!grant?.authorization||/[\r\n]/.test(grant.authorization))throw new Error("Discord grant is unavailable");if(grant.expiresAt&&Date.parse(grant.expiresAt)<=Date.now())throw new Error("Discord grant is expired");const encoded=body===undefined?undefined:await dshDiscordRequestBody(body as Record<string,unknown>,this.fetchImpl);const response=await this.fetchImpl(`${this.origin.replace(/\/$/,"")}${path}`,{method,headers:{authorization:grant.authorization,accept:"application/json",...(encoded?.headers??{})},...(encoded?{body:encoded.body}:{}),signal:AbortSignal.timeout(15000)});if(response.status===204)return undefined;const text=await response.text();let payload:unknown=undefined;if(text){try{payload=JSON.parse(text);}catch{payload={message:text.slice(0,500)};}}if(!response.ok)throw new DshDiscordError(response.status,payload);return payload as T;}
}
export class DshDiscordError extends Error{constructor(readonly status:number,readonly responseBody:unknown){super(`Discord request failed with status ${status}`);this.name="DshDiscordError";}}

/** Publishes DSH's durable live outbox to Discord while retaining message ids for edit/remove parity. */
export class DshDiscordLivePublisher implements DshLiveActionPublisherV1 {
  constructor(private readonly api:DshDiscordTransportV1,private readonly state:SqliteDshDiscordMessageStore,private readonly branding:DshDiscordBrandingSourceV1,private readonly media?:DshSpotlightMediaSourceV1,private readonly now:()=>string=()=>new Date().toISOString()){}
  async publish(action:DshLiveActionV1){
    switch(action.type){
      case "shoutout.create": await this.upsertShoutout(action.tenantId,action.member,action.stream,false); return;
      case "shoutout.update": await this.upsertShoutout(action.tenantId,action.member,action.stream,false); return;
      case "shoutout.remove": await this.removeShoutout(action.tenantId,action.member); return;
      case "spotlight.update": await this.upsertSpotlight(action.tenantId,action.member,action.stream); return;
      case "spotlight.clear": await this.clearSpotlight(action.tenantId); return;
    }
  }
  private async upsertShoutout(tenantId:string,member:DshLiveMemberV1,stream:DshTwitchStreamV1,spotlight:boolean){
    const brand=await this.branding.getBranding(tenantId);let tracked=this.state.get(tenantId,"shoutout",member.canonicalUserId);const channelId=brand.groupChannels?.[dshShoutoutGroupSlug(member.group)||'']||member.shoutoutChannelId;const payload=buildDshTierShoutout(dshStreamShoutout(member,stream),{...(brand.embedTemplates?{templates:brand.embedTemplates}:{}),timestamp:this.now()});
    if(tracked&&tracked.channelId!==channelId){await this.api.deleteMessage(tenantId,tracked.channelId,tracked.messageId).catch(error=>{if(!repostable(error))throw error});this.state.remove(tenantId,"shoutout",member.canonicalUserId);tracked=undefined;}
    if(tracked){try{await this.api.editMessage(tenantId,tracked.channelId,tracked.messageId,payload);this.state.put({...tracked,updatedAt:this.now()});return;}catch(error){if(!repostable(error))throw error;await this.api.deleteMessage(tenantId,tracked.channelId,tracked.messageId).catch(()=>undefined);}}
    const messageId=await this.api.createMessage(tenantId,channelId,payload);this.state.put({tenantId,kind:"shoutout",key:member.canonicalUserId,channelId,messageId,updatedAt:this.now()});
  }
  private async removeShoutout(tenantId:string,member:DshLiveMemberV1){const tracked=this.state.get(tenantId,"shoutout",member.canonicalUserId);if(!tracked)return;await this.api.deleteMessage(tenantId,tracked.channelId,tracked.messageId).catch((error)=>{if(!repostable(error))throw error;});this.state.remove(tenantId,"shoutout",member.canonicalUserId);}
  private async upsertSpotlight(tenantId:string,member:DshLiveMemberV1,stream:DshTwitchStreamV1){
    const brand=await this.branding.getBranding(tenantId);if(brand.spotlightEnabled===false){await this.clearSpotlight(tenantId);return;}const channelId=brand.spotlightChannelId??member.shoutoutChannelId;const image=await this.media?.getImage({tenantId,member,stream});const tracked=this.state.get(tenantId,"spotlight","current");const embed=buildSpotlightEmbed(member,stream,image);const components=brand.onboardingCustomId?[{type:1,components:[{type:2,style:1,label:"Join SpaceMountain",custom_id:brand.onboardingCustomId}]}]:[];const payload={embeds:[embed],components,allowed_mentions:{parse:[]}};
    if(tracked){await this.api.deleteMessage(tenantId,tracked.channelId,tracked.messageId).catch((error)=>{if(!repostable(error))throw error;});}
    const messageId=await this.api.createMessage(tenantId,channelId,payload);this.state.put({tenantId,kind:"spotlight",key:"current",channelId,messageId,updatedAt:this.now()});
    await this.upsertShoutout(tenantId,member,stream,true);
  }
  private async clearSpotlight(tenantId:string){const tracked=this.state.get(tenantId,"spotlight","current");if(!tracked)return;await this.api.deleteMessage(tenantId,tracked.channelId,tracked.messageId).catch((error)=>{if(!repostable(error))throw error;});this.state.remove(tenantId,"spotlight","current");}
}

function buildSpotlightEmbed(member:DshLiveMemberV1,stream:DshTwitchStreamV1,image?:string){return{title:"⭐ COMMUNITY SPOTLIGHT ⭐",description:`**${stream.displayName}** is featured!\n[Watch Stream](https://twitch.tv/${member.twitchLogin})`,color:0xFFD700,thumbnail:{url:image??thumbnail(stream.thumbnailUrl,300,300)},fields:[{name:"🎮 Game",value:stream.gameName||"No category",inline:true},{name:"👥 Viewers",value:String(stream.viewerCount),inline:true},{name:"🔄 Rotates",value:"Every 10 min",inline:true}]};}
function thumbnail(value:string,width:number,height:number){return String(value||"").replace("{width}",String(width)).replace("{height}",String(height));}
function repostable(error:unknown){if(error instanceof DshDiscordError)return error.status===404||error.status===400;return /30046|unknown message|message_not_found|404/i.test(error instanceof Error?error.message:String(error));}
function cleanId(value:string,name:string){const clean=String(value??"").trim();if(!clean||clean.length>300||/[\r\n\0]/.test(clean))throw new Error(`${name} is invalid`);return clean;}
function snowflake(value:string,name:string){const clean=String(value??"").trim();if(!/^\d{5,30}$/.test(clean))throw new Error(`${name} must be a Discord snowflake`);return clean;}
function iso(value:string){if(!Number.isFinite(Date.parse(value)))throw new Error("updatedAt is invalid");return new Date(value).toISOString();}
