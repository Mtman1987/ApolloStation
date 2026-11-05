import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {StreamWeaverGenerationStore} from "../apps/streamweaver/dist/generation-settings.js";
import {createAsyncJsonRecordStore} from "../packages/async-json-store/factory.mjs";
import {readStreamWeaverGenerationSnapshot,importStreamWeaverGenerationSnapshot} from "../scripts/migrate-streamweaver-generation-to-turso.mjs";
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"streamweaver-generation-migration-")),sourcePath=join(directory,"source.sqlite"),destinationPath=join(directory,"destination.sqlite"),source=new StreamWeaverGenerationStore(sourcePath);
 source.save("tenant-a","public",{provider:"cloudflare",cloudflareModel:"@cf/black-forest-labs/flux-1-schnell",publicAccess:"mods"});
 source.save("tenant-a","private:user-a",{provider:"pollinations",pollinationsModel:"flux"});
 source.saveCatalog([{provider:"cloudflare",id:"model-a",label:"Model A"}]);source.saveGenerated("tenant-a","job-1",{resourceUrls:["https://example.com/image.png"]});source.close();
 const store=createAsyncJsonRecordStore({service:"streamweaver",mode:"sqlite",databasePath:destinationPath});await store.initialize();
 return{directory,sourcePath,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}
test("StreamWeaver generation importer preserves settings, model catalog and checkpoints idempotently",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),one=readStreamWeaverGenerationSnapshot(db),two=readStreamWeaverGenerationSnapshot(db);db.close();
  assert.equal(one.digest,two.digest);assert.deepEqual(one.counts,{tenants:1,settings:2,catalog:1,checkpoints:1});
  const result=await importStreamWeaverGenerationSnapshot(t.store,one,"migration-one");assert.equal(result.imported,true);assert.deepEqual(result.verified,{settings:2,checkpoints:1,catalog:1});
  assert.equal((await t.store.get("generation-settings","tenant-a","public")).publicAccess,"mods");
  assert.equal((await t.store.get("generation-model-catalog","_global","current")).models[0].id,"model-a");
  assert.equal((await t.store.get("generated-checkpoints","tenant-a","job-1")).resourceUrls.length,1);
  assert.equal((await importStreamWeaverGenerationSnapshot(t.store,one,"migration-one")).duplicate,true);
  await assert.rejects(importStreamWeaverGenerationSnapshot(t.store,{...one,digest:"other"},"migration-one"),/different StreamWeaver generation source digest/);
 }finally{await t.close();}
});
test("StreamWeaver generation importer refuses occupied namespaces without partial import",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),snapshot=readStreamWeaverGenerationSnapshot(db);db.close();
  await t.store.put("generation-tenants","_index","tenant-b",{tenantId:"tenant-b"});
  await assert.rejects(importStreamWeaverGenerationSnapshot(t.store,snapshot,"migration-one"),/namespaces are not empty/);
  assert.equal((await t.store.list("generation-migrations","_index")).length,0);
 }finally{await t.close();}
});
