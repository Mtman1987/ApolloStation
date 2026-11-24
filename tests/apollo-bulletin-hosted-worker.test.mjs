import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeChatGptConversationUrl } from "../tools/apollo-bulletin/browser-worker.mjs";
import { createBulletinServer } from "../tools/apollo-bulletin/server.mjs";

test("hosted browser accepts only an exact live ChatGPT conversation URL", () => {
  assert.equal(normalizeChatGptConversationUrl("https://chatgpt.com/c/abc-123"), "https://chatgpt.com/c/abc-123");
  for (const value of [
    "",
    "https://chatgpt.com/share/abc",
    "https://chatgpt.com/c/abc?foo=bar",
    "https://chatgpt.com/c/abc#fragment",
    "https://example.com/c/abc",
    "http://chatgpt.com/c/abc",
    "https://chatgpt.com/",
  ]) assert.throws(() => normalizeChatGptConversationUrl(value));
});

test("Bulletin requires the exact conversation URL for real ChatGPT tasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-hosted-"));
  const app = createBulletinServer({ statePath: join(directory, "state.json"), port: 0 });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const create = body => fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const invalid = await create({ name: "Bad target", prompt: "Do work", destination: "chatgpt", scheduleType: "manual" });
    assert.equal(invalid.status, 400);
    await invalid.text();
    const valid = await create({ name: "Hosted task", prompt: "Do work", destination: "chatgpt", conversationUrl: "https://chatgpt.com/c/abc-123", maxCycles: 4, scheduleType: "manual" });
    assert.equal(valid.status, 201);
    const { task } = await valid.json();
    assert.equal(task.destination, "chatgpt");
    assert.equal(task.conversationUrl, "https://chatgpt.com/c/abc-123");
    assert.equal(task.maxCycles, 4);
    assert.equal(task.status, "paused");
    assert.equal(task.basePrompt, undefined, "task API should not expose the original prompt separately");
    assert.equal(task.completionMarker, undefined, "task API should not expose the completion token");
    assert.equal(task.reviewKey, undefined, "task API should not expose the review secret");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ChatGPT work continuation is bounded and persisted before the next scheduled cycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-continuation-"));
  const statePath = join(directory, "state.json");
  const app = createBulletinServer({
    statePath, port: 0,
    dispatch: async () => ({ submitted: true, receipt: { reply: "Partial progress. I updated the checkpoint." }, reason: "test response" }),
  });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const created = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Continue me", prompt: "Implement the feature", destination: "chatgpt", conversationUrl: "https://chatgpt.com/c/abc-123", maxCycles: 2, scheduleType: "manual" }),
    });
    const { task } = await created.json();
    const runResponse = await fetch(origin + "/api/tasks/" + task.id + "/run", { method: "POST" });
    await runResponse.text();
    let saved;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      saved = JSON.parse(await readFile(statePath, "utf8"));
      if (saved.tasks[0]?.status === "scheduled") break;
    }
    assert.equal(saved.tasks[0].cycles, 1);
    assert.equal(saved.tasks[0].status, "scheduled");
    assert.match(saved.tasks[0].prompt, /^Continue the existing task/);
    assert.equal(saved.tasks[0].maxCycles, 2);
    assert.ok(saved.tasks[0].nextRunAt > Date.now());
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import { TursoBulletinStore } from "../tools/apollo-bulletin/turso-store.mjs";

test("Turso Bulletin store persists queue and browser session state under separate keys", async () => {
  const rows = new Map();
  const adapter = {
    async execute(sql, args = []) {
      if (sql.startsWith("CREATE TABLE")) return { rows: [], affectedRows: 0 };
      if (sql.startsWith("SELECT")) return { rows: rows.has(args[0]) ? [[rows.get(args[0])]] : [], affectedRows: 0 };
      if (sql.startsWith("INSERT")) { rows.set(args[0], args[1]); return { rows: [], affectedRows: 1 }; }
      throw new Error("Unexpected SQL in test: " + sql);
    },
  };
  const store = new TursoBulletinStore({ url: "libsql://test.turso.io", authToken: "test", adapter });
  const queue = { tasks: [{ id: "task-1", status: "scheduled" }], activity: [] };
  const browser = { cookies: [{ name: "session", value: "test-session" }], origins: [] };
  await store.saveQueue(queue);
  await store.saveBrowserState(browser);
  assert.deepEqual(await store.loadQueue(), queue);
  assert.deepEqual(await store.loadBrowserState(), browser);
});

