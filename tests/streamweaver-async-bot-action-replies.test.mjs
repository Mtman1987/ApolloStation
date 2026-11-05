import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncStreamWeaverBotActionReplies } from "../apps/streamweaver/dist/async-bot-action-replies.js";

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),"streamweaver-action-replies-"));
 const databasePath=join(directory,"records.sqlite");
 const store=new AsyncStreamWeaverBotActionReplies({mode:"sqlite",databasePath,now:()=>1000});
 await store.initialize();
 return{directory,databasePath,store,async close(){await store.close();await rm(directory,{recursive:true,force:true});}};
}
function context(tenantId="tenant-a",requestId="request-1"){
 return{tenantId,source:"twitch",connectionId:"connection-a",channelId:"channel-a",requestId,actor:{userId:"user-a",username:"alice",role:"owner"}};
}
function receipt(ctx,text="Queued image generation."){
 return{action:"sw.image.generate",context:ctx,message:{schemaVersion:1,tenantId:ctx.tenantId,provider:ctx.source,connectionId:ctx.connectionId,channelId:ctx.channelId,text,idempotencyKey:`reply:${ctx.requestId}`},jobId:"job-1",completionReply:true};
}

test("async bot-action receipts are idempotent, identity-locked, and survive restart",async()=>{
 const t=await fixture();
 const ctx=context();
 try{
  const first=await t.store.remember(receipt(ctx));
  const duplicate=await t.store.remember(receipt(ctx,"different duplicate text"));
  assert.equal(duplicate.message.text,first.message.text);
  assert.deepEqual(await t.store.get(ctx),first);
  await assert.rejects(t.store.get({...ctx,actor:{...ctx.actor,username:"mallory"}}),/identity mismatch/);
  await t.store.acknowledge(ctx);
  await t.store.close();
  const reopened=new AsyncStreamWeaverBotActionReplies({mode:"sqlite",databasePath:t.databasePath,now:()=>2000});
  await reopened.initialize();
  try{
   assert.equal((await reopened.get(ctx)).jobId,"job-1");
   const flushed=await reopened.flush({getExecutionJob:async()=>{throw new Error("must not fetch when delivery is disallowed");}},async()=>{},()=>false);
   assert.equal(flushed,0);
   assert.equal((await reopened.get(ctx)).message.text,"Queued image generation.");
  }finally{await reopened.close();}
 }finally{await rm(t.directory,{recursive:true,force:true});}
});

test("async bot-action receipt namespaces isolate tenants",async()=>{
 const t=await fixture();
 try{
  await t.store.remember(receipt(context("tenant-a","same-request"),"A"));
  await t.store.remember(receipt(context("tenant-b","same-request"),"B"));
  assert.equal((await t.store.get(context("tenant-a","same-request"))).message.text,"A");
  assert.equal((await t.store.get(context("tenant-b","same-request"))).message.text,"B");
 }finally{await t.close();}
});
