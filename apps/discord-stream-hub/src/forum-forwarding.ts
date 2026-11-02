import type { SpmtClient } from "@spmt/sdk";
import { DatabaseSync } from "node:sqlite";
import { DshDiscordApi, DshDiscordError } from "./discord-live-publisher.js";
export const DSH_FORUM_POST_FORWARDED="dsh.forum.post-forwarded.v1";
export interface DshForwardedForumPostV1 {
  sourceApp:string;sourceServerId:string;sourceChannelId:string;sourceChannelName:string;
  sourceMessageId:string;sourceMessageUrl?:string;authorId:string;authorName:string;
  title:string;content:string;category?:string;postedAt?:string;
  embeds?:Array<Record<string,unknown>>;attachments?:Array<Record<string,unknown>>;
  mentionedUsers?:Array<Record<string,unknown>>;
}
function forumText(value:unknown,max:number){const result=String(value??"").trim();if(!result||result.length>max||result.includes("\0"))throw new Error("Forwarded forum post contains invalid text");return result;}
function forumList(value:unknown,max:number){if(value===undefined||value===null)return[];if(!Array.isArray(value)||value.length>max)throw new Error("Forwarded forum post contains too many rich items");return value.map(item=>{if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Forwarded forum rich item is invalid");const encoded=JSON.stringify(item);if(encoded.length>12000)throw new Error("Forwarded forum rich item is too large");return JSON.parse(encoded) as Record<string,unknown>;});}
export function normalizeDshForwardedForumPost(value:unknown):DshForwardedForumPostV1{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Forwarded forum post is required");
  const item=value as Record<string,unknown>,postedAt=item.postedAt===undefined?undefined:forumText(item.postedAt,60);
  if(postedAt&&!Number.isFinite(Date.parse(postedAt)))throw new Error("Forwarded forum post time is invalid");
  const sourceMessageUrl=item.sourceMessageUrl===undefined?undefined:forumText(item.sourceMessageUrl,2048);
  if(sourceMessageUrl){const url=new URL(sourceMessageUrl);if(url.protocol!=="https:")throw new Error("Forwarded forum source URL must use HTTPS");}
  return {sourceApp:forumText(item.sourceApp,80),sourceServerId:forumText(item.sourceServerId,120),sourceChannelId:forumText(item.sourceChannelId,120),sourceChannelName:forumText(item.sourceChannelName,120),sourceMessageId:forumText(item.sourceMessageId,120),...(sourceMessageUrl?{sourceMessageUrl}:{}),authorId:forumText(item.authorId,120),authorName:forumText(item.authorName,120),title:forumText(item.title,300),content:forumText(item.content,12000),...(item.category===undefined?{}:{category:forumText(item.category,100)}),...(postedAt?{postedAt}:{}),embeds:forumList(item.embeds,10),attachments:forumList(item.attachments,20),mentionedUsers:forumList(item.mentionedUsers,50)};
}
export async function forwardDshForumPost(client:SpmtClient,tenantId:string,value:unknown){
  const post=normalizeDshForwardedForumPost(value);
  const result=await client.publishEvent(tenantId,DSH_FORUM_POST_FORWARDED,{schemaVersion:1,...post,forwardedAt:new Date().toISOString()},`dsh-forum:${post.sourceApp}:${post.sourceServerId}:${post.sourceChannelId}:${post.sourceMessageId}`);
  return {accepted:true,duplicate:result.duplicate,event:result.event};
}

export type DshForumForwardRuleV1 = {
  schemaVersion:1; tenantId:string; sourceGuildId:string; destinationGuildId:string; forumChannelId:string;
  mode:"per-channel"|"single-thread"; sharedThreadId?:string; paused:boolean;
  restrictToWhitelist:boolean; sourceChannelWhitelist:string[];
};
export type DshForumForwardMutationV1 = {
  tenantId:string; guildId:string; channelId:string; channelName:string; channelType:number;
  messageId:string; authorId:string; authorName:string; authorAvatar?:string; content:string;
  attachments?:Array<{url?:string;proxyUrl?:string;filename?:string;contentType?:string}>;
  embeds?:Array<{title?:string;description?:string;url?:string;imageUrl?:string}>;
  sourceMessageUrl?:string; occurredAt:string; sourceIsPublic:boolean;
  authorIsBot?:boolean; originatedFromForwarder?:boolean; operation?:"create"|"edit"|"delete";
};
function discordSnowflake(value:string,name:string){if(!/^\\d{5,30}$/.test(value))throw new Error("Invalid "+name);return value;}
function validateForwardRule(value:DshForumForwardRuleV1){
  if(value.schemaVersion!==1||!value.tenantId||!value.sourceGuildId||!value.destinationGuildId||
    !value.forumChannelId||!["per-channel","single-thread"].includes(value.mode)||
    typeof value.paused!=="boolean"||typeof value.restrictToWhitelist!=="boolean"||
    !Array.isArray(value.sourceChannelWhitelist)||value.sourceChannelWhitelist.length>500)throw new Error("Invalid forum forwarding rule");
  discordSnowflake(value.sourceGuildId,"source guild");discordSnowflake(value.destinationGuildId,"destination guild");
  discordSnowflake(value.forumChannelId,"forum channel");
  if(value.mode==="single-thread")discordSnowflake(value.sharedThreadId??"","shared thread");
  value.sourceChannelWhitelist.forEach(v=>discordSnowflake(v,"source channel"));
  return {...value,sourceChannelWhitelist:[...new Set(value.sourceChannelWhitelist)]};
}

/** App-private persistence for DSH's donor-derived forum routing and source receipts. */
export class DshForumForwardingStore {
  private readonly db:DatabaseSync;
  constructor(path:string){
    this.db=new DatabaseSync(path,{timeout:5000});this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dsh_forum_rules(tenant_id TEXT NOT NULL,source_guild_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,source_guild_id)) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_forum_threads(tenant_id TEXT NOT NULL,source_guild_id TEXT NOT NULL,source_channel_id TEXT NOT NULL,thread_id TEXT,pending INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,source_guild_id,source_channel_id)) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_forum_messages(tenant_id TEXT NOT NULL,source_guild_id TEXT NOT NULL,source_channel_id TEXT NOT NULL,source_message_id TEXT NOT NULL,thread_id TEXT NOT NULL,forwarded_message_id TEXT NOT NULL,deleted INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,source_guild_id,source_channel_id,source_message_id)) STRICT;
    `);
  }
  close(){this.db.close();}
  putRule(input:DshForumForwardRuleV1){const r=validateForwardRule(input);this.db.prepare("INSERT INTO dsh_forum_rules VALUES(?,?,?) ON CONFLICT(tenant_id,source_guild_id) DO UPDATE SET body=excluded.body").run(r.tenantId,r.sourceGuildId,JSON.stringify(r));return r;}
  listRules(tenant:string){const rows=this.db.prepare("SELECT body FROM dsh_forum_rules WHERE tenant_id=? ORDER BY source_guild_id").all(tenant) as Array<{body:string}>;return rows.map(row=>validateForwardRule(JSON.parse(row.body) as DshForumForwardRuleV1));}
  getRule(tenant:string,guild:string){const row=this.db.prepare("SELECT body FROM dsh_forum_rules WHERE tenant_id=? AND source_guild_id=?").get(tenant,guild) as {body:string}|undefined;return row?validateForwardRule(JSON.parse(row.body) as DshForumForwardRuleV1):undefined;}
  getThread(tenant:string,guild:string,channel:string){return this.db.prepare("SELECT thread_id,pending FROM dsh_forum_threads WHERE tenant_id=? AND source_guild_id=? AND source_channel_id=?").get(tenant,guild,channel) as {thread_id:string|null;pending:number}|undefined;}
  setThread(tenant:string,guild:string,channel:string,thread:string|null,pending:boolean,now:string){this.db.prepare("INSERT INTO dsh_forum_threads VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,source_guild_id,source_channel_id) DO UPDATE SET thread_id=excluded.thread_id,pending=excluded.pending,updated_at=excluded.updated_at").run(tenant,guild,channel,thread,pending?1:0,now);}
  getMessage(tenant:string,guild:string,channel:string,message:string){return this.db.prepare("SELECT thread_id,forwarded_message_id,deleted FROM dsh_forum_messages WHERE tenant_id=? AND source_guild_id=? AND source_channel_id=? AND source_message_id=?").get(tenant,guild,channel,message) as {thread_id:string;forwarded_message_id:string;deleted:number}|undefined;}
  setMessage(v:{tenant:string;guild:string;channel:string;message:string;thread:string;forwarded:string;deleted:boolean;now:string}){this.db.prepare("INSERT INTO dsh_forum_messages VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,source_guild_id,source_channel_id,source_message_id) DO UPDATE SET thread_id=excluded.thread_id,forwarded_message_id=excluded.forwarded_message_id,deleted=excluded.deleted,updated_at=excluded.updated_at").run(v.tenant,v.guild,v.channel,v.message,v.thread,v.forwarded,v.deleted?1:0,v.now);}
}

type DshForumDiscordPort = Pick<DshDiscordApi,"getChannel"|"createForumThread"|"createThreadMessage"|"editThreadMessage"|"deleteThreadMessage"|"setThreadArchived">;

/** Actual Discord forum delivery: per-source/single-thread routing, rich media, edits, deletes and loop prevention. */
export class DshForumForwardingService {
  constructor(private readonly store:DshForumForwardingStore,private readonly discord:DshForumDiscordPort,private readonly now:()=>string=()=>new Date().toISOString()){}
  configure(rule:DshForumForwardRuleV1){return this.store.putRule(rule);}
  async apply(event:DshForumForwardMutationV1){
    discordSnowflake(event.guildId,"guild");discordSnowflake(event.channelId,"channel");discordSnowflake(event.messageId,"message");
    if(event.authorIsBot||event.originatedFromForwarder)return{status:"skipped" as const,reason:"forward-loop"};
    if(!event.sourceIsPublic)return{status:"skipped" as const,reason:"restricted-source"};
    if([10,11,12,15,16].includes(event.channelType))return{status:"skipped" as const,reason:"thread-or-forum-source"};
    const rule=this.store.getRule(event.tenantId,event.guildId);if(!rule)return{status:"unconfigured" as const};
    if(rule.paused)return{status:"skipped" as const,reason:"paused"};
    if(rule.restrictToWhitelist&&rule.sourceChannelWhitelist.length&&!rule.sourceChannelWhitelist.includes(event.channelId))return{status:"skipped" as const,reason:"not-whitelisted"};
    const prior=this.store.getMessage(event.tenantId,event.guildId,event.channelId,event.messageId),operation=event.operation??"create";
    if(operation==="delete"){
      if(!prior||prior.deleted)return{status:"duplicate" as const};
      await this.discord.deleteThreadMessage(event.tenantId,prior.thread_id,prior.forwarded_message_id);
      this.store.setMessage({tenant:event.tenantId,guild:event.guildId,channel:event.channelId,message:event.messageId,thread:prior.thread_id,forwarded:prior.forwarded_message_id,deleted:true,now:this.now()});
      return{status:"deleted" as const,threadId:prior.thread_id};
    }
    const payload=buildDshForumDiscordPayload(event);
    if(operation==="edit"){
      if(!prior||prior.deleted)return{status:"missing-original" as const};
      await this.discord.editThreadMessage(event.tenantId,prior.thread_id,prior.forwarded_message_id,payload);
      this.store.setMessage({tenant:event.tenantId,guild:event.guildId,channel:event.channelId,message:event.messageId,thread:prior.thread_id,forwarded:prior.forwarded_message_id,deleted:false,now:this.now()});
      return{status:"edited" as const,threadId:prior.thread_id};
    }
    if(prior)return{status:"duplicate" as const,threadId:prior.thread_id};
    const thread=await this.ensureThread(rule,event),forwarded=await this.discord.createThreadMessage(event.tenantId,thread,payload);
    this.store.setMessage({tenant:event.tenantId,guild:event.guildId,channel:event.channelId,message:event.messageId,thread,forwarded,deleted:false,now:this.now()});
    return{status:"forwarded" as const,threadId:thread,forwardedMessageId:forwarded};
  }
  private async ensureThread(rule:DshForumForwardRuleV1,event:DshForumForwardMutationV1){
    if(rule.mode==="single-thread"){
      const target=await this.discord.getChannel(event.tenantId,rule.sharedThreadId!);
      if(target.guild_id!==rule.destinationGuildId||![10,11,12].includes(Number(target.type)))throw new Error("Shared destination is not a thread in the configured server");
      if(target.thread_metadata?.archived)await this.discord.setThreadArchived(event.tenantId,target.id,false);
      return target.id;
    }
    const saved=this.store.getThread(event.tenantId,event.guildId,event.channelId);
    if(saved?.pending)throw new Error("Forum thread creation has an unknown result; reconcile before retrying to avoid duplicates");
    if(saved?.thread_id){
      const target=await this.discord.getChannel(event.tenantId,saved.thread_id);
      if(target.guild_id!==rule.destinationGuildId||target.parent_id!==rule.forumChannelId||![10,11,12].includes(Number(target.type)))throw new Error("Saved forwarding thread is outside the configured destination");
      if(target.thread_metadata?.archived)await this.discord.setThreadArchived(event.tenantId,target.id,false);
      return target.id;
    }
    const forum=await this.discord.getChannel(event.tenantId,rule.forumChannelId);
    if(forum.guild_id!==rule.destinationGuildId||![15,16].includes(Number(forum.type)))throw new Error("Destination must be a forum or media channel in the configured server");
    this.store.setThread(event.tenantId,event.guildId,event.channelId,null,true,this.now());
    try{
      const created=await this.discord.createForumThread(event.tenantId,rule.forumChannelId,event.channelName.slice(0,100),{content:"Forwarded messages from #"+event.channelName,allowed_mentions:{parse:[]}});
      this.store.setThread(event.tenantId,event.guildId,event.channelId,created.threadId,false,this.now());
      return created.threadId;
    }catch(error){
      if(error instanceof DshDiscordError&&error.status>=400&&error.status<500&&error.status!==408)this.store.setThread(event.tenantId,event.guildId,event.channelId,null,false,this.now());
      throw error;
    }
  }
}
export function buildDshForumDiscordPayload(event:DshForumForwardMutationV1):Record<string,unknown>{
  const attachments=(event.attachments??[]).filter(a=>typeof(a.url??a.proxyUrl)==="string").slice(0,10),embeds=(event.embeds??[]).slice(0,3);
  const fields:Array<{name:string;value:string}>=[];
  if(attachments.length)fields.push({name:"Attachments",value:attachments.map(a=>"[Open "+String(a.filename||"attachment").slice(0,80)+"]("+String(a.url??a.proxyUrl)+")").join("\\n").slice(0,1024)});
  for(const e of embeds)if(e.title||e.description)fields.push({name:String(e.title||"Source embed").slice(0,256),value:String(e.description||e.url||"Embedded content").slice(0,1024)});
  const image=attachments.find(a=>String(a.contentType??"").startsWith("image/"))?.url??embeds.find(e=>e.imageUrl)?.imageUrl;
  const embed:Record<string,unknown>={author:{name:event.authorName,...(event.authorAvatar?{icon_url:event.authorAvatar}:{})},description:(event.content||"").slice(0,4000)||"\u200b",color:0x5865f2,footer:{text:"Discord · #"+event.channelName},timestamp:event.occurredAt,...(event.sourceMessageUrl?{url:event.sourceMessageUrl}:{}),...(image?{image:{url:image}}:{}),...(fields.length?{fields:fields.slice(0,10)}:{})};
  return{embeds:[embed],allowed_mentions:{parse:[]}};
}
