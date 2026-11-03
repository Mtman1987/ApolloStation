import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {CommlinkForumStore} from "../packages/commlink-core/dist/index.js";
import {CommlinkForumApi} from "../apps/spmt-service/dist/commlink-forum-api.js";

test("native forum posts and replies are tenant isolated and author controlled",()=>{
 const store=new CommlinkForumStore(":memory:");
 try{
  const post=store.createPost("tenant-a","alice","Launch notes","First post");
  assert.equal(post.replyCount,0);
  const reply=store.createReply("tenant-a",post.id,"bob","Looks good");
  assert.equal(store.getPost("tenant-a",post.id).replyCount,1);
  assert.equal(store.listReplies("tenant-a",post.id)[0].id,reply.id);
  assert.equal(store.getPost("tenant-b",post.id),undefined);
  assert.throws(()=>store.editPost("tenant-a",post.id,"bob",{title:"Hijack"}),/Only the post author/);
  assert.throws(()=>store.deleteReply("tenant-a",reply.id,"alice"),/Only the reply author/);
  assert.equal(store.editReply("tenant-a",reply.id,"bob","Updated").body,"Updated");
  assert.equal(store.deleteReply("tenant-a",reply.id,"bob").deleted,true);
  assert.equal(store.getPost("tenant-a",post.id).replyCount,0);
  assert.equal(store.deletePost("tenant-a",post.id,"alice").deleted,true);
  assert.equal(store.getPost("tenant-a",post.id),undefined);
 }finally{store.close()}
});

test("forum API requires a user session and scopes every operation to the selected tenant",async()=>{
 const store=new CommlinkForumStore(":memory:");
 const api=new CommlinkForumApi({store,auth:{authorize:(token)=>({actorType:"user",actorId:token})},control:{getTenant:tenant=>({status:"active",ownerUserId:"owner-"+tenant})},accessToken:req=>req.headers.authorization?.replace(/^Bearer /,"")});
 const server=createServer((req,res)=>void api.handle(req,res,new URL(req.url,"http://localhost")));
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const base="http://127.0.0.1:"+server.address().port;
 const call=(tenant,path,{method="GET",token="alice",body}={})=>fetch(base+path,{method,headers:{"x-spmt-tenant":tenant,authorization:"Bearer "+token,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await fetch(base+"/v1/commlink/forums",{headers:{"x-spmt-tenant":"tenant-a"}})).status,401);
  let response=await call("tenant-a","/v1/commlink/forums",{method:"POST",body:{title:"Topic",body:"Hello"}});
  assert.equal(response.status,201);const post=(await response.json()).post;
  response=await call("tenant-b","/v1/commlink/forums/"+post.id);assert.equal((await response.json()).post,undefined);
  response=await call("tenant-a","/v1/commlink/forums/"+post.id+"/replies",{method:"POST",token:"bob",body:{body:"Reply"}});
  assert.equal(response.status,201);const reply=(await response.json()).reply;
  response=await call("tenant-a","/v1/commlink/forums/"+post.id+"/replies/"+reply.id,{method:"PATCH",token:"alice",body:{body:"not yours"}});
  assert.equal(response.status,403);assert.match((await response.json()).message,/Only the reply author/);
  response=await call("tenant-a","/v1/commlink/forums/"+post.id);assert.equal((await response.json()).post.replyCount,1);
 }finally{await new Promise(resolve=>server.close(resolve));store.close()}
});

test("provider-origin replay is idempotent and cannot collide across tenants",()=>{
 const store=new CommlinkForumStore(":memory:");
 try{
  const origin={provider:"discord",channelId:"forum-channel",threadId:"thread-42",messageId:"starter-1"};
  const first=store.createPost("tenant-a","bridge","Imported topic","Original content",origin);
  const replay=store.createPost("tenant-a","bridge","Imported topic","Original content",origin);
  const otherTenant=store.createPost("tenant-b","bridge","Imported topic","Original content",origin);
  assert.equal(replay.id,first.id);
  assert.notEqual(otherTenant.id,first.id);
  assert.equal(store.resolveOrigin("tenant-a","discord","forum-channel","thread-42","starter-1","post"),first.id);
  const replyOrigin={provider:"discord",channelId:"forum-channel",threadId:"thread-42",messageId:"reply-9"};
  const reply=store.createReply("tenant-a",first.id,"bridge","Imported reply",replyOrigin);
  const replayReply=store.createReply("tenant-a",first.id,"bridge","Imported reply",replyOrigin);
  assert.equal(replayReply.id,reply.id);
 }finally{store.close()}
});
