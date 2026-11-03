import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {forwardDshForumPost,importDshDiscordForumThreads,importDshDiscordForumThreadMessage,DshForumForwardingStore,DshForumForwardingWorker,DshForumForwardingService,DshCommlinkForumDiscordPort,dshForumThreadCreationIdempotencyKey} from "../apps/discord-stream-hub/dist/forum-forwarding.js";

const source={sourceApp:"discord-stream-hub",sourceServerId:"123456",sourceChannelId:"234567",sourceChannelName:"general",sourceMessageId:"345678",sourceMessageUrl:"https://discord.com/channels/123456/234567/345678",authorId:"456789",authorName:"Viewer",title:"Community / #general",content:"Hello community",postedAt:"2026-11-03T12:00:00.000Z"};
function client(){
 const calls=[];
 return {calls,async createCommlinkForumPost(...args){calls.push(["create",...args]);return {post:{id:"native-post"}};},async mutateCommlinkForumImport(...args){calls.push(["mutate",...args]);return {deleted:true,id:"native-post"};},async publishEvent(...args){calls.push(["event",...args]);return {duplicate:false,event:{id:"event-1"}};}};
}
test("forum edit retries reuse a receipt but distinct edits get distinct receipts",async()=>{
 const keys=[],client={async createExecutionJob(_tenant,_input,key){keys.push(key);return{job:{id:"job-edit"}};},async getExecutionJob(){return{state:"succeeded",result:{}};}};
 const discord={async getChannel(){return{id:"thread-1",parent_id:"forum-1",guild_id:"guild-1",type:11};}};
 const port=new DshCommlinkForumDiscordPort(client,discord);
 const first={embeds:[{url:"https://discord.com/channels/1/2/3",description:"first edit"}]};
 await port.editThreadMessage("tenant-a","thread-1","message-1",first);
 await port.editThreadMessage("tenant-a","thread-1","message-1",first);
 await port.editThreadMessage("tenant-a","thread-1","message-1",{embeds:[{url:"https://discord.com/channels/1/2/3",description:"second edit"}]});
 assert.equal(keys.length,3);assert.equal(keys[0],keys[1]);assert.notEqual(keys[1],keys[2]);
});

test("an enabled forum whitelist with no entries fails closed",async()=>{
 const store=new DshForumForwardingStore(":memory:");
 try{
  const service=new DshForumForwardingService(store,{async getChannel(){throw new Error("no destination lookup expected");},async createForumThread(){throw new Error("no delivery expected");},async createThreadMessage(){throw new Error("no delivery expected");},async editThreadMessage(){throw new Error("no delivery expected");},async deleteThreadMessage(){throw new Error("no delivery expected");},async setThreadArchived(){throw new Error("no delivery expected");}});
  service.configure({schemaVersion:1,tenantId:"tenant-a",sourceGuildId:"123456",destinationGuildId:"654321",forumChannelId:"765432",mode:"per-channel",paused:false,restrictToWhitelist:true,sourceChannelWhitelist:[]});
  const result=await service.apply({tenantId:"tenant-a",guildId:"123456",channelId:"234567",channelName:"general",channelType:0,messageId:"345678",authorId:"456789",authorName:"Viewer",content:"hello",occurredAt:"2026-11-03T12:00:00.000Z",sourceIsPublic:true});
  assert.deepEqual(result,{status:"skipped",reason:"not-whitelisted"});
 }finally{store.close();}
});

test("a second forum worker run cannot replay the same tenant concurrently",async()=>{
 const store=new DshForumForwardingStore(":memory:");let release;const waiting=new Promise(resolve=>{release=resolve;});
 let entered;const started=new Promise(resolve=>{entered=resolve;});
 const client={async listCommlinkForumForwardRules(){return{rules:[]};},async listEvents(){entered();await waiting;return[];}};
 const worker=new DshForumForwardingWorker(store,client,{},()=>[]);
 try{
  const first=worker.runOnce("tenant-a");await started;
  const second=await worker.runOnce("tenant-a");
  assert.equal(second.busy,true);assert.equal(second.processed,0);
  release();const result=await first;assert.equal(result.busy,undefined);assert.equal(result.processed,0);
 }finally{release();store.close();}
});

