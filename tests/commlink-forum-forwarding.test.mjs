import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {CommlinkForumForwardingStore} from "../packages/commlink-core/dist/index.js";
import {CommlinkForumForwardingApi} from "../apps/spmt-service/dist/commlink-forum-forwarding-api.js";

const perChannel={schemaVersion:1,sourceGuildId:"123456",destinationGuildId:"234567",forumChannelId:"345678",mode:"per-channel",paused:false,restrictToWhitelist:true,sourceChannelWhitelist:["456789","567890"]};
test("canonical forum forwarding rules validate, deduplicate and isolate tenants",()=>{
 const store=new CommlinkForumForwardingStore(":memory:");
 try{
  const saved=store.putRule({...perChannel,tenantId:"tenant-a"});
  assert.deepEqual(saved.sourceChannelWhitelist,["456789","567890"]);
  assert.equal(store.listRules("tenant-a").length,1);
  assert.equal(store.listRules("tenant-b").length,0);
  store.putRule({...perChannel,tenantId:"tenant-a",sourceChannelWhitelist:["456789","456789"]});
  assert.deepEqual(store.getRule("tenant-a","123456").sourceChannelWhitelist,["456789"]);
  const shared=store.putRule({...perChannel,tenantId:"tenant-a",sourceGuildId:"678901",mode:"single-thread",sharedThreadId:"789012"});
  assert.equal(shared.forumChannelId,"345678");assert.equal(shared.sharedThreadId,"789012");
  assert.equal(store.deleteRule("tenant-a","678901"),true);
  assert.equal(store.deleteRule("tenant-a","678901"),false);
 }finally{store.close()}
});

test("forum forwarding rules API permits only owner or scoped DSH service",async()=>{
 const store=new CommlinkForumForwardingStore(":memory:");
 const api=new CommlinkForumForwardingApi({store,auth:{authorize:token=>({actorType:token==="service"?"service":"user",actorId:token==="owner"?"owner":"member"})},control:{getTenant:()=>({status:"active",ownerUserId:"owner"})},accessToken:req=>req.headers.authorization?.replace(/^Bearer /,"")});
 const server=createServer((req,res)=>void api.handle(req,res,new URL(req.url,"http://localhost")));
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base="http://127.0.0.1:"+server.address().port;
 const call=(token,path,options={})=>fetch(base+path,{headers:{"x-spmt-tenant":"tenant-a",authorization:"Bearer "+token,"content-type":"application/json"},...options});
 try{
  let response=await call("member","/v1/commlink/forum-forwarding/rules",{method:"PUT",body:JSON.stringify({rule:perChannel})});assert.equal(response.status,403);
  response=await call("owner","/v1/commlink/forum-forwarding/rules",{method:"PUT",body:JSON.stringify({rule:perChannel})});assert.equal(response.status,200);
  response=await call("service","/v1/commlink/forum-forwarding/rules");assert.equal(response.status,200);assert.equal((await response.json()).rules.length,1);
  response=await call("owner","/v1/commlink/forum-forwarding/rules/123456",{method:"DELETE"});assert.equal(response.status,200);assert.equal((await response.json()).deleted,true);
 }finally{await new Promise(resolve=>server.close(resolve));store.close()}
});
