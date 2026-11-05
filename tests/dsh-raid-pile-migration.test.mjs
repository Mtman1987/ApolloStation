import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {DshRaidPileStore} from "../apps/discord-stream-hub/dist/raid-pile.js";
import {createAsyncJsonRecordStore} from "../packages/async-json-store/factory.mjs";
import {readDshRaidPileSnapshot,importDshRaidPileSnapshot} from "../scripts/migrate-dsh-raid-pile-to-turso.mjs";
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"dsh-raid-pile-migration-")),sourcePath=join(directory,"source.sqlite"),destinationPath=join(directory,"destination.sqlite");
 const source=new DshRaidPileStore(sourcePath,undefined,()=>"2026-11-05T08:00:00.000Z");
 source.join("tenant-a",{userId:"user-a",twitchLogin:"alice",displayName:"Alice"});source.join("tenant-a",{userId:"user-b",twitchLogin:"bob",displayName:"Bob"});source.updatePresence("tenant-a","user-a",15,true);source.ensureTargets("tenant-a");source.close();
 const store=createAsyncJsonRecordStore({service:"discord-stream-hub",mode:"sqlite",databasePath:destinationPath});await store.initialize();
 return{directory,sourcePath,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}
test("DSH Raid Pile importer snapshots every related table and is idempotent",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),one=readDshRaidPileSnapshot(db),two=readDshRaidPileSnapshot(db);db.close();
  assert.equal(one.digest,two.digest);assert.equal(one.counts.tenants,1);assert.equal(one.counts.raid_pile_members,2);
  const result=await importDshRaidPileSnapshot(t.store,one,"migration-one");assert.equal(result.imported,true);assert.equal(result.verified["tenant-a:raid_pile_members"],2);
  assert.equal((await t.store.get("raid-pile-state","tenant-a","current")).raid_piles.length,1);
  assert.equal((await importDshRaidPileSnapshot(t.store,one,"migration-one")).duplicate,true);
  await assert.rejects(importDshRaidPileSnapshot(t.store,{...one,digest:"different"},"migration-one"),/different DSH Raid Pile source digest/);
 }finally{await t.close();}
});
test("DSH Raid Pile importer refuses indexed occupied targets",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),snapshot=readDshRaidPileSnapshot(db);db.close();
  await t.store.put("raid-pile-tenants","_index","tenant-other",{tenantId:"tenant-other"});
  await assert.rejects(importDshRaidPileSnapshot(t.store,snapshot,"migration-one"),/namespaces are not empty/);
  assert.equal((await t.store.list("raid-pile-migrations","_index")).length,0);
 }finally{await t.close();}
});