test("Bulletin server reads and writes task state through the injected Turso store", async () => {
  let persisted = null;
  const store = {
    async loadQueue() { return persisted; },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ port: 0, store });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const created = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Persist me", prompt: "Keep this checkpoint", destination: "test-simulator", scheduleType: "manual" }),
    });
    assert.equal(created.status, 201);
    assert.equal(persisted.tasks[0].name, "Persist me");
    assert.equal(persisted.tasks[0].status, "paused");
  } finally {
    await app.close();
  }
});

test("Hostless cron endpoint is authenticated and wakes one due task per tick", async () => {
  const priorCron = process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;
  const priorToken = process.env.APOLLO_BULLETIN_CRON_TOKEN;
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  process.env.APOLLO_BULLETIN_CRON_TOKEN = "cron-test-token";
  let persisted = {
    tasks: [
      { id: "one", name: "One", prompt: "one", destination: "test-simulator", status: "scheduled", nextRunAt: Date.now() - 1000, schedule: { type: "manual" } },
      { id: "two", name: "Two", prompt: "two", destination: "test-simulator", status: "scheduled", nextRunAt: Date.now() - 1000, schedule: { type: "manual" } },
    ],
    activity: [],
  };
  const store = {
    async loadQueue() { return structuredClone(persisted); },
    async saveQueue(value) { persisted = structuredClone(value); },
    async loadBrowserState() { return null; },
    async saveBrowserState() {},
  };
  const app = createBulletinServer({ port: 0, store, dispatch: async task => ({ submitted: true, receipt: { reply: "simulated" }, reason: task.id }) });
  try {
    const address = await app.listen();
    const endpoint = "http://127.0.0.1:" + address.port + "/api/cron/tick";
    const denied = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer wrong" } });
    assert.equal(denied.status, 401);
    await denied.text();
    const first = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer cron-test-token" } });
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { accepted: true });
    for (let attempt = 0; attempt < 30 && persisted.tasks[0].status !== "dispatched"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(persisted.tasks[0].status, "dispatched");
    assert.equal(persisted.tasks[1].status, "scheduled");
    const firstActivity = await (await fetch("http://127.0.0.1:" + address.port + "/api/tasks")).json();
    assert.ok(firstActivity.activity.some(item => item.event === "hostless-cron-tick-started"));
    assert.ok(firstActivity.activity.some(item => item.event === "hostless-cron-tick-completed"));
    let secondBody;
    for (let attempt = 0; attempt < 30; attempt++) {
      const second = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer cron-test-token" } });
      assert.equal(second.status, 202);
      secondBody = await second.json();
      if (secondBody.accepted) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(secondBody, { accepted: true });
    for (let attempt = 0; attempt < 30 && persisted.tasks[1].status !== "dispatched"; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(persisted.tasks[1].status, "dispatched");
  } finally {
    await app.close();
    if (priorCron === undefined) delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON; else process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = priorCron;
    if (priorToken === undefined) delete process.env.APOLLO_BULLETIN_CRON_TOKEN; else process.env.APOLLO_BULLETIN_CRON_TOKEN = priorToken;
  }
});

test("Hostless deploy config declares one named Bulletin dispatcher cron", async () => {
  const { readFile } = await import("node:fs/promises");
  const hostless = await readFile(new URL("../hostless.yaml", import.meta.url), "utf8");
  assert.match(hostless, /name: apollo-bulletin-resumer/);
  assert.match(hostless, /command: "node tools\/apollo-bulletin\/cron-tick\.mjs"/);
  assert.match(hostless, /schedule: "\*\/1 \* \* \* \*"/);
  assert.equal((hostless.match(/^\s+- name:/gm) || []).length, 1);
});

test("Apollo Bulletin proxy requires the canonical platform-owner session for app routes", async () => {
  const { authorizeBulletinRequest } = await import("../apps/spacemountain-web/dist/integrated-server.js");
  const publicHealth = await authorizeBulletinRequest({ headers: {}, method: "GET" }, "/bulletin/health/ready", "http://127.0.0.1:3000", async () => { throw new Error("readiness must not call the identity service"); }, {});
  assert.equal(publicHealth.authorized, true);
  assert.equal(publicHealth.reason, "public-readiness");
  const denied = await authorizeBulletinRequest({ headers: {} }, "/bulletin/api/tasks", "http://127.0.0.1:3000", async () => {
    throw new Error("must not call identity service without a cookie");
  }, {});
  assert.equal(denied.authorized, false);
  assert.equal(denied.status, 401);
  let seenCookie = "";
  const allowed = await authorizeBulletinRequest(
    { headers: { cookie: "spmt_token=apollo-owner-session" } },
    "/bulletin/api/tasks",
    "http://127.0.0.1:3000",
    async (url, options) => {
      assert.equal(String(url), "http://127.0.0.1:3000/v1/auth/session/check");
      seenCookie = options.headers.cookie;
      return new Response(JSON.stringify({ authenticated: true, actorId: "owner-1", tenantIds: ["tenant-1"], tenantRoles: { "tenant-1": "owner" }, platformOwner: true }), { status: 200 });
    },
    {},
  );
  assert.equal(seenCookie, "spmt_token=apollo-owner-session");
  assert.equal(allowed.authorized, true, "the canonical platform owner may access Bulletin without an additional actor-pin secret");
  const member = await authorizeBulletinRequest(
    { headers: { cookie: "spmt_token=member-session" } },
    "/bulletin/api/tasks",
    "http://127.0.0.1:3000",
    async () => new Response(JSON.stringify({ authenticated: true, actorId: "member-1", tenantIds: ["tenant-1"], tenantRoles: { "tenant-1": "member" } }), { status: 200 }),
    {},
  );
  assert.equal(member.authorized, false);
  assert.equal(member.status, 403);
  const otherTenantOwner = await authorizeBulletinRequest(
    { headers: { cookie: "spmt_token=other-tenant-owner-session" } },
    "/bulletin/api/tasks",
    "http://127.0.0.1:3000",
    async () => new Response(JSON.stringify({ authenticated: true, actorId: "other-tenant-owner", tenantIds: ["tenant-2"], tenantRoles: { "tenant-2": "owner" }, platformOwner: false }), { status: 200 }),
    {},
  );
  assert.equal(otherTenantOwner.authorized, false, "being an owner of a different tenant must not expose the global owner queue");
  assert.equal(otherTenantOwner.status, 403);
  const missingRoles = await authorizeBulletinRequest(
    { headers: { cookie: "spmt_token=legacy-session" } },
    "/bulletin/api/tasks",
    "http://127.0.0.1:3000",
    async () => new Response(JSON.stringify({ authenticated: true, actorId: "legacy-user" }), { status: 200 }),
    {},
  );
  assert.equal(missingRoles.authorized, false);
  const wrongOwnerPin = await authorizeBulletinRequest(
    { headers: { cookie: "spmt_token=other-owner-session" } },
    "/bulletin/api/tasks",
    "http://127.0.0.1:3000",
    async () => new Response(JSON.stringify({ authenticated: true, actorId: "other-owner", tenantIds: ["tenant-1"], tenantRoles: { "tenant-1": "owner" }, platformOwner: true }), { status: 200 }),
    { APOLLO_BULLETIN_OWNER_ACTOR_ID: "owner-1" },
  );
  assert.equal(wrongOwnerPin.authorized, false);
  assert.equal(wrongOwnerPin.status, 403);
});

test("Hostless cron proxy uses a bearer secret and does not need an interactive Apollo session", async () => {
  const { authorizeBulletinRequest } = await import("../apps/spacemountain-web/dist/integrated-server.js");
  const environment = { APOLLO_BULLETIN_CRON_TOKEN: "private-cron-token" };
  const allowed = await authorizeBulletinRequest(
    { headers: { authorization: "Bearer private-cron-token" } },
    "/bulletin/api/cron/tick",
    "http://127.0.0.1:3000",
    async () => { throw new Error("cron auth must not call SPMT session check"); },
    environment,
  );
  assert.equal(allowed.authorized, true);
  const denied = await authorizeBulletinRequest(
    { headers: { authorization: "Bearer wrong" } },
    "/bulletin/api/cron/tick",
    "http://127.0.0.1:3000",
    async () => { throw new Error("cron auth must not call SPMT session check"); },
    environment,
  );
  assert.equal(denied.authorized, false);
  assert.equal(denied.status, 401);
  const bossKeyAllowed = await authorizeBulletinRequest(
    { headers: { authorization: "Bearer existing-owner-key" } },
    "/bulletin/api/cron/tick",
    "http://127.0.0.1:3000",
    async () => { throw new Error("cron auth must not call SPMT session check"); },
    { BOSS_KEY: "existing-owner-key" },
  );
  assert.equal(bossKeyAllowed.authorized, true, "the existing BOSS_KEY fallback must work at the integrated gateway");
  const previewAllowed = await authorizeBulletinRequest(
    { headers: { authorization: "Bearer preview-only-token" } },
    "/bulletin/api/cron/tick",
    "http://127.0.0.1:3000",
    async () => { throw new Error("cron auth must not call SPMT session check"); },
    { APOLLO_PREVIEW_PASSWORD: "preview-only-token" },
  );
  assert.equal(previewAllowed.authorized, true);
  const whitespaceDedicatedFallback = await authorizeBulletinRequest(
    { headers: { authorization: "Bearer browser-control-token" } },
    "/bulletin/api/cron/tick",
    "http://127.0.0.1:3000",
    async () => { throw new Error("cron auth must not call SPMT session check"); },
    { APOLLO_BULLETIN_CRON_TOKEN: "  ", APOLLO_BROWSER_CONTROL_PASSWORD: " browser-control-token " },
  );
  assert.equal(whitespaceDedicatedFallback.authorized, true, "blank dedicated values must not mask an existing fallback credential");
});

test("Node 1 disables its private polling loop when Hostless cron owns scheduling", async () => {
  const { readFile } = await import("node:fs/promises");
  const startNode = await readFile(new URL("../scripts/hostless/start-node.mjs", import.meta.url), "utf8");
  assert.match(startNode, /APOLLO_BULLETIN_USE_HOSTLESS_CRON:\s*"1"/);
  assert.match(startNode, /APOLLO_BULLETIN_REQUIRE_TURSO:\s*"1"/);
  assert.match(startNode, /APOLLO_BULLETIN_CRON_TOKEN, process\.env\.APOLLO_BROWSER_CONTROL_PASSWORD, process\.env\.APOLLO_PREVIEW_PASSWORD, process\.env\.BOSS_KEY/);
  assert.match(startNode, /APOLLO_BROWSER_CONTROL_PASSWORD, process\.env\.APOLLO_PREVIEW_PASSWORD, process\.env\.BOSS_KEY/);
});

test("Bulletin Stop is terminal and Hostless mode rejects sub-minute task schedules", async () => {
  const priorCron = process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON;
  process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = "1";
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-stop-"));
  const app = createBulletinServer({ statePath: join(directory, "state.json"), port: 0 });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const created = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Stop me", prompt: "No-op", destination: "test-simulator", scheduleType: "manual" }),
    });
    const { task } = await created.json();
    const stopped = await fetch(origin + "/api/tasks/" + task.id + "/stop", { method: "POST" });
    assert.equal(stopped.status, 200);
    assert.equal((await stopped.json()).task.status, "stopped");
    const rerun = await fetch(origin + "/api/tasks/" + task.id + "/run", { method: "POST" });
    assert.equal(rerun.status, 409);
    await rerun.text();
    const seconds = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Too frequent", prompt: "No-op", destination: "test-simulator", scheduleType: "interval", every: 10, unit: "seconds" }),
    });
    assert.equal(seconds.status, 400);
    await seconds.text();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
    if (priorCron === undefined) delete process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON; else process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON = priorCron;
  }
});

