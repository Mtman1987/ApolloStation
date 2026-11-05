import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {StreamWeaverRideStore} from "../apps/streamweaver/dist/ride-store.js";
import {createAsyncJsonRecordStore} from "../packages/async-json-store/factory.mjs";
import {readStreamWeaverRideSnapshot,importStreamWeaverRideSnapshot} from "../scripts/migrate-streamweaver-rides-to-turso.mjs";
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"streamweaver-ride-migration-")),sourcePath=join(directory,"source.sqlite"),destinationPath=join(directory,"destination.sqlite"),source=new StreamWeaverRideStore(sourcePath);
 source.configure("tenant-a",{enabled:true,rewardId:"ride"});source.prepare("tenant-a","ride-1",{signature:"sig",actorId:"actor",displayName:"Viewer",source:"twitch",currency:"streamer",streamSession:"session",reward:{id:"ride",title:"Ride",price:100,award:0,acceptance:"streamer",firstPerStream:false,text:"Ride",mediaUrl:"",enabled:true,rewardId:"reward"},riders:[{userId:"user-a",displayName:"Alice",imageUrl:""}]});source.reserveFrontSeat("tenant-a","ride-1",()=>0);source.close();
 const store=createAsyncJsonRecordStore({service:"streamweaver",mode:"sqlite",databasePath:destinationPath});await store.initialize();
 return{directory,sourcePath,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}
test("StreamWeaver ride importer preserves deterministic tenant snapshots and idempotency",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),one=readStreamWeaverRideSnapshot(db),two=readStreamWeaverRideSnapshot(db);db.close();
  assert.equal(one.digest,two.digest);assert.deepEqual(one.counts,{tenants:1,settings:1,attempts:1,frontSeats:1});
  const result=await importStreamWeaverRideSnapshot(t.store,one,"migration-one");assert.equal(result.imported,true);assert.equal(result.verified["tenant-a:attempts"],1);
  const saved=await t.store.get("ride-state","tenant-a","current");assert.equal(saved.attempts[0].id,"ride-1");assert.equal(saved.settings[0].body,JSON.stringify({enabled:true,rewardId:"ride"}));
  assert.equal((await importStreamWeaverRideSnapshot(t.store,one,"migration-one")).duplicate,true);
  await assert.rejects(importStreamWeaverRideSnapshot(t.store,{...one,digest:"other"},"migration-one"),/different StreamWeaver ride source digest/);
 }finally{await t.close();}
});
test("StreamWeaver ride importer refuses occupied tenant namespaces without partial import",async()=>{
 const t=await fixture();try{
  const db=new DatabaseSync(t.sourcePath,{readOnly:true}),snapshot=readStreamWeaverRideSnapshot(db);db.close();
  await t.store.put("ride-tenants","_index","tenant-b",{tenantId:"tenant-b"});
  await assert.rejects(importStreamWeaverRideSnapshot(t.store,snapshot,"migration-one"),/namespaces are not empty/);
  assert.equal((await t.store.list("ride-migrations","_index")).length,0);
 }finally{await t.close();}
});
