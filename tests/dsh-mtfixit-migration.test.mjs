import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createAsyncJsonRecordStore} from "../packages/async-json-store/factory.mjs";
import {readDshMtFixItSnapshot,importDshMtFixItSnapshot} from "../scripts/migrate-dsh-mtfixit-to-turso.mjs";
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"dsh-mtfixit-migration-")),sourcePath=join(directory,"source.sqlite"),destinationPath=join(directory,"destination.sqlite"),db=new DatabaseSync(sourcePath);
 db.exec("CREATE TABLE dsh_mtfixit_reports(tenant TEXT NOT NULL,event_id TEXT NOT NULL,job_id TEXT NOT NULL,channel_id TEXT NOT NULL,message_id TEXT NOT NULL,reporter TEXT NOT NULL,description TEXT NOT NULL,owner_notified INTEGER NOT NULL DEFAULT 0,reply_sent INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,PRIMARY KEY(tenant,event_id)) STRICT;");
 db.prepare("INSERT INTO dsh_mtfixit_reports VALUES(?,?,?,?,?,?,?,?,?,?)").run("tenant-a","event-1","job-1","channel-1","message-1","alice","The overlay is broken",1,0,"2026-11-05T08:00:00.000Z");db.close();
 const store=createAsyncJsonRecordStore({service:"discord-stream-hub",mode:"sqlite",databasePath:destinationPath});await store.initialize();
 return{directory,sourcePath,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}
test("DSH MtFixIt importer preserves notification receipts with deterministic digest",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),one=readDshMtFixItSnapshot(db),two=readDshMtFixItSnapshot(db);db.close();
  assert.equal(one.digest,two.digest);assert.deepEqual(one.counts,{reports:1,tenants:1});
  const result=await importDshMtFixItSnapshot(t.store,one,"migration-one");assert.equal(result.imported,true);assert.deepEqual(result.verified,{"tenant-a":1});
  const saved=await t.store.get("mtfixit-reports","tenant-a","event-1");assert.equal(saved.ownerNotified,true);assert.equal(saved.replySent,false);assert.equal(saved.jobId,"job-1");
  assert.equal((await importDshMtFixItSnapshot(t.store,one,"migration-one")).duplicate,true);
  await assert.rejects(importDshMtFixItSnapshot(t.store,{...one,digest:"different"},"migration-one"),/different MtFixIt source digest/);
 }finally{await t.close();}
});
test("DSH MtFixIt importer refuses a populated namespace without partial writes",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),snapshot=readDshMtFixItSnapshot(db);db.close();
  await t.store.put("mtfixit-reports","tenant-a","occupied",{jobId:"existing"});
  await assert.rejects(importDshMtFixItSnapshot(t.store,snapshot,"migration-one"),/not empty/);
  assert.equal((await t.store.list("mtfixit-migrations","_index")).length,0);
 }finally{await t.close();}
});