test("work resumer checkpoint records the phone-hosted implementation and remaining smoke test", async () => {
  const { readFile } = await import("node:fs/promises");
  const checkpoint = await readFile(new URL("../tools/apollo-work-resumer/CHECKPOINT.md", import.meta.url), "utf8");
  assert.match(checkpoint, /Hostless owns scheduling/);
  assert.match(checkpoint, /Apollo session gate/);
  assert.match(checkpoint, /No production deployment/);
});

test("uncertain sends cannot be hidden by Pause or Stop and require manual resolution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-uncertain-"));
  const app = createBulletinServer({
    statePath: join(directory, "state.json"), port: 0,
    dispatch: async () => ({ submitted: false, reason: "browser-dispatch-uncertain-no-retry: test timeout" }),
  });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const created = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Uncertain send", prompt: "Inspect before retry", destination: "test-simulator", scheduleType: "manual" }),
    });
    const { task } = await created.json();
    const runResponse = await fetch(origin + "/api/tasks/" + task.id + "/run", { method: "POST" });
    await runResponse.text();
    let status;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const data = await (await fetch(origin + "/api/tasks")).json();
      status = data.tasks.find(item => item.id === task.id)?.status;
      if (status === "dispatch-uncertain") break;
    }
    assert.equal(status, "dispatch-uncertain");
    const pause = await fetch(origin + "/api/tasks/" + task.id + "/pause", { method: "POST" });
    assert.equal(pause.status, 409);
    await pause.text();
    const stop = await fetch(origin + "/api/tasks/" + task.id + "/stop", { method: "POST" });
    assert.equal(stop.status, 409);
    await stop.text();
    const complete = await fetch(origin + "/api/tasks/" + task.id + "/complete", { method: "POST" });
    assert.equal(complete.status, 200);
    assert.equal((await complete.json()).task.status, "completed");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Pause during an in-flight ChatGPT cycle resumes with a continuation, not the original prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-pause-inflight-"));
  const statePath = join(directory, "state.json");
  let releaseFirst;
  const prompts = [];
  const app = createBulletinServer({
    statePath, port: 0,
    dispatch: async task => {
      prompts.push(task.prompt);
      if (prompts.length === 1) return new Promise(resolve => { releaseFirst = () => resolve({ submitted: true, receipt: { reply: "Partial work; checkpoint updated." }, reason: "first cycle" }); });
      return { submitted: true, receipt: { reply: "Work complete.\n" + task.completionMarker }, reason: "completion marker" };
    },
  });
  try {
    const address = await app.listen();
    const origin = "http://127.0.0.1:" + address.port;
    const created = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Pause safely", prompt: "Implement the requested feature", destination: "chatgpt", conversationUrl: "https://chatgpt.com/c/pause-test", maxCycles: 3, scheduleType: "manual" }),
    });
    const { task } = await created.json();
    const runResponse = await fetch(origin + "/api/tasks/" + task.id + "/run", { method: "POST" });
    await runResponse.text();
    let status;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const data = await (await fetch(origin + "/api/tasks")).json();
      status = data.tasks.find(item => item.id === task.id)?.status;
      if (status === "dispatching" && releaseFirst) break;
    }
    assert.equal(status, "dispatching");
    assert.equal(typeof releaseFirst, "function");
    const paused = await fetch(origin + "/api/tasks/" + task.id + "/pause", { method: "POST" });
    assert.equal(paused.status, 200);
    await paused.text();
    releaseFirst();
    let saved;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      saved = JSON.parse(await readFile(statePath, "utf8"));
      if (saved.tasks[0]?.status === "paused") break;
    }
    assert.equal(saved.tasks[0].status, "paused");
    assert.match(saved.tasks[0].prompt, /^Continue the existing task/);
    const resumed = await fetch(origin + "/api/tasks/" + task.id + "/resume", { method: "POST" });
    assert.equal(resumed.status, 200);
    await resumed.text();
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      saved = JSON.parse(await readFile(statePath, "utf8"));
      if (saved.tasks[0]?.status === "completed") break;
    }
    assert.equal(saved.tasks[0].status, "completed");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /^Continue the existing task/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});


