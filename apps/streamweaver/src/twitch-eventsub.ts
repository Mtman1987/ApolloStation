import { DatabaseSync } from "node:sqlite";
import type { StreamWeaverTwitchGrantSourceV1 } from "./twitch-command-adapter.js";

export interface StreamWeaverTwitchEvent { id:string;tenantId:string;type:string;userId:string;username:string;displayName:string;rewardId?:string;redemptionId?:string;input:string;occurredAt:string; }
interface Socket { close():void; addEventListener(type:string,listener:(event:any)=>void):void; }
/** Reconnectable EventSub source with a durable inbox, separate from ordinary chat sockets. */
export class StreamWeaverTwitchEventSub {
  private readonly db:DatabaseSync;
  private closed=false;
  private readonly signatures=new Map<string,string>();
  private readonly connections=new Map<string,{socket?:Socket;retryAt:number;connecting:boolean}>();
  constructor(path:string,private readonly grants:StreamWeaverTwitchGrantSourceV1,private readonly fetchImpl:typeof fetch=fetch,private readonly sockets:(url:string)=>Socket=url=>new WebSocket(url)){
    this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sw_twitch_events(tenant TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant,id)); CREATE TABLE IF NOT EXISTS sw_twitch_event_retries(tenant TEXT NOT NULL,id TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(tenant,id));");
  }
  async reconcile(tenants:Array<{tenantId:string;types:string[]}>,deliver:(event:StreamWeaverTwitchEvent)=>Promise<void>){
    if(this.closed)return;
    const desired=new Set(tenants.map(t=>t.tenantId));for(const [id,state] of this.connections)if(!desired.has(id)){state.socket?.close();this.connections.delete(id);}
    for(const tenant of tenants){const signature=JSON.stringify([...new Set(tenant.types)].sort());if(this.signatures.get(tenant.tenantId)!==signature){this.connections.get(tenant.tenantId)?.socket?.close();this.connections.delete(tenant.tenantId);this.signatures.set(tenant.tenantId,signature);}const old=this.connections.get(tenant.tenantId);if(old?.socket||old?.connecting||(old?.retryAt??0)>Date.now())continue;const state={retryAt:0,connecting:true} as {socket?:Socket;retryAt:number;connecting:boolean};this.connections.set(tenant.tenantId,state);try{await this.connect(tenant.tenantId,tenant.types,state);}catch{state.connecting=false;state.retryAt=Date.now()+30_000;}}
    for(const row of this.db.prepare("SELECT e.tenant,e.id,e.body FROM sw_twitch_events e LEFT JOIN sw_twitch_event_retries r ON r.tenant=e.tenant AND r.id=e.id WHERE e.done=0 AND COALESCE(r.retry_at,0)<=? ORDER BY e.rowid LIMIT 50").all(Date.now())){
      if(!desired.has(String(row.tenant)))continue;
      const retry=this.db.prepare("SELECT retry_at FROM sw_twitch_event_retries WHERE tenant=? AND id=?").get(String(row.tenant),String(row.id));
      if(Number(retry?.retry_at??0)>Date.now())continue;
      try {await deliver(JSON.parse(String(row.body)) as StreamWeaverTwitchEvent);
        if(this.closed)return;
        this.db.prepare("UPDATE sw_twitch_events SET done=1 WHERE tenant=? AND id=?").run(String(row.tenant),String(row.id));
        this.db.prepare("DELETE FROM sw_twitch_event_retries WHERE tenant=? AND id=?").run(String(row.tenant),String(row.id));
      } catch(error){if(this.closed)return;this.db.prepare("INSERT INTO sw_twitch_event_retries VALUES(?,?,1,?,?) ON CONFLICT(tenant,id) DO UPDATE SET attempts=attempts+1,retry_at=excluded.retry_at,error=excluded.error").run(String(row.tenant),String(row.id),Date.now()+30000,String(error instanceof Error?error.message:"Provider event delivery failed").slice(0,500));}
    }
  }
  close(){this.closed=true;for(const state of this.connections.values())state.socket?.close();this.connections.clear();this.db.close();}
  private async connect(tenantId:string,types:string[],state:{socket?:Socket;retryAt:number;connecting:boolean},address="wss://eventsub.wss.twitch.tv/ws"){
    if(this.closed)return;
    const parsed=new URL(address);if(parsed.protocol!=="wss:"||parsed.hostname!=="eventsub.wss.twitch.tv")throw new Error("Invalid EventSub reconnect address");
    const grant=await this.grants.getGrant({tenantId,capability:"events:read"});if(grant.status!=="ready")throw new Error(grant.reason);
    if(this.closed)return;
    const socket=this.sockets(address);state.socket=socket;state.connecting=false;let lastMessage=Date.now(),heartbeat:ReturnType<typeof setInterval>|undefined;
    const failed=()=>{if(heartbeat)clearInterval(heartbeat);if(state.socket===socket){delete state.socket;state.retryAt=Date.now()+10_000;}socket.close();};
    heartbeat=setInterval(()=>{if(Date.now()-lastMessage>30000)failed()},5000);heartbeat.unref();
    socket.addEventListener("close",()=>{if(heartbeat)clearInterval(heartbeat);if(state.socket===socket){delete state.socket;state.retryAt=Date.now()+10_000;}});
    socket.addEventListener("error",failed);
    socket.addEventListener("message",event=>{void(async()=>{
      if(this.closed||state.socket!==socket)return;
      lastMessage=Date.now();const frame=JSON.parse(String(event.data));
      if(frame.metadata?.message_type==="session_welcome"){
        const session=frame.payload?.session;if(!session?.id)throw new Error("Missing EventSub session");
        const keepalive=Math.max(10,Number(session.keepalive_timeout_seconds)||10)*1000;
        if(heartbeat)clearInterval(heartbeat);
        heartbeat=setInterval(()=>{if(Date.now()-lastMessage>keepalive+10_000)failed()},5000);heartbeat.unref();
        for(const [type,version,condition] of subscriptions(types,grant.broadcasterId)){
          const capability=type.includes("redemption")?"events:rewards":type==="channel.follow"?"events:follow":type.includes("subscr")?"events:subscriptions":type==="channel.cheer"?"events:cheer":"events:read";
          const authorized=await this.grants.getGrant({tenantId,capability});if(authorized.status!=="ready")throw new Error(authorized.reason);
          const response=await this.fetchImpl("https://api.twitch.tv/helix/eventsub/subscriptions",{method:"POST",headers:{authorization:`Bearer ${authorized.accessToken}`,"client-id":authorized.clientId,"content-type":"application/json"},body:JSON.stringify({type,version,condition,transport:{method:"websocket",session_id:session.id}}),redirect:"error",signal:AbortSignal.timeout(15000)});
          if(!response.ok&&response.status!==409)throw new Error(`EventSub subscription failed (${response.status})`);
        }
      }else if(frame.metadata?.message_type==="session_reconnect"){
        const next=frame.payload?.session?.reconnect_url;if(typeof next!=="string")throw new Error("Invalid reconnect request");
        if(heartbeat)clearInterval(heartbeat);await this.connect(tenantId,types,state,next);socket.close();
      }else if(frame.metadata?.message_type==="revocation")failed();
      else if(frame.metadata?.message_type==="notification"){
        const e=frame.payload?.event??{},subscription=frame.payload?.subscription?.type??"",id=String(frame.metadata?.message_id??"");
        const type=eventType(subscription);if(!type||!id)return;
        const value:StreamWeaverTwitchEvent={id,tenantId,type,userId:String(e.user_id??e.from_broadcaster_user_id??""),username:String(e.user_login??e.from_broadcaster_user_login??""),displayName:String(e.user_name??e.from_broadcaster_user_name??"viewer"),input:String(e.user_input??""),occurredAt:String(frame.metadata.message_timestamp??new Date().toISOString()),...(e.reward?.id?{rewardId:String(e.reward.id),redemptionId:String(e.id??"")}:{})};
        this.db.prepare("INSERT OR IGNORE INTO sw_twitch_events(tenant,id,body) VALUES(?,?,?)").run(tenantId,id,JSON.stringify(value));
      }
    })().catch(failed)});
  }
}
function subscriptions(types:string[],broadcaster:string):Array<[string,string,Record<string,string>]>{const result:Array<[string,string,Record<string,string>]>=[];const add=(type:string,version="1",condition:Record<string,string>={broadcaster_user_id:broadcaster})=>result.push([type,version,condition]);if(types.some(t=>t.startsWith("reward:")))add("channel.channel_points_custom_reward_redemption.add");if(types.includes("follow"))add("channel.follow","2",{broadcaster_user_id:broadcaster,moderator_user_id:broadcaster} as Record<string,string>);if(types.includes("subscribe"))add("channel.subscribe");if(types.includes("resubscribe"))add("channel.subscription.message");if(types.some(t=>t==="gift-sub"||t==="gift-bomb"))add("channel.subscription.gift");if(types.includes("cheer"))add("channel.cheer");if(types.includes("raid"))add("channel.raid","1",{to_broadcaster_user_id:broadcaster});return result;}
function eventType(value:string){return({"channel.channel_points_custom_reward_redemption.add":"reward","channel.follow":"follow","channel.subscribe":"subscribe","channel.subscription.message":"resubscribe","channel.subscription.gift":"gift-bomb","channel.cheer":"cheer","channel.raid":"raid"} as Record<string,string>)[value];}
