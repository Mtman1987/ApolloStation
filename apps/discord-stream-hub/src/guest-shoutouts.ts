import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { DshMemberGroupV1, DshTwitchStreamV1 } from './live-monitor.js';
import { buildDshTierShoutout, dshHttps, type DshEmbedTemplates } from './shoutout-presentation.js';

export const DSH_GUEST_OFFLINE_TTL_MS=3_600_000;
export const DSH_GUEST_OFFLINE_GRACE_MS=1_200_000;
export const DSH_GUEST_REFRESH_MS=600_000;
export interface DshGuestShoutoutV1 {
  id:string; tenantId:string; guildId:string; channelId:string; twitchLogin:string; displayName:string; avatarUrl?:string;
  canonicalUserId?:string; group:DshMemberGroupV1; requesterUserId:string;
  state:'active'|'removed'|'expired'; generation:number; revision:number; trackWhileLive:boolean;
  stream?:DshTwitchStreamV1; offlineDetectedAt?:string; deleteAt?:string; createdAt:string; updatedAt:string;
}
export type DshGuestLiveActionV1={schemaVersion:1;type:'guest.refresh';tenantId:string;idempotencyKey:string;targetId:string;generation:number;revision:number};
export interface DshGuestProfileV1 {twitchLogin:string;displayName:string;avatarUrl?:string;stream?:DshTwitchStreamV1;}

/** App-private delivery targets. An unlinked creator never becomes a fabricated SPMT member. */
export class DshGuestShoutoutStore {
  constructor(private readonly db:DatabaseSync){db.exec(`
    CREATE TABLE IF NOT EXISTS dsh_guest_shoutouts(tenant TEXT NOT NULL,id TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,id)) STRICT;
    CREATE TABLE IF NOT EXISTS dsh_guest_delivery_leases(tenant TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(tenant,id)) STRICT;
    CREATE TABLE IF NOT EXISTS dsh_guest_operations(tenant TEXT NOT NULL,id TEXT NOT NULL,signature TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,id)) STRICT;
  `);}
  get(tenant:string,id:string):DshGuestShoutoutV1|undefined {const row=this.db.prepare('SELECT body FROM dsh_guest_shoutouts WHERE tenant=? AND id=?').get(tenant,id) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;}
  list(tenant:string,activeOnly=true):DshGuestShoutoutV1[]{return (this.db.prepare(`SELECT body FROM dsh_guest_shoutouts WHERE tenant=? ${activeOnly?"AND state='active'":''} ORDER BY id`).all(tenant) as {body:string}[]).map(row=>JSON.parse(row.body));}
  register(input:{tenantId:string;guildId:string;channelId:string;profile:DshGuestProfileV1;requesterUserId:string;group?:DshMemberGroupV1;canonicalUserId?:string;operationId:string;now:string}) {
    const tenantId=clean(input.tenantId),guildId=snowflake(input.guildId),channelId=snowflake(input.channelId),login=dshGuestLogin(input.profile.twitchLogin),at=timestamp(input.now),actor=clean(input.requesterUserId);
    const id='guest-'+createHash('sha256').update(JSON.stringify([guildId,channelId,login])).digest('hex').slice(0,40),signature=JSON.stringify([actor,guildId,channelId,login]);
    return this.once(tenantId,clean(input.operationId),signature,()=>{
      const prior=this.get(tenantId,id),stream=input.profile.stream,avatarUrl=dshHttps(input.profile.avatarUrl);
      const target:DshGuestShoutoutV1={id,tenantId,guildId,channelId,twitchLogin:login,displayName:String(input.profile.displayName||login).slice(0,100),...(avatarUrl?{avatarUrl}:{}),...(input.canonicalUserId?{canonicalUserId:clean(input.canonicalUserId)}:{}),group:input.group??'Everyone Else',requesterUserId:actor,state:'active',generation:(prior?.generation??0)+(prior?.state==='active'?0:1),revision:(prior?.revision??0)+1,trackWhileLive:Boolean(stream),...(stream?{stream}:{deleteAt:new Date(Date.parse(at)+DSH_GUEST_OFFLINE_TTL_MS).toISOString()}),createdAt:prior?.state==='active'?prior.createdAt:at,updatedAt:at};
      this.put(target);this.queue(target);return target;
    });
  }
  remove(tenant:string,id:string,actor:string,operationId:string,now:string) {
    return this.once(clean(tenant),clean(operationId),JSON.stringify([clean(actor),id,'remove']),()=>{const target=this.get(tenant,id);if(!target)return {removed:false};if(target.state==='active')this.retire(target,'removed',timestamp(now));return {removed:true};});
  }
  /** Called inside the monitor's poll transaction, only after a successful complete Twitch read. */
  observe(tenant:string,streams:readonly DshTwitchStreamV1[],now:string) {
    const at=timestamp(now),live=new Map(streams.map(stream=>[stream.twitchLogin.toLowerCase(),stream]));
    for(const target of this.list(tenant)) {
      if(!target.trackWhileLive){if(target.deleteAt&&target.deleteAt<=at)this.retire(target,'expired',at);continue;}
      const stream=live.get(target.twitchLogin);
      if(!stream){target.offlineDetectedAt??=at;if(Date.parse(at)-Date.parse(target.offlineDetectedAt)>=DSH_GUEST_OFFLINE_GRACE_MS){this.retire(target,'expired',at);continue;}this.put(target);continue;}
      delete target.offlineDetectedAt;target.stream=stream;
      if(Date.parse(at)-Date.parse(target.updatedAt)>=DSH_GUEST_REFRESH_MS){target.revision++;target.updatedAt=at;this.put(target);this.queue(target);}else this.put(target);
    }
  }
  expire(tenant:string,now:string) {this.transaction(()=>{for(const target of this.list(tenant))if(!target.trackWhileLive&&target.deleteAt&&target.deleteAt<=timestamp(now))this.retire(target,'expired',timestamp(now));});}
  acquire(tenant:string,id:string){const owner=randomUUID(),at=Date.now();const changed=this.db.prepare('INSERT INTO dsh_guest_delivery_leases VALUES(?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires<?').run(tenant,id,owner,at+120_000,at);return changed.changes?owner:undefined;}
  renew(tenant:string,id:string,owner:string){if(!this.db.prepare('UPDATE dsh_guest_delivery_leases SET expires=? WHERE tenant=? AND id=? AND owner=? AND expires>?').run(Date.now()+120_000,tenant,id,owner,Date.now()).changes)throw Error('Guest shoutout delivery lease expired');}
  release(tenant:string,id:string,owner:string){this.db.prepare('DELETE FROM dsh_guest_delivery_leases WHERE tenant=? AND id=? AND owner=?').run(tenant,id,owner);}
  private retire(target:DshGuestShoutoutV1,state:'removed'|'expired',at:string){target.state=state;target.updatedAt=at;target.revision++;this.put(target);this.queue(target);}
  private put(target:DshGuestShoutoutV1){this.db.prepare('INSERT INTO dsh_guest_shoutouts VALUES(?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET state=excluded.state,body=excluded.body').run(target.tenantId,target.id,target.state,JSON.stringify(target));}
  private queue(target:DshGuestShoutoutV1){const action:DshGuestLiveActionV1={schemaVersion:1,type:'guest.refresh',tenantId:target.tenantId,targetId:target.id,generation:target.generation,revision:target.revision,idempotencyKey:`dsh:guest:${target.tenantId}:${target.id}:${target.generation}:${target.revision}`};this.db.prepare("INSERT INTO live_action_outbox(id,tenant_id,state,attempts,created_at,body) VALUES(?,?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING").run(action.idempotencyKey,target.tenantId,target.updatedAt,JSON.stringify(action));}
  private once<T>(tenant:string,id:string,signature:string,run:()=>T):T{return this.transaction(()=>{const row=this.db.prepare('SELECT signature,body FROM dsh_guest_operations WHERE tenant=? AND id=?').get(tenant,id) as {signature:string;body:string}|undefined;if(row){if(row.signature!==signature)throw Error('This request belongs to another guest shoutout');return JSON.parse(row.body);}const value=run();this.db.prepare('INSERT INTO dsh_guest_operations VALUES(?,?,?,?)').run(tenant,id,signature,JSON.stringify(value));return value;});}
  private transaction<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}

