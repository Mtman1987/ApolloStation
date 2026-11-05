#!/usr/bin/env node
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";

const RECORDS="bot-action-replies",TENANTS="bot-action-reply-tenants",MIGRATIONS="bot-action-reply-migrations";
export function readStreamWeaverBotActionReplySnapshot(db){
 const integrity=db.prepare("PRAGMA integrity_check").all().map(row=>Object.values(row)[0]);
 if(integrity.length!==1||integrity[0]!=="ok")throw new Error("Source SQLite integrity_check failed");
 const exists=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='streamweaver_bot_action_replies'").get());
 const rows=exists?db.prepare("SELECT tenant_id,request_id,body,acknowledged,done,next_attempt FROM streamweaver_bot_action_replies ORDER BY tenant_id,request_id").all():[];
 const receipts=rows.map(row=>({tenantId:String(row.tenant_id),key:String(row.request_id),value:{...JSON.parse(String(row.body)),acknowledged:Number(row.acknowledged)===1,done:Number(row.done)===1,nextAttempt:Number(row.next_attempt)}}));
 const tenants=[...new Set(receipts.map(row=>row.tenantId))].sort(),snapshot={receipts,tenants};
 const digest=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
 return{...snapshot,counts:{receipts:receipts.length,tenants:tenants.length},digest};
}
export async function importStreamWeaverBotActionReplySnapshot(store,snapshot,migrationId){
 return store.transaction(async tx=>{
  const prior=await tx.get(MIGRATIONS,"_index",migrationId);
  if(prior){if(prior.digest!==snapshot.digest)throw new Error("Migration ID already exists with a different bot-action-reply source digest");return{imported:false,duplicate:true,counts:snapshot.counts,digest:snapshot.digest};}
  if((await tx.list(TENANTS,"_index")).length||(await tx.list(MIGRATIONS,"_index")).length)throw new Error("Turso bot-action-reply namespaces are not empty");
  for(const tenantId of snapshot.tenants)if((await tx.list(RECORDS,tenantId)).length)throw new Error(`Turso destination is not empty for bot action replies / ${tenantId}`);
  for(const tenantId of snapshot.tenants)await tx.put(TENANTS,"_index",tenantId,{tenantId});
  for(const row of snapshot.receipts)await tx.put(RECORDS,row.tenantId,row.key,row.value);
  const verified={};
  for(const tenantId of snapshot.tenants){const expected=snapshot.receipts.filter(row=>row.tenantId===tenantId).length,actual=(await tx.list(RECORDS,tenantId)).length;if(actual!==expected)throw new Error(`Bot action reply import verification failed for ${tenantId}: expected ${expected}, received ${actual}`);verified[tenantId]=actual;}
  await tx.put(MIGRATIONS,"_index",migrationId,{digest:snapshot.digest,counts:snapshot.counts,importedAt:new Date().toISOString()});
  return{imported:true,duplicate:false,verified,digest:snapshot.digest};
 });
}
function args(argv){const out={source:"",apply:false};for(let i=0;i<argv.length;i++){if(argv[i]==="--source")out.source=argv[++i]??"";else if(argv[i]==="--apply")out.apply=true;else throw new Error(`Unknown argument: ${argv[i]}`);}if(!out.source)throw new Error("Use --source /absolute/path/to/streamweaver.sqlite");return out;}
async function main(){
 const options=args(process.argv.slice(2)),source=resolve(options.source),db=new DatabaseSync(source,{readOnly:true});let snapshot;
 try{snapshot=readStreamWeaverBotActionReplySnapshot(db);}finally{db.close();}
 const report={source,mode:options.apply?"apply":"dry-run",counts:snapshot.counts,digest:snapshot.digest};
 if(options.apply){const url=process.env.STREAMWEAVER_TURSO_DATABASE_URL,authToken=process.env.STREAMWEAVER_TURSO_AUTH_TOKEN;if(!url||!authToken)throw new Error("Apply requires STREAMWEAVER_TURSO_DATABASE_URL and STREAMWEAVER_TURSO_AUTH_TOKEN");const store=createAsyncJsonRecordStore({service:"streamweaver",mode:"turso",url,authToken});try{await store.initialize();report.result=await importStreamWeaverBotActionReplySnapshot(store,snapshot,`sqlite-bot-action-replies-v1:${snapshot.digest}`);}finally{await store.close();}}
 else report.nextStep="Review counts and digest; rerun with --apply only against the intended empty StreamWeaver Turso namespaces.";
 process.stdout.write(JSON.stringify(report,null,2)+"\n");
}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)main().catch(error=>{process.stderr.write(`StreamWeaver bot-action-reply migration failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
