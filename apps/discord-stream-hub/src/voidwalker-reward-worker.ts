import { DatabaseSync } from "node:sqlite";
import type { SpmtClient } from "@spmt/sdk";
import { listCommunityIdentities } from "@spmt/sdk/provider-identity";
import type { DshDiscordApi } from "./discord-live-publisher.js";

const COMPLETED = "ecosystem.easter-eggs.completed.v1";
const DELIVERED = "ecosystem.easter-eggs.discord-reward-delivered.v1";
const TITLE = "Voidwalker";
type Tenant = { tenantId: string; discordGuildIds?: string[] };
type Event = { sourceAppId?: string; type?: string; payload?: Record<string, unknown> };

export class SqliteDshVoidwalkerRewardStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS dsh_voidwalker_roles (tenant_id TEXT NOT NULL,guild_id TEXT NOT NULL,role_id TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,guild_id)) STRICT;`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS dsh_voidwalker_rewards (
      tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL, role_id TEXT, delivered_at TEXT,
      last_error TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id,user_id,guild_id)
    ) STRICT;`);
  }
  close() { this.db.close(); }
  roleId(tenantId:string,guildId:string) {
    return (this.db.prepare("SELECT role_id AS roleId FROM dsh_voidwalker_roles WHERE tenant_id=? AND guild_id=?").get(tenantId,guildId) as {roleId:string}|undefined)?.roleId;
  }
  rememberRole(tenantId:string,guildId:string,roleId:string,now:string) {
    this.db.prepare("INSERT INTO dsh_voidwalker_roles(tenant_id,guild_id,role_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,guild_id) DO UPDATE SET role_id=excluded.role_id,updated_at=excluded.updated_at").run(tenantId,guildId,roleId,now);
  }
  delivered(tenantId:string,userId:string,guildId:string) {
    return Boolean(this.db.prepare("SELECT 1 FROM dsh_voidwalker_rewards WHERE tenant_id=? AND user_id=? AND guild_id=? AND delivered_at IS NOT NULL").get(tenantId,userId,guildId));
  }
  success(v:{tenantId:string;userId:string;guildId:string;discordUserId:string;roleId:string;now:string}) {
    this.db.prepare(`INSERT INTO dsh_voidwalker_rewards(tenant_id,user_id,guild_id,discord_user_id,role_id,delivered_at,last_error,updated_at)
      VALUES(?,?,?,?,?,?,NULL,?) ON CONFLICT(tenant_id,user_id,guild_id) DO UPDATE SET discord_user_id=excluded.discord_user_id,role_id=excluded.role_id,delivered_at=excluded.delivered_at,last_error=NULL,updated_at=excluded.updated_at`)
      .run(v.tenantId,v.userId,v.guildId,v.discordUserId,v.roleId,v.now,v.now);
  }
  failure(v:{tenantId:string;userId:string;guildId:string;discordUserId:string;error:string;now:string}) {
    this.db.prepare(`INSERT INTO dsh_voidwalker_rewards(tenant_id,user_id,guild_id,discord_user_id,last_error,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,user_id,guild_id) DO UPDATE SET discord_user_id=excluded.discord_user_id,last_error=excluded.last_error,updated_at=excluded.updated_at`)
      .run(v.tenantId,v.userId,v.guildId,v.discordUserId,v.error.slice(0,300),v.now);
  }
}