test("Hostless cron dispatcher uses the same token fallback order as gateway auth", async () => {
  const { resolveCronToken } = await import("../tools/apollo-bulletin/cron-auth.mjs");
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN: "cron", APOLLO_BROWSER_CONTROL_PASSWORD: "browser", APOLLO_PREVIEW_PASSWORD: "preview" }), "cron");
  assert.equal(resolveCronToken({ APOLLO_BROWSER_CONTROL_PASSWORD: "browser", APOLLO_PREVIEW_PASSWORD: "preview" }), "browser");
  assert.equal(resolveCronToken({ APOLLO_PREVIEW_PASSWORD: "preview" }), "preview");
  assert.equal(resolveCronToken({ BOSS_KEY: "existing-owner-key" }), "existing-owner-key");
  assert.equal(resolveCronToken({ APOLLO_BULLETIN_CRON_TOKEN: " ", APOLLO_BROWSER_CONTROL_PASSWORD: " ", APOLLO_PREVIEW_PASSWORD: " ", BOSS_KEY: "existing-owner-key" }), "existing-owner-key");
  assert.equal(resolveCronToken({}), "");
});

test("completed ChatGPT recurring occurrences re-arm the schedule with a fresh completion marker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-recurrence-"));
  const statePath = join(directory, "state.json");
  const app = createBulletinServer({
    statePath, port: 0,
    dispatch: async task => ({ submitted: true, receipt: { reply: "Occurrence complete.\n" + task.completionMarker }, reason: "completion" }),
  });
  try {
    const address = await app.listen(), origin = "http://127.0.0.1:" + address.port;
    const created = await fetch(origin + "/api/tasks", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({name:"Recurring ChatGPT task",prompt:"Run this monthly",destination:"chatgpt",conversationUrl:"https://chatgpt.com/c/recurrence-test",scheduleType:"interval",every:1,unit:"hours",maxCycles:2}) });
    assert.equal(created.status,201);
    const { task } = await created.json();
    const originalMarker = JSON.parse(await readFile(statePath, "utf8")).tasks[0].completionMarker;
    const run = await fetch(origin + "/api/tasks/" + task.id + "/run", { method:"POST" });
    assert.equal(run.status,200);
    await run.text();
    let saved;
    for(let attempt=0;attempt<30;attempt++){await new Promise(resolve=>setTimeout(resolve,50));saved=JSON.parse(await readFile(statePath,"utf8"));if(saved.tasks[0]?.status==="scheduled"&&saved.tasks[0]?.totalCycles===1)break;}
    assert.equal(saved.tasks[0].status,"scheduled");
    assert.equal(saved.tasks[0].totalCycles,1);
    assert.equal(saved.tasks[0].cycles,0);
    assert.ok(saved.tasks[0].nextRunAt>Date.now());
    assert.notEqual(saved.tasks[0].completionMarker,originalMarker);
    assert.match(saved.tasks[0].prompt,new RegExp(saved.tasks[0].completionMarker));
    assert.ok(saved.activity.some(item=>item.event==="recurrence-rearmed"));
  } finally { await app.close(); await rm(directory,{recursive:true,force:true}); }
});

