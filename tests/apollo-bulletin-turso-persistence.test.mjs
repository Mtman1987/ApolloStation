import test from "node:test";
import assert from "node:assert/strict";
import { createBulletinServer } from "../tools/apollo-bulletin/server.mjs";

function memoryStore() {
  const records = new Map();
  return {
    async initialize() {},
    async get(namespace, tenantId, key) { return records.get([namespace, tenantId, key].join(":")); },
    async put(namespace, tenantId, key, value) { records.set([namespace, tenantId, key].join(":"), structuredClone(value)); },
    async close() {},
  };
}

test("Bulletin tasks survive a server restart through the durable record-store contract", async () => {
  const recordStore = memoryStore();
  const first = createBulletinServer({ port: 0, recordStore });
  const firstAddress = await first.listen();
  const base = `http://127.0.0.1:${firstAddress.port}`;
  try {
    const created = await fetch(base + "/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Turso persistence proof",
        prompt: "This task must survive a process restart.",
        scheduleType: "manual",
        destination: "test-simulator",
      }),
    });
    assert.equal(created.status, 201);
    const payload = await created.json();
    assert.equal(payload.task.status, "paused");
  } finally {
    await first.close();
  }

  const second = createBulletinServer({ port: 0, recordStore });
  const secondAddress = await second.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${secondAddress.port}/api/tasks`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].name, "Turso persistence proof");
    assert.equal(payload.tasks[0].status, "paused");
  } finally {
    await second.close();
  }
});
