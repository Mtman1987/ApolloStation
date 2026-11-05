import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AsyncDshMtFixItIntake} from "../apps/discord-stream-hub/dist/async-mtfixit-intake.js";

test("async DSH MtFixIt intake persists one idempotent coder job and completion flags",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"dsh-mtfixit-intake-")),databasePath=join(directory,"records.sqlite");
 const calls={logs:0,jobs:0,dms:0,replies:0};
 const client={
  async publishOperationsLog(tenantId,input,idempotencyKey,eventId){calls.logs++;return{log:{id:"log-1",sourceAppId:"discord-stream-hub",level:input.level,kind:input.kind,summary:input.summary,detail:input.detail,labels:input.labels,occurredAt:input.occurredAt}};},
  async createCoderJob(){calls.jobs++;return{job:{id:"coder-job-1"}};}
 };
 const discord={
  async sendDirectMessage(){calls.dms++;},
  async createMessage(){calls.replies++;}
 };
 const message={text:"!mtfixit The lounge overlay is not loading after restart",occurredAt:"2026-11-05T08:00:00.000Z",channelId:"channel-1",messageId:"message-1",guildId:"guild-1",actor:{username:"alice",providerUserId:"discord-user-1"}};
 const intake=new AsyncDshMtFixItIntake(client,discord,{mode:"sqlite",databasePath,ownerDiscordUserId:"",now:()=>"2026-11-05T08:00:01.000Z"});
 try{
  const first=await intake.handle("tenant-a","event-1",message);
  const duplicate=await intake.handle("tenant-a","event-1",message);
  assert.deepEqual(first,{handled:true,jobId:"coder-job-1"});
  assert.deepEqual(duplicate,first);
  assert.deepEqual(calls,{logs:1,jobs:1,dms:0,replies:1});
  const health=await intake.health();assert.equal(health.ready,true);
 }finally{await intake.close();await rm(directory,{recursive:true,force:true});}
});

test("async DSH MtFixIt intake rejects unrelated messages and redacts credentials",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"dsh-mtfixit-redaction-")),databasePath=join(directory,"records.sqlite");
 const calls={logs:0,jobs:0,replies:0};
 const client={async publishOperationsLog(tenantId,input){calls.logs++;assert.doesNotMatch(input.detail,/Bearer secretvalue/);return{log:{id:"log-1",sourceAppId:"discord-stream-hub",level:input.level,kind:input.kind,summary:input.summary,detail:input.detail,labels:input.labels,occurredAt:input.occurredAt}};},async createCoderJob(){calls.jobs++;return{job:{id:"job-1"}};}};
 const discord={async createMessage(){calls.replies++;},async sendDirectMessage(){}};
 const intake=new AsyncDshMtFixItIntake(client,discord,{mode:"sqlite",databasePath,ownerDiscordUserId:""});
 try{
  assert.deepEqual(await intake.handle("tenant-a","event-1",{text:"hello",channelId:"c",messageId:"m",occurredAt:"2026-11-05T08:00:00.000Z",actor:{username:"a",providerUserId:"u"}}),{handled:false});
  await intake.handle("tenant-a","event-2",{text:"!mtfixit overlay failure Bearer secretvalue",channelId:"c",messageId:"m2",occurredAt:"2026-11-05T08:00:00.000Z",actor:{username:"a",providerUserId:"u"}});
  assert.equal(calls.logs,1);assert.equal(calls.jobs,1);assert.equal(calls.replies,1);
 }finally{await intake.close();await rm(directory,{recursive:true,force:true});}
});