test("task API sanitizes internal prompt and review tokens and rejects oversized JSON bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-api-guard-"));
  const app = createBulletinServer({ statePath: join(directory,"state.json"), port:0 });
  try {
    const address=await app.listen(),origin="http://127.0.0.1:"+address.port;
    const created=await fetch(origin+"/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Sanitize",prompt:"Private prompt",destination:"test-simulator",scheduleType:"manual"})});
    assert.equal(created.status,201);
    const task=(await created.json()).task;
    for(const key of ["prompt","basePrompt","completionMarker","reviewKey"])assert.equal(task[key],undefined);
    const list=await (await fetch(origin+"/api/tasks")).json();
    for(const key of ["prompt","basePrompt","completionMarker","reviewKey"])assert.equal(list.tasks[0][key],undefined);
    const oversized=await fetch(origin+"/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Huge",prompt:"x".repeat(40000),destination:"test-simulator",scheduleType:"manual"})});
    assert.equal(oversized.status,413);
    await oversized.text();
  } finally { await app.close(); await rm(directory,{recursive:true,force:true}); }
});

test("pre-send browser blocks pause recoverably and require owner resume, not an uncertain send", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apollo-bulletin-blocked-send-"));
  const statePath = join(directory, "state.json");
  let dispatchCalls = 0;
  const app = createBulletinServer({ statePath, port:0, dispatch:async()=>{dispatchCalls++;return{submitted:false,reason:"browser-dispatch-blocked: ChatGPT login required"};} });
  try {
    const address=await app.listen(),origin="http://127.0.0.1:"+address.port;
    const created=await fetch(origin+"/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Login blocked",prompt:"Do work",destination:"chatgpt",conversationUrl:"https://chatgpt.com/c/login-blocked",scheduleType:"manual"})});
    const {task}=await created.json();
    const run=await fetch(origin+"/api/tasks/"+task.id+"/run",{method:"POST"});
    assert.equal(run.status,200);await run.text();
    let saved;
    for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,50));saved=JSON.parse(await readFile(statePath,"utf8"));if(saved.tasks[0]?.status==="paused")break;}
    assert.equal(saved.tasks[0].status,"paused");
    assert.match(saved.tasks[0].lastEvent,/blocked/);
    assert.ok(saved.activity.some(item=>item.event==="dispatch-blocked-before-send"));
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.equal(dispatchCalls,1,"paused blocked task must not retry automatically");
    const resume=await fetch(origin+"/api/tasks/"+task.id+"/resume",{method:"POST"});
    assert.equal(resume.status,200);await resume.text();
    for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,50));saved=JSON.parse(await readFile(statePath,"utf8"));if(dispatchCalls>=2&&saved.tasks[0]?.status==="paused")break;}
    assert.equal(dispatchCalls,2,"owner resume should make a deliberate second attempt");
    assert.equal(saved.tasks[0].status,"paused");
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.equal(dispatchCalls,2,"blocked send remains paused after second attempt");
  } finally { await app.close(); await rm(directory,{recursive:true,force:true}); }
});