/** SPMT achievement events determine eligibility; Discord mutations use scoped provider grants. */
export class DshVoidwalkerRewardWorker {
  private running = false;
  private timer: ReturnType<typeof setInterval>|undefined;
  constructor(private readonly client:SpmtClient,private readonly discord:DshDiscordApi,private readonly store:SqliteDshVoidwalkerRewardStore,private readonly tenants:Tenant[],private readonly now=()=>new Date().toISOString(),private readonly readOnly=false) {}
  start() { if(this.timer||this.readOnly)return; void this.drain(); this.timer=setInterval(()=>{void this.drain();},30_000); this.timer.unref?.(); }
  close() { if(this.timer)clearInterval(this.timer); this.timer=undefined; this.store.close(); }
  async drain() {
    if(this.running||this.readOnly)return;
    this.running=true;
    try { for(const tenant of this.tenants) await this.drainTenant(tenant); }
    finally { this.running=false; }
  }
  private async drainTenant(tenant:Tenant) {
    const events=await this.client.listEvents(tenant.tenantId,{type:COMPLETED,limit:200}) as Event[];
    const members:Awaited<ReturnType<typeof listCommunityIdentities>>["members"]=[];
    let after="";
    for(let page=0;page<20;page++){const result=await listCommunityIdentities(this.client,tenant.tenantId,after);members.push(...result.members);if(!result.nextAfterUserId)break;after=result.nextAfterUserId;}
    const byUser=new Map(members.map(member=>[member.userId,member]));
    const receipts=await this.client.listEvents(tenant.tenantId,{type:DELIVERED,limit:200}) as Event[];
    const confirmed=new Set(receipts.map(event=>String(event.payload?.userId||"")));
    for(const event of events){
      const userId=String(event.payload?.userId||event.sourceAppId||"").trim();
      if(!userId||confirmed.has(userId))continue;
      const discordId=byUser.get(userId)?.providers.find(provider=>provider.provider==="discord")?.providerUserId;
      if(!discordId)continue;
      const guildIds=tenant.discordGuildIds??[];
      let complete=guildIds.length>0;
      for(const guildId of guildIds){
        if(this.store.delivered(tenant.tenantId,userId,guildId))continue;
        try{
          const roleId=await this.ensureRole(tenant.tenantId,guildId);
          const member=await this.discord.getGuildMember(tenant.tenantId,guildId,discordId);
          if(!Array.isArray(member?.roles))throw new Error("Discord member roles are unavailable");
          if(!member.roles.includes(roleId))await this.discord.addGuildMemberRole(tenant.tenantId,guildId,discordId,roleId);
          const roles=await this.discord.listGuildRoles(tenant.tenantId,guildId);
          if(!Array.isArray(roles))throw new Error("Discord guild roles are unavailable");
          for(const role of roles)if(role.id!==roleId&&member.roles.includes(role.id)&&["signal seeker","signal hunter"].includes(role.name.toLowerCase()))await this.discord.removeGuildMemberRole(tenant.tenantId,guildId,discordId,role.id);
          this.store.success({tenantId:tenant.tenantId,userId,guildId,discordUserId:discordId,roleId,now:this.now()});
        }catch(error){complete=false;this.store.failure({tenantId:tenant.tenantId,userId,guildId,discordUserId:discordId,error:error instanceof Error?error.message:"Discord reward delivery failed",now:this.now()});}
      }
      if(complete){await this.client.publishEvent(tenant.tenantId,DELIVERED,{schemaVersion:1,userId,reward:TITLE,discordUserId:discordId,deliveredAt:this.now()},`voidwalker-delivered:${userId}`);confirmed.add(userId);}
    }
  }
  private async ensureRole(tenantId:string,guildId:string) {
    const cached=this.store.roleId(tenantId,guildId);
    const roles=await this.discord.listGuildRoles(tenantId,guildId);
    if(!Array.isArray(roles))throw new Error("Discord guild roles are unavailable");
    const existing=roles.find(role=>role.id===cached)||roles.find(role=>role.name.toLowerCase()===TITLE.toLowerCase());
    if(existing?.managed)throw new Error("Voidwalker role is managed by another integration");
    const role=existing||await this.discord.createGuildRole(tenantId,guildId,{name:TITLE,color:0x8b5cf6,permissions:"0",mentionable:false,hoist:false});
    if(!role?.id)throw new Error("Discord did not confirm the Voidwalker role");
    this.store.rememberRole(tenantId,guildId,role.id,this.now());
    return role.id;
  }
}
