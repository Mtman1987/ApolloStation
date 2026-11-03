import test from "node:test";
import assert from "node:assert/strict";
import {forwardDshForumPost,importDshDiscordForumThreads,importDshDiscordForumThreadMessage,DshForumForwardingStore,DshForumForwardingWorker} from "../apps/discord-stream-hub/dist/forum-forwarding.js";

const source={sourceApp:"discord-stream-hub",sourceServerId:"123456",sourceChannelId:"234567",sourceChannelName:"general",sourceMessageId:"345678",sourceMessageUrl:"https://discord.com/channels/123456/234567/345678",authorId:"456789",authorName:"Viewer",title:"Community / #general",content:"Hello community",postedAt:"2026-11-03T12:00:00.000Z"};
function client(){
 const calls=[];
 return {calls,async createCommlinkForumPost(...args){calls.push(["create",...args]);return {post:{id:"native-post"}};},async mutateCommlinkForumImport(...args){calls.push(["mutate",...args]);return {deleted:true,id:"native-post"};},async publishEvent(...args){calls.push(["event",...args]);return {duplicate:false,event:{id:"event-1"}};}};
}
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
 const client={async listEvents(){if(delivered)return[];delivered=true;return[event];},async listCommlinkLiveChat(){return[{guildId:"guild-1",provider:"discord",channelId:"thread-1",messageId:"reply-1",providerUserId:"reply-user",username:"replyuser",displayName:"Reply User",text:"Live reply",occurredAt:"2026-11-03T12:02:00.000Z",isBot:false,rich:{attachments:[]}}];},async createCommlinkForumPost(_tenant,input){calls.push(["post",input]);return{post:{id:"native-post"}};},async createCommlinkForumReply(_tenant,postId,input){calls.push(["reply",postId,input]);return{reply:{id:"native-reply"}};},async publishEvent(){return{duplicate:true,event:{id:"event-2"}};}};
 const discord={async getChannel(_tenant,id){return id==="thread-1"?{id,guild_id:"guild-1",type:11,parent_id:"forum-1",name:"Welcome"}:{id,guild_id:"guild-1",type:15,name:"Community"};},async getChannelMessage(){return{id:"thread-1",content:"Starter",timestamp:"2026-11-03T12:01:00.000Z",author:{id:"starter-user",username:"Starter"}};}};
 try{
  const worker=new DshForumForwardingWorker(store,client,discord,()=>["guild-1"]);
  const result=await worker.runOnce("tenant-a");
  assert.equal(result.processed,1);assert.equal(result.forwarded,1);assert.equal(calls[0][0],"post");assert.equal(calls[1][0],"reply");assert.equal(calls[1][1],"native-post");
 }finally{store.close()}
});
