import { DatabaseSync } from "node:sqlite";
import type { CompanionWorkflowJobV1, CompanionWorkflowStoreV1 } from "./workflow-jobs.js";

export interface CompanionWorkflowClaimV1 { jobId:string; claimantId:string; claimedAt:string; leaseUntil:string }

export class SqliteCompanionWorkflowStore implements CompanionWorkflowStoreV1 {
  private readonly db:DatabaseSync;
  constructor(path:string){if(!path)throw new Error("Companion workflow database path is required");this.db=new DatabaseSync(path,{timeout:5_000});this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS companion_workflow_jobs(job_id TEXT PRIMARY KEY,created_at TEXT NOT NULL,body TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS companion_workflow_claims(job_id TEXT PRIMARY KEY,claimant_id TEXT NOT NULL,claimed_at TEXT NOT NULL,lease_until TEXT NOT NULL) STRICT;`);}
  close(){this.db.close();}
  list():CompanionWorkflowJobV1[]{const rows=this.db.prepare("SELECT body FROM companion_workflow_jobs ORDER BY created_at,job_id LIMIT 200").all() as {body:string}[];return rows.map((row)=>structuredClone(JSON.parse(row.body) as CompanionWorkflowJobV1));}
  put(job:CompanionWorkflowJobV1){validateJob(job);this.db.prepare("INSERT INTO companion_workflow_jobs(job_id,created_at,body) VALUES(?,?,?) ON CONFLICT(job_id) DO UPDATE SET created_at=excluded.created_at,body=excluded.body").run(job.id,job.createdAt,JSON.stringify(job));}
  get(jobId:string){const row=this.db.prepare("SELECT body FROM companion_workflow_jobs WHERE job_id=?").get(cleanId(jobId,"jobId")) as {body:string}|undefined;return row?structuredClone(JSON.parse(row.body) as CompanionWorkflowJobV1):undefined;}
  claim(jobIdValue:string,claimantIdValue:string,input:{now?:string;leaseMs?:number}={}):CompanionWorkflowClaimV1{
    const jobId=cleanId(jobIdValue,"jobId"),claimantId=cleanId(claimantIdValue,"claimantId"),job=this.get(jobId);if(!job)throw new Error("Companion workflow job was not found");if(!["approved","running","waiting_for_renderer"].includes(job.status))throw new Error("Companion workflow job is not claimable");const now=timestamp(input.now??new Date().toISOString()),leaseMs=Math.max(1_000,Math.min(10*60_000,Math.trunc(input.leaseMs??60_000))),leaseUntil=new Date(Date.parse(now)+leaseMs).toISOString();
    const existing=this.db.prepare("SELECT claimant_id,claimed_at,lease_until FROM companion_workflow_claims WHERE job_id=?").get(jobId) as {claimant_id:string;claimed_at:string;lease_until:string}|undefined;if(existing&&Date.parse(existing.lease_until)>Date.parse(now)&&existing.claimant_id!==claimantId)throw new Error("Companion workflow job is already claimed");const claim={jobId,claimantId,claimedAt:existing?.claimant_id===claimantId?existing.claimed_at:now,leaseUntil};this.db.prepare("INSERT INTO companion_workflow_claims(job_id,claimant_id,claimed_at,lease_until) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET claimant_id=excluded.claimant_id,claimed_at=excluded.claimed_at,lease_until=excluded.lease_until").run(jobId,claimantId,claim.claimedAt,leaseUntil);return claim;
  }
  renew(jobIdValue:string,claimantIdValue:string,input:{now?:string;leaseMs?:number}={}){const jobId=cleanId(jobIdValue,"jobId"),claimantId=cleanId(claimantIdValue,"claimantId"),now=timestamp(input.now??new Date().toISOString()),row=this.db.prepare("SELECT claimant_id,claimed_at,lease_until FROM companion_workflow_claims WHERE job_id=?").get(jobId) as {claimant_id:string;claimed_at:string;lease_until:string}|undefined;if(!row||row.claimant_id!==claimantId||Date.parse(row.lease_until)<=Date.parse(now))throw new Error("Companion workflow claim is not active");return this.claim(jobId,claimantId,{now,leaseMs:input.leaseMs});}
  release(jobIdValue:string,claimantIdValue:string){const result=this.db.prepare("DELETE FROM companion_workflow_claims WHERE job_id=? AND claimant_id=?").run(cleanId(jobIdValue,"jobId"),cleanId(claimantIdValue,"claimantId"));return Number(result.changes)>0;}
  claimStatus(jobIdValue:string,nowValue=new Date().toISOString()){const jobId=cleanId(jobIdValue,"jobId"),now=timestamp(nowValue),row=this.db.prepare("SELECT claimant_id,claimed_at,lease_until FROM companion_workflow_claims WHERE job_id=?").get(jobId) as {claimant_id:string;claimed_at:string;lease_until:string}|undefined;if(!row||Date.parse(row.lease_until)<=Date.parse(now))return null;return{jobId,claimantId:row.claimant_id,claimedAt:row.claimed_at,leaseUntil:row.lease_until};}
}

export class CompanionWorkflowClaimCoordinator {
  constructor(private readonly store:SqliteCompanionWorkflowStore,private readonly claimantId:string,private readonly options:{leaseMs?:number;now?:()=>string}={}){cleanId(claimantId,"claimantId");}
  claim(jobId:string){return this.store.claim(jobId,this.claimantId,{now:this.now(),leaseMs:this.options.leaseMs});}
  heartbeat(jobId:string){return this.store.renew(jobId,this.claimantId,{now:this.now(),leaseMs:this.options.leaseMs});}
  release(jobId:string){return this.store.release(jobId,this.claimantId);}
  private now(){return this.options.now?.()??new Date().toISOString();}
}
function validateJob(job:CompanionWorkflowJobV1){cleanId(job.id,"job.id");timestamp(job.createdAt);timestamp(job.updatedAt);}
function cleanId(value:string,name:string){const clean=String(value??"").trim();if(!clean||clean.length>180||/[\r\n\0]/.test(clean))throw new Error(`${name} is invalid`);return clean;}
function timestamp(value:string){const parsed=Date.parse(value);if(!Number.isFinite(parsed))throw new Error("Companion workflow timestamp is invalid");return new Date(parsed).toISOString();}
