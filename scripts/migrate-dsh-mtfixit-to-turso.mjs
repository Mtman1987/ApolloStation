#!/usr/bin/env node
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
import {createAsyncJsonRecordStore} from "@spmt/async-json-store/factory";
const RECORDS="mtfixit-reports",TENANTS="mtfixit-report-tenants",MIGRATIONS="mtfixit-migrations";
export function readDshMtFixItSnapshot(db){
 const integrity=db.prepare("PRAGMA integrity_check").all().map(row=>Object.values(row)[0]);
 if(integrity.length!==1||integrity[0]!=="ok")throw new Error("Source SQLite integrity_check failed");
 const exists=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dsh_mtfixit_reports'").get());
 if(!exists)throw new Error("Source SQLite is missing dsh_mtfixit_reports");
 const rows=db.prepare("SELECT tenant,event_id,job_id,channel_id,message_id,reporter,description,owner_notified,reply_sent,created_at FROM dsh_mtfixit_reports ORDER BY tenant,event_id").all();
 const reports=rows.map(row=>({tenant:String(row.tenant),key:String(row.event_id),value:{tenant:String(row.tenant),eventId:String(row.event_id),jobId:String(row.job_id),channelId:String(row.channel_id),messageId:String(row.message_id),reporter:String(row.reporter),description:String(row.description),ownerNotified:Number(row.owner_notified)===1,replySent:Number(row.reply_sent)===1,createdAt:String(row.created_at)}}));
 const snapshot={reports,tenants:[...new Set(reports.map(row=>row.tenant))].sort()},digest=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
 return{...snapshot,counts:{reports:reports.length,tenants:snapshot.tenants.length},digest};
}
export async function importDshMtFixItSnapshot(store,snapshot,migrationId){
 return store.transaction(async tx=>{
  const prior=await tx.get(MIGRATIONS,"_index",migrationId);
  if(prior){if(prior.digest!==snapshot.digest)throw new Error("Migration ID already exists with a different MtFixIt source digest");return{imported:false,duplicate:true,counts:snapshot.counts,digest:snapshot.digest};}
  if((await tx.list(MIGRATIONS,"_index")).length)throw new Error("Turso MtFixIt migration receipts are not empty");
  if((await tx.list(TENANTS,"_index")).length)throw new Error("Turso MtFixIt destination tenant index is not empty");
  for(const tenant of snapshot.tenants){await tx.put(TENANTS,"_index",tenant,{tenantId:tenant});for(const row of snapshot.reports.filter(item=>item.tenant===tenant))await tx.put(RECORDS,tenant,row.key,row.value);}
  const verified={};
  for(const tenant of snapshot.tenants){const expected=snapshot.reports.filter(row=>row.tenant===tenant).length,actual=(await tx.list(RECORDS,tenant)).length;if(actual!==expected)throw new Error(`MtFixIt import verification failed for ${tenant}: expected ${expected}, received ${actual}`);verified[tenant]=actual;}
  await tx.put(MIGRATIONS,"_index",migrationId,{digest:snapshot.digest,counts:snapshot.counts,importedAt:new Date().toISOString()});
  return{imported:true,duplicate:false,verified,digest:snapshot.digest};
 });
}
function parseArgs(argv){const out={source:"",apply:false};for(let i=0;i<argv.length;i++){if(argv[i]==="--source")out.source=argv[++i]??"";else if(argv[i]==="--apply")out.apply=true;else throw new Error(`Unknown argument: ${argv[i]}`);}if(!out.source)throw new Error("Use --source /absolute/path/to/discord-stream-hub.sqlite");return out;}
async function main(){const args=parseArgs(process.argv.slice(2)),source=resolve(args.source),db=new DatabaseSync(source,{readOnly:true});let snapshot;try{snapshot=readDshMtFixItSnapshot(db);}finally{db.close();}const report={source,mode:args.apply?"apply":"dry-run",counts:snapshot.counts,digest:snapshot.digest};if(args.apply){const url=process.env.DSH_TURSO_DATABASE_URL,authToken=process.env.DSH_TURSO_AUTH_TOKEN;if(!url||!authToken)throw new Error("Apply requires DSH_TURSO_DATABASE_URL and DSH_TURSO_AUTH_TOKEN");const store=createAsyncJsonRecordStore({service:"discord-stream-hub",mode:"turso",url,authToken});try{await store.initialize();report.result=await importDshMtFixItSnapshot(store,snapshot,`sqlite-mtfixit-v1:${snapshot.digest}`);}finally{await store.close();}}else report.nextStep="Review counts and digest; rerun with --apply only against the intended empty DSH Turso namespace.";process.stdout.write(JSON.stringify(report,null,2)+"\n");}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)main().catch(error=>{process.stderr.write(`DSH MtFixIt migration failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
