import {StreamWeaverRideStore} from "./ride-store.js";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
export interface StreamPartner { id:string; name:string; kind:"partner"|"crew"|"mod"|"community"; imageUrl:string; inviteUrl:string; rewardId?:string; source?:{guildId:string;roleId:string;syncedAt:string}; }
export interface StreamCheckinSettings {enabled:boolean;aiEnabled:boolean;ttsEnabled:boolean;discordEnabled:boolean;greeting:string;prompt:string;voice:string;}
export interface StreamRedeem { id:string; title:string; price:number; award:number; acceptance:"streamer"|"spmt"|"either"; firstPerStream:boolean; text:string; mediaUrl:string; enabled:boolean; rewardId:string; }
export const STREAM_EVENT_AWARDS=["twitch:follow","twitch:subscribe","twitch:resubscribe","twitch:gift-bomb","twitch:cheer","twitch:raid","youtube:newSponsorEvent","youtube:memberMilestoneChatEvent","youtube:membershipGiftingEvent","youtube:giftMembershipReceivedEvent","youtube:superChatEvent","youtube:superStickerEvent"] as const;
export interface StreamEventAward {event:string;points:number;perUnit:boolean;enabled:boolean;}
export interface StreamEventBinding { event:string; command:string; enabled:boolean; }
export interface StreamPresentationSettings { welcomeEnabled:boolean; welcomeSession:string; welcomeText:string; brbMode:"broadcaster"|"viewer"; welcomeShoutout?:boolean;shoutoutMode?:"full"|"overlay"|"chat"; }
export class StreamWeaverCommunityStore {
  readonly rides:StreamWeaverRideStore;
  private readonly db:DatabaseSync;
  constructor(path:string){this.rides=new StreamWeaverRideStore(path);this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");this.db.exec(`
    CREATE TABLE IF NOT EXISTS sw_community_config(tenant TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,kind,id));
    CREATE TABLE IF NOT EXISTS sw_checkins(tenant TEXT NOT NULL,request TEXT NOT NULL,actor TEXT NOT NULL,partner TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(tenant,request));
    CREATE TABLE IF NOT EXISTS sw_watchtime(tenant TEXT NOT NULL,provider TEXT NOT NULL,user_id TEXT NOT NULL,username TEXT NOT NULL,minutes INTEGER NOT NULL DEFAULT 0,last_bucket INTEGER NOT NULL,PRIMARY KEY(tenant,provider,user_id));
    CREATE TABLE IF NOT EXISTS sw_welcomed(tenant TEXT NOT NULL,session TEXT NOT NULL,provider TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(tenant,session,provider,user_id));
    CREATE TABLE IF NOT EXISTS sw_community_outbox(tenant TEXT NOT NULL,id TEXT NOT NULL,type TEXT NOT NULL,body TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant,id));
    CREATE TABLE IF NOT EXISTS sw_stream_tasks(tenant TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT,next_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant,id));`);}
  eventOutcome(tenant:string,key:string):{accepted:boolean;text:string}|undefined{const row=this.db.prepare("SELECT body FROM sw_community_config WHERE tenant=? AND kind='event-outcome' AND id=?").get(tenant,key);return row?JSON.parse(String(row.body)):undefined;}
  saveEventOutcome(tenant:string,key:string,value:{accepted:boolean;text:string}){this.save(tenant,"event-outcome",key,{id:key,...value});}
  providerDiagnostics(tenant:string){if(!this.db.prepare("SELECT name FROM sqlite_master WHERE name='sw_twitch_event_retries'").get())return [];return this.db.prepare("SELECT id,attempts,retry_at AS retryAt,error FROM sw_twitch_event_retries WHERE tenant=? ORDER BY retry_at DESC LIMIT 100").all(tenant);}
  configuredTenants(){return this.db.prepare("SELECT DISTINCT tenant FROM sw_community_config").all().map(r=>String(r.tenant));}
  partners(tenant:string){return this.list<StreamPartner>(tenant,"partner");}
  savePartner(tenant:string,input:StreamPartner){const value:StreamPartner={id:id(input.id),name:text(input.name,120),kind:input.kind,imageUrl:url(input.imageUrl),inviteUrl:url(input.inviteUrl),...(input.rewardId?{rewardId:id(input.rewardId)}:{})};if(!["partner","crew","mod","community"].includes(value.kind))throw new Error("Choose a partner group");if(value.rewardId&&this.rides.settings(tenant).enabled&&this.rides.settings(tenant).rewardId===value.rewardId)throw Error("The ride reward cannot also price an individual check-in");if(value.rewardId&&this.partners(tenant).some(p=>p.id!==value.id&&p.rewardId===value.rewardId))throw new Error("This reward is already assigned to another check-in");const source=this.partners(tenant).find(p=>p.id===value.id)?.source;if(source)value.source=source;this.save(tenant,"partner",value.id,value);return value;}
  importPartnerRole(tenant:string,input:{guildId:string;roleId:string;kind:StreamPartner["kind"];members:Array<{id:string;name:string;imageUrl:string}>}){
    if(!/^[0-9]{5,30}$/.test(input.guildId)||!/^[0-9]{5,30}$/.test(input.roleId)||!["partner","crew","mod","community"].includes(input.kind)||!Array.isArray(input.members)||input.members.length>10000)throw new Error("Choose a Discord server, role and check-in group");
    const seen=new Set<string>();for(const m of input.members){if(!m||!/^[0-9]{5,30}$/.test(m.id)||seen.has(m.id))throw new Error("Role members must have unique Discord IDs");seen.add(m.id);text(m.name,120);url(m.imageUrl);}
    this.db.exec("BEGIN IMMEDIATE");try{
      const old=this.partners(tenant),source={guildId:input.guildId,roleId:input.roleId,syncedAt:new Date().toISOString()},ids=new Set<string>();
      for(const m of input.members){const key=`discord:${input.guildId}:${input.roleId}:${input.kind}:${m.id}`;ids.add(key);const prior=old.find(p=>p.id===key);this.save(tenant,"partner",key,{id:key,name:m.name,kind:input.kind,imageUrl:m.imageUrl,inviteUrl:prior?.inviteUrl??"",...(prior?.rewardId?{rewardId:prior.rewardId}:{}),source});}
      for(const p of old)if(p.source?.guildId===input.guildId&&p.source.roleId===input.roleId&&p.kind===input.kind&&!ids.has(p.id))this.removePartner(tenant,p.id);
      this.db.exec("COMMIT");return {imported:ids.size,source};
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  removePartner(tenant:string,partner:string){this.db.prepare("DELETE FROM sw_community_config WHERE tenant=? AND kind='partner' AND id=?").run(tenant,partner);}
  redeems(tenant:string){return this.list<StreamRedeem>(tenant,"redeem").map(r=>({...r,award:r.award??0,acceptance:r.acceptance??"streamer" as const,firstPerStream:r.firstPerStream??false}));}
  saveRedeem(tenant:string,input:StreamRedeem){
    const price=Number(input.price),award=Number(input.award??0),acceptance=input.acceptance??"streamer";
    for(const [name,amount] of [["Cost",price],["Award",award]] as const)if(!Number.isSafeInteger(amount)||amount<0||amount>1_000_000_000_000)throw new Error(`${name} must be a whole number between 0 and 1000000000000`);
    if(!["streamer","spmt","either"].includes(acceptance))throw new Error("Choose accepted currency");
    const value:StreamRedeem={id:id(input.id),title:text(input.title,120),price,award,acceptance,firstPerStream:input.firstPerStream===true,text:text(input.text,2000),mediaUrl:url(input.mediaUrl),enabled:input.enabled===true,rewardId:String(input.rewardId??"").slice(0,200)};
    const collision=this.redeems(tenant).find(r=>r.id!==value.id&&value.rewardId&&r.rewardId===value.rewardId);if(collision)throw new Error("This Twitch reward is already bound to another reward");
    this.save(tenant,"redeem",value.id,value);return value;
  }
  awards(tenant:string){return this.list<StreamEventAward>(tenant,"event-award");}
  saveAward(tenant:string,input:StreamEventAward){if(!(STREAM_EVENT_AWARDS as readonly string[]).includes(input.event)||!Number.isSafeInteger(input.points)||input.points<0||input.points>1000000000000||typeof input.perUnit!=="boolean"||typeof input.enabled!=="boolean")throw new Error("Choose a supported event and nonnegative whole-point award");if(input.perUnit&&!['twitch:cheer','twitch:gift-bomb','twitch:raid'].includes(input.event))throw new Error("Per-unit awards are available for Twitch bits, gifted subscriptions and raid viewers");const value={event:input.event,points:input.points,perUnit:input.perUnit,enabled:input.enabled};this.save(tenant,"event-award",value.event,value);return value;}
  bindings(tenant:string){return this.list<StreamEventBinding&{id:string}>(tenant,"binding");}
  saveBinding(tenant:string,input:StreamEventBinding){if(!/^(follow|subscribe|resubscribe|gift-sub|gift-bomb|cheer|raid|reward:[A-Za-z0-9-]+)$/.test(input.event))throw new Error("Choose a supported provider event");const value={id:input.event,event:input.event,command:text(input.command,500),enabled:input.enabled===true};this.save(tenant,"binding",value.id,value);return value;}
  settings(tenant:string):StreamPresentationSettings{return this.list<StreamPresentationSettings>(tenant,"presentation")[0]??{welcomeEnabled:false,welcomeSession:"default",welcomeText:"Welcome {user}!",brbMode:"broadcaster"};}
  saveSettings(tenant:string,input:Partial<StreamPresentationSettings>){const old=this.settings(tenant),value={welcomeEnabled:input.welcomeEnabled===undefined?old.welcomeEnabled:input.welcomeEnabled===true,welcomeSession:input.welcomeSession?text(input.welcomeSession,120):old.welcomeSession,welcomeText:input.welcomeText?text(input.welcomeText,2000):old.welcomeText,brbMode:input.brbMode??old.brbMode,welcomeShoutout:input.welcomeShoutout??old.welcomeShoutout??false,shoutoutMode:input.shoutoutMode??old.shoutoutMode??"full"};if(!["full","overlay","chat"].includes(value.shoutoutMode)||typeof value.welcomeShoutout!=="boolean")throw new Error("Choose valid shoutout settings");if(!["broadcaster","viewer"].includes(value.brbMode))throw new Error("Choose a BRB mode");this.save(tenant,"presentation","main",value);return value;}
  welcome(tenant:string,provider:string,userId:string,displayName:string,username?:string){
    const settings=this.settings(tenant);if(!settings.welcomeEnabled)return;
    this.db.exec("BEGIN IMMEDIATE");try{
      const result=this.db.prepare("INSERT OR IGNORE INTO sw_welcomed VALUES(?,?,?,?)").run(tenant,settings.welcomeSession,provider,userId);
      if(!result.changes){this.db.exec("COMMIT");return;}
      const message=settings.welcomeText.replaceAll("{user}",displayName),key=`welcome:${settings.welcomeSession}:${provider}:${userId}`;
      this.enqueue(tenant,key,"streamweaver.welcome.v1",{text:message,displayName});
      if(settings.welcomeShoutout&&provider==="twitch"&&username)this.requestTask(tenant,key,{action:"shoutout",username,source:"auto-welcome"});
      this.db.exec("COMMIT");return message;
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  bindRewardCheckin(tenant:string,actor:string,rewardId:string,requestId:string){
    const key=createHash("sha256").update(requestId).digest("hex"),signature=JSON.stringify([actor,rewardId]);
    this.db.exec("BEGIN IMMEDIATE");try{
      const old=this.db.prepare("SELECT body FROM sw_community_config WHERE tenant=? AND kind='reward-checkin' AND id=?").get(tenant,key);
      if(old){const result=JSON.parse(String(old.body));if(result.signature!==signature)throw new Error("Reward check-in identifier conflicts with another request");this.db.exec("COMMIT");return result as {signature:string;partner?:StreamPartner};}
      const partner=this.partners(tenant).find(p=>p.rewardId===rewardId),result={signature,...(partner?{partner}:{})};this.save(tenant,"reward-checkin",key,result);this.db.exec("COMMIT");return result;
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  prepareCheckin(tenant:string,actor:string,partnerId:string,source:string,requestId:string,currency:"streamer"|"spmt"):{signature:string;partner:StreamPartner;reward?:StreamRedeem;streamSession:string}{
    const request=id(requestId),signature=JSON.stringify([actor,partnerId,source,currency]);text(actor,300);text(source,100);
    this.db.exec("BEGIN IMMEDIATE");try{
      const old=this.db.prepare("SELECT body FROM sw_community_config WHERE tenant=? AND kind='checkin-attempt' AND id=?").get(tenant,request);
      if(old){const result=JSON.parse(String(old.body));if(result.signature!==signature)throw new Error("Check-in identifier was used for a different request");this.db.exec("COMMIT");return result as {signature:string;partner:StreamPartner;reward?:StreamRedeem;streamSession:string};}
      const completed=this.db.prepare("SELECT actor,partner,source FROM sw_checkins WHERE tenant=? AND request=?").get(tenant,request);
      if(completed){
        if(completed.actor!==actor||completed.partner!==partnerId||completed.source!==source)throw new Error("Check-in identifier was used for a different request");
        const event=this.db.prepare("SELECT body FROM sw_community_outbox WHERE tenant=? AND id=?").get(tenant,createHash("sha256").update(`checkin:${request}`).digest("hex"));
        if(!event)throw new Error("The historical check-in receipt is unavailable; it will not be charged again");
        const result={signature,partner:JSON.parse(String(event.body)).partner as StreamPartner,streamSession:this.settings(tenant).welcomeSession};this.save(tenant,"checkin-attempt",request,result);this.db.exec("COMMIT");return result;
      }
      const partner=this.partners(tenant).find(p=>p.id===partnerId);if(!partner)throw new Error("Partner was not found");
      const reward=partner.rewardId?this.redeems(tenant).find(r=>r.id===partner.rewardId):undefined;
      if(partner.rewardId&&!reward)throw new Error("The check-in reward is unavailable; ask the streamer to update it");
      const result={signature,partner,...(reward?{reward}:{}),streamSession:this.settings(tenant).welcomeSession};this.save(tenant,"checkin-attempt",request,result);this.db.exec("COMMIT");return result;
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  checkin(tenant:string,actor:string,partnerId:string,sourceInput:string,requestId:string,partnerSnapshot?:StreamPartner,presentationName?:string,emitOverlay=true){
    const request=id(requestId),source=text(sourceInput,100);text(actor,300);
    this.db.exec("BEGIN IMMEDIATE");try{
      const prior=this.db.prepare("SELECT actor,partner,source FROM sw_checkins WHERE tenant=? AND request=?").get(tenant,request);
      if(prior){
        if(prior.actor!==actor||prior.partner!==partnerId||prior.source!==source)throw new Error("Request identifier was used for another check-in");
        const saved=this.db.prepare("SELECT body FROM sw_community_outbox WHERE tenant=? AND id=?").get(tenant,createHash("sha256").update(`checkin:${request}`).digest("hex"));
        if(saved){const {partner,userTotal,partnerTotal}=JSON.parse(String(saved.body));this.db.exec("COMMIT");return {partner:partner as StreamPartner,userTotal:Number(userTotal),partnerTotal:Number(partnerTotal)};}
      }
      const attempt=this.db.prepare("SELECT body FROM sw_community_config WHERE tenant=? AND kind='checkin-attempt' AND id=?").get(tenant,request);
      const frozen=attempt?JSON.parse(String(attempt.body)):undefined;
      if(frozen){const bound=JSON.parse(frozen.signature);if(bound[0]!==actor||bound[1]!==partnerId||bound[2]!==source)throw new Error("Check-in identifier was used for a different request");}
      if(partnerSnapshot&&partnerSnapshot.id!==partnerId)throw new Error("Check-in snapshot does not match its partner");
      const partner=(frozen?.partner as StreamPartner|undefined)??partnerSnapshot??this.partners(tenant).find(p=>p.id===partnerId);if(!partner)throw new Error("Partner was not found");
      this.db.prepare("INSERT OR IGNORE INTO sw_checkins VALUES(?,?,?,?,?,?)").run(tenant,request,actor,partnerId,source,new Date().toISOString());
      const result={partner,userTotal:Number(this.db.prepare("SELECT COUNT(*) AS n FROM sw_checkins WHERE tenant=? AND actor=?").get(tenant,actor)!.n),partnerTotal:Number(this.db.prepare("SELECT COUNT(*) AS n FROM sw_checkins WHERE tenant=? AND partner=?").get(tenant,partnerId)!.n)};
      this.enqueue(tenant,`checkin:${request}`,"streamweaver.checkin.v1",{...result,actor});
      if(!emitOverlay)this.db.prepare("UPDATE sw_community_outbox SET sent=1 WHERE tenant=? AND id=?").run(tenant,createHash("sha256").update(`checkin:${request}`).digest("hex"));
      if(presentationName!==undefined&&this.checkinSettings(tenant).enabled)this.requestTask(tenant,`checkin-greeting:${request}`,{action:"checkin-greeting",displayName:text(presentationName,120),partner:{id:partner.id,name:partner.name,kind:partner.kind,inviteUrl:partner.inviteUrl}});
      this.db.exec("COMMIT");return result;
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  checkinSettings(tenant:string):StreamCheckinSettings{return this.list<StreamCheckinSettings>(tenant,"checkin-settings")[0]??{enabled:false,aiEnabled:false,ttsEnabled:false,discordEnabled:false,greeting:"Welcome {user}! You checked in with {partner}.",prompt:"Write a short, warm public check-in greeting.",voice:"deepgram:aura-2:athena"};}
  saveCheckinSettings(tenant:string,input:StreamCheckinSettings){for(const key of ["enabled","aiEnabled","ttsEnabled","discordEnabled"] as const)if(typeof input[key]!=="boolean")throw Error("Choose valid check-in presentation settings");const value={enabled:input.enabled,aiEnabled:input.aiEnabled,ttsEnabled:input.ttsEnabled,discordEnabled:input.discordEnabled,greeting:text(input.greeting,1000),prompt:text(input.prompt,2000),voice:text(input.voice,128)};this.save(tenant,"checkin-settings","main",value);return value;}
  checkinGreeting(tenant:string,key:string):{jobId?:string;text?:string;failed?:boolean}|undefined{const row=this.db.prepare("SELECT body FROM sw_community_config WHERE tenant=? AND kind='checkin-greeting' AND id=?").get(tenant,key);return row?JSON.parse(String(row.body)):undefined;}
  saveCheckinGreeting(tenant:string,key:string,value:{jobId?:string;text?:string;failed?:boolean}){this.save(tenant,"checkin-greeting",key,value);}
  checkinStats(tenant:string){return{partners:this.db.prepare("SELECT partner,COUNT(*) AS count FROM sw_checkins WHERE tenant=? GROUP BY partner ORDER BY count DESC").all(tenant),sources:this.db.prepare("SELECT source,COUNT(*) AS count FROM sw_checkins WHERE tenant=? GROUP BY source ORDER BY count DESC").all(tenant),users:this.db.prepare("SELECT actor,COUNT(*) AS count FROM sw_checkins WHERE tenant=? GROUP BY actor ORDER BY count DESC LIMIT 500").all(tenant)};}
  recordWatchtime(tenant:string,provider:string,chatters:Array<{id:string;username:string}>,now=Date.now()){const bucket=Math.floor(now/60000);this.db.exec("BEGIN IMMEDIATE");try{for(const user of chatters)this.db.prepare("INSERT INTO sw_watchtime VALUES(?,?,?,?,1,?) ON CONFLICT(tenant,provider,user_id) DO UPDATE SET minutes=sw_watchtime.minutes+CASE WHEN excluded.last_bucket>sw_watchtime.last_bucket THEN 1 ELSE 0 END,last_bucket=MAX(sw_watchtime.last_bucket,excluded.last_bucket),username=excluded.username").run(tenant,provider,user.id,user.username,bucket);this.db.exec("COMMIT");}catch(error){this.db.exec("ROLLBACK");throw error;}}
  watchtime(tenant:string,provider:string,userId:string){return this.db.prepare("SELECT username,minutes FROM sw_watchtime WHERE tenant=? AND provider=? AND user_id=?").get(tenant,provider,userId)??{minutes:0};}
  watchLeaders(tenant:string){return this.db.prepare("SELECT username,SUM(minutes) AS minutes FROM sw_watchtime WHERE tenant=? GROUP BY provider,user_id ORDER BY minutes DESC LIMIT 10").all(tenant);}
  enqueue(tenant:string,key:string,type:string,payload:Record<string,unknown>){this.db.prepare("INSERT OR IGNORE INTO sw_community_outbox(tenant,id,type,body) VALUES(?,?,?,?)").run(tenant,createHash("sha256").update(key).digest("hex"),type,JSON.stringify(payload));}
  async flush(publish:(tenant:string,type:string,payload:Record<string,unknown>,key:string)=>Promise<unknown>){for(const row of this.db.prepare("SELECT tenant,id,type,body FROM sw_community_outbox WHERE sent=0 LIMIT 100").all()){await publish(String(row.tenant),String(row.type),JSON.parse(String(row.body)),`community:${row.id}`);this.db.prepare("UPDATE sw_community_outbox SET sent=1 WHERE tenant=? AND id=?").run(String(row.tenant),String(row.id));}}
  close(){this.rides.close();this.db.close();}
  requestTask(tenant:string,key:string,body:Record<string,unknown>){if(!key||key.length>500||key.includes("\0"))throw new Error("Stream request identifier is required");const hash=createHash("sha256").update(key).digest("hex"),old=this.db.prepare("SELECT body FROM sw_stream_tasks WHERE tenant=? AND id=?").get(tenant,hash);if(old&&String(old.body)!==JSON.stringify(body))throw new Error("Stream request identifier was used for another action");this.db.prepare("INSERT OR IGNORE INTO sw_stream_tasks(tenant,id,body) VALUES(?,?,?)").run(tenant,hash,JSON.stringify(body));return {requestId:hash};}
  pendingTasks(){return this.db.prepare("SELECT tenant,id,body FROM sw_stream_tasks WHERE state='pending' AND next_at<=? ORDER BY rowid LIMIT 10").all(Date.now()).map(r=>({tenant:String(r.tenant),id:String(r.id),body:JSON.parse(String(r.body)) as Record<string,unknown>}));}
  deferTask(tenant:string,key:string){this.db.prepare("UPDATE sw_stream_tasks SET next_at=? WHERE tenant=? AND id=?").run(Date.now()+1000,tenant,key);}
  finishTask(tenant:string,key:string,error?:string){this.db.prepare("UPDATE sw_stream_tasks SET state=?,error=?,next_at=? WHERE tenant=? AND id=?").run(error?"pending":"complete",error?.slice(0,300)??null,Date.now()+60_000,tenant,key);}
  tasks(tenant:string){return this.db.prepare("SELECT id,state,error FROM sw_stream_tasks WHERE tenant=? ORDER BY rowid DESC LIMIT 30").all(tenant);}
  program(tenant:string):{clips:Array<{url:string;duration:number;text:string}>;index:number;nextAt:number;requestId:string}|undefined{return this.list(tenant,"brb-program")[0] as ReturnType<StreamWeaverCommunityStore['program']>;}
  saveProgram(tenant:string,program:NonNullable<ReturnType<StreamWeaverCommunityStore['program']>>){this.save(tenant,"brb-program","main",program);}
  stopProgram(tenant:string){this.db.prepare("DELETE FROM sw_community_config WHERE tenant=? AND kind='brb-program'").run(tenant);this.db.prepare("UPDATE sw_stream_tasks SET state='cancelled' WHERE tenant=? AND state='pending' AND json_extract(body,'$.action')='brb-start'").run(tenant);}
  private list<T>(tenant:string,kind:string):T[]{return this.db.prepare("SELECT body FROM sw_community_config WHERE tenant=? AND kind=? ORDER BY id").all(tenant,kind).map(r=>JSON.parse(String(r.body)));}
  private save(tenant:string,kind:string,key:string,value:unknown){this.db.prepare("INSERT INTO sw_community_config VALUES(?,?,?,?) ON CONFLICT(tenant,kind,id) DO UPDATE SET body=excluded.body").run(tenant,kind,key,JSON.stringify(value));}
}
function id(v:unknown){if(typeof v!=="string"||!/^[A-Za-z0-9_.:-]{1,200}$/.test(v))throw new Error("Identifier is invalid");return v;}
function text(v:unknown,max:number){if(typeof v!=="string"||!v.trim()||v.length>max||v.includes("\0"))throw new Error("Text is missing or too long");return v.trim();}
function url(v:unknown){if(v===undefined||v==="")return "";const u=new URL(String(v));if(u.protocol!=="https:"||u.username||u.password)throw new Error("Use an HTTPS media or invite URL");return u.toString();}
