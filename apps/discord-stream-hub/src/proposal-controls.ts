import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isSimulationDiscordId } from "@spmt/contracts";
import { fetchAppSessionContext, readJsonBody, requireSameOrigin, safeError, sendJson } from "@spmt/app-foundation/product-web";
import { SpmtClient } from "@spmt/sdk";
import { DshDiscordApi, type DshDiscordGrantSourceV1, type DshDiscordTransportV1 } from "./discord-live-publisher.js";
import { createDshWorkerTokenProvider, loadDshLiveRuntimeConfig, type DshLiveRuntimeConfigV1 } from "./live-worker.js";
import { DshSimulationRoomDiscordTransport } from "./simulation-room.js";

export type DshProposalAudienceV1 = "community" | "admin" | "targeted";
export interface DshProposalV1 {
  schemaVersion:1;
  id:string;
  tenantId:string;
  channelId:string;
  title:string;
  description:string;
  audience:DshProposalAudienceV1;
  approveLabel:string;
  denyLabel:string;
  approveEmoji:string;
  denyEmoji:string;
  color:number;
  referenceUrl?:string;
  createdBy:string;
  createdAt:string;
  updatedAt:string;
  delivery:{status:"pending"|"delivered"|"failed";attempts:number;messageId?:string;error?:string};
}

export interface DshProposalControlOptionsV1 {
  spmtOrigin:string;
  databasePath:string;
  runtimeConfigPath:string;
  credential?:string;
  operationMode?:"active"|"read-only";
  fetchImpl?:typeof fetch;
  now?:()=>string;
}

type SessionContext=Awaited<ReturnType<typeof fetchAppSessionContext>>;

export class DshProposalControls {
  private readonly db:DatabaseSync;
  private readonly config:DshLiveRuntimeConfigV1;
  private readonly discord?:DshDiscordTransportV1;
  private readonly client?:SpmtClient;
  private readonly now:()=>string;
  private readonly fetchImpl:typeof fetch;
  private readonly liveWrites:boolean;

