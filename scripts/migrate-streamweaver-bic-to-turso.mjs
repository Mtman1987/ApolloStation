#!/usr/bin/env node
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { AsyncStreamWeaverBicStore } from "../apps/streamweaver/dist/async-bic-store.js";

export function readBicSnapshot(db){
 const integrity=db.prepare("PRAGMA integrity_check").all().map(r=>Object.values(r)[0]);if(integrity.length!==1||integrity[0]!=="ok")throw new Error("Source SQLite integrity_check failed");
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 const get=(table,sql)=>tables.has(table)?db.prepare(sql).all():[];
 const tenants=new Set();
 for(const table of ["streamweaver_bic_state","streamweaver_bic_victims","streamweaver_bic_blacklist","streamweaver_bic_operations"])if(tables.has(table))for(const row of db.prepare(`SELECT DISTINCT tenant_id FROM ${table}`).all())tenants.add(String(row.tenant_id));
 const snapshots=[...tenants].sort().map(tenantId=>({tenantId,total:0,victims:{},blacklist:[],operations:{}}));
 const byTenant=new Map(snapshots.map(s=>[s.tenantId,s]));
 for(const r of get("streamweaver_bic_state","SELECT tenant_id,total FROM streamweaver_bic_state ORDER BY tenant_id"))byTenant.get(String(r.tenant_id)).total=Number(r.total);
 for(const r of get("streamweaver_bic_victims","SELECT tenant_id,username,display_name,count FROM streamweaver_bic_victims ORDER BY tenant_id,username"))byTenant.get(String(r.tenant_id)).victims[String(r.username)]={displayName:String(r.display_name),count:Number(r.count)};
 for(const r of get("streamweaver_bic_blacklist","SELECT tenant_id,username FROM streamweaver_bic_blacklist ORDER BY tenant_id,username"))byTenant.get(String(r.tenant_id)).blacklist.push(String(r.username));
 for(const r of get("streamweaver_bic_operations","SELECT tenant_id,idempotency_key,body FROM streamweaver_bic_operations ORDER BY tenant_id,idempotency_key"))byTenant.get(String(r.tenant_id)).operations[String(r.idempotency_key)]=JSON.parse(String(r.body));
 const digest=createHash("sha256").update(JSON.stringify(snapshots)).digest("hex");
 return{snapshots,counts:{tenants:snapshots.length,victims:snapshots.reduce((n,s)=>n+Object.keys(s.victims).length,0),blacklist:snapshots.reduce((n,s)=>n+s.blacklist.length,0),operations:snapshots.reduce((n,s)=>n+Object.keys(s.operations).length,0)},digest};
}
function args(argv){const out={source:"",apply:false};for(let i=0;i<argv.length;i++){if(argv[i]==="--source")out.source=argv[++i]??"";else if(argv[i]==="--apply")out.apply=true;else throw new Error(`Unknown argument: ${argv[i]}`);}if(!out.source)throw new Error("Use --source /absolute/path/to/streamweaver.sqlite");return out;}
async function main(){const a=args(process.argv.slice(2)),source=resolve(a.source),db=new DatabaseSync(source,{readOnly:true});let snapshot;try{snapshot=readBicSnapshot(db);}finally{db.close();}
 const report={source,mode:a.apply?"apply":"dry-run",counts:snapshot.counts,digest:snapshot.digest};
 if(a.apply){const url=process.env.STREAMWEAVER_TURSO_DATABASE_URL,authToken=process.env.STREAMWEAVER_TURSO_AUTH_TOKEN;if(!url||!authToken)throw new Error("Apply requires STREAMWEAVER_TURSO_DATABASE_URL and STREAMWEAVER_TURSO_AUTH_TOKEN");const store=new AsyncStreamWeaverBicStore({mode:"turso",url,authToken});try{await store.initialize();await store.importSnapshots(snapshot.snapshots);const verified=[];for(const expected of snapshot.snapshots){const actual=await store.snapshot(expected.tenantId);if(JSON.stringify(actual)!==JSON.stringify({tenantId:expected.tenantId,total:expected.total,victims:Object.entries(expected.victims).filter(([,v])=>v.count>0).map(([name,v])=>({name,displayName:v.displayName,count:v.count})).sort((x,y)=>y.count-x.count||x.name.localeCompare(y.name)),blacklist:[...expected.blacklist].sort()}))throw new Error(`Bic import verification failed for tenant ${expected.tenantId}`);verified.push(expected.tenantId);}report.verifiedTenants=verified;}finally{await store.close();}}
 else report.nextStep="Review the digest and counts. Apply only to the intended empty StreamWeaver Bic namespace.";
 process.stdout.write(JSON.stringify(report,null,2)+"\\n");
}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)main().catch(e=>{process.stderr.write(`Bic migration failed: ${e instanceof Error?e.message:String(e)}\\n`);process.exitCode=1;});
