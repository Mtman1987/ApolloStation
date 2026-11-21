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
    const valid = await create({ name: "Hosted task", prompt: "Do work", destination: "chatgpt", conversationUrl: "https://chatgpt.com/c/abc-123", maxCycles: 4, scheduleType: "manual" });
    assert.equal(valid.status, 201);
    const { task } = await valid.json();
    assert.equal(task.destination, "chatgpt");
    assert.equal(task.conversationUrl, "https://chatgpt.com/c/abc-123");
    assert.equal(task.maxCycles, 4);
    assert.equal(task.status, "paused");
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
    await fetch(origin + "/api/tasks/" + task.id + "/run", { method: "POST" });
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

test("Hostless cron endpoint is authenticated and processes one due task per tick", async () => {
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
    const first = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer cron-test-token" } });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { processed: 1, busy: false });
    assert.equal(persisted.tasks[0].status, "dispatched");
    assert.equal(persisted.tasks[1].status, "scheduled");
    const second = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer cron-test-token" } });
    assert.deepEqual(await second.json(), { processed: 1, busy: false });
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

test("Apollo Bulletin proxy requires a signed-in Apollo session for app routes", async () => {
  const { authorizeBulletinRequest } = await import("../apps/spacemountain-web/dist/integrated-server.js");
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
      return new Response(JSON.stringify({ authenticated: true, actorId: "owner-1" }), { status: 200 });
    },
    {},
  );
  assert.equal(seenCookie, "spmt_token=apollo-owner-session");
  assert.equal(allowed.authorized, true);
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
});

test("Node 1 disables its private polling loop when Hostless cron owns scheduling", async () => {
  const { readFile } = await import("node:fs/promises");
  const startNode = await readFile(new URL("../scripts/hostless/start-node.mjs", import.meta.url), "utf8");
  assert.match(startNode, /APOLLO_BULLETIN_USE_HOSTLESS_CRON:\s*"1"/);
  assert.match(startNode, /APOLLO_BULLETIN_REQUIRE_TURSO:\s*"1"/);
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
    const seconds = await fetch(origin + "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Too frequent", prompt: "No-op", destination: "test-simulator", scheduleType: "interval", every: 10, unit: "seconds" }),
    });
    assert.equal(seconds.status, 400);
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
