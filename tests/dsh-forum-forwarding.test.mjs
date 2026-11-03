import test from "node:test";
import assert from "node:assert/strict";
import {forwardDshForumPost} from "../apps/discord-stream-hub/dist/forum-forwarding.js";

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
