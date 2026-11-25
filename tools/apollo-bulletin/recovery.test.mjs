import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  const app=createBulletinServer({port:0,store,dispatch:async task=>{sentPrompts.push(task.prompt);return{submitted:true,receipt:{reply:sentPrompts.length===1?task.reviewMarker:task.completionMarker}};}});
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

test("Hostless cron readiness requires a persisted completed tick, not only a configured token", async () => {
  const keys = ["APOLLO_BULLETIN_REQUIRE_TURSO","APOLLO_BULLETIN_USE_HOSTLESS_CRON","APOLLO_BULLETIN_CRON_TOKEN","APOLLO_BULLETIN_ENABLE_BROWSER","APOLLO_BULLETIN_OWNER_ACTOR_ID"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_REQUIRE_TURSO = "1";
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "cron-health-test-token";
  process.env.APOLLO_BULLETIN_ENABLE_BROWSER = "0";
  delete process.env.APOLLO_BULLETIN_OWNER_ACTOR_ID;
  let persisted = { tasks: [], activity: [] };
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ port: 0, store });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const before = await fetch(origin + "/health/ready");
    assert.equal(before.status, 503);
    assert.equal((await before.json()).cron.lastTickStatus, "never");
    const denied = await fetch(origin + "/api/cron/tick", { method: "POST" });
    assert.equal(denied.status, 401);
    const wake = await fetch(origin + "/api/cron/tick", { method: "POST", headers: { authorization: "Bearer cron-health-test-token" } });
    assert.equal(wake.status, 202);
    assert.deepEqual(await wake.json(), { accepted: true });
    for (let attempt = 0; attempt < 50 && persisted.cron?.status !== "completed"; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(persisted.cron.status, "completed");
    const after = await fetch(origin + "/health/ready");
    assert.equal(after.status, 200);
    const proof = await after.json();
    assert.equal(proof.ready, true);
    assert.equal(proof.cronExecutionConfirmed, true);
    assert.equal(proof.cron.lastTickStatus, "completed");
    assert.equal(proof.cron.completedTicks, 1);
    assert.equal(proof.cron.lastTickProcessed, 0);
    assert.equal(proof.browserSessionReady, false, "browser sign-in remains a separate owner action");
    assert.equal("tasks" in proof, false, "public health must not expose queue contents");
  } finally {
    await app.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test("Bulletin widgets render scheduled times in the selected timezone and expose accessible status", async () => {
  const directory = await (await import("node:fs/promises")).mkdtemp(join((await import("node:os")).tmpdir(), "apollo-bulletin-widget-a11y-"));
  const store = { async loadQueue() { return { tasks: [], activity: [] }; }, async saveQueue() {}, async loadBrowserState() { return null; }, async saveBrowserState() {} };
  const app = createBulletinServer({ statePath: join(directory, "state.json"), port: 0, store });
  try {
    const address = await app.listen();
    const response = await fetch("http://127.0.0.1:" + address.port + "/widgets/scheduler");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /function nextRun\(t\)/);
    assert.match(html, /timeZoneName:"short"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /min-height:40px/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("submitted dispatch without a verified reply receipt is uncertain and never continued", async () => {
  const priorCron = process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;
  const priorBrowser = process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  const priorRequireTurso = process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;
  delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  let persisted = null;
  let dispatchCalls = 0;
  const store = {
    async loadQueue() { return persisted; },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ port: 0, store, dispatch: async () => { dispatchCalls += 1; return { submitted: true, reason: "missing receipt" }; } });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const created = await fetch(origin + "/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Missing receipt", prompt: "Do not duplicate this work", destination: "chatgpt", conversationUrl: "https://chatgpt.com/c/missing-receipt", scheduleType: "manual" }) });
    assert.equal(created.status, 201);
    const { task } = await created.json();
    const run = await fetch(origin + "/api/tasks/" + task.id + "/run", { method: "POST" });
    assert.equal(run.status, 200);
    await run.text();
    for (let attempt = 0; attempt < 50 && persisted?.tasks?.[0]?.status !== "dispatch-uncertain"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(persisted.tasks[0].status, "dispatch-uncertain");
    assert.equal(persisted.tasks[0].nextRunAt, null);
    assert.ok(persisted.activity.some(item => item.event === "dispatch-receipt-missing-no-retry"));
    const retry = await fetch(origin + "/api/tasks/" + task.id + "/run", { method: "POST" });
    assert.equal(retry.status, 409);
    assert.equal(dispatchCalls, 1);
  } finally {
    await app.close();
    if (priorCron === undefined) delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON; else process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = priorCron;
    if (priorBrowser === undefined) delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER; else process.env.APOLLO_BULLETIN_ENABLE_BROWSER = priorBrowser;
    if (priorRequireTurso === undefined) delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO; else process.env.APOLLO_BULLETIN_REQUIRE_TURSO = priorRequireTurso;
  }
});

test("restart marks an interrupted persisted Hostless cron tick failed and not ready", async () => {
  const keys = ["APOLLO_BULLETIN_REQUIRE_TURSO","APOLLO_BULLETIN_USE_HOSTLESS_CRON","APOLLO_BULLETIN_CRON_TOKEN","APOLLO_BULLETIN_ENABLE_BROWSER"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_REQUIRE_TURSO = "1";
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "cron-restart-test-token";
  process.env.APOLLO_BULLETIN_ENABLE_BROWSER = "0";
  let persisted = {
    tasks: [], activity: [],
    cron: { status: "running", inFlight: true, completedTicks: 4, failedTicks: 0, lastTickStartedAt: Date.now(), lastTickCompletedAt: Date.now() - 600_000, lastTickProcessed: null },
  };
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ port: 0, store });
  try {
    const address = await app.listen();
    const response = await fetch("http://127.0.0.1:" + address.port + "/health/ready");
    assert.equal(response.status, 503);
    const proof = await response.json();
    assert.equal(proof.cron.lastTickStatus, "interrupted");
    assert.equal(proof.cron.inFlight, false);
    assert.equal(proof.cron.failedTicks, 1);
    assert.equal(persisted.cron.status, "interrupted");
    assert.equal(persisted.cron.inFlight, false);
  } finally {
    await app.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test("a running cron tick retains readiness only while its previous completed proof is fresh", async () => {
  const keys = ["APOLLO_BULLETIN_REQUIRE_TURSO","APOLLO_BULLETIN_USE_HOSTLESS_CRON","APOLLO_BULLETIN_CRON_TOKEN","APOLLO_BULLETIN_ENABLE_BROWSER"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.APOLLO_BULLETIN_REQUIRE_TURSO = "1";
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "cron-running-test-token";
  process.env.APOLLO_BULLETIN_ENABLE_BROWSER = "0";
  let persisted = { tasks: [], activity: [], cron: { status: "running", inFlight: true, completedTicks: 3, failedTicks: 0, lastTickStartedAt: Date.now(), lastTickCompletedAt: Date.now() - 60_000, lastTickProcessed: null } };
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ port: 0, store });
  try {
    const address = await app.listen();
    const response = await fetch("http://127.0.0.1:" + address.port + "/health/ready");
    assert.equal(response.status, 200);
    const proof = await response.json();
    assert.equal(proof.ready, true);
    assert.equal(proof.cronExecutionConfirmed, true);
    assert.equal(proof.cron.lastTickStatus, "running");
    assert.equal(proof.cron.inFlight, true);
  } finally {
    await app.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test("an assistant echoing the review URL does not falsely request owner review", async () => {
  const priorCron=process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON,priorBrowser=process.env.APOLLO_BULLETIN_ENABLE_BROWSER,priorRequireTurso=process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON="1";delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;
  let persisted=null;
  const store={async loadQueue(){return persisted;},async saveQueue(value){persisted=structuredClone(value);},async loadBrowserState(){return null;},async saveBrowserState(){}};
  const app=createBulletinServer({port:0,store,dispatch:async task=>({submitted:true,receipt:{reply:"For your reference, the review link is "+task.reviewUrl}})});
  try {
    const address=await app.listen(),origin="http://127.0.0.1:"+address.port;
    const created=await fetch(origin+"/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Review link echo",prompt:"Inspect this task",destination:"chatgpt",conversationUrl:"https://chatgpt.com/c/review-link-echo",scheduleType:"manual",maxCycles:2})});
    assert.equal(created.status,201);const {task}=await created.json();
    assert.equal("reviewMarker" in task,false,"internal review marker must not be exposed in the public task object");
    const run=await fetch(origin+"/api/tasks/"+task.id+"/run",{method:"POST"});assert.equal(run.status,200);await run.text();
    for(let i=0;i<50&&persisted?.tasks[0]?.status!=="scheduled";i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(persisted.tasks[0].status,"scheduled");
    assert.doesNotMatch(persisted.tasks[0].lastEvent,/owner review/i);
  } finally {
    await app.close();
    if(priorCron===undefined)delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;else process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON=priorCron;
    if(priorBrowser===undefined)delete process.env.APOLLO_BULLETIN_ENABLE_BROWSER;else process.env.APOLLO_BULLETIN_ENABLE_BROWSER=priorBrowser;
    if(priorRequireTurso===undefined)delete process.env.APOLLO_BULLETIN_REQUIRE_TURSO;else process.env.APOLLO_BULLETIN_REQUIRE_TURSO=priorRequireTurso;
  }
});

test("legacy tasks receive a private review marker during queue recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-review-marker-migration-"));
  const statePath = join(directory, "state.json");
  const legacy = { id: "legacy-review-task", name: "Legacy review task", prompt: "Continue my existing work", basePrompt: "Continue my existing work", destination: "chatgpt", status: "paused", schedule: { type: "manual" }, nextRunAt: null };
  let persisted = { tasks: [legacy], activity: [] };
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ statePath, port: 0, store });
  try {
    const address = await app.listen();
    const response = await fetch("http://127.0.0.1:" + address.port + "/api/tasks");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal("reviewMarker" in data.tasks[0], false);
    assert.match(persisted.tasks[0].reviewMarker, /^APOLLO_BULLETIN_REVIEW_/);
    assert.ok(persisted.tasks[0].prompt.includes(persisted.tasks[0].reviewMarker));
    assert.ok(persisted.tasks[0].prompt.includes("\n\nAPOLLO BULLETIN REVIEW HANDOFF:"));
    assert.ok(persisted.activity.some(item => item.event === "review-marker-migrated" && item.taskId === "legacy-review-task"));
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
