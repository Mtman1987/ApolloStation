import {createHash,randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import type {SpmtClient} from "@spmt/sdk";
import {DshSpmtIdentityResolver} from "./provider-identity.js";
import type {DshLiveRuntimeConfigV1} from "./live-worker.js";

export interface DshMessageObservation {provider:string;guildId?:string;channelId:string;messageId:string;occurredAt:string;actor:{providerUserId:string;username:string;displayName?:string;isBot:boolean};}
/** Activity is a derived count, never a second shared message history or identity owner. */
export class DshMemberActivityStore {
  private readonly db:DatabaseSync;
  constructor(path:string){this.db=new DatabaseSync(path,{timeout:5000});this.db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS dsh_activity_cursor(tenant TEXT PRIMARY KEY,event_id TEXT NOT NULL DEFAULT '',owner TEXT,expires INTEGER NOT NULL DEFAULT 0,error TEXT);
    CREATE TABLE IF NOT EXISTS dsh_activity_receipts(tenant TEXT NOT NULL,message_key TEXT NOT NULL,PRIMARY KEY(tenant,message_key));
    CREATE TABLE IF NOT EXISTS dsh_activity_days(tenant TEXT NOT NULL,guild TEXT NOT NULL,user TEXT NOT NULL,day TEXT NOT NULL,PRIMARY KEY(tenant,guild,user,day));
    CREATE TABLE IF NOT EXISTS dsh_member_activity(tenant TEXT NOT NULL,guild TEXT NOT NULL,user TEXT NOT NULL,messages INTEGER NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,channel TEXT NOT NULL,username TEXT NOT NULL,display_name TEXT NOT NULL,PRIMARY KEY(tenant,guild,user));`);}
  close(){this.db.close();}
  cursor(tenant:string){return (this.db.prepare("SELECT event_id AS eventId,error FROM dsh_activity_cursor WHERE tenant=?").get(tenant) as {eventId:string;error:string|null}|undefined)??{eventId:"",error:null};}
  acquire(tenant:string,owner:string){return Number(this.db.prepare("INSERT INTO dsh_activity_cursor(tenant,owner,expires) VALUES(?,?,?) ON CONFLICT(tenant) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires<?").run(tenant,owner,Date.now()+120000,Date.now()).changes)>0;}
  renew(tenant:string,owner:string){if(!this.db.prepare("UPDATE dsh_activity_cursor SET expires=? WHERE tenant=? AND owner=? AND expires>?").run(Date.now()+120000,tenant,owner,Date.now()).changes)throw Error("Activity projection lease expired");}
  release(tenant:string,owner:string){this.db.prepare("UPDATE dsh_activity_cursor SET owner=NULL,expires=0 WHERE tenant=? AND owner=?").run(tenant,owner);}
  fail(tenant:string,owner:string){this.db.prepare("UPDATE dsh_activity_cursor SET error='Activity import is pending; retrying from the last saved event.' WHERE tenant=? AND owner=?").run(tenant,owner);}
  advance(tenant:string,owner:string,eventId:string,message?:DshMessageObservation,userId?:string){
    this.db.exec("BEGIN IMMEDIATE");try{this.renew(tenant,owner);
      if(message&&userId){const at=new Date(message.occurredAt).toISOString(),guild=message.guildId;if(!guild||!message.channelId||!message.messageId||!message.actor?.providerUserId)throw Error("Invalid activity observation");
        const key=createHash("sha256").update(JSON.stringify([message.provider,guild,message.channelId,message.messageId])).digest("hex");
        if(this.db.prepare("INSERT OR IGNORE INTO dsh_activity_receipts VALUES(?,?)").run(tenant,key).changes){
          this.db.prepare("INSERT OR IGNORE INTO dsh_activity_days VALUES(?,?,?,?)").run(tenant,guild,userId,at.slice(0,10));
          this.db.prepare(`INSERT INTO dsh_member_activity VALUES(?,?,?,1,?,?,?,?,?) ON CONFLICT(tenant,guild,user) DO UPDATE SET messages=messages+1,first_seen=min(first_seen,excluded.first_seen),channel=CASE WHEN excluded.last_seen>=last_seen THEN excluded.channel ELSE channel END,username=CASE WHEN excluded.last_seen>=last_seen THEN excluded.username ELSE username END,display_name=CASE WHEN excluded.last_seen>=last_seen THEN excluded.display_name ELSE display_name END,last_seen=max(last_seen,excluded.last_seen)`).run(tenant,guild,userId,at,at,message.channelId,message.actor.username,message.actor.displayName??message.actor.username);
        }
      }
      this.db.prepare("UPDATE dsh_activity_cursor SET event_id=?,error=NULL WHERE tenant=? AND owner=?").run(eventId,tenant,owner);this.db.exec("COMMIT");
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  list(tenant:string,guild?:string){const rows=this.db.prepare(`SELECT a.guild AS guildId,a.user AS userId,a.messages AS messageCount,a.first_seen AS firstSeenAt,a.last_seen AS lastSeenAt,a.channel AS lastSeenChannelId,a.username,a.display_name AS displayName,(SELECT count(*) FROM dsh_activity_days d WHERE d.tenant=a.tenant AND d.guild=a.guild AND d.user=a.user) AS activeDays FROM dsh_member_activity a WHERE a.tenant=? AND (? IS NULL OR a.guild=?) ORDER BY a.last_seen DESC,a.user LIMIT 10000`).all(tenant,guild??null,guild??null);return rows.map(row=>({...row,voiceMinutes:null,helpfulReactions:null,streamAttendance:null,lastSeenChannelName:null}));}
}

export class DshMemberActivityWorker {
  private readonly identities:DshSpmtIdentityResolver;
  constructor(private readonly store:DshMemberActivityStore,private readonly client:SpmtClient,private readonly config:DshLiveRuntimeConfigV1){this.identities=new DshSpmtIdentityResolver(client);}
  async runOnce(tenant:string){const owner=randomUUID();if(!this.store.acquire(tenant,owner))return {processed:0,busy:true};let processed=0;
    try {for(let page=0;page<20;page++){
      this.store.renew(tenant,owner);const events=await this.client.listEvents(tenant,{type:"spmt.chat.message.received.v1",sourceAppId:"chat-gateway",afterId:this.store.cursor(tenant).eventId,limit:200});
      if(!events.length)break;
      for(const event of events){this.store.renew(tenant,owner);if(typeof event.id!=="string"||event.tenantId!==tenant||event.type!=="spmt.chat.message.received.v1"||event.sourceAppId!=="chat-gateway")throw Error("Activity source is invalid");
        const message=event.payload as DshMessageObservation,eligible=message?.provider==="discord"&&!message.actor?.isBot&&Boolean(message.guildId&&this.config.tenants.find(t=>t.tenantId===tenant)?.discordGuildIds?.includes(message.guildId));
        if(eligible){const identity=await this.identities.resolveOrGrandfather({tenantId:tenant,provider:"discord",providerUserId:message.actor.providerUserId,username:message.actor.username,...(message.actor.displayName?{displayName:message.actor.displayName}:{})});this.store.advance(tenant,owner,event.id,message,identity.userId);}
        else this.store.advance(tenant,owner,event.id);processed++;
      }
      if(events.length<200)break;
    }return {processed,busy:false};}catch(error){this.store.fail(tenant,owner);throw error;}finally{this.store.release(tenant,owner);}
  }
}
