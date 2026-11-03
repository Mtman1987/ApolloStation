import { DatabaseSync } from "node:sqlite";
import type { OutboundChatMessageV1 } from "@spmt/contracts";
import type { StreamWeaverCommunityStore } from "./community-store.js";
import type { StreamWeaverTwitchCommandAdapter, StreamWeaverTwitchStreamV1 } from "./twitch-command-adapter.js";

export interface StreamWeaverStellaLoungeHostStateV1 {
  tenantId:string;
  nextAt:number;
  leaseUntil:number;
  slotId:number;
  lastSpokeAt:number;
  lastTopic?:string;
  recentTopics:string[];
  lastMessage?:string;
  updatedAt:string;
}
export interface StreamWeaverStellaLoungeHostReportV1 { attempted:number;sent:number;skipped:number;failed:number; }

/** A bounded, non-generative Stella host loop. It uses live Twitch/Community state and Chat Gateway egress; no paid AI or direct provider socket. */
export class SqliteStreamWeaverStellaLoungeHostStore {
  private readonly db:DatabaseSync;
  constructor(path:string){if(!path)throw new Error("Stella Lounge Host database path is required");this.db=new DatabaseSync(path);this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sw_stella_lounge_host(tenant TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;");}
  close(){this.db.close();}
  view(tenantId:string):StreamWeaverStellaLoungeHostStateV1{
    const tenant=cleanTenant(tenantId),row=this.db.prepare("SELECT body FROM sw_stella_lounge_host WHERE tenant=?").get(tenant) as {body:string}|undefined;
    if(!row)return{tenantId:tenant,nextAt:0,leaseUntil:0,slotId:0,lastSpokeAt:0,recentTopics:[],updatedAt:new Date(0).toISOString()};
    const value=JSON.parse(row.body) as Partial<StreamWeaverStellaLoungeHostStateV1>;
    return{tenantId:tenant,nextAt:Math.max(0,Number(value.nextAt)||0),leaseUntil:Math.max(0,Number(value.leaseUntil)||0),slotId:Math.max(0,Number(value.slotId)||0),lastSpokeAt:Math.max(0,Number(value.lastSpokeAt)||0),...(value.lastTopic?{lastTopic:String(value.lastTopic).slice(0,40)}:{}),recentTopics:Array.isArray(value.recentTopics)?value.recentTopics.map(String).slice(-4):[],...(value.lastMessage?{lastMessage:String(value.lastMessage).slice(0,240)}:{}),updatedAt:String(value.updatedAt||new Date(0).toISOString())};
  }
  claim(tenantId:string,nowMs:number,initialDelayMs:number):StreamWeaverStellaLoungeHostStateV1|undefined{
    this.db.exec("BEGIN IMMEDIATE");try{const current=this.view(tenantId);if(current.nextAt===0){this.save({...current,nextAt:nowMs+Math.max(0,initialDelayMs),updatedAt:new Date(nowMs).toISOString()});this.db.exec("COMMIT");return undefined;}if(current.nextAt>nowMs||current.leaseUntil>nowMs){this.db.exec("COMMIT");return undefined;}const claimed={...current,slotId:current.slotId||current.nextAt,leaseUntil:nowMs+120_000,updatedAt:new Date(nowMs).toISOString()};this.save(claimed);this.db.exec("COMMIT");return claimed;}catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  complete(tenantId:string,nowMs:number,topic:string,message:string,nextAt:number){const current=this.view(tenantId);this.save({...current,leaseUntil:0,slotId:0,lastSpokeAt:nowMs,lastTopic:topic,recentTopics:[...current.recentTopics,topic].slice(-4),lastMessage:message.slice(0,240),nextAt,updatedAt:new Date(nowMs).toISOString()});}
  defer(tenantId:string,nowMs:number,retryMs:number){const current=this.view(tenantId);this.save({...current,leaseUntil:0,nextAt:nowMs+Math.max(1,retryMs),updatedAt:new Date(nowMs).toISOString()});}
  setNextAt(tenantId:string,nextAt:number){const current=this.view(tenantId);this.save({...current,nextAt:Math.max(0,nextAt),leaseUntil:0,slotId:0});}
  private save(value:StreamWeaverStellaLoungeHostStateV1){this.db.prepare("INSERT INTO sw_stella_lounge_host(tenant,body) VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET body=excluded.body").run(value.tenantId,JSON.stringify(value));}
}

export class StreamWeaverStellaLoungeHost {
  private readonly minDelayMs=6*60_000;
  private readonly maxDelayMs=12*60_000;
  constructor(private readonly options:{store:SqliteStreamWeaverStellaLoungeHostStore;community:StreamWeaverCommunityStore;twitch:Pick<StreamWeaverTwitchCommandAdapter,"uptime">;connections:Array<{tenantId:string;provider:string;connectionId:string;channelId:string;desired:boolean}>;egress:{send(message:OutboundChatMessageV1):Promise<unknown>};tenants?:string[];nowMs?:()=>number;random?:()=>number}){}
  close(){this.options.store.close();}
  async runOnce(nowMs=this.options.nowMs?.()??Date.now()):Promise<StreamWeaverStellaLoungeHostReportV1>{
    const report:StreamWeaverStellaLoungeHostReportV1={attempted:0,sent:0,skipped:0,failed:0},allowed=new Set(this.options.tenants??["spacemountainlive"]),connections=new Map<string,{tenantId:string;connectionId:string;channelId:string}>();
    for(const connection of this.options.connections)if(connection.desired&&connection.provider==="twitch"&&allowed.has(connection.tenantId)&&!connections.has(connection.tenantId))connections.set(connection.tenantId,connection);
    for(const connection of connections.values()){
      let claimed:StreamWeaverStellaLoungeHostStateV1|undefined;try{claimed=this.options.store.claim(connection.tenantId,nowMs,this.delay());}catch{report.failed++;continue;}if(!claimed)continue;
      report.attempted++;
      try{
        const stream=await this.options.twitch.uptime(connection.tenantId);
        if(!stream){this.options.store.defer(connection.tenantId,nowMs,120_000);report.skipped++;continue;}
        if(this.options.community.program(connection.tenantId)){this.options.store.defer(connection.tenantId,nowMs,180_000);report.skipped++;continue;}
        const planned=buildStellaAmbientMessage(stream,this.options.community,connection.tenantId,claimed.recentTopics);
        if(!planned){this.options.store.defer(connection.tenantId,nowMs,180_000);report.skipped++;continue;}
        await this.options.egress.send({schemaVersion:1,tenantId:connection.tenantId,provider:"twitch",connectionId:connection.connectionId,channelId:connection.channelId,text:planned.text,idempotencyKey:"stella-lounge-host:"+connection.tenantId+":"+(claimed.slotId||claimed.nextAt)});
        this.options.store.complete(connection.tenantId,nowMs,planned.topic,planned.text,nowMs+this.delay());report.sent++;
      }catch{this.options.store.defer(connection.tenantId,nowMs,60_000);report.failed++;}
    }
    return report;
  }
  private delay(){const random=Math.min(0.999999,Math.max(0,this.options.random?.()??Math.random()));return this.minDelayMs+Math.floor(random*(this.maxDelayMs-this.minDelayMs+1));}
}

function buildStellaAmbientMessage(stream:StreamWeaverTwitchStreamV1,community:StreamWeaverCommunityStore,tenantId:string,recent:string[]){
  const stats=community.checkinStats(tenantId),checkins=stats.users.reduce((sum,row)=>sum+Math.max(0,Number(row.count)||0),0),leaders=community.watchLeaders(tenantId),rides=community.rides.settings(tenantId),game=cleanPublic(stream.gameName,60),title=cleanPublic(stream.title,90),viewers=Math.max(0,Math.floor(Number(stream.viewerCount)||0));
  const candidates:Array<{topic:string;text:string}>=[];
  if(rides.enabled)candidates.push({topic:"ride",text:"Stella on the bridge: Space Mountain is ready for another run. Use !checkin --ride to claim a seat and join the crew."});
  if(checkins>0)candidates.push({topic:"community",text:"Stella's crew board has "+checkins.toLocaleString("en-US")+" check-ins on record. Thanks for keeping the lounge moving, crew."});
  if(leaders.length){const leader=leaders[0] as {username?:string;minutes?:number};candidates.push({topic:"watch",text:"Watch-time check from Stella: "+cleanPublic(leader.username,35)+" is leading with "+Math.max(0,Number(leader.minutes)||0).toLocaleString("en-US")+" minutes. Keep those minutes rolling."});}
  if(game)candidates.push({topic:"game",text:"Stella's watching "+game+" with "+viewers.toLocaleString("en-US")+" viewers aboard. "+(title?"Current stream: "+title+". ":"")+"Drop a hello if you're just joining us."});
  candidates.push({topic:"welcome",text:"Stella here, keeping the lounge lights on. "+viewers.toLocaleString("en-US")+" aboard—say hello and make yourselves at home."});
  const selected=candidates.find(candidate=>!recent.includes(candidate.topic))??candidates[0];
  return selected?{topic:selected.topic,text:selected.text.slice(0,240)}:undefined;
}
function cleanTenant(value:string){const tenant=String(value??"").trim();if(!/^[A-Za-z0-9._:@/-]{1,180}$/.test(tenant))throw new Error("Stella Lounge Host tenant is invalid");return tenant;}
function cleanPublic(value:unknown,limit:number){return String(value??"").replace(/[\r\n]/g," ").replace(/\s+/g," ").trim().slice(0,limit)||"the stream";}
