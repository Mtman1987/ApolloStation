import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAsyncJsonRecordStore } from "../packages/async-json-store/factory.mjs";
import { readStreamWeaverBotActionReplySnapshot,importStreamWeaverBotActionReplySnapshot } from "../scripts/migrate-streamweaver-bot-action-replies-to-turso.mjs";

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"streamweaver-action-reply-migration-")),sourcePath=join(directory,"source.sqlite"),destinationPath=join(directory,"destination.sqlite");
 const db=new DatabaseSync(sourcePath);
 db.exec("CREATE TABLE streamweaver_bot_action_replies(tenant_id TEXT NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,acknowledged INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL,next_attempt INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,request_id)) STRICT;");
 const body={action:"sw.image.generate",context:{tenantId:"tenant-a",requestId:"r1"},message:{text:"queued",idempotencyKey:"reply:r1"},jobId:"job-1",completionReply:true};
 db.prepare("INSERT INTO streamweaver_bot_action_replies VALUES(?,?,?,?,?,?)").run("tenant-a","r1",JSON.stringify(body),1,0,1234);
 db.close();
 const store=createAsyncJsonRecordStore({service:"streamweaver",mode:"sqlite",databasePath:destinationPath});await store.initialize();
 return{directory,sourcePath,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}

test("bot action reply importer verifies deterministic, idempotent multi-tenant snapshot",async()=>{
 const t=await fixture();
 try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),one=readStreamWeaverBotActionReplySnapshot(db),two=readStreamWeaverBotActionReplySnapshot(db);db.close();
  assert.equal(one.digest,two.digest);assert.deepEqual(one.counts,{receipts:1,tenants:1});
  const result=await importStreamWeaverBotActionReplySnapshot(t.store,one,"migration-one");assert.equal(result.imported,true);assert.deepEqual(result.verified,{"tenant-a":1});
  const imported=await t.store.get("bot-action-replies","tenant-a","r1");assert.equal(imported.acknowledged,true);assert.equal(imported.nextAttempt,1234);
  assert.equal((await importStreamWeaverBotActionReplySnapshot(t.store,one,"migration-one")).duplicate,true);
  await assert.rejects(importStreamWeaverBotActionReplySnapshot(t.store,{...one,digest:"other"},"migration-one"),/different bot-action-reply source digest/);
 }finally{await t.close();}
});

test("bot action reply importer refuses occupied namespaces without partial writes",async()=>{
 const t=await fixture();
 try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),snapshot=readStreamWeaverBotActionReplySnapshot(db);db.close();
  await t.store.put("bot-action-replies","tenant-a","occupied",{done:true});
  await assert.rejects(importStreamWeaverBotActionReplySnapshot(t.store,snapshot,"migration-one"),/not empty/);
  assert.equal((await t.store.list("bot-action-reply-tenants","_index")).length,0);
  assert.equal((await t.store.list("bot-action-reply-migrations","_index")).length,0);
 }finally{await t.close();}
});
