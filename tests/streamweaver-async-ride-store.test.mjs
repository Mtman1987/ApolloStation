import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AsyncStreamWeaverRideStore} from "../apps/streamweaver/dist/async-ride-store.js";
async function fixture(){const directory=await mkdtemp(join(tmpdir(),"streamweaver-ride-store-")),databasePath=join(directory,"records.sqlite"),store=new AsyncStreamWeaverRideStore({mode:"sqlite",databasePath});await store.initialize();return{directory,databasePath,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};}
const riders=[{userId:"user-a",displayName:"Alice",imageUrl:""},{userId:"user-b",displayName:"Bob",imageUrl:""}];
function attempt(){return{signature:"sig-1",actorId:"actor",displayName:"Viewer",source:"twitch",currency:"streamer",streamSession:"session-1",reward:{id:"ride",title:"Ride",price:100,award:0,acceptance:"streamer",firstPerStream:false,text:"Ride",mediaUrl:"",enabled:true,rewardId:"reward-1"},riders};}
test("async StreamWeaver ride store persists settings, attempts, front seat and Nebula bonus across restart",async()=>{
 const t=await fixture();try{
  await t.store.configure("tenant-a",{enabled:true,rewardId:"ride"});
  const first=await t.store.prepare("tenant-a","ride-1",attempt());
  const duplicate=await t.store.prepare("tenant-a","ride-1",attempt());assert.equal(duplicate.signature,first.signature);
  const winner=await t.store.reserveFrontSeat("tenant-a","ride-1",()=>0);
  const again=await t.store.reserveFrontSeat("tenant-a","ride-1",()=>1);assert.equal(again.winner.userId,winner.winner.userId);
  await t.store.complete("tenant-a","ride-1",{state:"complete",text:"Ride completed · Nebula Arcade bonus pending retry",count:2,frontSeat:winner.winner.displayName,frontSeatUserId:winner.winner.userId,rideId:"ride-1",bonus:100,nebulaBonusStatus:"pending"});
  await t.store.markNebulaBonus("tenant-a","ride-1",100);
  await t.store.close();
  const reopened=new AsyncStreamWeaverRideStore({mode:"sqlite",databasePath:t.databasePath});await reopened.initialize();
  try{assert.deepEqual(await reopened.settings("tenant-a"),{enabled:true,rewardId:"ride"});const saved=await reopened.attempt("tenant-a","ride-1");assert.equal(saved.winner.userId,winner.winner.userId);assert.equal(saved.result.nebulaBonusStatus,"awarded");assert.match(saved.result.text,/\+100 Nebula Arcade points/);assert.equal(await reopened.attempt("tenant-b","ride-1"),undefined);}finally{await reopened.close();}
 }finally{await rm(t.directory,{recursive:true,force:true});}
});
test("async StreamWeaver ride store isolates tenant settings and rejects conflicting request identities",async()=>{
 const t=await fixture();try{
  await t.store.configure("tenant-a",{enabled:true,rewardId:"ride-a"});await t.store.configure("tenant-b",{enabled:false,rewardId:""});
  await t.store.prepare("tenant-a","ride-1",attempt());
  await assert.rejects(t.store.prepare("tenant-a","ride-1",{...attempt(),signature:"other"}),/conflicts/);
  assert.equal((await t.store.settings("tenant-a")).enabled,true);assert.equal((await t.store.settings("tenant-b")).enabled,false);
 }finally{await t.close();}
});
