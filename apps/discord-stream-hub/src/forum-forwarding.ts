import { createHash } from "node:crypto";
import type { SpmtClient } from "@spmt/sdk";
import { DatabaseSync } from "node:sqlite";
import { DshDiscordApi, DshDiscordError } from "./discord-live-publisher.js";
export const DSH_FORUM_POST_FORWARDED="dsh.forum.post-forwarded.v1";
export interface DshForwardedForumPostV1 {
  sourceApp:string;sourceServerId:string;sourceChannelId:string;sourceChannelName:string;
  sourceMessageId:string;sourceThreadId?:string;sourceMessageUrl?:string;authorId:string;authorName:string;
  title:string;content:string;category?:string;postedAt?:string;
  embeds?:Array<Record<string,unknown>>;attachments?:Array<Record<string,unknown>>;
  mentionedUsers?:Array<Record<string,unknown>>;
  operation?:"create"|"edit"|"delete";
}
function forumHttps(value:unknown):string|undefined{try{const url=new URL(String(value??""));return url.protocol==="https:"&&!url.username&&!url.password&&url.href.length<=2048?url.href:undefined;}catch{return undefined;}}
function forumText(value:unknown,max:number){const result=String(value??"").trim();if(!result||result.length>max||result.includes("\0"))throw new Error("Forwarded forum post contains invalid text");return result;}
function forumList(value:unknown,max:number){if(value===undefined||value===null)return[];if(!Array.isArray(value)||value.length>max)throw new Error("Forwarded forum post contains too many rich items");return value.map(item=>{if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Forwarded forum rich item is invalid");const encoded=JSON.stringify(item);if(encoded.length>12000)throw new Error("Forwarded forum rich item is too large");return JSON.parse(encoded) as Record<string,unknown>;});}
export function normalizeDshForwardedForumPost(value:unknown):DshForwardedForumPostV1{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Forwarded forum post is required");
  const item=value as Record<string,unknown>,operation=item.operation===undefined?"create":item.operation,postedAt=item.postedAt===undefined?undefined:forumText(item.postedAt,60);if(operation!=="create"&&operation!=="edit"&&operation!=="delete")throw new Error("Forwarded forum operation is invalid");
  if(postedAt&&!Number.isFinite(Date.parse(postedAt)))throw new Error("Forwarded forum post time is invalid");
  const sourceMessageUrl=item.sourceMessageUrl===undefined?undefined:forumText(item.sourceMessageUrl,2048);
  if(sourceMessageUrl&&!forumHttps(sourceMessageUrl))throw new Error("Forwarded forum source URL must use credential-free HTTPS");
  return {sourceApp:forumText(item.sourceApp,80),sourceServerId:forumText(item.sourceServerId,120),sourceChannelId:forumText(item.sourceChannelId,120),sourceChannelName:forumText(item.sourceChannelName,120),sourceMessageId:forumText(item.sourceMessageId,120),...(item.sourceThreadId===undefined?{}:{sourceThreadId:forumText(item.sourceThreadId,120)}),...(sourceMessageUrl?{sourceMessageUrl}:{}),authorId:forumText(item.authorId,120),authorName:forumText(item.authorName,120),title:forumText(item.title,300),content:operation==="delete"?String(item.content??"").slice(0,12000):forumText(item.content,12000),...(item.category===undefined?{}:{category:forumText(item.category,100)}),...(postedAt?{postedAt}:{}),embeds:forumList(item.embeds,10),attachments:forumList(item.attachments,20),mentionedUsers:forumList(item.mentionedUsers,50),operation};
}
export const DSH_FORUM_POST_MUTATED="dsh.forum.post-mutated.v1";
export async function forwardDshForumPost(client:SpmtClient,tenantId:string,value:unknown){
  const post=normalizeDshForwardedForumPost(value),origin={provider:"discord",channelId:post.sourceChannelId,...(post.sourceThreadId?{threadId:post.sourceThreadId}:{}),messageId:post.sourceMessageId,authorId:post.authorId,authorName:post.authorName,...(post.sourceMessageUrl?{sourceUrl:post.sourceMessageUrl}:{}),sourceApp:post.sourceApp};
  const create=()=>client.createCommlinkForumPost(tenantId,{title:post.title,body:post.content||"[Discord forum post]",origin});let native:Awaited<ReturnType<typeof create>>|undefined;
  if(post.operation==="delete"){try{await client.mutateCommlinkForumImport(tenantId,{operation:"delete",origin});}catch(error){if((error as {status?:number})?.status!==404)throw error;}}
  else if(post.operation==="edit"){try{const result=await client.mutateCommlinkForumImport(tenantId,{operation:"edit",origin,title:post.title,body:post.content});native=result.post?{post:result.post}:undefined;}catch(error){if((error as {status?:number})?.status!==404)throw error;native=await create();}}
  else native=await create();
  const eventType=post.operation==="create"?DSH_FORUM_POST_FORWARDED:DSH_FORUM_POST_MUTATED;
  const key=post.operation==="create"?`dsh-forum:${post.sourceApp}:${post.sourceServerId}:${post.sourceChannelId}:${post.sourceMessageId}`:`dsh-forum-mutation:${post.sourceApp}:${post.sourceServerId}:${post.sourceChannelId}:${post.sourceMessageId}:${post.operation}:${post.postedAt??"unknown"}`;
  const result=await client.publishEvent(tenantId,eventType,{schemaVersion:1,...post,forwardedAt:new Date().toISOString()},key);
  return {accepted:true,duplicate:result.duplicate,event:result.event,...(native?.post?{post:native.post}:{})};
}

/** Imports a Discord forum and its thread replies into SPMT-owned Commlink records. */
export async function importDshDiscordForumThreads(client:SpmtClient,discord:DshDiscordApi,tenantId:string,guildId:string,forumId:string){
  const guildKey=forumText(guildId,120),forumKey=forumText(forumId,120),guild=await discord.getGuild(tenantId,guildKey),forum=await discord.getChannel(tenantId,forumKey);
  if(forum.guild_id!==guild.id||![15,16].includes(Number(forum.type)))throw new Error("Choose a forum or media channel in the selected Discord server");
  const byId=new Map<string,any>(),active=await discord.listActiveThreads(tenantId,guildKey);
  for(const thread of Array.isArray(active.threads)?active.threads:[])if(thread?.parent_id===forumKey&&typeof thread.id==="string")byId.set(thread.id,thread);
  let before:string|undefined,archivePages=0;
  while(archivePages<10){const page=await discord.listArchivedForumThreads(tenantId,forumKey,before);for(const thread of Array.isArray(page.threads)?page.threads:[])if(thread?.parent_id===forumKey&&typeof thread.id==="string")byId.set(thread.id,thread);archivePages++;if(!page.has_more||!Array.isArray(page.threads)||!page.threads.length)break;const oldest=page.threads.at(-1),next=String(oldest?.thread_metadata?.archive_timestamp??"");if(!next||next===before)break;before=next;}
  let posts=0,replies=0,skipped=0,truncatedThreads=0;
  for(const thread of byId.values()){
    const messages:any[]=[],seen=new Set<string>();let messageBefore:string|undefined,pages=0,truncated=false;
    while(pages<10){const rows=await discord.listChannelMessages(tenantId,thread.id,messageBefore);if(!rows.length)break;for(const row of rows){if(typeof row?.id==="string"&&!seen.has(row.id)){seen.add(row.id);messages.push(row);}}pages++;if(rows.length<100)break;const oldest=rows.at(-1)?.id;if(typeof oldest!=="string"||oldest===messageBefore)break;messageBefore=oldest;if(pages===10)truncated=true;}
    if(truncated){truncatedThreads++;skipped++;continue;}messages.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);const starter=messages[0];if(!starter?.id){skipped++;continue;}
    const author=(message:any)=>({id:String(message.author?.id??"unknown"),name:String(message.author?.global_name??message.author?.username??"Discord member")});
    const text=(message:any)=>{const content=String(message.content??"").trim(),attachments=Array.isArray(message.attachments)?message.attachments.flatMap((a:any)=>{const url=forumHttps(a.url);return url?[url]:[]}):[];return [content,...attachments].filter(Boolean).join("\n")||"[Discord attachment]";};
    const starterAuthor=author(starter),threadTitle=String(thread.name??"Discord forum post").slice(0,300),starterUrl="https://discord.com/channels/"+guildKey+"/"+thread.id+"/"+starter.id;
    const imported=await forwardDshForumPost(client,tenantId,{sourceApp:"discord-stream-hub",sourceServerId:guildKey,sourceChannelId:forumKey,sourceChannelName:String(forum.name??forumKey),sourceThreadId:String(thread.id),sourceMessageId:String(starter.id),sourceMessageUrl:starterUrl,authorId:starterAuthor.id,authorName:starterAuthor.name,title:threadTitle,content:text(starter),postedAt:starter.timestamp??new Date().toISOString(),attachments:starter.attachments??[],embeds:starter.embeds??[]});
    const postId=imported.post?.id;if(!postId)throw new Error("SPMT did not return the imported forum post");posts++;
    for(const message of messages.slice(1)){if(!message?.id)continue;const a=author(message);await client.createCommlinkForumReply(tenantId,postId,{body:text(message),origin:{provider:"discord",channelId:forumKey,threadId:String(thread.id),messageId:String(message.id),authorId:a.id,authorName:a.name,sourceUrl:"https://discord.com/channels/"+guildKey+"/"+thread.id+"/"+message.id,sourceApp:"discord-stream-hub"}});replies++;}
  }
  return {forumId:forumKey,threadsDiscovered:byId.size,postsImported:posts,repliesImported:replies,skippedThreads:skipped,truncatedThreads};
}


/** Applies one live Discord forum-thread message to its native Commlink post or reply. */
export async function importDshDiscordForumThreadMessage(client:SpmtClient,discord:DshDiscordApi,tenantId:string,guildId:string,forum:any,thread:any,record:any,operation:"create"|"edit"|"delete"="create"){
  if(record.isBot)return false;const threadId=String(thread.id??""),forumId=String(forum.id??""),messageId=String(record.messageId??"");if(!threadId||!forumId||!messageId)return false;
  const starterId=threadId,starterUrl="https://discord.com/channels/"+guildId+"/"+threadId+"/"+starterId;
  let starter:any;if(operation==="delete"&&messageId===starterId)starter={id:starterId,content:record.text,author:{id:record.providerUserId,username:record.displayName??record.username},timestamp:record.occurredAt};else starter=await discord.getChannelMessage(tenantId,threadId,starterId);
  if(!starter?.id)return false;const starterAuthor={id:String(starter.author?.id??"unknown"),name:String(starter.author?.global_name??starter.author?.username??"Discord member")};
  const body=(value:string,attachments:any[]=[])=>[String(value??"").trim(),...attachments.flatMap(a=>{const url=forumHttps(a.url??a.proxyUrl);return url?[url]:[];})].filter(Boolean).join("\n")||"[Discord attachment]";
  let parent:any;try{parent=await forwardDshForumPost(client,tenantId,{sourceApp:"discord-stream-hub",sourceServerId:guildId,sourceChannelId:forumId,sourceChannelName:String(forum.name??forumId),sourceThreadId:threadId,sourceMessageId:starterId,sourceMessageUrl:starterUrl,authorId:starterAuthor.id,authorName:starterAuthor.name,title:String(thread.name||"Discord forum post").slice(0,300),content:body(String(starter.content??""),starter.attachments??[]),postedAt:starter.timestamp??record.occurredAt,attachments:starter.attachments??[],embeds:starter.embeds??[],...(messageId===starterId?{operation}:{})});}catch(error){if(messageId!==starterId&&(error as Error)?.message?.includes("already deleted"))return true;throw error;}
  if(messageId===starterId)return true;const origin={provider:"discord",channelId:forumId,threadId,messageId,authorId:String(record.providerUserId??"unknown"),authorName:String(record.displayName??record.username??"Discord member"),sourceUrl:"https://discord.com/channels/"+guildId+"/"+threadId+"/"+messageId,sourceApp:"discord-stream-hub"};
  if(operation==="delete"){try{await client.mutateCommlinkForumImport(tenantId,{kind:"reply",operation:"delete",origin});}catch(error){if((error as {status?:number})?.status!==404)throw error;}return true;}
  if(operation==="edit"){try{await client.mutateCommlinkForumImport(tenantId,{kind:"reply",operation:"edit",origin,body:body(record.text,record.rich?.attachments??[])});}catch(error){if((error as {status?:number})?.status!==404)throw error;await client.createCommlinkForumReply(tenantId,parent.post!.id,{body:body(record.text,record.rich?.attachments??[]),origin});}return true;}
  await client.createCommlinkForumReply(tenantId,parent.post!.id,{body:body(record.text,record.rich?.attachments??[]),origin});return true;
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
  embeds?:Array<{title?:string;description?:string;url?:string;imageUrl?:string;thumbnailUrl?:string}>;
  sourceMessageUrl?:string; occurredAt:string; sourceIsPublic:boolean;
  authorIsBot?:boolean; originatedFromForwarder?:boolean; operation?:"create"|"edit"|"delete";
};
function discordSnowflake(value:string,name:string){if(value.length<5||value.length>30||Array.from(value).some(char=>char<"0"||char>"9"))throw new Error("Invalid "+name);return value;}
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
      CREATE TABLE IF NOT EXISTS dsh_forum_cursors(tenant_id TEXT PRIMARY KEY,event_id TEXT NOT NULL DEFAULT '') STRICT;
      CREATE TABLE IF NOT EXISTS dsh_forum_rules(tenant_id TEXT NOT NULL,source_guild_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,source_guild_id)) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_forum_threads(tenant_id TEXT NOT NULL,source_guild_id TEXT NOT NULL,source_channel_id TEXT NOT NULL,thread_id TEXT,pending INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,source_guild_id,source_channel_id)) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_forum_messages(tenant_id TEXT NOT NULL,source_guild_id TEXT NOT NULL,source_channel_id TEXT NOT NULL,source_message_id TEXT NOT NULL,thread_id TEXT NOT NULL,forwarded_message_id TEXT NOT NULL,deleted INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,source_guild_id,source_channel_id,source_message_id)) STRICT;
    `);
  }
  cursor(tenant:string){const row=this.db.prepare("SELECT event_id FROM dsh_forum_cursors WHERE tenant_id=?").get(tenant) as {event_id:string}|undefined;return row?.event_id??"";}
  advanceCursor(tenant:string,eventId:string){this.db.prepare("INSERT INTO dsh_forum_cursors VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET event_id=excluded.event_id").run(tenant,eventId);}
  close(){this.db.close();}
  putRule(input:DshForumForwardRuleV1){const r=validateForwardRule(input);this.db.prepare("INSERT INTO dsh_forum_rules VALUES(?,?,?) ON CONFLICT(tenant_id,source_guild_id) DO UPDATE SET body=excluded.body").run(r.tenantId,r.sourceGuildId,JSON.stringify(r));return r;}
  listRules(tenant:string){const rows=this.db.prepare("SELECT body FROM dsh_forum_rules WHERE tenant_id=? ORDER BY source_guild_id").all(tenant) as Array<{body:string}>;return rows.map(row=>validateForwardRule(JSON.parse(row.body) as DshForumForwardRuleV1));}
  replaceRules(tenant:string,rules:DshForumForwardRuleV1[]){this.db.exec("BEGIN IMMEDIATE");try{this.db.prepare("DELETE FROM dsh_forum_rules WHERE tenant_id=?").run(tenant);for(const rule of rules)this.putRule({...rule,tenantId:tenant});this.db.exec("COMMIT");}catch(error){this.db.exec("ROLLBACK");throw error;}}
  getRule(tenant:string,guild:string){const row=this.db.prepare("SELECT body FROM dsh_forum_rules WHERE tenant_id=? AND source_guild_id=?").get(tenant,guild) as {body:string}|undefined;return row?validateForwardRule(JSON.parse(row.body) as DshForumForwardRuleV1):undefined;}
  getThread(tenant:string,guild:string,channel:string){return this.db.prepare("SELECT thread_id,pending FROM dsh_forum_threads WHERE tenant_id=? AND source_guild_id=? AND source_channel_id=?").get(tenant,guild,channel) as {thread_id:string|null;pending:number}|undefined;}
  setThread(tenant:string,guild:string,channel:string,thread:string|null,pending:boolean,now:string){this.db.prepare("INSERT INTO dsh_forum_threads VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,source_guild_id,source_channel_id) DO UPDATE SET thread_id=excluded.thread_id,pending=excluded.pending,updated_at=excluded.updated_at").run(tenant,guild,channel,thread,pending?1:0,now);}
  getMessage(tenant:string,guild:string,channel:string,message:string){return this.db.prepare("SELECT thread_id,forwarded_message_id,deleted FROM dsh_forum_messages WHERE tenant_id=? AND source_guild_id=? AND source_channel_id=? AND source_message_id=?").get(tenant,guild,channel,message) as {thread_id:string;forwarded_message_id:string;deleted:number}|undefined;}
  setMessage(v:{tenant:string;guild:string;channel:string;message:string;thread:string;forwarded:string;deleted:boolean;now:string}){this.db.prepare("INSERT INTO dsh_forum_messages VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,source_guild_id,source_channel_id,source_message_id) DO UPDATE SET thread_id=excluded.thread_id,forwarded_message_id=excluded.forwarded_message_id,deleted=excluded.deleted,updated_at=excluded.updated_at").run(v.tenant,v.guild,v.channel,v.message,v.thread,v.forwarded,v.deleted?1:0,v.now);}
}


type DshForumDiscordPort = Pick<DshDiscordApi,"getChannel"|"createForumThread"|"createThreadMessage"|"editThreadMessage"|"deleteThreadMessage"|"setThreadArchived">;

export function dshForumThreadCreationIdempotencyKey(tenantId:string,forumId:string,sourceGuildId:string,sourceChannelId:string){return `thread:${tenantId}:${forumId}:${sourceGuildId}:${sourceChannelId}`;}

/** DSH submits destination writes as durable jobs; Chat Gateway alone owns Discord credentials and egress. */
class DshCommlinkForumDiscordPort implements DshForumDiscordPort {
  constructor(private readonly client:SpmtClient,private readonly reads:DshDiscordApi){}
  getChannel(tenantId:string,channelId:string){return this.reads.getChannel(tenantId,channelId);}
  async createForumThread(tenantId:string,forumId:string,name:string,message:Record<string,unknown>){
    const content=String(message.content??"Forwarded Discord messages").slice(0,1900);
    const idempotencyKey=String(message.idempotencyKey??`thread:${forumId}:${name}:${content}`);const result=await this.submit(tenantId,"create-thread",forumId,{name,content},idempotencyKey);
    return{threadId:String(result.threadId),messageId:String(result.messageId)};
  }
  async createThreadMessage(tenantId:string,threadId:string,payload:Record<string,unknown>){
    const target=await this.threadTarget(tenantId,threadId);
    const result=await this.submit(tenantId,"upsert",target.parentId,{...this.messageInput(payload),threadId},`create:${threadId}:${this.sourceKey(payload)}`);
    return String(result.providerMessageId);
  }
  async editThreadMessage(tenantId:string,threadId:string,messageId:string,payload:Record<string,unknown>){
    const target=await this.threadTarget(tenantId,threadId);
    await this.submit(tenantId,"upsert",target.parentId,{...this.messageInput(payload),threadId,previousMessageId:messageId},`edit:${threadId}:${messageId}:${this.sourceKey(payload)}`);
  }
  async deleteThreadMessage(tenantId:string,threadId:string,messageId:string){
    const target=await this.threadTarget(tenantId,threadId);
    await this.submit(tenantId,"delete",target.parentId,{threadId,messageId,transport:"webhook"},`delete:${threadId}:${messageId}`);
  }
  private async threadTarget(tenantId:string,threadId:string){
    const thread=await this.reads.getChannel(tenantId,threadId),parentId=String(thread.parent_id??"");
    if(!parentId)throw new Error("Destination thread has no parent channel");
    return{parentId};
  }
  async setThreadArchived(tenantId:string,threadId:string,archived:boolean){
    const target=await this.threadTarget(tenantId,threadId);
    await this.submit(tenantId,"archive-thread",target.parentId,{threadId,archived},`archive:${threadId}:${archived}`);
  }
  private messageInput(payload:Record<string,unknown>){
    const embeds=Array.isArray(payload.embeds)?payload.embeds:[],first=(embeds[0]&&typeof embeds[0]==="object"?embeds[0]:{}) as Record<string,unknown>,author=(first.author&&typeof first.author==="object"?first.author:{}) as Record<string,unknown>;
    return{title:String(first.title??"Forwarded Discord message").slice(0,256),content:String(first.description??"Forwarded Discord message").slice(0,3800)||"Forwarded Discord message",authorName:String(author.name??"Discord member").slice(0,100),...(typeof first.url==="string"?{sourceUrl:first.url}:{}),payload};
  }
  private sourceKey(payload:Record<string,unknown>){const embeds=Array.isArray(payload.embeds)?payload.embeds:[],first=(embeds[0]&&typeof embeds[0]==="object"?embeds[0]:{}) as Record<string,unknown>;return String(first.url??first.timestamp??JSON.stringify(payload).slice(0,180));}
  private async submit(tenantId:string,operation:"create-thread"|"upsert"|"delete"|"archive-thread",targetId:string,details:Record<string,unknown>,key:string):Promise<Record<string,unknown>>{
    const result=await this.client.createExecutionJob(tenantId,{ownerAppId:"discord-stream-hub",capabilityId:"commlink.discord.forum-egress.v1",executionOwner:"chat-gateway",meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"sprite",meteringTarget:"hosted",input:{schemaVersion:1,operation,channelId:targetId,...details}},`commlink-forum-egress:${tenantId}:${createHash("sha256").update(key).digest("hex")}`);
    const jobId=String((result.job as any)?.id??"");if(!jobId)throw new Error("Chat Gateway did not accept the Commlink forum egress job");
    for(let attempt=0;attempt<120;attempt++){
      const job=await this.client.getExecutionJob(tenantId,jobId);
      if(job.state==="succeeded")return (job.result??{}) as Record<string,unknown>;
      if(["failed","cancelled","dead-letter"].includes(job.state))throw new Error(String(job.error?.message??"Chat Gateway Commlink forum egress failed"));
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    throw new Error("Chat Gateway Commlink forum egress is still pending; retry will use the same idempotency key");
  }
}

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
      const created=await this.discord.createForumThread(event.tenantId,rule.forumChannelId,event.channelName.slice(0,100),{content:"Forwarded messages from #"+event.channelName,allowed_mentions:{parse:[]},idempotencyKey:dshForumThreadCreationIdempotencyKey(event.tenantId,rule.forumChannelId,event.guildId,event.channelId)});
      this.store.setThread(event.tenantId,event.guildId,event.channelId,created.threadId,false,this.now());
      return created.threadId;
    }catch(error){
      if(error instanceof DshDiscordError&&error.status>=400&&error.status<500&&error.status!==408)this.store.setThread(event.tenantId,event.guildId,event.channelId,null,false,this.now());
      throw error;
    }
  }
}
export function buildDshForumDiscordPayload(event:DshForumForwardMutationV1):Record<string,unknown>{
  const attachments=(event.attachments??[]).flatMap(a=>{const url=forumHttps(a.url??a.proxyUrl);return url?[{...a,url}]:[];}).slice(0,10),sourceEmbeds=(event.embeds??[]).slice(0,5);
  const fields:Array<{name:string;value:string}>=[];
  if(attachments.length)fields.push({name:"Attachments",value:attachments.map(a=>"[Open "+String(a.filename||"attachment").slice(0,80)+"]("+String(a.url??a.proxyUrl)+")").join("\n").slice(0,1024)});
  for(const e of sourceEmbeds)if(e.title||e.description)fields.push({name:String(e.title||"Source embed").slice(0,256),value:String(e.description||e.url||"Embedded content").slice(0,1024)});
  const imageUrls=[...new Set([...attachments.filter(a=>String(a.contentType??"").startsWith("image/")).map(a=>a.url??a.proxyUrl),...sourceEmbeds.flatMap(e=>[forumHttps(e.imageUrl),forumHttps(e.thumbnailUrl)])].filter((url):url is string=>typeof url==="string"))];
  const embed:Record<string,unknown>={author:{name:event.authorName,...(event.authorAvatar?{icon_url:event.authorAvatar}:{})},description:(event.content||"").slice(0,4000)||"\u200b",color:0x5865f2,footer:{text:"Discord · #"+event.channelName},timestamp:event.occurredAt,...(forumHttps(event.sourceMessageUrl)?{url:forumHttps(event.sourceMessageUrl)}:{}),...(imageUrls[0]?{image:{url:imageUrls[0]}}:{}),...(fields.length?{fields:fields.slice(0,10)}:{})};
  const sourceMedia=sourceEmbeds.map(e=>({...(e.title?{title:String(e.title).slice(0,256)}:{}),...(e.description?{description:String(e.description).slice(0,3500)}:{}),...(forumHttps(e.url)?{url:forumHttps(e.url)}:{}),...(forumHttps(e.imageUrl)?{image:{url:forumHttps(e.imageUrl)}}:{}),...(forumHttps(e.thumbnailUrl)?{thumbnail:{url:forumHttps(e.thumbnailUrl)}}:{})})).filter(e=>Object.keys(e).length>0);
  const extraImages=imageUrls.slice(1,5).map(url=>({image:{url}}));
  return{embeds:[embed,...sourceMedia,...extraImages].slice(0,10),allowed_mentions:{parse:[]}};
}

export class DshForumForwardingWorker {
  private readonly service:DshForumForwardingService;
  constructor(private readonly store:DshForumForwardingStore,private readonly client:SpmtClient,private readonly discord:DshDiscordApi,private readonly allowedGuilds:(tenant:string)=>string[]){this.service=new DshForumForwardingService(store,new DshCommlinkForumDiscordPort(client,discord));}
  async runOnce(tenant:string){
    const canonicalRules=await this.client.listCommlinkForumForwardRules(tenant);this.store.replaceRules(tenant,canonicalRules.rules);
    let cursor=this.store.cursor(tenant),processed=0,forwarded=0;
    for(let page=0;page<10;page++){
      const events=await this.client.listEvents(tenant,{sourceAppId:"chat-gateway",afterId:cursor,limit:200});
      if(!events.length)break;
      for(const item of events){
        const eventId=String(item.id??item.eventId??"");if(!eventId)continue;
        if(item.type==="spmt.chat.message.received.v1"||item.type==="spmt.chat.message.mutated.v1"){
          const payload=(item.payload&&typeof item.payload==="object"?item.payload:{}) as Record<string,unknown>;
          if(payload.provider==="discord"&&typeof payload.channelId==="string"&&typeof payload.messageId==="string"){
            const records=await this.client.listCommlinkLiveChat(tenant,{provider:"discord",channelId:payload.channelId,limit:500});
            const record=records.find(row=>row.messageId===payload.messageId);
            if(record&&this.allowedGuilds(tenant).includes(record.guildId??String(payload.guildId??""))){
              const messageChannel=await this.discord.getChannel(tenant,record.channelId);
              let forumThreadHandled=false;
              if(Number(messageChannel.type)===11&&messageChannel.parent_id){
                const parentChannel=await this.discord.getChannel(tenant,String(messageChannel.parent_id));
                if([15,16].includes(Number(parentChannel.type))){
                  const operation=item.type==="spmt.chat.message.mutated.v1"?(payload.operation==="delete"?"delete":payload.operation==="edit"?"edit":"create"):"create";
                  if(await importDshDiscordForumThreadMessage(this.client,this.discord,tenant,record.guildId??String(payload.guildId??""),parentChannel,messageChannel,record,operation))forwarded++;
                  forumThreadHandled=true;
                }
              }
              if(Number(messageChannel.type)!==12&&!forumThreadHandled){
                let sourceChannel=messageChannel;
                if([10,11].includes(Number(messageChannel.type))&&messageChannel.parent_id)sourceChannel=await this.discord.getChannel(tenant,messageChannel.parent_id);
                if(![15,16].includes(Number(sourceChannel.type))){
                  const guild=await this.discord.getGuild(tenant,record.guildId??String(payload.guildId??""));
                  const attachments=(record.rich?.attachments??[]).map(item=>({url:item.url,filename:item.name,contentType:item.contentType}));
                  const embeds=(record.rich?.embeds??[]).map(item=>({title:item.title,description:item.description,url:item.url,imageUrl:item.imageUrl,thumbnailUrl:item.thumbnailUrl}));
                  const guildId=record.guildId??String(payload.guildId),forwardEvent={tenantId:tenant,guildId,channelId:sourceChannel.id,channelName:String(sourceChannel.name??sourceChannel.id),channelType:Number(sourceChannel.type??0),messageId:record.messageId,authorId:record.providerUserId,authorName:record.displayName??record.username,content:record.text,attachments,embeds,sourceMessageUrl:"https://discord.com/channels/"+guildId+"/"+record.channelId+"/"+record.messageId,occurredAt:record.occurredAt,sourceIsPublic:isPublicDshForumSource(guild,sourceChannel),authorIsBot:record.isBot,operation:item.type==="spmt.chat.message.mutated.v1"?(payload.operation==="delete"?"delete":"edit"):"create"} as DshForumForwardMutationV1;
                  const remoteState=await this.client.getCommlinkForumForwardState(tenant,guildId,sourceChannel.id,record.messageId);
                  if(remoteState.thread)this.store.setThread(tenant,guildId,sourceChannel.id,remoteState.thread.destinationThreadId,remoteState.thread.pending,remoteState.thread.updatedAt);
                  if(remoteState.receipt)this.store.setMessage({tenant,guild:guildId,channel:sourceChannel.id,message:record.messageId,thread:remoteState.receipt.destinationThreadId,forwarded:remoteState.receipt.destinationMessageId,deleted:remoteState.receipt.deleted,now:remoteState.receipt.updatedAt});
                  let result:any;
                  try{result=await this.service.apply(forwardEvent);}finally{
                    const thread=this.store.getThread(tenant,guildId,sourceChannel.id),receipt=this.store.getMessage(tenant,guildId,sourceChannel.id,record.messageId);
                    if(thread||receipt)await this.client.putCommlinkForumForwardState(tenant,{...(thread?{thread:{sourceGuildId:guildId,sourceChannelId:sourceChannel.id,destinationThreadId:thread.thread_id,pending:Boolean(thread.pending),updatedAt:new Date().toISOString()}}:{}),...(receipt?{receipt:{sourceGuildId:guildId,sourceChannelId:sourceChannel.id,sourceMessageId:record.messageId,destinationThreadId:receipt.thread_id,destinationMessageId:receipt.forwarded_message_id,deleted:Boolean(receipt.deleted),updatedAt:new Date().toISOString()}}:{})});
                  }
                  if(result?.status==="forwarded")forwarded++;
                }
              }
            }
          }
        }
        this.store.advanceCursor(tenant,eventId);cursor=eventId;processed++;
      }
      if(events.length<200)break;
    }
    return{processed,forwarded,cursor};
  }
}
export function isPublicDshForumSource(guild:any,channel:any){
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
