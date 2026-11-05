import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AsyncDshRaidPileStore} from "../apps/discord-stream-hub/dist/async-raid-pile-store.js";
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"dsh-raid-pile-")),databasePath=join(directory,"records.sqlite");let now="2026-11-05T08:00:00.000Z";
 const store=new AsyncDshRaidPileStore({mode:"sqlite",databasePath,now:()=>now});
 await store.initialize();return{directory,databasePath,store,setNow(value){now=value;},async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}
test("async DSH Raid Pile preserves join, presence, target rotation and voluntary raid receipts",async()=>{
 const t=await fixture();try{
  const [a,b]=await Promise.all([
   t.store.join("tenant-a",{userId:"user-a",twitchLogin:"alice",displayName:"Alice"}),
   t.store.join("tenant-a",{userId:"user-b",twitchLogin:"bob",displayName:"Bob"})
  ]);
  assert.equal(a.duplicate,false);assert.equal(b.duplicate,false);
  await t.store.updatePresence("tenant-a","user-a",10,true);await t.store.updatePresence("tenant-a","user-b",20,true);
  const piles=await t.store.ensureTargets("tenant-a");assert.equal(piles.length,1);assert.equal(piles[0].members.length,2);assert.ok(piles[0].target);
  const target=piles[0].target.userId,raider=target==="user-a"?"user-b":"user-a";
  const outcome=await t.store.recordRaidOut("tenant-a",raider,target,"raid-event-1");assert.equal(outcome.compliant,true);
  const duplicate=await t.store.recordRaidOut("tenant-a",raider,target,"raid-event-1");assert.equal(duplicate.strikes,outcome.strikes);
  t.setNow("2026-11-05T13:00:00.000Z");
  const handoffs=await t.store.dueHandoffs("tenant-a");assert.equal(handoffs.length,1);
  assert.equal((await t.store.piles("tenant-b")).length,0);
 }finally{await t.close();}
});
test("async DSH Raid Pile state survives a process restart",async()=>{
 const t=await fixture();await t.store.join("tenant-a",{userId:"user-a",twitchLogin:"alice",displayName:"Alice"});await t.store.updatePresence("tenant-a","user-a",17,true);await t.store.close();
 const reopened=new AsyncDshRaidPileStore({mode:"sqlite",databasePath:t.databasePath});await reopened.initialize();
 try{const piles=await reopened.piles("tenant-a");assert.equal(piles.length,1);assert.equal(piles[0].members[0].currentViewers,17);}finally{await reopened.close();await rm(t.directory,{recursive:true,force:true});}
});
