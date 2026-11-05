#!/usr/bin/env node
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
import {createAsyncJsonRecordStore} from "@spmt/async-json-store/factory";
const NAMESPACE="raid-pile-state",INDEX="raid-pile-tenants",MIGRATIONS="raid-pile-migrations";
const TABLES=["raid_piles","raid_pile_profiles","raid_pile_members","raid_pile_targets","raid_pile_events"];
export function readDshRaidPileSnapshot(db){
 const integrity=db.prepare("PRAGMA integrity_check").all().map(row=>Object.values(row)[0]);if(integrity.length!==1||integrity[0]!=="ok")throw new Error("Source SQLite integrity_check failed");
 for(const table of TABLES)if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error(`Source SQLite is missing ${table}`);
 const grouped=new Map();
 for(const table of TABLES){const rows=db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();for(const row of rows){const tenant=String(row.tenant_id);let snapshot=grouped.get(tenant);if(!snapshot){snapshot=Object.fromEntries(TABLES.map(name=>[name,[]]));grouped.set(tenant,snapshot);}snapshot[table].push(row);}}
 const tenants=[...grouped.keys()].sort(),records=tenants.map(tenant=>({tenant,snapshot:grouped.get(tenant)})),counts={tenants:tenants.length,...Object.fromEntries(TABLES.map(table=>[table,records.reduce((sum,item)=>sum+item.snapshot[table].length,0)]))};
 const body={records,tenants},digest=createHash("sha256").update(JSON.stringify(body)).digest("hex");return{...body,counts,digest};
}
export async function importDshRaidPileSnapshot(store,snapshot,migrationId){
 return store.transaction(async tx=>{
  const prior=await tx.get(MIGRATIONS,"_index",migrationId);if(prior){if(prior.digest!==snapshot.digest)throw new Error("Migration ID already exists with a different DSH Raid Pile source digest");return{imported:false,duplicate:true,counts:snapshot.counts,digest:snapshot.digest};}
  if((await tx.list(MIGRATIONS,"_index")).length||(await tx.list(INDEX,"_index")).length)throw new Error("Turso DSH Raid Pile namespaces are not empty");
  for(const item of snapshot.records)if(await tx.get(NAMESPACE,item.tenant,"current"))throw new Error(`Turso DSH Raid Pile destination is not empty for ${item.tenant}`);
  for(const item of snapshot.records){await tx.put(INDEX,"_index",item.tenant,{tenantId:item.tenant});await tx.put(NAMESPACE,item.tenant,"current",item.snapshot);}
  const verified={};for(const item of snapshot.records){const actual=await tx.get(NAMESPACE,item.tenant,"current");for(const table of TABLES){const expected=item.snapshot[table].length,received=actual?.[table]?.length??0;if(received!==expected)throw new Error(`Raid Pile verification failed for ${item.tenant}/${table}: expected ${expected}, received ${received}`);verified[`${item.tenant}:${table}`]=received;}}
  await tx.put(MIGRATIONS,"_index",migrationId,{digest:snapshot.digest,counts:snapshot.counts,importedAt:new Date().toISOString()});return{imported:true,duplicate:false,verified,digest:snapshot.digest};
 });
}
function parseArgs(argv){const out={source:"",apply:false};for(let i=0;i<argv.length;i++){if(argv[i]==="--source")out.source=argv[++i]??"";else if(argv[i]==="--apply")out.apply=true;else throw new Error(`Unknown argument: ${argv[i]}`);}if(!out.source)throw new Error("Use --source /absolute/path/to/discord-stream-hub.sqlite");return out;}
async function main(){const args=parseArgs(process.argv.slice(2)),source=resolve(args.source),db=new DatabaseSync(source,{readOnly:true});let snapshot;try{snapshot=readDshRaidPileSnapshot(db);}finally{db.close();}const report={source,mode:args.apply?"apply":"dry-run",counts:snapshot.counts,digest:snapshot.digest};if(args.apply){const url=process.env.DSH_TURSO_DATABASE_URL,authToken=process.env.DSH_TURSO_AUTH_TOKEN;if(!url||!authToken)throw new Error("Apply requires DSH_TURSO_DATABASE_URL and DSH_TURSO_AUTH_TOKEN");const store=createAsyncJsonRecordStore({service:"discord-stream-hub",mode:"turso",url,authToken});try{await store.initialize();report.result=await importDshRaidPileSnapshot(store,snapshot,`sqlite-dsh-raid-pile-v1:${snapshot.digest}`);}finally{await store.close();}}else report.nextStep="Review counts and digest; rerun with --apply only against the intended empty DSH Raid Pile namespace.";process.stdout.write(JSON.stringify(report,null,2)+"\n");}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)main().catch(error=>{process.stderr.write(`DSH Raid Pile migration failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
