#!/usr/bin/env node
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
import {createAsyncJsonRecordStore} from "@spmt/async-json-store/factory";
const SETTINGS="generation-settings",CATALOG="generation-model-catalog",CHECKPOINTS="generated-checkpoints",TENANTS="generation-tenants",MIGRATIONS="generation-migrations";
export function readStreamWeaverGenerationSnapshot(db){
 const integrity=db.prepare("PRAGMA integrity_check").all().map(row=>Object.values(row)[0]);if(integrity.length!==1||integrity[0]!=="ok")throw new Error("Source SQLite integrity_check failed");
 for(const table of ["sw_generation_settings","sw_generation_model_catalog","sw_generated_checkpoints"])if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error(`Source SQLite is missing ${table}`);
 const settings=db.prepare("SELECT tenant,surface,body FROM sw_generation_settings ORDER BY tenant,surface").all().map(row=>({tenant:String(row.tenant),surface:String(row.surface),body:JSON.parse(String(row.body))}));
 const catalogRow=db.prepare("SELECT body FROM sw_generation_model_catalog WHERE id=1").get(),catalog=catalogRow?JSON.parse(String(catalogRow.body)):undefined;
 const checkpoints=db.prepare("SELECT tenant,job,body FROM sw_generated_checkpoints ORDER BY tenant,job").all().map(row=>({tenant:String(row.tenant),job:String(row.job),body:JSON.parse(String(row.body))}));
 const tenants=[...new Set([...settings.map(x=>x.tenant),...checkpoints.map(x=>x.tenant)])].sort();
 const snapshot={settings,catalog,checkpoints,tenants},counts={tenants:tenants.length,settings:settings.length,catalog:catalog?1:0,checkpoints:checkpoints.length},digest=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
 return{...snapshot,counts,digest};
}
export async function importStreamWeaverGenerationSnapshot(store,snapshot,migrationId){
 return store.transaction(async tx=>{
  const prior=await tx.get(MIGRATIONS,"_index",migrationId);if(prior){if(prior.digest!==snapshot.digest)throw new Error("Migration ID already exists with a different StreamWeaver generation source digest");return{imported:false,duplicate:true,counts:snapshot.counts,digest:snapshot.digest};}
  if((await tx.list(TENANTS,"_index")).length||(await tx.list(MIGRATIONS,"_index")).length)throw new Error("Turso StreamWeaver generation namespaces are not empty");
  if(await tx.get(CATALOG,"_global","current"))throw new Error("Turso StreamWeaver generation catalog is not empty");
  for(const tenant of snapshot.tenants){if((await tx.list(SETTINGS,tenant)).length||(await tx.list(CHECKPOINTS,tenant)).length)throw new Error(`Turso StreamWeaver generation destination is not empty for ${tenant}`);}
  for(const tenant of snapshot.tenants)await tx.put(TENANTS,"_index",tenant,{tenantId:tenant});
  for(const row of snapshot.settings)await tx.put(SETTINGS,row.tenant,row.surface,row.body);
  if(snapshot.catalog)await tx.put(CATALOG,"_global","current",snapshot.catalog);
  for(const row of snapshot.checkpoints)await tx.put(CHECKPOINTS,row.tenant,row.job,row.body);
  const verified={settings:0,checkpoints:0,catalog:0};
  for(const tenant of snapshot.tenants){const settings=(await tx.list(SETTINGS,tenant)).length,checkpoints=(await tx.list(CHECKPOINTS,tenant)).length;const expectedSettings=snapshot.settings.filter(x=>x.tenant===tenant).length,expectedCheckpoints=snapshot.checkpoints.filter(x=>x.tenant===tenant).length;if(settings!==expectedSettings||checkpoints!==expectedCheckpoints)throw new Error(`StreamWeaver generation import verification failed for ${tenant}`);verified.settings+=settings;verified.checkpoints+=checkpoints;}
  const catalog=await tx.get(CATALOG,"_global","current");if(Boolean(catalog)!==Boolean(snapshot.catalog))throw new Error("StreamWeaver generation catalog import verification failed");verified.catalog=catalog?1:0;
  await tx.put(MIGRATIONS,"_index",migrationId,{digest:snapshot.digest,counts:snapshot.counts,importedAt:new Date().toISOString()});
  return{imported:true,duplicate:false,verified,digest:snapshot.digest};
 });
}
function parseArgs(argv){const out={source:"",apply:false};for(let i=0;i<argv.length;i++){if(argv[i]==="--source")out.source=argv[++i]??"";else if(argv[i]==="--apply")out.apply=true;else throw new Error(`Unknown argument: ${argv[i]}`);}if(!out.source)throw new Error("Use --source /absolute/path/to/streamweaver.sqlite");return out;}
async function main(){const args=parseArgs(process.argv.slice(2)),source=resolve(args.source),db=new DatabaseSync(source,{readOnly:true});let snapshot;try{snapshot=readStreamWeaverGenerationSnapshot(db);}finally{db.close();}const report={source,mode:args.apply?"apply":"dry-run",counts:snapshot.counts,digest:snapshot.digest};if(args.apply){const url=process.env.STREAMWEAVER_TURSO_DATABASE_URL,authToken=process.env.STREAMWEAVER_TURSO_AUTH_TOKEN;if(!url||!authToken)throw new Error("Apply requires STREAMWEAVER_TURSO_DATABASE_URL and STREAMWEAVER_TURSO_AUTH_TOKEN");const store=createAsyncJsonRecordStore({service:"streamweaver",mode:"turso",url,authToken});try{await store.initialize();report.result=await importStreamWeaverGenerationSnapshot(store,snapshot,`sqlite-streamweaver-generation-v1:${snapshot.digest}`);}finally{await store.close();}}else report.nextStep="Review counts and digest; rerun with --apply only against the intended empty StreamWeaver Turso namespaces.";process.stdout.write(JSON.stringify(report,null,2)+"\n");}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)main().catch(error=>{process.stderr.write(`StreamWeaver generation migration failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
