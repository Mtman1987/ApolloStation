import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readBicSnapshot } from "../scripts/migrate-streamweaver-bic-to-turso.mjs";
import { AsyncStreamWeaverBicStore } from "../apps/streamweaver/dist/async-bic-store.js";

test("Bic migration exports all state and operation receipts with stable digest",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"bic-migration-")),source=join(dir,"source.sqlite"),dest=join(dir,"dest.sqlite");
 try{
  const db=new DatabaseSync(source);db.exec(`
   CREATE TABLE streamweaver_bic_state(tenant_id TEXT PRIMARY KEY,total INTEGER NOT NULL) STRICT;
   CREATE TABLE streamweaver_bic_victims(tenant_id TEXT NOT NULL,username TEXT NOT NULL,display_name TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(tenant_id,username)) STRICT;
   CREATE TABLE streamweaver_bic_blacklist(tenant_id TEXT NOT NULL,username TEXT NOT NULL,PRIMARY KEY(tenant_id,username)) STRICT;
   CREATE TABLE streamweaver_bic_operations(tenant_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,idempotency_key)) STRICT;
  `);
  db.prepare("INSERT INTO streamweaver_bic_state VALUES(?,?)").run("tenant-a",12);
  db.prepare("INSERT INTO streamweaver_bic_victims VALUES(?,?,?,?)").run("tenant-a","victim","Victim",3);
  db.prepare("INSERT INTO streamweaver_bic_blacklist VALUES(?,?)").run("tenant-a","blocked");
  db.prepare("INSERT INTO streamweaver_bic_operations VALUES(?,?,?)").run("tenant-a","delivery-1",JSON.stringify({tenantId:"tenant-a",target:"victim",displayName:"Victim",total:12,userCount:3}));
  const first=readBicSnapshot(db),second=readBicSnapshot(db);db.close();assert.equal(first.digest,second.digest);assert.deepEqual(first.counts,{tenants:1,victims:1,blacklist:1,operations:1});
  const store=new AsyncStreamWeaverBicStore({mode:"sqlite",databasePath:dest});await store.initialize();
  try{await store.importSnapshots(first.snapshots);const snap=await store.snapshot("tenant-a");assert.equal(snap.total,12);assert.equal(snap.victims[0].count,3);assert.equal(await store.isBlacklisted("tenant-a","blocked"),true);assert.equal((await store.steal("tenant-a","victim","Victim","delivery-1")).duplicate,true);await assert.rejects(store.importSnapshots(first.snapshots),/not empty/);}finally{await store.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
