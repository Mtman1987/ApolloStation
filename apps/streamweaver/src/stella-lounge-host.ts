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
  speakerSpeakingUntil:number;
  lastStreamerSpeech?:string;
  updatedAt:string;
}
export interface StreamWeaverStellaLoungeHostReportV1 { attempted:number;sent:number;skipped:number;failed:number; }
export type StreamWeaverStellaLoungeEventV1={tenantId:string;eventId:string;kind:"raid"|"follow"|"subscribe"|"cheer"|"game-winner"|"game-play"|"game-round"|"milestone";actor?:string;viewers?:number;amount?:number;game?:string;detail?:string};

/** A bounded, non-generative Stella host loop. It uses live Twitch/Community state and Chat Gateway egress; no paid AI or direct provider socket. */
export class SqliteStreamWeaverStellaLoungeHostStore {
  private readonly db:DatabaseSync;
  constructor(path:string){if(!path)throw new Error("Stella Lounge Host database path is required");this.db=new DatabaseSync(path);this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sw_stella_lounge_host(tenant TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS sw_stella_lounge_host_events(tenant TEXT NOT NULL,event_id TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(tenant,event_id)) STRICT;");}
  close(){this.db.close();}
  view(tenantId:string):StreamWeaverStellaLoungeHostStateV1{
    const tenant=cleanTenant(tenantId),row=this.db.prepare("SELECT body FROM sw_stella_lounge_host WHERE tenant=?").get(tenant) as {body:string}|undefined;
    if(!row)return{tenantId:tenant,nextAt:0,leaseUntil:0,slotId:0,lastSpokeAt:0,recentTopics:[],speakerSpeakingUntil:0,updatedAt:new Date(0).toISOString()};
    const value=JSON.parse(row.body) as Partial<StreamWeaverStellaLoungeHostStateV1>;
    return{tenantId:tenant,nextAt:Math.max(0,Number(value.nextAt)||0),leaseUntil:Math.max(0,Number(value.leaseUntil)||0),slotId:Math.max(0,Number(value.slotId)||0),lastSpokeAt:Math.max(0,Number(value.lastSpokeAt)||0),...(value.lastTopic?{lastTopic:String(value.lastTopic).slice(0,40)}:{}),recentTopics:Array.isArray(value.recentTopics)?value.recentTopics.map(String).slice(-4):[],...(value.lastMessage?{lastMessage:String(value.lastMessage).slice(0,240)}:{}),speakerSpeakingUntil:Math.max(0,Number(value.speakerSpeakingUntil)||0),...(value.lastStreamerSpeech?{lastStreamerSpeech:String(value.lastStreamerSpeech).slice(0,500)}:{}),updatedAt:String(value.updatedAt||new Date(0).toISOString())};
  }
  claim(tenantId:string,nowMs:number,initialDelayMs:number):StreamWeaverStellaLoungeHostStateV1|undefined{
    this.db.exec("BEGIN IMMEDIATE");try{const current=this.view(tenantId);if(current.nextAt===0){this.save({...current,nextAt:nowMs+Math.max(0,initialDelayMs),updatedAt:new Date(nowMs).toISOString()});this.db.exec("COMMIT");return undefined;}if(current.nextAt>nowMs||current.leaseUntil>nowMs){this.db.exec("COMMIT");return undefined;}const claimed={...current,slotId:current.slotId||current.nextAt,leaseUntil:nowMs+120_000,updatedAt:new Date(nowMs).toISOString()};this.save(claimed);this.db.exec("COMMIT");return claimed;}catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  complete(tenantId:string,nowMs:number,topic:string,message:string,nextAt:number){const current=this.view(tenantId);this.save({...current,leaseUntil:0,slotId:0,lastSpokeAt:nowMs,lastTopic:topic,recentTopics:[...current.recentTopics,topic].slice(-4),lastMessage:message.slice(0,240),nextAt,updatedAt:new Date(nowMs).toISOString()});}
  defer(tenantId:string,nowMs:number,retryMs:number){const current=this.view(tenantId);this.save({...current,leaseUntil:0,nextAt:nowMs+Math.max(1,retryMs),updatedAt:new Date(nowMs).toISOString()});}
  setNextAt(tenantId:string,nextAt:number){const current=this.view(tenantId);this.save({...current,nextAt:Math.max(0,nextAt),leaseUntil:0,slotId:0});}
  noteStreamerSpeech(tenantId:string,text:string,nowMs:number){const current=this.view(tenantId),speech=String(text??"").replace(/[\r\n]/g," ").replace(/\s+/g," ").trim().slice(0,500);if(!speech)return;this.save({...current,speakerSpeakingUntil:nowMs+8_000,lastStreamerSpeech:speech,updatedAt:new Date(nowMs).toISOString()});}
  claimEvent(tenantId:string,eventId:string,nowMs:number){const tenant=cleanTenant(tenantId),id=String(eventId??"").trim().slice(0,180);if(!id)return false;this.db.exec("BEGIN IMMEDIATE");try{this.db.prepare("DELETE FROM sw_stella_lounge_host_events WHERE expires_at<=?").run(nowMs);const result=this.db.prepare("INSERT OR IGNORE INTO sw_stella_lounge_host_events(tenant,event_id,expires_at) VALUES(?,?,?)").run(tenant,id,nowMs+60_000);this.db.exec("COMMIT");return Number(result.changes)===1;}catch(error){this.db.exec("ROLLBACK");throw error;}}
  completeEvent(tenantId:string,eventId:string,nowMs:number){this.db.prepare("UPDATE sw_stella_lounge_host_events SET expires_at=? WHERE tenant=? AND event_id=?").run(nowMs+10*60_000,cleanTenant(tenantId),String(eventId).slice(0,180));}
  releaseEvent(tenantId:string,eventId:string){this.db.prepare("DELETE FROM sw_stella_lounge_host_events WHERE tenant=? AND event_id=?").run(cleanTenant(tenantId),String(eventId).slice(0,180));}
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
        if(claimed.speakerSpeakingUntil>nowMs){this.options.store.defer(connection.tenantId,nowMs,Math.min(15_000,claimed.speakerSpeakingUntil-nowMs));report.skipped++;continue;}
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
  async reactToEvent(event:StreamWeaverStellaLoungeEventV1,nowMs=this.options.nowMs?.()??Date.now()):Promise<{delivered:boolean;reason:string;text?:string}>{
    const tenantId=cleanTenant(event.tenantId),allowed=new Set(this.options.tenants??["spacemountainlive"]);
    if(!allowed.has(tenantId))return{delivered:false,reason:"tenant-not-allowed"};
    const connection=this.options.connections.find(item=>item.tenantId===tenantId&&item.provider==="twitch"&&item.desired);
    if(!connection)return{delivered:false,reason:"no-twitch-egress"};
    const eventId=String(event.eventId??"").trim().slice(0,180),actor=cleanEventValue(event.actor,45),kind=event.kind;
    if(!eventId)return{delivered:false,reason:"event-id-required"};
    const priority=kind==="raid"||kind==="game-winner"||kind==="milestone"?90:kind==="subscribe"||kind==="cheer"?72:kind==="follow"?60:64;
    const state=this.options.store.view(tenantId);
    if(state.speakerSpeakingUntil>nowMs&&priority<90)return{delivered:false,reason:"streamer-speaking"};
    if(priority<90&&nowMs-state.lastSpokeAt<12_000)return{delivered:false,reason:"speech-cooldown"};
    let stream:StreamWeaverTwitchStreamV1|undefined;
    try{stream=await this.options.twitch.uptime(tenantId);}catch{return{delivered:false,reason:"stream-status-unavailable"};}
    if(!stream)return{delivered:false,reason:"stream-offline"};
    if(!this.options.store.claimEvent(tenantId,eventId,nowMs))return{delivered:false,reason:"duplicate-event"};
    const text=buildStellaEventMessage({...event,actor});
    try{
      await this.options.egress.send({schemaVersion:1,tenantId,provider:"twitch",connectionId:connection.connectionId,channelId:connection.channelId,text,idempotencyKey:"stella-lounge-event:"+tenantId+":"+eventId});
      this.options.store.completeEvent(tenantId,eventId,nowMs);
      this.options.store.complete(tenantId,nowMs,kind,text,nowMs+this.delay());
      return{delivered:true,reason:"delivered",text};
    }catch{
      this.options.store.releaseEvent(tenantId,eventId);
      return{delivered:false,reason:"egress-failed"};
    }
  }
  noteStreamerSpeech(text:string,nowMs=this.options.nowMs?.()??Date.now(),tenantId="spacemountainlive"){this.options.store.noteStreamerSpeech(tenantId,text,nowMs);}
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

function cleanEventValue(value:unknown,limit:number){return String(value??"").replace(/[\r\n]/g," ").replace(/\s+/g," ").trim().slice(0,limit);}
function buildStellaEventMessage(event:StreamWeaverStellaLoungeEventV1):string{
  const actor=cleanEventValue(event.actor,45),name=actor||"the community",game=cleanEventValue(event.game,50),detail=cleanEventValue(event.detail,90),viewers=Math.max(0,Math.floor(Number(event.viewers)||0)),amount=Math.max(0,Math.floor(Number(event.amount)||0));
  switch(event.kind){
    case "raid":return ("Welcome "+name+(viewers?" and "+viewers.toLocaleString("en-US")+" raiders":"")+" aboard SpaceMountainLive! Grab a seat and say hello—Stella has the bridge.").slice(0,240);
    case "follow":return ("Welcome aboard, "+(actor||"new Passenger")+"! Glad you found SpaceMountainLive—make yourself at home.").slice(0,240);
    case "subscribe":return ("Big thanks to "+name+" for the support. You're helping keep the Lounge lights on.").slice(0,240);
    case "cheer":return ("That "+(amount?amount.toLocaleString("en-US")+"-bit ":"")+"cheer from "+name+" just sent extra energy through the Lounge. Thank you!").slice(0,240);
    case "game-winner":return ("Well played, "+name+"—you took the "+(game||"game")+" win. The Lounge has a new story.").slice(0,240);
    case "game-play":return ("Nice move, "+name+"! That "+(game||"game")+" play deserves a spotlight moment.").slice(0,240);
    case "game-round":return ("A new round of "+(game||"the Lounge game")+" is underway."+(detail?" "+detail:" The Lounge is watching.")).slice(0,240);
    case "milestone":return ("That's a milestone worth celebrating, "+name+"! Thanks for being part of the Lounge.").slice(0,240);
  }
}
\nfunction cleanTenant(value:string){const tenant=String(value??"").trim();if(!/^[A-Za-z0-9._:@/-]{1,180}$/.test(tenant))throw new Error("Stella Lounge Host tenant is invalid");return tenant;}
function cleanPublic(value:unknown,limit:number){return String(value??"").replace(/[\r\n]/g," ").replace(/\s+/g," ").trim().slice(0,limit)||"the stream";}
