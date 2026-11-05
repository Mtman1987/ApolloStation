#!/usr/bin/env node
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
import {createAsyncJsonRecordStore} from "@spmt/async-json-store/factory";
const NAMESPACE="ride-state",TENANTS="ride-tenants",MIGRATIONS="ride-migrations";
const TABLES=["sw_ride_settings","sw_ride_attempts","sw_ride_front_seats"];
export function readStreamWeaverRideSnapshot(db){
 const integrity=db.prepare("PRAGMA integrity_check").all().map(row=>Object.values(row)[0]);
 if(integrity.length!==1||integrity[0]!=="ok")throw new Error("Source SQLite integrity_check failed");
 for(const table of TABLES)if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error(`Source SQLite is missing ${table}`);
 const tenants=new Map();
 const bucket=tenant=>{let value=tenants.get(tenant);if(!value){value={settings:[],attempts:[],frontSeats:[]};tenants.set(tenant,value);}return value;};
 for(const row of db.prepare("SELECT tenant,body FROM sw_ride_settings ORDER BY tenant").all())bucket(String(row.tenant)).settings.push({tenant:String(row.tenant),body:String(row.body)});
 for(const row of db.prepare("SELECT tenant,id,body FROM sw_ride_attempts ORDER BY tenant,id").all())bucket(String(row.tenant)).attempts.push({tenant:String(row.tenant),id:String(row.id),body:String(row.body)});
 for(const row of db.prepare("SELECT tenant,body FROM sw_ride_front_seats ORDER BY tenant").all())bucket(String(row.tenant)).frontSeats.push({tenant:String(row.tenant),body:String(row.body)});
 const records=[...tenants.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([tenant,snapshot])=>({tenant,snapshot}));
 const counts={tenants:records.length,settings:records.reduce((n,r)=>n+r.snapshot.settings.length,0),attempts:records.reduce((n,r)=>n+r.snapshot.attempts.length,0),frontSeats:records.reduce((n,r)=>n+r.snapshot.frontSeats.length,0)};
 const digest=createHash("sha256").update(JSON.stringify(records)).digest("hex");return{records,counts,digest};
}
export async function importStreamWeaverRideSnapshot(store,snapshot,migrationId){
 return store.transaction(async tx=>{
  const prior=await tx.get(MIGRATIONS,"_index",migrationId);
  if(prior){if(prior.digest!==snapshot.digest)throw new Error("Migration ID already exists with a different StreamWeaver ride source digest");return{imported:false,duplicate:true,counts:snapshot.counts,digest:snapshot.digest};}
  if((await tx.list(TENANTS,"_index")).length||(await tx.list(MIGRATIONS,"_index")).length)throw new Error("Turso StreamWeaver ride namespaces are not empty");
  for(const row of snapshot.records)if(await tx.get(NAMESPACE,row.tenant,"current"))throw new Error(`Turso StreamWeaver ride destination is not empty for ${row.tenant}`);
  const verified={};
  for(const row of snapshot.records){await tx.put(TENANTS,"_index",row.tenant,{tenantId:row.tenant});await tx.put(NAMESPACE,row.tenant,"current",row.snapshot);const saved=await tx.get(NAMESPACE,row.tenant,"current");for(const table of ["settings","attempts","frontSeats"]){const expected=row.snapshot[table].length,actual=saved?.[table]?.length??0;if(actual!==expected)throw new Error(`StreamWeaver ride import verification failed for ${row.tenant}/${table}: expected ${expected}, received ${actual}`);verified[`${row.tenant}:${table}`]=actual;}}
  await tx.put(MIGRATIONS,"_index",migrationId,{digest:snapshot.digest,counts:snapshot.counts,importedAt:new Date().toISOString()});
  return{imported:true,duplicate:false,verified,digest:snapshot.digest};
 });
}
function parseArgs(argv){const out={source:"",apply:false};for(let i=0;i<argv.length;i++){if(argv[i]==="--source")out.source=argv[++i]??"";else if(argv[i]==="--apply")out.apply=true;else throw new Error(`Unknown argument: ${argv[i]}`);}if(!out.source)throw new Error("Use --source /absolute/path/to/streamweaver.sqlite");return out;}
async function main(){const args=parseArgs(process.argv.slice(2)),source=resolve(args.source),db=new DatabaseSync(source,{readOnly:true});let snapshot;try{snapshot=readStreamWeaverRideSnapshot(db);}finally{db.close();}const report={source,mode:args.apply?"apply":"dry-run",counts:snapshot.counts,digest:snapshot.digest};if(args.apply){const url=process.env.STREAMWEAVER_TURSO_DATABASE_URL,authToken=process.env.STREAMWEAVER_TURSO_AUTH_TOKEN;if(!url||!authToken)throw new Error("Apply requires STREAMWEAVER_TURSO_DATABASE_URL and STREAMWEAVER_TURSO_AUTH_TOKEN");const store=createAsyncJsonRecordStore({service:"streamweaver",mode:"turso",url,authToken});try{await store.initialize();report.result=await importStreamWeaverRideSnapshot(store,snapshot,`sqlite-streamweaver-rides-v1:${snapshot.digest}`);}finally{await store.close();}}else report.nextStep="Review counts and digest; rerun with --apply only against the intended empty StreamWeaver Turso namespace.";process.stdout.write(JSON.stringify(report,null,2)+"\n");}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)main().catch(error=>{process.stderr.write(`StreamWeaver ride migration failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