test("forum worker lease prevents concurrent replay and releases safely",()=>{
 const store=new DshForumForwardingStore(":memory:");
 try{
  const now="2026-11-03T12:00:00.000Z",later="2026-11-03T12:15:00.000Z";
  assert.equal(store.acquireWorkerLease("tenant-a","worker-1",now,later),true);
  assert.equal(store.acquireWorkerLease("tenant-a","worker-2",now,later),false);
  assert.equal(store.renewWorkerLease("tenant-a","worker-2","2026-11-03T12:30:00.000Z"),false);
  assert.equal(store.renewWorkerLease("tenant-a","worker-1","2026-11-03T12:30:00.000Z"),true);
  store.releaseWorkerLease("tenant-a","worker-2");
  assert.equal(store.acquireWorkerLease("tenant-a","worker-2",now,later),false);
  store.releaseWorkerLease("tenant-a","worker-1");
  assert.equal(store.acquireWorkerLease("tenant-a","worker-2",now,later),true);
 }finally{store.close();}
});

test("pending forum thread creation reconciles by deterministic starter marker",async()=>{
 const store=new DshForumForwardingStore(":memory:"),sent=[];
 const rule={schemaVersion:1,tenantId:"tenant-a",sourceGuildId:"123456",destinationGuildId:"654321",forumChannelId:"765432",mode:"per-channel",paused:false,restrictToWhitelist:false,sourceChannelWhitelist:[]};
 store.putRule(rule);store.setThread("tenant-a","123456","234567",null,true,"2026-11-03T12:00:00.000Z");
 const marker="SPMT forwarding key: "+createHash("sha256").update(["tenant-a","123456","234567","765432"].join(":")).digest("hex").slice(0,24);
 const discord={async getChannel(_tenant,id){return{id,guild_id:"654321",type:11,parent_id:"765432",name:"general"};},async listActiveThreads(){return{threads:[{id:"777777",parent_id:"765432"}]};},async listArchivedForumThreads(){return{threads:[],has_more:false};},async getChannelMessage(){return{id:"777777",content:"Forwarded messages\\n\\n"+marker};},async createThreadMessage(_tenant,thread,payload){sent.push({thread,payload});return"888888";}};
 try{
  const service=new DshForumForwardingService(store,discord);
  const result=await service.apply({tenantId:"tenant-a",guildId:"123456",channelId:"234567",channelName:"general",channelType:0,messageId:"345678",authorId:"456789",authorName:"Viewer",content:"Hello",occurredAt:"2026-11-03T12:00:00.000Z",sourceIsPublic:true});
  assert.equal(result.status,"forwarded");assert.equal(result.threadId,"777777");assert.equal(sent[0].thread,"777777");
  assert.deepEqual(store.getThread("tenant-a","123456","234567"),{thread_id:"777777",pending:0});
 }finally{store.close();}
});

test("forum thread creation idempotency is isolated by source channel",()=>{
 const first=dshForumThreadCreationIdempotencyKey("tenant-a","forum-1","guild-1","channel-1");
 const second=dshForumThreadCreationIdempotencyKey("tenant-a","forum-1","guild-1","channel-2");
 const replay=dshForumThreadCreationIdempotencyKey("tenant-a","forum-1","guild-1","channel-1");
 assert.notEqual(first,second);assert.equal(first,replay);
});

test("DSH forum create imports a native Commlink post before publishing the legacy event",async()=>{
 const spmt=client();const result=await forwardDshForumPost(spmt,"tenant-a",source);
 assert.equal(result.accepted,true);assert.equal(spmt.calls[0][0],"create");
 assert.equal(spmt.calls[0][2].origin.authorName,"Viewer");assert.equal(spmt.calls[0][2].origin.messageId,"345678");
 assert.equal(spmt.calls[1][0],"event");assert.equal(spmt.calls[1][2],"dsh.forum.post-forwarded.v1");
});
test("DSH forum edit and delete synchronize the native record and publish mutation events",async()=>{
 const edited=client();await forwardDshForumPost(edited,"tenant-a",{...source,operation:"edit",content:"Updated community message",postedAt:"2026-11-03T12:01:00.000Z"});
 assert.equal(edited.calls[0][0],"mutate");assert.equal(edited.calls[0][2].operation,"edit");assert.equal(edited.calls[0][2].body,"Updated community message");
 assert.equal(edited.calls[1][2],"dsh.forum.post-mutated.v1");
 const deleted=client();await forwardDshForumPost(deleted,"tenant-a",{...source,operation:"delete",content:"",postedAt:"2026-11-03T12:02:00.000Z"});
 assert.equal(deleted.calls[0][0],"mutate");assert.equal(deleted.calls[0][2].operation,"delete");
 assert.equal(deleted.calls[1][2],"dsh.forum.post-mutated.v1");
});

