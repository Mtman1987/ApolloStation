import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createAsyncJsonRecordStore} from "../packages/async-json-store/factory.mjs";
import {readDshLoungeSnapshot,importDshLoungeSnapshot} from "../scripts/migrate-dsh-lounge-to-turso.mjs";
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"dsh-lounge-migration-")),sourcePath=join(directory,"source.sqlite"),destinationPath=join(directory,"destination.sqlite"),db=new DatabaseSync(sourcePath);
 db.exec("CREATE TABLE dsh_rendered_media(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,created_at TEXT NOT NULL);CREATE TABLE dsh_lounge_state(tenant_id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;CREATE TABLE dsh_lounge_host(tenant_id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;CREATE TABLE dsh_lounge_avatar(tenant_id TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;CREATE TABLE dsh_lounge_broadcast(tenant_id TEXT PRIMARY KEY,started_at TEXT NOT NULL,target_hours REAL NOT NULL) STRICT;");
 const now="2026-11-05T08:00:00.000Z";
 db.prepare("INSERT INTO dsh_lounge_state VALUES(?,?)").run("tenant-a",JSON.stringify({schemaVersion:1,tenantId:"tenant-a",headline:"SpaceMountainLive Lounge"}));
 db.prepare("INSERT INTO dsh_lounge_host VALUES(?,?)").run("tenant-a",JSON.stringify({schemaVersion:1,tenantId:"tenant-a",persistent:"idle"}));
 db.prepare("INSERT INTO dsh_lounge_avatar VALUES(?,?,?)").run("tenant-a",JSON.stringify({schemaVersion:1,tenantId:"tenant-a",source:"athena-robot-pet",fps:30,animations:{},renderedAt:now}),now);
 db.prepare("INSERT INTO dsh_lounge_broadcast VALUES(?,?,?)").run("tenant-a",now,24);db.close();
 const store=createAsyncJsonRecordStore({service:"discord-stream-hub",mode:"sqlite",databasePath:destinationPath});await store.initialize();
 return{directory,sourcePath,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}
test("DSH Lounge importer snapshots and restores all four tenant records atomically",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),one=readDshLoungeSnapshot(db),two=readDshLoungeSnapshot(db);db.close();
  assert.equal(one.digest,two.digest);assert.deepEqual(one.counts,{records:4,tenants:1,byNamespace:{"lounge-avatar":1,"lounge-broadcast":1,"lounge-host":1,"lounge-state":1}});
  const result=await importDshLoungeSnapshot(t.store,one,"migration-one");assert.equal(result.imported,true);assert.equal(Object.keys(result.verified).length,4);
  assert.equal((await t.store.get("lounge-state","tenant-a","current")).headline,"SpaceMountainLive Lounge");
  assert.equal((await t.store.get("lounge-broadcast","tenant-a","current")).targetHours,24);
  assert.equal((await importDshLoungeSnapshot(t.store,one,"migration-one")).duplicate,true);
  await assert.rejects(importDshLoungeSnapshot(t.store,{...one,digest:"different"},"migration-one"),/different DSH Lounge source digest/);
 }finally{await t.close();}
});
test("DSH Lounge importer refuses occupied namespaces",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),snapshot=readDshLoungeSnapshot(db);db.close();
  await t.store.put("lounge-tenants","_index","tenant-other",{tenantId:"tenant-other"});
  await t.store.put("lounge-host","tenant-other","current",{persistent:"idle"});
  await assert.rejects(importDshLoungeSnapshot(t.store,snapshot,"migration-one"),/namespaces are not empty/);
  assert.equal((await t.store.list("lounge-migrations","_index")).length,0);
 }finally{await t.close();}
});