  constructor(private readonly options:DshProposalControlOptionsV1){
    this.db=new DatabaseSync(options.databasePath,{timeout:5_000});
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dsh_proposals(tenant_id TEXT NOT NULL,proposal_id TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,proposal_id)) STRICT; CREATE INDEX IF NOT EXISTS dsh_proposals_updated ON dsh_proposals(tenant_id,updated_at);`);
    this.config=loadDshLiveRuntimeConfig(options.runtimeConfigPath);
    this.now=options.now??(()=>new Date().toISOString());
    this.fetchImpl=options.fetchImpl??fetch;
    this.liveWrites=options.operationMode!=="read-only";
    if(options.credential){
      const getAccessToken=createDshWorkerTokenProvider({spmtOrigin:options.spmtOrigin,credential:options.credential,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})});
      const client=new SpmtClient({baseUrl:options.spmtOrigin,appId:"discord-stream-hub",getAccessToken,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})});
      this.client=client;
      const grants:DshDiscordGrantSourceV1={getGrant:async({tenantId,capability})=>{const providerUserId=this.tenant(tenantId).discordProviderUserId;if(!providerUserId)throw new Error("Connect the tenant's Discord bot before posting proposals");const grant=await client.issueProviderGrant(tenantId,"discord",providerUserId,"dsh-proposal-control",[capability],300),scheme=grant.credential.metadata.authorizationScheme??"Bot";if(scheme!=="Bot"&&scheme!=="Bearer")throw new Error("Discord grant authorization scheme is invalid");return{authorization:`${scheme} ${grant.credential.accessToken}`,expiresAt:grant.expiresAt};}};
      const api=new DshDiscordApi(grants,this.fetchImpl);
      this.discord=new DshSimulationRoomDiscordTransport(api,client,{guildIds:tenantId=>this.tenant(tenantId).discordGuildIds??[],now:this.now,liveWrites:this.liveWrites});
    }
  }

  close(){this.db.close();}

  async handle(request:IncomingMessage,response:ServerResponse,url:URL):Promise<boolean>{
    if(!url.pathname.startsWith("/api/discord-stream-hub/control/proposals/"))return false;
    try{
      const context=await fetchAppSessionContext({appId:"discord-stream-hub",spmtOrigin:this.options.spmtOrigin,request});
      this.requireCrewOrOwner(context);
      const action=url.pathname.slice("/api/discord-stream-hub/control/proposals/".length);
      if(request.method==="GET"&&action==="state")return await this.state(response,context);
      if(request.method!=="POST")return sendJson(response,405,{error:"method_not_allowed"});
      requireSameOrigin(request);const body=await readJsonBody(request);
      if(action==="post")return await this.post(response,context,body);
      if(action==="retry")return await this.retry(response,context,body);
      return sendJson(response,404,{error:"not_found"});
    }catch(error){const message=safeError(error),status=/sign in|session/i.test(message)?401:/crew or owner/i.test(message)?403:/not found|required|invalid|too long|HTTPS/i.test(message)?400:/Discord|grant|delivery/i.test(message)?502:400;return sendJson(response,status,{error:"dsh_proposal_control_failed",message});}
  }

  private async state(response:ServerResponse,context:SessionContext){
    const proposals=this.list(context.tenantId,100),channels:Array<{id:string;name:string;guildName:string}> = [];
    if(this.discord){
      for(const guild of await this.discord.listGuilds(context.tenantId)){
        if(!guild.id)continue;
        for(const channel of await this.discord.listGuildChannels(context.tenantId,guild.id))if(channel.id&&channel.type===0)channels.push({id:channel.id,name:channel.name??channel.id,guildName:guild.name??guild.id});
      }
    }
    return sendJson(response,200,{schemaVersion:1,channels,proposals});
  }

  private async post(response:ServerResponse,context:SessionContext,body:Record<string,unknown>){
    const now=this.now(),proposal:DshProposalV1={schemaVersion:1,id:randomUUID(),tenantId:cleanId(context.tenantId,"tenantId"),channelId:snowflake(body.channelId,"channelId"),title:cleanText(body.title,"title",256),description:cleanText(body.description,"description",4096),audience:audience(body.audience),approveLabel:cleanText(body.approveLabel||"Approve","approveLabel",80),denyLabel:cleanText(body.denyLabel||"Deny","denyLabel",80),approveEmoji:cleanEmoji(body.approveEmoji||"✅","approveEmoji"),denyEmoji:cleanEmoji(body.denyEmoji||"❌","denyEmoji"),color:parseColor(body.color),...(optionalUrl(body.referenceUrl)?{referenceUrl:optionalUrl(body.referenceUrl)}:{}),createdBy:cleanId(String(context.session.actorId),"createdBy"),createdAt:now,updatedAt:now,delivery:{status:"pending",attempts:0}};
    this.write(proposal);const delivered=await this.deliver(proposal);return sendJson(response,delivered.delivery.status==="delivered"?200:502,{schemaVersion:1,proposal:delivered});
  }

  private async retry(response:ServerResponse,context:SessionContext,body:Record<string,unknown>){const proposal=this.get(context.tenantId,cleanId(body.proposalId,"proposalId"));if(!proposal)throw new Error("Proposal not found");if(proposal.delivery.status==="delivered")return sendJson(response,200,{schemaVersion:1,proposal});const delivered=await this.deliver(proposal);return sendJson(response,delivered.delivery.status==="delivered"?200:502,{schemaVersion:1,proposal:delivered});}

  private async deliver(proposal:DshProposalV1){
    if(!this.discord){const failed=this.delivery(proposal,{status:"failed",error:"Discord delivery is not connected"});this.write(failed);return failed;}
    try{
      const messageId=await this.discord.createMessage(proposal.tenantId,proposal.channelId,buildDshProposalMessage(proposal));
      if(this.liveWrites&&!isSimulationDiscordId(proposal.channelId)){await this.addReaction(proposal.tenantId,proposal.channelId,messageId,proposal.approveEmoji);await this.addReaction(proposal.tenantId,proposal.channelId,messageId,proposal.denyEmoji);}
      const delivered=this.delivery(proposal,{status:"delivered",messageId});this.write(delivered);return delivered;
    }catch(error){const failed=this.delivery(proposal,{status:"failed",error:safeError(error)});this.write(failed);return failed;}
  }

  private async addReaction(tenantId:string,channelId:string,messageId:string,emoji:string){
    if(!this.client)throw new Error("Discord proposal reaction delivery is unavailable");const providerUserId=this.tenant(tenantId).discordProviderUserId;if(!providerUserId)throw new Error("Discord provider is not connected");const grant=await this.client.issueProviderGrant(tenantId,"discord",providerUserId,"dsh-proposal-reaction",["messages:write"],300),scheme=grant.credential.metadata.authorizationScheme??"Bot";if(scheme!=="Bot"&&scheme!=="Bearer")throw new Error("Discord grant authorization scheme is invalid");const response=await this.fetchImpl(`https://discord.com/api/v10/channels/${snowflake(channelId,"channelId")}/messages/${snowflake(messageId,"messageId")}/reactions/${encodeURIComponent(emoji)}/@me`,{method:"PUT",headers:{authorization:`${scheme} ${grant.credential.accessToken}`},signal:AbortSignal.timeout(15_000)});if(!response.ok)throw new Error(`Discord proposal reaction failed with status ${response.status}`);
  }

  private list(tenantIdValue:string,limit:number){const tenantId=cleanId(tenantIdValue,"tenantId"),rows=this.db.prepare("SELECT body FROM dsh_proposals WHERE tenant_id=? ORDER BY updated_at DESC LIMIT ?").all(tenantId,Math.max(1,Math.min(500,Math.trunc(limit)))) as unknown as Array<{body:string}>;return rows.map(row=>JSON.parse(row.body) as DshProposalV1);}
  private get(tenantIdValue:string,proposalIdValue:string){const row=this.db.prepare("SELECT body FROM dsh_proposals WHERE tenant_id=? AND proposal_id=?").get(cleanId(tenantIdValue,"tenantId"),cleanId(proposalIdValue,"proposalId")) as {body:string}|undefined;return row?JSON.parse(row.body) as DshProposalV1:undefined;}
  private write(value:DshProposalV1){this.db.prepare("INSERT INTO dsh_proposals(tenant_id,proposal_id,body,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,proposal_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at").run(value.tenantId,value.id,JSON.stringify(value),value.updatedAt);}
  private delivery(value:DshProposalV1,result:{status:"delivered"|"failed";messageId?:string;error?:string}){const updatedAt=this.now();return{...value,updatedAt,delivery:{status:result.status,attempts:value.delivery.attempts+1,...(result.messageId?{messageId:result.messageId}:{}),...(result.error?{error:result.error.slice(0,1000)}:{})}} as DshProposalV1;}
  private tenant(tenantId:string){const tenant=this.config.tenants.find(item=>item.tenantId===tenantId);if(!tenant)throw new Error("DSH is not configured for this tenant");return tenant;}
  private requireCrewOrOwner(context:SessionContext){const roles=record(context.session.tenantRoles),owner=roles?.[context.tenantId]==="owner",actor=String(context.session.actorId??""),crew=this.tenant(context.tenantId).members.some(member=>member.canonicalUserId===actor&&member.group==="Crew");if(!owner&&!crew)throw new Error("Crew or owner access is required to post proposals");}
}

