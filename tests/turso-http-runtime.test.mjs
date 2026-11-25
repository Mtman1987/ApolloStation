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

test("parallel transaction calls are serialized on the same Hrana stream", async () => {
  const calls = [];
  const batons = ["stream-1", "stream-2", "stream-3", null];
  const adapter = new TursoHttpAdapter({
    url: "libsql://apollo.example.turso.io",
    authToken: "test-only",
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return response(batons[calls.length - 1], [ok()]);
    },
  });
  await adapter.transaction(async (tx) => {
    await Promise.all([
      tx.execute("INSERT INTO probe(id) VALUES (?)", ["one"]),
      tx.execute("INSERT INTO probe(id) VALUES (?)", ["two"]),
    ]);
  });
  assert.deepEqual(calls.map((call) => call.baton), [null, "stream-1", "stream-2", "stream-3"]);
  assert.deepEqual(calls.slice(1, 3).map((call) => call.requests[0].stmt.args[0].value), ["one", "two"]);
  assert.equal(calls[3].requests[0].stmt.sql, "COMMIT");
});

test("Turso requests carry an abort signal and complete within the default timeout", async () => {
  let seenSignal;
  const adapter = new TursoHttpAdapter({
    url: "libsql://apollo.example.turso.io",
    authToken: "test-only",
    fetchImpl: async (_url, init) => {
      seenSignal = init.signal;
      return response(null, [ok()]);
    },
  });
  await adapter.execute("SELECT 1");
  assert.ok(seenSignal instanceof AbortSignal);
  assert.equal(seenSignal.aborted, false);
});

test("a Turso request that never resolves times out instead of hanging forever", async () => {
  const adapter = new TursoHttpAdapter({
    url: "libsql://apollo.example.turso.io",
    authToken: "test-only",
    requestTimeoutMs: 25,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      // A wedged connection: the promise settles only when the adapter's
      // abort signal fires, like a real fetch would.
      init.signal.addEventListener("abort", () => reject(init.signal.reason ?? new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(adapter.execute("SELECT 1"), /Turso request timed out after 25ms/);
});

test("Turso adapter rejects a non-positive request timeout", async () => {
  assert.throws(
    () => new TursoHttpAdapter({ url: "libsql://apollo.example.turso.io", authToken: "test-only", requestTimeoutMs: 0 }),
    /requestTimeoutMs must be a positive number/,
  );
});

test("Turso pipeline requests close the connection so the next call dials fresh", async () => {
  const seenHeaders = [];
  const adapter = new TursoHttpAdapter({
    url: "libsql://apollo.example.turso.io",
    authToken: "test-only",
    fetchImpl: async (_url, init) => {
      seenHeaders.push(init.headers);
      return response(null, [ok()]);
    },
  });
  await adapter.execute("SELECT 1");
  await adapter.execute("SELECT 2");
  assert.equal(seenHeaders.length, 2);
  for (const headers of seenHeaders) assert.equal(headers.connection, "close");
});
