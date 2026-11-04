import test from "node:test";
import assert from "node:assert/strict";
import { TursoHttpAdapter } from "../packages/turso-http/index.mjs";

function ok(result = {}) {
  return { type: "ok", response: { type: "execute", result: { rows: [], affected_row_count: 0, ...result } } };
}
function response(baton, results) {
  return new Response(JSON.stringify({ baton, base_url: null, results }), { status: 200 });
}

test("Turso interactive transaction retains one Hrana baton through commit", async () => {
  const calls = [];
  const batons = ["stream-1", "stream-2", null];
  const adapter = new TursoHttpAdapter({
    url: "libsql://apollo.example.turso.io",
    authToken: "test-only",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return response(batons[calls.length - 1], [ok()]);
    },
  });
  const value = await adapter.transaction(async (tx) => {
    await tx.execute("INSERT INTO probe(id) VALUES (?)", ["one"]);
    return "committed";
  });
  assert.equal(value, "committed");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].baton, null);
  assert.equal(calls[0].requests[0].stmt.sql, "BEGIN IMMEDIATE");
  assert.equal(calls[1].baton, "stream-1");
  assert.equal(calls[1].requests[0].stmt.sql, "INSERT INTO probe(id) VALUES (?)");
  assert.equal(calls[2].baton, "stream-2");
  assert.equal(calls[2].requests[0].stmt.sql, "COMMIT");
});

test("Turso interactive transaction rolls back after a failed statement", async () => {
  const calls = [];
  const replies = [
    { baton: "stream-1", results: [ok()] },
    { baton: "stream-2", results: [{ type: "error", error: { message: "constraint failed" } }] },
    { baton: null, results: [ok()] },
  ];
  const adapter = new TursoHttpAdapter({
    url: "libsql://apollo.example.turso.io",
    authToken: "test-only",
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      const next = replies[calls.length - 1];
      return response(next.baton, next.results);
    },
  });
  await assert.rejects(
    adapter.transaction(async (tx) => {
      await tx.execute("INSERT INTO probe(id) VALUES (?)", ["duplicate"]);
    }),
    /constraint failed/,
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[2].baton, "stream-2");
  assert.equal(calls[2].requests[0].stmt.sql, "ROLLBACK");
  assert.equal(calls.some((call) => call.requests.some((request) => request.stmt?.sql === "COMMIT")), false);
});

test("Turso transaction callback exceptions trigger rollback and preserve the original error", async () => {
  const calls = [];
  const replies = [
    { baton: "stream-1", results: [ok()] },
    { baton: null, results: [ok()] },
  ];
  const adapter = new TursoHttpAdapter({
    url: "libsql://apollo.example.turso.io",
    authToken: "test-only",
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      const next = replies[calls.length - 1];
      return response(next.baton, next.results);
    },
  });
  await assert.rejects(adapter.transaction(async () => { throw new Error("domain failure"); }), /domain failure/);
  assert.equal(calls[1].requests[0].stmt.sql, "ROLLBACK");
});

test("Turso transaction rejects invalid modes", async () => {
  const adapter = new TursoHttpAdapter({
    url: "libsql://apollo.example.turso.io",
    authToken: "test-only",
    fetchImpl: async () => response(null, [ok()]),
  });
  await assert.rejects(adapter.transaction(async () => undefined, { mode: "unsafe" }), /Unsupported Turso transaction mode/);
});
