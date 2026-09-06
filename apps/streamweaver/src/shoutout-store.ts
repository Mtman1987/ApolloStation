import { DatabaseSync } from "node:sqlite";

export const STREAMWEAVER_SHOUTOUT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const STREAMWEAVER_KNOWN_BOTS = new Set([
  "streamelements","nightbot","moobot","streamlabs","blerp","fossabot","wizebot","botisimo","coebot","ankhbot","deepbot","phantombot","vivbot","ohbot","supibot",
]);

export interface StreamWeaverShoutoutSettings { aiEnabled:boolean; prompt:string; greeting:string; cooldownMinutes:number; voice:string; discordEnabled:boolean; excluded:string[]; }

export type StreamWeaverShoutoutEligibilityV1 =
  | { eligible: true; count: number }
  | { eligible: false; reason: "known-bot" | "excluded-user" | "cooldown"; remainingMs?: number; count: number };

export class SqliteStreamWeaverShoutoutStore {
  private readonly db: DatabaseSync;
  constructor(databasePath: string, private readonly nowMs: () => number = Date.now) {
    this.db = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streamweaver_shoutout_users(
        tenant_id TEXT NOT NULL,
        username TEXT NOT NULL,
        last_shoutout_ms INTEGER,
        shoutout_count INTEGER NOT NULL DEFAULT 0 CHECK(shoutout_count >= 0),
        excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)),
        PRIMARY KEY(tenant_id,username)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS streamweaver_shoutout_operations(
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,idempotency_key)
      ) STRICT;
    `);
  }
  close(): void { this.db.close(); }
  settings(tenant:string):StreamWeaverShoutoutSettings {
    const saved=this.operation(safeId(tenant,"tenantId"),"settings")??{};
    return {aiEnabled:false,prompt:"Give this streamer a warm, concise shoutout. Use only the supplied profile facts; do not invent their games or achievements.",greeting:"Welcome, @{user}! Glad you’re here!",cooldownMinutes:720,voice:"deepgram:aura-2:athena",discordEnabled:true,...saved,excluded:this.excluded(tenant)} as StreamWeaverShoutoutSettings;
  }
  saveSettings(tenant:string,input:Partial<StreamWeaverShoutoutSettings>){
    const value={...this.settings(tenant),...input};
    if(typeof value.aiEnabled!=="boolean"||typeof value.discordEnabled!=="boolean")throw new Error("Choose valid shoutout toggles");
    for(const key of ["prompt","greeting"] as const)if(typeof value[key]!=="string"||!value[key].trim()||value[key].length>2000)throw new Error("Shoutout text must contain 1–2000 characters");
    if(!Number.isSafeInteger(value.cooldownMinutes)||value.cooldownMinutes<0||value.cooldownMinutes>10080)throw new Error("Cooldown must be 0–10080 minutes");
    if(typeof value.voice!=="string"||value.voice.length>128||!/^[A-Za-z0-9:_-]+$/.test(value.voice))throw new Error("Voice ID is invalid");
    if(!Array.isArray(value.excluded)||value.excluded.length>500)throw new Error("Choose at most 500 excluded users");
    const excluded=[...new Set(value.excluded.map(safeLogin))];
    this.transaction(()=>{for(const user of this.excluded(tenant))this.setExcluded(tenant,user,false);for(const user of excluded)this.setExcluded(tenant,user,true);const {excluded:_,...body}=value;this.saveOperation(tenant,"settings",body);});
    return this.settings(tenant);
  }
  greeting(tenant:string,invocation:string):{jobId?:string;text?:string;failed?:boolean}|undefined{return this.operation(tenant,`greeting:${invocation}`);}
  saveGreeting(tenant:string,invocation:string,body:{jobId?:string;text?:string;failed?:boolean}){this.saveOperation(tenant,`greeting:${invocation}`,body);}
  audit(tenant:string,invocation:string,status:string,metadata:Record<string,unknown>){this.saveOperation(tenant,`audit:${invocation}:${status}`,{invocationId:invocation,status,metadata,recordedAt:new Date(this.nowMs()).toISOString()});}
  auditLog(tenant:string){return this.db.prepare("SELECT body FROM streamweaver_shoutout_operations WHERE tenant_id=? AND idempotency_key LIKE 'audit:%' ORDER BY rowid DESC LIMIT 5000").all(safeId(tenant,"tenantId")).map(r=>JSON.parse(String(r.body)));}
  private saveOperation(tenant:string,key:string,body:unknown){this.db.prepare("INSERT INTO streamweaver_shoutout_operations VALUES(?,?,?) ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET body=excluded.body").run(safeId(tenant,"tenantId"),safeKey(key),JSON.stringify(body));}


  eligibility(tenantId: string, username: string, skipCooldown = false): StreamWeaverShoutoutEligibilityV1 {
    const tenant = safeId(tenantId, "tenantId");
    const user = safeLogin(username);
    const row = this.db.prepare("SELECT last_shoutout_ms,shoutout_count,excluded FROM streamweaver_shoutout_users WHERE tenant_id=? AND username=?").get(tenant,user) as { last_shoutout_ms:number|null; shoutout_count:number; excluded:number }|undefined;
    const count = row?.shoutout_count ?? 0;
    if (STREAMWEAVER_KNOWN_BOTS.has(user)) return { eligible:false, reason:"known-bot", count };
    if (row?.excluded === 1) return { eligible:false, reason:"excluded-user", count };
    if (!skipCooldown && row?.last_shoutout_ms != null) {
      const remainingMs = this.settings(tenant).cooldownMinutes*60000 - (this.nowMs() - row.last_shoutout_ms);
      if (remainingMs > 0) return { eligible:false, reason:"cooldown", remainingMs, count };
    }
    return { eligible:true, count };
  }

  record(tenantId: string, username: string, idempotencyKey: string): { count:number; duplicate:boolean; recordedAt:string } {
    const tenant=safeId(tenantId,"tenantId"); const user=safeLogin(username); const key=safeKey(idempotencyKey);
    const prior=this.operation(tenant,key); if(prior)return { count:Number(prior.count), duplicate:true, recordedAt:String(prior.recordedAt) };
    let result:{count:number;recordedAt:string}|undefined;
    this.transaction(()=>{
      const again=this.operation(tenant,key); if(again){result={count:Number(again.count),recordedAt:String(again.recordedAt)};return;}
      const current=this.db.prepare("SELECT shoutout_count FROM streamweaver_shoutout_users WHERE tenant_id=? AND username=?").get(tenant,user) as {shoutout_count:number}|undefined;
      const count=(current?.shoutout_count??0)+1; const now=this.nowMs(); const recordedAt=new Date(now).toISOString();
      this.db.prepare("INSERT INTO streamweaver_shoutout_users(tenant_id,username,last_shoutout_ms,shoutout_count,excluded) VALUES(?,?,?,?,0) ON CONFLICT(tenant_id,username) DO UPDATE SET last_shoutout_ms=excluded.last_shoutout_ms,shoutout_count=excluded.shoutout_count").run(tenant,user,now,count);
      result={count,recordedAt}; this.putOperation(tenant,key,result);
    });
    if(!result)throw new Error("Shoutout record did not complete"); return {...result,duplicate:false};
  }

  setExcluded(tenantId:string,username:string,excluded:boolean):void{
    this.db.prepare("INSERT INTO streamweaver_shoutout_users(tenant_id,username,last_shoutout_ms,shoutout_count,excluded) VALUES(?,?,NULL,0,?) ON CONFLICT(tenant_id,username) DO UPDATE SET excluded=excluded.excluded").run(safeId(tenantId,"tenantId"),safeLogin(username),excluded?1:0);
  }
  excluded(tenantId:string):string[]{ return (this.db.prepare("SELECT username FROM streamweaver_shoutout_users WHERE tenant_id=? AND excluded=1 ORDER BY username").all(safeId(tenantId,"tenantId")) as Array<{username:string}>).map(row=>row.username); }
  count(tenantId:string,username:string):number{ return (this.db.prepare("SELECT shoutout_count FROM streamweaver_shoutout_users WHERE tenant_id=? AND username=?").get(safeId(tenantId,"tenantId"),safeLogin(username)) as {shoutout_count:number}|undefined)?.shoutout_count??0; }

  private operation(tenant:string,key:string):Record<string,unknown>|undefined{ const row=this.db.prepare("SELECT body FROM streamweaver_shoutout_operations WHERE tenant_id=? AND idempotency_key=?").get(tenant,key) as {body:string}|undefined; return row?JSON.parse(row.body) as Record<string,unknown>:undefined; }
  private putOperation(tenant:string,key:string,body:unknown):void{this.db.prepare("INSERT INTO streamweaver_shoutout_operations(tenant_id,idempotency_key,body) VALUES(?,?,?)").run(tenant,key,JSON.stringify(body));}
  private transaction(work:()=>void):void{this.db.exec("BEGIN IMMEDIATE");try{work();this.db.exec("COMMIT");}catch(error){this.db.exec("ROLLBACK");throw error;}}
}
function safeId(value:unknown,field:string){const v=String(value??"").trim().replace(/[^A-Za-z0-9._:-]/g,"").slice(0,180);if(!v)throw new Error(`${field} is required`);return v;}
function safeKey(value:unknown){const v=String(value??"").trim().replace(/[^A-Za-z0-9._:-]/g,"").slice(0,240);if(!v)throw new Error("idempotencyKey is required");return v;}
function safeLogin(value:unknown){const v=String(value??"").trim().replace(/^@/,"").toLowerCase();if(!/^[a-z0-9_]{1,25}$/.test(v))throw new Error("Twitch login is invalid");return v;}
