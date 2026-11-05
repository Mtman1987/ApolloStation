import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncStreamWeaverBicStore } from "../apps/streamweaver/dist/async-bic-store.js";

async function fixture(){const directory=await mkdtemp(join(tmpdir(),"streamweaver-bic-"));const store=new AsyncStreamWeaverBicStore({mode:"sqlite",databasePath:join(directory,"records.sqlite")});await store.initialize();return{directory,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};}

test("async Bic store is atomic, tenant-isolated, blacklist-aware, and replay-safe",async()=>{const f=await fixture();try{
 const first=await f.store.steal("tenant-a","@Victim","Victim","delivery-1");
 assert.deepEqual(first,{tenantId:"tenant-a",target:"victim",displayName:"Victim",total:1,userCount:1,duplicate:false});
 const replay=await f.store.steal("tenant-a","victim","Victim","delivery-1");assert.equal(replay.duplicate,true);assert.equal(replay.total,1);
 await f.store.addToBlacklist("tenant-a","protected");
 await assert.rejects(f.store.steal("tenant-a","protected","Protected","delivery-2"),/protected from Bic thefts/);
 assert.equal((await f.store.snapshot("tenant-a")).total,1);
 assert.equal((await f.store.snapshot("tenant-b")).total,0);
 assert.equal(await f.store.removeFromBlacklist("tenant-a","protected"),true);
 const removed=await f.store.remove("tenant-a","victim","Victim","delivery-3");assert.equal(removed.total,0);assert.equal(removed.userCount,0);
 }finally{await f.close();}});

test("async Bic store serializes concurrent mutations and preserves idempotency",async()=>{const f=await fixture();try{
 const results=await Promise.all(Array.from({length:20},(_,i)=>f.store.steal("tenant-a","victim","Victim",`delivery-${i}`)));
 assert.equal((await f.store.snapshot("tenant-a")).total,20);assert.equal(results.filter(r=>!r.duplicate).length,20);
 const dupes=await Promise.all(Array.from({length:10},()=>f.store.steal("tenant-a","victim","Victim","same-delivery")));
 assert.equal(dupes.filter(r=>r.duplicate).length,9);assert.equal((await f.store.snapshot("tenant-a")).total,21);
 }finally{await f.close();}});

test("async Bic legacy import merges missing victims, higher total, blacklist and receipt atomically",async()=>{const f=await fixture();try{
 await f.store.steal("tenant-a","existing","Existing","before-import");
 const input={total:50,victims:{existing:99,legacy:4},blacklist:["blocked"]};
 const first=await f.store.importLegacy("tenant-a",input,"legacy-v1");assert.equal(first.imported,4);assert.equal(first.snapshot.total,50);assert.equal(first.snapshot.victims.find(v=>v.name==="existing").count,1);assert.equal(await f.store.isBlacklisted("tenant-a","blocked"),true);
 const replay=await f.store.importLegacy("tenant-a",input,"legacy-v1");assert.equal(replay.duplicate,true);assert.equal(replay.imported,4);
 }finally{await f.close();}});
