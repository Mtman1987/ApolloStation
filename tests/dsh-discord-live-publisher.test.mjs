import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DshDiscordApi, DshDiscordLivePublisher, SqliteDshDiscordMessageStore } from "../apps/discord-stream-hub/dist/index.js";

const member={canonicalUserId:"user-a",discordUserId:"11111",twitchLogin:"captain",group:"Crew",shoutoutChannelId:"22222"};
const stream={twitchLogin:"captain",twitchStreamId:"stream-a",displayName:"Captain",title:"Space Night",gameName:"Space Game",viewerCount:42,thumbnailUrl:"https://example.com/{width}x{height}.jpg",startedAt:"2026-08-25T00:00:00.000Z"};
function action(type,extra={}){return{schemaVersion:1,type,idempotencyKey:`id:${type}`,tenantId:"tenant-a",...extra};}

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"dsh-discord-"));const db=join(dir,"state.sqlite");const calls=[];let next=1;
 const grants={getGrant:async()=>({authorization:"Bot scoped-token",expiresAt:"2099-01-01T00:00:00.000Z"})};
 const fetchImpl=async(url,init={})=>{calls.push({url:String(url),method:init.method??"GET",headers:init.headers,body:init.body});if((init.method??"GET")==="POST")return new Response(JSON.stringify({id:String(90000+next++)}),{status:200,headers:{"content-type":"application/json"}});return new Response(undefined,{status:204});};
 const api=new DshDiscordApi(grants,fetchImpl);const store=new SqliteDshDiscordMessageStore(db);const branding={getBranding:async()=>({communityMemberName:"Crew",spotlightChannelId:"33333",onboardingCustomId:"spmt:onboard"})};const media={getImage:async()=>"https://example.com/spotlight.gif"};const publisher=new DshDiscordLivePublisher(api,store,branding,media,()=>"2026-08-25T03:00:00.000Z");
 return{dir,calls,store,publisher,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}

test("live create posts a donor-style Twitch embed and persists the Discord message id",async()=>{const f=fixture();await f.publisher.publish(action("shoutout.create",{member,stream}));const tracked=f.store.get("tenant-a","shoutout","user-a");assert.equal(tracked.channelId,"22222");assert.match(f.calls[0].url,/channels\/22222\/messages$/);const body=JSON.parse(f.calls[0].body);assert.match(body.embeds[0].title,/Captain.*LIVE/);assert.equal(body.embeds[0].footer.text,"Twitch • Crew Shoutout");f.close();});

test("live update edits the tracked message instead of reposting",async()=>{const f=fixture();await f.publisher.publish(action("shoutout.create",{member,stream}));await f.publisher.publish(action("shoutout.update",{member,stream:{...stream,viewerCount:55}}));assert.equal(f.calls.filter(c=>c.method==="POST").length,1);assert.equal(f.calls.filter(c=>c.method==="PATCH").length,1);f.close();});

test("offline removes the tracked shoutout and clears durable delivery state",async()=>{const f=fixture();await f.publisher.publish(action("shoutout.create",{member,stream}));await f.publisher.publish(action("shoutout.remove",{member,priorStreamId:"stream-a"}));assert.equal(f.store.get("tenant-a","shoutout","user-a"),undefined);assert.ok(f.calls.some(c=>c.method==="DELETE"));f.close();});

test("spotlight replaces the pinned compact embed and upgrades the member shoutout",async()=>{const f=fixture();await f.publisher.publish(action("spotlight.update",{member,stream,nextIndex:1,rotatesEveryMs:600000}));const spotlight=f.store.get("tenant-a","spotlight","current");assert.equal(spotlight.channelId,"33333");const posts=f.calls.filter(c=>c.method==="POST");assert.equal(posts.length,2);const compact=JSON.parse(posts[0].body);assert.equal(compact.embeds[0].title,"⭐ COMMUNITY SPOTLIGHT ⭐");assert.equal(compact.embeds[0].thumbnail.url,"https://example.com/spotlight.gif");const shoutout=JSON.parse(posts[1].body);assert.equal(shoutout.embeds[0].footer.text,"Twitch • ⭐ COMMUNITY SPOTLIGHT ⭐");f.close();});

test("expired Discord grants fail closed without sending requests",async()=>{let calls=0;const grants={getGrant:async()=>({authorization:"Bot token",expiresAt:"2020-01-01T00:00:00.000Z"})};const api=new DshDiscordApi(grants,async()=>{calls+=1;return new Response();});await assert.rejects(()=>api.createMessage("tenant-a","22222",{content:"x"}),/expired/);assert.equal(calls,0);});