test("Discord forum import creates native topics and ordered native replies",async()=>{
 const calls=[];
 const client={async createCommlinkForumPost(tenant,input){calls.push(["post",tenant,input]);return {post:{id:"native-1"}};},async createCommlinkForumReply(tenant,postId,input){calls.push(["reply",tenant,postId,input]);return {reply:{id:"reply-1"}};},async publishEvent(...args){calls.push(["event",...args]);return {duplicate:false,event:{id:"event-1"}};}};
 const discord={async getGuild(){return {id:"guild-1",name:"Guild"};},async getChannel(){return {id:"forum-1",guild_id:"guild-1",name:"introductions",type:15};},async listActiveThreads(){return {threads:[{id:"thread-1",parent_id:"forum-1",name:"Welcome"}]};},async listArchivedForumThreads(){return {threads:[],has_more:false};},async listChannelMessages(_tenant,_thread,before){assert.equal(before,undefined);return [{id:"300000",timestamp:"2026-11-03T12:02:00.000Z",content:"A reply",author:{id:"user-2",username:"Second"}},{id:"200000",timestamp:"2026-11-03T12:01:00.000Z",content:"Starter post",author:{id:"user-1",username:"First"}}];}};
 const result=await importDshDiscordForumThreads(client,discord,"tenant-a","guild-1","forum-1");
 assert.equal(result.threadsDiscovered,1);assert.equal(result.postsImported,1);assert.equal(result.repliesImported,1);
 assert.equal(calls[0][0],"post");assert.equal(calls[0][2].origin.threadId,"thread-1");assert.equal(calls[0][2].body,"Starter post");
 assert.equal(calls[2][0],"reply");assert.equal(calls[2][2],"native-1");assert.equal(calls[2][3].origin.messageId,"300000");
});

test("live Discord forum thread messages create, edit, and delete native replies",async()=>{
 const calls=[];const client={async createCommlinkForumPost(tenant,input){calls.push(["post",tenant,input]);return {post:{id:"native-post"}};},async createCommlinkForumReply(tenant,postId,input){calls.push(["reply",tenant,postId,input]);return {reply:{id:"native-reply"}};},async mutateCommlinkForumImport(tenant,input){calls.push(["mutate",tenant,input]);return {deleted:input.operation==="delete",id:"native-reply"};},async publishEvent(...args){calls.push(["event",...args]);return {duplicate:true,event:{id:"event-1"}};}};
 const discord={async getChannelMessage(_tenant,_thread,_starter){return {id:"200000",content:"Starter",timestamp:"2026-11-03T12:00:00.000Z",author:{id:"starter-user",username:"Starter"}};}};
 const forum={id:"forum-1",name:"Community"},thread={id:"200000",name:"Welcome"};
 const record={messageId:"300000",providerUserId:"reply-user",displayName:"Reply User",username:"replyuser",text:"Hello",occurredAt:"2026-11-03T12:01:00.000Z",isBot:false,rich:{attachments:[]}};
 assert.equal(await importDshDiscordForumThreadMessage(client,discord,"tenant-a","guild-1",forum,thread,record,"create"),true);
 assert.equal(calls.find(x=>x[0]==="reply")[2],"native-post");
 assert.equal(calls.find(x=>x[0]==="reply")[3].origin.threadId,"200000");
 await importDshDiscordForumThreadMessage(client,discord,"tenant-a","guild-1",forum,thread,{...record,text:"Edited reply"},"edit");
 assert.equal(calls.filter(x=>x[0]==="mutate").at(-1)[2].kind,"reply");
 assert.equal(calls.filter(x=>x[0]==="mutate").at(-1)[2].body,"Edited reply");
 await importDshDiscordForumThreadMessage(client,discord,"tenant-a","guild-1",forum,thread,record,"delete");
 assert.equal(calls.filter(x=>x[0]==="mutate").at(-1)[2].operation,"delete");
});

