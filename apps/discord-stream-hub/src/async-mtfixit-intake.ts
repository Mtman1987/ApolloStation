import { createHash } from "node:crypto";
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore } from "@spmt/async-json-store";
import type { SpmtClient } from "@spmt/sdk";
import { mtFixItCoderPrompt, mtFixItIncidentFromOperationsLog } from "@spmt/platform-ops";
import type { DshDiscordTransportV1 } from "./discord-live-publisher.js";
import type { DshMessageObservation } from "./member-activity.js";

interface MtFixItReportRecord {
 tenant:string;eventId:string;jobId:string;channelId:string;messageId:string;reporter:string;description:string;
 ownerNotified:boolean;replySent:boolean;createdAt:string;
}
const RECORDS="mtfixit-reports";

/** Async Turso counterpart for the DSH MtFixIt intake receipt and notification state. */
export class AsyncDshMtFixItIntake {
 private readonly records:AsyncJsonRecordStore;
 constructor(
  private readonly client:SpmtClient,private readonly discord:DshDiscordTransportV1,
  options:{databasePath?:string;mode?:"sqlite"|"turso";url?:string;authToken?:string;ownerDiscordUserId?:string;now?:()=>string}={},
 ){
  this.ownerDiscordUserId=String(options.ownerDiscordUserId??process.env.DSH_MTFIXIT_OWNER_DISCORD_ID??"").trim();
  this.now=options.now??(()=>new Date().toISOString());
  this.records=createAsyncJsonRecordStore({service:"discord-stream-hub",...(options.databasePath?{databasePath:options.databasePath}:{}),...(options.mode?{mode:options.mode}:{}),...(options.url?{url:options.url}:{}),...(options.authToken?{authToken:options.authToken}:{})});
 }
 private readonly ownerDiscordUserId:string;private readonly now:()=>string;
 initialize(){return this.records.initialize();}
 health(){return this.records.health();}
 close(){return this.records.close();}
 async handle(tenantId:string,eventId:string,message:DshMessageObservation):Promise<{handled:boolean;jobId?:string}>{
  const raw=String(message.text??"").trim(),match=raw.match(/^!mtfixit(?:\s+([\s\S]+))?$/i);
  if(!match)return{handled:false};
  const description=redactReport(String(match[1]??"").trim());
  if(description.length<8){await this.reply(tenantId,message,"Usage: !mtfixit describe the problem in a few words.");return{handled:true};}
  if(description.length>2000)throw new Error("MtFixIt reports must be 2,000 characters or fewer.");
  await this.initialize();
  const key=createHash("sha256").update(JSON.stringify([tenantId,eventId,message.messageId])).digest("hex");
  let saved=await this.records.get<MtFixItReportRecord>(RECORDS,tenantId,eventId);
  if(!saved){
   const published=await this.client.publishOperationsLog(tenantId,{level:"error",kind:"mtfixit.report",summary:description.slice(0,300),detail:description,labels:["source:discord","workflow:mtfixit","intake:donor-compatibility"],occurredAt:message.occurredAt},`dsh-mtfixit-log:${key}`,eventId);
   const incident=mtFixItIncidentFromOperationsLog(published.log);
   const prompt=mtFixItCoderPrompt({incident,attempt:1,evidence:[`Reporter: ${message.actor.username} (${message.actor.providerUserId})`,`Discord guild: ${message.guildId??"unknown"}`,`Discord channel: ${message.channelId}`,`Discord message: ${message.messageId}`,`Reported problem: ${description}`]});
   const created=await this.client.createCoderJob(tenantId,"discord-stream-hub",prompt,[published.log.id],`dsh-mtfixit-job:${key}`);
   const candidate:MtFixItReportRecord={tenant:tenantId,eventId,jobId:created.job.id,channelId:message.channelId,messageId:message.messageId,reporter:message.actor.username,description,ownerNotified:false,replySent:false,createdAt:this.now()};
   saved=await this.records.transaction(async tx=>{const existing=await tx.get<MtFixItReportRecord>(RECORDS,tenantId,eventId);if(existing)return existing;await tx.put(RECORDS,tenantId,eventId,candidate);return candidate;});
  }
  if(this.ownerDiscordUserId&&!saved.ownerNotified){
   await this.discord.sendDirectMessage(tenantId,this.ownerDiscordUserId,{content:`**MtFixIt report received**\nReporter: ${saved.reporter}\nReport: ${saved.description}\nCoder job: ${saved.jobId}\n\nReview the job in Mission Control. This intake does not approve or deploy changes.`,allowed_mentions:{parse:[]}});
   saved=await this.update(tenantId,eventId,row=>({...row,ownerNotified:true}));
  }
  if(!saved.replySent){
   const note=this.ownerDiscordUserId?"The owner has been notified for review.":"Owner DM is not configured yet; the job is saved for Mission Control review.";
   await this.reply(tenantId,message,"@"+message.actor.username+", your report is recorded as "+saved.jobId+". "+note);
   saved=await this.update(tenantId,eventId,row=>({...row,replySent:true}));
  }
  return{handled:true,jobId:saved.jobId};
 }
 private async update(tenant:string,eventId:string,change:(row:MtFixItReportRecord)=>MtFixItReportRecord){
  return this.records.transaction(async tx=>{const row=await tx.get<MtFixItReportRecord>(RECORDS,tenant,eventId);if(!row)throw new Error("MtFixIt report receipt disappeared");const next=change(row);await tx.put(RECORDS,tenant,eventId,next);return next;});
 }
 private async reply(tenantId:string,message:DshMessageObservation,content:string){
  await this.discord.createMessage(tenantId,message.channelId,{content,message_reference:{message_id:message.messageId},allowed_mentions:{parse:[]}});
 }
}
function redactReport(value:string){return value.replace(/\bBearer\s+[^\s,;]+/gi,"Bearer [REDACTED]").replace(/\b(?:sk-|github_pat_)[A-Za-z0-9_-]{12,}\b/g,"[REDACTED]").replace(/(["']?(?:access_token|refresh_token|client_secret|password|authorization|api[_-]?key|token|secret)["']?\s*[:=]\s*["']?)[^\s,"']+/gi,"$1[REDACTED]").replace(/[\r\n\0]/g," ").trim();}
