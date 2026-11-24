import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createBulletinServer } from "./server.mjs";

test("restart converts persisted dispatching tasks to uncertain and never auto-resends", async () => {
  const previousCron = process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;
  const previousBrowser = process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  const previousRequireTurso = process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  let persisted = {
    tasks: [{
      id: "crash-window-task", name: "Crash-window task", prompt: "Never resend this",
      destination: "chatgpt", status: "dispatching", nextRunAt: null, lastDispatchAt: Date.now(),
      schedule: { type: "manual" },
    }],
    activity: [],
  };
  let dispatchCalls = 0;
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ port: 0, store, dispatch: async () => { dispatchCalls++; return { submitted: true, receipt: { reply: "sent" } }; } });
  try {
    const address = await app.listen(), origin = "http://127.0.0.1:" + address.port;
    const data = await (await fetch(origin + "/api/tasks")).json();
    assert.equal(data.tasks[0].status, "dispatch-uncertain");
    assert.equal(data.tasks[0].nextRunAt, null);
    assert.match(data.tasks[0].lastEvent, /outcome is unknown/);
    assert.ok(data.activity.some(item => item.event === "dispatch-interrupted-restart-no-retry" && item.taskId === "crash-window-task"));
    assert.equal(persisted.tasks[0].status, "dispatch-uncertain");
    const run = await fetch(origin + "/api/tasks/crash-window-task/run", { method: "POST" });
    assert.equal(run.status, 409);
    await run.text();
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(dispatchCalls, 0);
  } finally {
    await app.close();
    if (previousCron === undefined) delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON; else process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = previousCron;
    if (previousBrowser === undefined) delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER; else process.env.APOLLO_BULLETIN_ENABLE_BROWSER = previousBrowser;
    if (previousRequireTurso === undefined) delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO; else process.env.APOLLO_BULLETIN_REQUIRE_TURSO = previousRequireTurso;
  }
});

test("concurrent local queue writes do not collide on a shared temporary filename", async () => {
  const directory=await (await import("node:fs/promises")).mkdtemp(join((await import("node:os")).tmpdir(),"apollo-bulletin-save-race-"));
  const statePath=join(directory,"state.json");
  const app=createBulletinServer({statePath,port:0});
  try {
    const address=await app.listen(),origin="http://127.0.0.1:"+address.port;
    const make=label=>fetch(origin+"/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:label,prompt:"prompt",destination:"test-simulator",scheduleType:"manual"})});
    const responses=await Promise.all([make("Concurrent A"),make("Concurrent B")]);
    assert.deepEqual(responses.map(r=>r.status),[201,201]);
    const saved=JSON.parse(await (await import("node:fs/promises")).readFile(statePath,"utf8"));
    assert.equal(saved.tasks.length,2);
    assert.deepEqual(saved.tasks.map(t=>t.name).sort(),["Concurrent A","Concurrent B"]);
  } finally { await app.close(); await rm(directory,{recursive:true,force:true}); }
});

test("failed dispatch-intent persistence pauses before any external send", async () => {
  const priorCron=process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON="1";
  let persisted=null,failClaim=false,dispatchCalls=0;
  const store={
    async loadQueue(){return persisted;},
    async saveQueue(value){if(failClaim&&value.tasks.some(t=>t.status==="dispatching")){failClaim=false;throw new Error("Turso write unavailable");}persisted=structuredClone(value);},
    async loadBrowserState(){return null;},async saveBrowserState(){}
  };
  const app=createBulletinServer({port:0,store,dispatch:async()=>{dispatchCalls++;return{submitted:true,receipt:{reply:"sent"}};}});
  try {
    const address=await app.listen(),origin="http://127.0.0.1:"+address.port;
    const created=await fetch(origin+"/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Claim failure",prompt:"prompt",destination:"test-simulator",scheduleType:"manual"})});
    const {task}=await created.json();failClaim=true;
    const run=await fetch(origin+"/api/tasks/"+task.id+"/run",{method:"POST"});assert.equal(run.status,200);await run.text();
    for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,50));if(persisted?.tasks[0]?.status==="paused")break;}
    assert.equal(persisted.tasks[0].status,"paused");
    assert.match(persisted.tasks[0].lastEvent,/intent claim could not be persisted/);
    assert.ok(persisted.activity.some(item=>item.event==="dispatch-claim-persistence-failed"));
    assert.equal(dispatchCalls,0);
  } finally { await app.close(); if(priorCron===undefined)delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;else process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON=priorCron; }
});


test("reviewed tasks resume with a continuation instead of replaying the original prompt", async () => {
  const priorCron=process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON,priorBrowser=process.env.APOLLO_BULLETIN_ENABLE_BROWSER,priorRequireTurso=process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON="1";delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  let persisted=null;const sentPrompts=[];
  const store={async loadQueue(){return persisted;},async saveQueue(value){persisted=structuredClone(value);},async loadBrowserState(){return null;},async saveBrowserState(){}};
  const app=createBulletinServer({port:0,store,dispatch:async task=>{sentPrompts.push(task.prompt);return{submitted:true,receipt:{reply:sentPrompts.length===1?"Owner review required":task.completionMarker}};}});
  try {
    const address=await app.listen(),origin="http://127.0.0.1:"+address.port;
    const created=await fetch(origin+"/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Reviewed continuation",prompt:"Inspect and repair the service",destination:"chatgpt",conversationUrl:"https://chatgpt.com/c/review-resume",scheduleType:"manual",maxCycles:1})});
    assert.equal(created.status,201);const {task}=await created.json();
    const first=await fetch(origin+"/api/tasks/"+task.id+"/run",{method:"POST"});assert.equal(first.status,200);await first.text();
    for(let i=0;i<50&&persisted?.tasks[0]?.status!=="awaiting_review";i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(persisted.tasks[0].status,"awaiting_review");assert.match(persisted.tasks[0].prompt,/Continue the existing task in this exact conversation/);
    const resumed=await fetch(origin+"/api/tasks/"+task.id+"/resume",{method:"POST"});assert.equal(resumed.status,200);await resumed.text();
    for(let i=0;i<50&&persisted?.tasks[0]?.status!=="completed";i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(persisted.tasks[0].status,"completed");assert.equal(sentPrompts.length,2);
    assert.match(sentPrompts[1],/^Continue the existing task in this exact conversation/);assert.equal(persisted.tasks[0].totalCycles,2);
  } finally {
    await app.close();
    if(priorCron===undefined)delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;else process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON=priorCron;
    if(priorBrowser===undefined)delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;else process.env.APOLLO_BULLETIN_ENABLE_BROWSER=priorBrowser;
    if(priorRequireTurso===undefined)delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;else process.env.APOLLO_BULLETIN_REQUIRE_TURSO=priorRequireTurso;
  }
});

test("malformed task JSON returns HTTP 400", async () => {
  const store={async loadQueue(){return {tasks:[],activity:[]};},async saveQueue(){},async loadBrowserState(){return null;},async saveBrowserState(){}};
  const app=createBulletinServer({port:0,store});
  try {
    const address=await app.listen();
    const response=await fetch("http://127.0.0.1:"+address.port+"/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:"{"});
    assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:"Request body must be valid JSON"});
  } finally { await app.close(); }
});