test("DSH forum worker routes live Discord thread replies into native Commlink",async()=>{
 const store=new DshForumForwardingStore(":memory:"),calls=[];let delivered=false;
 const event={id:"event-1",type:"spmt.chat.message.received.v1",payload:{provider:"discord",guildId:"guild-1",channelId:"thread-1",messageId:"reply-1"}};
 let liveQuery;const client={async listCommlinkForumForwardRules(){return{rules:[]};},async listEvents(){if(delivered)return[];delivered=true;return[event];},async listCommlinkLiveChat(_tenant,options){liveQuery=options;return[{guildId:"guild-1",provider:"discord",channelId:"thread-1",messageId:"reply-1",providerUserId:"reply-user",username:"replyuser",displayName:"Reply User",text:"Live reply",occurredAt:"2026-11-03T12:02:00.000Z",isBot:false,rich:{attachments:[]}}];},async createCommlinkForumPost(_tenant,input){calls.push(["post",input]);return{post:{id:"native-post"}};},async createCommlinkForumReply(_tenant,postId,input){calls.push(["reply",postId,input]);return{reply:{id:"native-reply"}};},async publishEvent(){return{duplicate:true,event:{id:"event-2"}};}};
 const discord={async getChannel(_tenant,id){return id==="thread-1"?{id,guild_id:"guild-1",type:11,parent_id:"forum-1",name:"Welcome"}:{id,guild_id:"guild-1",type:15,name:"Community"};},async getChannelMessage(){return{id:"thread-1",content:"Starter",timestamp:"2026-11-03T12:01:00.000Z",author:{id:"starter-user",username:"Starter"}};}};
 try{
  const worker=new DshForumForwardingWorker(store,client,discord,()=>["guild-1"]);
  const result=await worker.runOnce("tenant-a");
  assert.equal(result.processed,1);assert.equal(result.forwarded,1);assert.deepEqual(liveQuery,{provider:"discord",channelId:"thread-1",messageId:"reply-1",limit:1});assert.equal(calls[0][0],"post");assert.equal(calls[1][0],"reply");assert.equal(calls[1][1],"native-post");
 }finally{store.close()}
});

test("DSH forum worker hydrates and persists canonical SPMT thread mappings and receipts",async()=>{
 const store=new DshForumForwardingStore(":memory:"),saved=[];let delivered=false;
 const rule={schemaVersion:1,tenantId:"tenant-a",sourceGuildId:"123456",destinationGuildId:"654321",forumChannelId:"345678",mode:"per-channel",paused:false,restrictToWhitelist:false,sourceChannelWhitelist:[]};
 const event={id:"event-10",type:"spmt.chat.message.received.v1",payload:{provider:"discord",guildId:"123456",channelId:"234567",messageId:"456789"}};
 let jobInput;
 const client={async listCommlinkForumForwardRules(){return{rules:[rule]};},async getCommlinkForumForwardState(){return{};},async putCommlinkForumForwardState(_tenant,state){saved.push(state);return{saved:true};},async listEvents(){if(delivered)return[];delivered=true;return[event];},async listCommlinkLiveChat(){return[{guildId:"123456",provider:"discord",channelId:"234567",messageId:"456789",providerUserId:"user-1",username:"Viewer",displayName:"Viewer",text:"Forward this",occurredAt:"2026-11-03T12:03:00.000Z",isBot:false,rich:{attachments:[]}}];},async createExecutionJob(_tenant,input){jobInput=input;return{duplicate:false,job:{id:"job-1"}};},async getExecutionJob(){return{state:"succeeded",result:jobInput.input.operation==="create-thread"?{threadId:"777777",messageId:"666666"}:{providerMessageId:"888888",transport:"webhook"}};}};
 const discord={async getChannel(_tenant,id){if(id==="234567")return{id,guild_id:"123456",type:0,name:"general",permission_overwrites:[]};if(id==="777777")return{id,guild_id:"654321",type:11,parent_id:"345678",name:"general"};return{id,guild_id:"654321",type:15,name:"forum"};},async getGuild(){return{id:"123456",roles:[{id:"123456",permissions:"1024"}]};},async createForumThread(){throw new Error("destination writes must use Chat Gateway");},async createThreadMessage(){throw new Error("destination writes must use Chat Gateway");},async setThreadArchived(){throw new Error("destination writes must use Chat Gateway");},async deleteThreadMessage(){throw new Error("destination writes must use Chat Gateway");},async editThreadMessage(){throw new Error("destination writes must use Chat Gateway");}};
 try{
  const worker=new DshForumForwardingWorker(store,client,discord,()=>["123456"]);
  const result=await worker.runOnce("tenant-a");
  assert.equal(result.forwarded,1);assert.equal(saved.length,1);
  assert.equal(saved[0].thread.destinationThreadId,"777777");assert.equal(saved[0].receipt.destinationMessageId,"888888");assert.equal(saved[0].receipt.deleted,false);
  assert.equal(store.listRules("tenant-a").length,1);
 }finally{store.close()}
});