export function dshGuestLogin(value:string){const login=String(value??'').trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//,'').replace(/^@/,'').replace(/\/+$/,'');if(!/^[a-z0-9_]{1,32}$/.test(login))throw Error('Choose a Twitch username or channel URL');return login;}
export function buildDshGuestShoutout(target:DshGuestShoutoutV1,templates?:DshEmbedTemplates){
  const stream=target.stream,url=`https://twitch.tv/${target.twitchLogin}`,nonce=createHash('sha256').update(`${target.tenantId}:${target.id}:${target.generation}`).digest('hex').slice(0,24);
  if(!stream)return {embeds:[{title:`${target.displayName} on Twitch`,url,description:'Visit their channel and check out their next stream.',...(target.avatarUrl?{thumbnail:{url:target.avatarUrl}}:{}),color:0x9146ff,footer:{text:'Temporary guest shoutout · posted while offline · expires after one hour'},timestamp:target.createdAt}],allowed_mentions:{parse:[]},nonce,enforce_nonce:true};
  const avatarUrl=target.avatarUrl??stream.avatarUrl,imageUrl=dshHttps(stream.thumbnailUrl.replace('{width}','1920').replace('{height}','1080'));
  return {...buildDshTierShoutout({id:target.id,twitchLogin:target.twitchLogin,displayName:stream.displayName,group:target.group,isSpotlight:false,title:stream.title,gameName:stream.gameName,viewerCount:stream.viewerCount,description:'',...(avatarUrl?{avatarUrl}:{}),...(imageUrl?{imageUrl}:{}),startedAt:stream.startedAt},{...(templates?{templates}:{}),timestamp:target.updatedAt}),nonce,enforce_nonce:true};
}
function clean(value:string){if(!value||value.length>300||value.trim()!==value||/[\r\n\0]/.test(value))throw Error('Guest shoutout identity is invalid');return value;}
function snowflake(value:string){if(!/^\d{5,30}$/.test(value))throw Error('Choose a Discord server and channel');return value;}
function timestamp(value:string){const at=Date.parse(value);if(!Number.isFinite(at))throw Error('Guest shoutout timestamp is invalid');return new Date(at).toISOString();}
