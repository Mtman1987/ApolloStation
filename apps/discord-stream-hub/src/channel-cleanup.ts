import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { DshChannelModerationService,type DshNukeRequestV1,type DshModeratorRoleV1 } from './channel-moderation.js';
interface CleanupPlan {id:string;tenantId:string;actorUserId:string;request:DshNukeRequestV1;createdAt:string;ids:string[];remaining:string[];errors:string[];}
export class DshChannelCleanup {
  private readonly db:DatabaseSync;
  constructor(path:string,private readonly moderation?:DshChannelModerationService){this.db=new DatabaseSync(path,{timeout:5000});this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS dsh_channel_cleanup(tenant TEXT NOT NULL,id TEXT NOT NULL,operation TEXT NOT NULL,signature TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,id),UNIQUE(tenant,operation)) STRICT;
    CREATE TABLE IF NOT EXISTS dsh_channel_cleanup_leases(tenant TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(tenant,id)) STRICT;`);}
  close(){this.db.close();}
  async preview(request:DshNukeRequestV1,actorUserId:string,operation:string,progress?:()=>Promise<void>){
    this.authorize(request.actorRole);const signature=JSON.stringify([request,actorUserId]);
    const prior=this.db.prepare('SELECT body,signature FROM dsh_channel_cleanup WHERE tenant=? AND operation=?').get(request.tenantId,operation) as {body:string;signature:string}|undefined;
    if(prior){if(prior.signature!==signature)throw Error('This cleanup preview receipt belongs to another selection');return view(JSON.parse(prior.body));}
    const {ids}=await this.requireModeration().preview(request,progress),plan:CleanupPlan={id:randomUUID(),tenantId:request.tenantId,actorUserId,request,createdAt:new Date().toISOString(),ids,remaining:ids,errors:[]};
    this.db.prepare('INSERT INTO dsh_channel_cleanup VALUES(?,?,?,?,?) ON CONFLICT(tenant,operation) DO NOTHING').run(request.tenantId,plan.id,operation,signature,JSON.stringify(plan));
    const saved=this.db.prepare('SELECT body,signature FROM dsh_channel_cleanup WHERE tenant=? AND operation=?').get(request.tenantId,operation) as {body:string;signature:string};if(saved.signature!==signature)throw Error('This cleanup preview receipt belongs to another selection');return view(JSON.parse(saved.body));
  }
  list(tenant:string,actorUserId:string,role:DshModeratorRoleV1){this.authorize(role);return (this.db.prepare('SELECT body FROM dsh_channel_cleanup WHERE tenant=? ORDER BY rowid DESC LIMIT 25').all(tenant) as {body:string}[]).map(row=>JSON.parse(row.body) as CleanupPlan).filter(plan=>plan.actorUserId===actorUserId||role==='owner').map(view);}
  async execute(tenant:string,id:string,actorUserId:string,role:DshModeratorRoleV1,allowedGuilds:readonly string[],progress:()=>Promise<void>=async()=>{}) {
    this.authorize(role);const plan=this.get(tenant,id);if(!plan)throw Error('Cleanup preview was not found');
    if(plan.actorUserId!==actorUserId&&role!=='owner')throw Error('This cleanup preview belongs to another moderator');
    if(!allowedGuilds.includes(plan.request.guildId))throw Error('This Discord server is no longer configured for this tenant');
    const owner=randomUUID();if(!this.db.prepare('INSERT INTO dsh_channel_cleanup_leases VALUES(?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires<?').run(tenant,id,owner,Date.now()+120000,Date.now()).changes)throw Error('This cleanup selection is already running');
    const check=async()=>{await progress();if(!this.db.prepare('UPDATE dsh_channel_cleanup_leases SET expires=? WHERE tenant=? AND id=? AND owner=? AND expires>?').run(Date.now()+120000,tenant,id,owner,Date.now()).changes)throw Error('Cleanup execution lease expired');};
    try {
      const current=this.get(tenant,id)!;current.errors=[];
      for(let offset=0;offset<current.remaining.length;){
        await check();const ids=current.remaining.slice(offset,offset+100),result=await this.requireModeration().executeSelected({...current.request,actorRole:role},ids,check),done=new Set(result.deletedIds);
        current.remaining=current.remaining.filter(messageId=>!done.has(messageId));current.errors.push(...result.log.slice(0,5));current.errors=current.errors.slice(-20);
        this.db.prepare('UPDATE dsh_channel_cleanup SET body=? WHERE tenant=? AND id=?').run(JSON.stringify(current),tenant,id);
        offset+=result.failedIds.length;
      }
      return view(current);
    }finally{this.db.prepare('DELETE FROM dsh_channel_cleanup_leases WHERE tenant=? AND id=? AND owner=?').run(tenant,id,owner);}
  }
  private requireModeration(){if(!this.moderation)throw Error("Connect Discord before running channel cleanup");return this.moderation;}
  private get(tenant:string,id:string):CleanupPlan|undefined{const row=this.db.prepare('SELECT body FROM dsh_channel_cleanup WHERE tenant=? AND id=?').get(tenant,id) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;}
  private authorize(role:DshModeratorRoleV1){if(role!=='owner'&&role!=='admin')throw Error('DSH admin or owner access is required for channel cleanup');}
}
function view(plan:CleanupPlan){return {id:plan.id,tenantId:plan.tenantId,actorUserId:plan.actorUserId,guildId:plan.request.guildId,channelId:plan.request.channelId,mode:plan.request.mode,untilMessageId:plan.request.untilMessageId,createdAt:plan.createdAt,selected:plan.ids.length,deleted:plan.ids.length-plan.remaining.length,remaining:plan.remaining.length,errors:plan.errors,sampleMessageIds:plan.ids.slice(0,5)};}
