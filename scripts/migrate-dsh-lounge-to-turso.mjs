#!/usr/bin/env node
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
import {createAsyncJsonRecordStore} from "@spmt/async-json-store/factory";
const MIGRATIONS="lounge-migrations";
const TABLES=[["dsh_lounge_state","lounge-state","body"],["dsh_lounge_host","lounge-host","body"],["dsh_lounge_avatar","lounge-avatar","body"]];
export function readDshLoungeSnapshot(db){
 const integrity=db.prepare("PRAGMA integrity_check").all().map(row=>Object.values(row)[0]);
 if(integrity.length!==1||integrity[0]!=="ok")throw new Error("Source SQLite integrity_check failed");
 const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 if(!exists("dsh_rendered_media"))throw new Error("Source SQLite is missing the DSH media marker table");
 const records=[];
 for(const [table,namespace,column] of TABLES)if(exists(table)){
  const rows=db.prepare(`SELECT tenant_id,${column} AS body${table==="dsh_lounge_avatar"?",updated_at":""} FROM ${table} ORDER BY tenant_id`).all();
  for(const row of rows)records.push({namespace,tenant:String(row.tenant_id),key:table==="dsh_lounge_avatar"?"manifest":"current",value:JSON.parse(String(row.body))});
 }
 if(exists("dsh_lounge_broadcast"))for(const row of db.prepare("SELECT tenant_id,started_at,target_hours FROM dsh_lounge_broadcast ORDER BY tenant_id").all())records.push({namespace:"lounge-broadcast",tenant:String(row.tenant_id),key:"current",value:{startedAt:String(row.started_at),targetHours:Number(row.target_hours)}});
 const tenants=[...new Set(records.map(row=>row.tenant))].sort(),snapshot={records,tenants};
 const digest=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
 return{...snapshot,counts:{records:records.length,tenants:tenants.length,byNamespace:Object.fromEntries([...new Set(records.map(row=>row.namespace))].sort().map(ns=>[ns,records.filter(row=>row.namespace===ns).length]))},digest};
}
export async function importDshLoungeSnapshot(store,snapshot,migrationId){
 return store.transaction(async tx=>{
  const prior=await tx.get(MIGRATIONS,"_index",migrationId);
  if(prior){if(prior.digest!==snapshot.digest)throw new Error("Migration ID already exists with a different DSH Lounge source digest");return{imported:false,duplicate:true,counts:snapshot.counts,digest:snapshot.digest};}
  if((await tx.list(MIGRATIONS,"_index")).length)throw new Error("Turso DSH Lounge migration receipts are not empty");
  for(const namespace of ["lounge-state","lounge-host","lounge-avatar","lounge-broadcast"])if((await tx.list(namespace,"_index")).length)throw new Error(`Turso DSH Lounge namespace ${namespace} is not empty`);
  for(const tenant of snapshot.tenants)for(const namespace of ["lounge-state","lounge-host","lounge-avatar","lounge-broadcast"])if(await tx.get(namespace,tenant,namespace==="lounge-avatar"?"manifest":"current"))throw new Error(`Turso DSH Lounge destination is not empty for ${namespace}/${tenant}`);
  for(const row of snapshot.records)await tx.put(row.namespace,row.tenant,row.key,row.value);
  const verified={};
  for(const tenant of snapshot.tenants)for(const namespace of ["lounge-state","lounge-host","lounge-avatar","lounge-broadcast"]){const expected=snapshot.records.filter(row=>row.tenant===tenant&&row.namespace===namespace).length,actual=await tx.get(namespace,tenant,namespace==="lounge-avatar"?"manifest":"current")?1:0;if(actual!==expected)throw new Error(`DSH Lounge verification failed for ${namespace}/${tenant}`);if(expected)verified[`${namespace}:${tenant}`]=actual;}
  await tx.put(MIGRATIONS,"_index",migrationId,{digest:snapshot.digest,counts:snapshot.counts,importedAt:new Date().toISOString()});
  return{imported:true,duplicate:false,verified,digest:snapshot.digest};
 });
}
function parseArgs(argv){const out={source:"",apply:false};for(let i=0;i<argv.length;i++){if(argv[i]==="--source")out.source=argv[++i]??"";else if(argv[i]==="--apply")out.apply=true;else throw new Error(`Unknown argument: ${argv[i]}`);}if(!out.source)throw new Error("Use --source /absolute/path/to/discord-stream-hub.sqlite");return out;}
async function main(){const args=parseArgs(process.argv.slice(2)),source=resolve(args.source),db=new DatabaseSync(source,{readOnly:true});let snapshot;try{snapshot=readDshLoungeSnapshot(db);}finally{db.close();}const report={source,mode:args.apply?"apply":"dry-run",counts:snapshot.counts,digest:snapshot.digest};if(args.apply){const url=process.env.DSH_TURSO_DATABASE_URL,authToken=process.env.DSH_TURSO_AUTH_TOKEN;if(!url||!authToken)throw new Error("Apply requires DSH_TURSO_DATABASE_URL and DSH_TURSO_AUTH_TOKEN");const store=createAsyncJsonRecordStore({service:"discord-stream-hub",mode:"turso",url,authToken});try{await store.initialize();report.result=await importDshLoungeSnapshot(store,snapshot,`sqlite-dsh-lounge-v1:${snapshot.digest}`);}finally{await store.close();}}else report.nextStep="Review counts and digest; rerun with --apply only against the intended empty DSH Lounge namespaces.";process.stdout.write(JSON.stringify(report,null,2)+"\n");}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)main().catch(error=>{process.stderr.write(`DSH Lounge migration failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
