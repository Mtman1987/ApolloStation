import { DatabaseSync } from "node:sqlite";

export type StreamWeaverSocialReactionRecord = {
  tenantId:string; deliveryId:string; trigger:string; actor:string; target:string; animationKey:string;
  jobId?:string; reaction?:string; state:"pending"|"waiting"|"ready"|"failed"; attempts:number; createdAt:string;
};

export class SqliteStreamWeaverSocialReactionStore {
  private readonly db:DatabaseSync;
  constructor(path:string, private readonly now:()=>string=()=>new Date().toISOString()) {
    this.db=new DatabaseSync(path,{timeout:5000});
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS streamweaver_social_reactions(
      tenant_id TEXT NOT NULL,delivery_id TEXT NOT NULL,trigger TEXT NOT NULL,actor TEXT NOT NULL,target TEXT NOT NULL,
      animation_key TEXT NOT NULL,job_id TEXT,reaction TEXT,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,PRIMARY KEY(tenant_id,delivery_id)
    ) STRICT;`);
  }
  close(){this.db.close();}
  enqueue(input:{tenantId:string;deliveryId:string;trigger:string;actor:string;target?:string;animationKey:string}) {
    this.db.prepare(`INSERT OR IGNORE INTO streamweaver_social_reactions
      (tenant_id,delivery_id,trigger,actor,target,animation_key,state,attempts,created_at)
      VALUES(?,?,?,?,?,?, 'pending',0,?)`).run(input.tenantId,input.deliveryId,input.trigger,input.actor,input.target??"",input.animationKey,this.now());
  }
  pending(limit=100):StreamWeaverSocialReactionRecord[] {
    return (this.db.prepare(`SELECT tenant_id tenantId,delivery_id deliveryId,trigger,actor,target,animation_key animationKey,
      job_id jobId,reaction,state,attempts,created_at createdAt FROM streamweaver_social_reactions
      WHERE state IN ('pending','waiting') ORDER BY rowid LIMIT ?`).all(limit) as any[]).map(row=>({...row,attempts:Number(row.attempts)}));
  }
  setJob(tenantId:string,deliveryId:string,jobId:string,attempts:number){
    this.db.prepare("UPDATE streamweaver_social_reactions SET job_id=?,state='waiting',attempts=? WHERE tenant_id=? AND delivery_id=?").run(jobId,attempts,tenantId,deliveryId);
  }
  retry(tenantId:string,deliveryId:string){
    this.db.prepare("UPDATE streamweaver_social_reactions SET job_id=NULL,state='pending' WHERE tenant_id=? AND delivery_id=?").run(tenantId,deliveryId);
  }
  complete(tenantId:string,deliveryId:string,reaction:string,state:"ready"|"failed"="ready"){
    this.db.prepare("UPDATE streamweaver_social_reactions SET reaction=?,state=? WHERE tenant_id=? AND delivery_id=?").run(reaction,state,tenantId,deliveryId);
  }
  recent(tenantId:string,limit=40):string[]{
    return (this.db.prepare("SELECT reaction FROM streamweaver_social_reactions WHERE tenant_id=? AND reaction IS NOT NULL ORDER BY rowid DESC LIMIT ?").all(tenantId,limit) as Array<{reaction:string}>).map(row=>row.reaction);
  }
  count(tenantId:string):number{
    const row=this.db.prepare("SELECT COUNT(*) n FROM streamweaver_social_reactions WHERE tenant_id=? AND reaction IS NOT NULL").get(tenantId) as {n:number};
    return Number(row?.n||0);
  }
}