export function buildDshProposalMessage(proposal:Pick<DshProposalV1,"title"|"description"|"audience"|"approveLabel"|"denyLabel"|"approveEmoji"|"denyEmoji"|"color"|"referenceUrl">){const fields:Array<Record<string,unknown>>=[{name:"Voting",value:`${proposal.approveEmoji} ${proposal.approveLabel}\n${proposal.denyEmoji} ${proposal.denyLabel}`,inline:false},{name:"Audience",value:proposal.audience==="admin"?"Admin-only review":proposal.audience==="targeted"?"Targeted community review":"Full community review",inline:true}];if(proposal.referenceUrl)fields.push({name:"Reference",value:`[Open related notes or attachment](${proposal.referenceUrl})`,inline:false});return{embeds:[{title:proposal.title,description:proposal.description,color:proposal.color,fields,footer:{text:"React below to vote. Final decision remains owner/admin controlled."},timestamp:new Date().toISOString()}],allowed_mentions:{parse:[]}};}
function record(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function cleanId(value:unknown,name:string){const clean=String(value??"").trim();if(!clean||clean.length>300||/[\r\n\0]/.test(clean))throw new Error(`${name} is invalid`);return clean;}
function snowflake(value:unknown,name:string){const clean=String(value??"").trim();if(!/^\d{5,30}$/.test(clean))throw new Error(`${name} must be a Discord id`);return clean;}
function cleanText(value:unknown,name:string,max:number){const clean=String(value??"").replace(/\0/g,"").trim();if(!clean)throw new Error(`${name} is required`);if(clean.length>max)throw new Error(`${name} is too long`);return clean;}
function cleanEmoji(value:unknown,name:string){const clean=cleanText(value,name,100);if(/[\r\n]/.test(clean))throw new Error(`${name} is invalid`);return clean;}
function audience(value:unknown):DshProposalAudienceV1{const clean=String(value??"community");if(clean==="community"||clean==="admin"||clean==="targeted")return clean;throw new Error("Proposal audience is invalid");}
function parseColor(value:unknown){const raw=String(value??"5865F2").trim().replace(/^#/,"");if(!/^[0-9a-fA-F]{6}$/.test(raw))return 0x5865F2;return Number.parseInt(raw,16);}
function optionalUrl(value:unknown){const clean=String(value??"").trim();if(!clean)return undefined;const url=new URL(clean);if(url.protocol!=="https:"||url.username||url.password)throw new Error("Proposal reference must be a credential-free HTTPS URL");if(clean.length>500)throw new Error("Proposal reference URL is too long");return url.toString();}
