export function encodeHranaValue(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "bigint") return { type: "integer", value: value.toString() };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Turso parameters cannot contain non-finite numbers");
    if (Number.isInteger(value) && Number.isSafeInteger(value)) return { type: "integer", value: String(value) };
    return { type: "float", value };
  }
  if (typeof value === "string") return { type: "text", value };
  if (value instanceof Uint8Array) return { type: "blob", base64: Buffer.from(value).toString("base64") };
  throw new Error(`Unsupported SQLite value type: ${typeof value}`);
}

export function decodeHranaValue(value) {
  if (!value || value.type === "null") return null;
  if (value.type === "integer") {
    const integer = BigInt(value.value);
    return integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(integer) : integer;
  }
  if (value.type === "float") return value.value;
  if (value.type === "text") return value.value;
  if (value.type === "blob") return Buffer.from(value.base64, "base64");
  throw new Error(`Unsupported Turso result type: ${value.type}`);
}

export function normalizeTursoUrl(value) {
  const url = new URL(value.startsWith("libsql://") ? value.replace(/^libsql:/, "https:") : value);
  if (url.protocol !== "https:") throw new Error("Turso database URL must use libsql:// or https://");
  url.pathname = "/v2/pipeline";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function statementRequest({ sql, args = [], wantRows = false }) {
  return { type: "execute", stmt: { sql, args: args.map(encodeHranaValue), want_rows: wantRows } };
}
function decodeStatementResult(item) {
  if (item?.type !== "ok") throw new Error(`Turso SQL error: ${item?.error?.message ?? "unknown error"}`);
  const result = item.response?.result;
  return {
    columns: (result?.cols ?? []).map((column) => String(column.name ?? "")),
    rows: (result?.rows ?? []).map((row) => row.map(decodeHranaValue)),
    affectedRows: Number(result?.affected_row_count ?? 0),
  };
}

/**
 * Async Turso/libSQL HTTP client. Each interactive transaction owns a Hrana
 * stream and passes its baton sequentially; statements cannot interleave on
 * that stream. Network/commit errors are surfaced, never automatically replayed.
 */
export class TursoHttpAdapter {
  constructor({ url, authToken, fetchImpl = fetch, requestTimeoutMs = 10_000 }) {
    if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("Turso requestTimeoutMs must be a positive number");
    this.endpoint = normalizeTursoUrl(url);
    this.authToken = authToken;
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async request(requests, baton = null, close = true) {
    const wireRequests = close ? [...requests, { type: "close" }] : requests;
    // Bound every request: a fetch that never resolves used to hang the
    // caller forever (the boot hydrate paged through ~120 requests with no
    // timeout, so one wedged connection silenced the whole boot — no error,
    // no log, no listen). Abort after requestTimeoutMs; callers with retry
    // (the hydrate's per-page retry) then retry the page in place, and the
    // timeout is named in the error so the failure is diagnosable.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        // Fresh connection per request: Turso's edge closes the socket after
        // large responses, and undici's pool hands the dead socket to the
        // next call, which then hangs ~60s before failing with "fetch
        // failed". `Connection: close` keeps the socket out of the pool, so
        // every request dials fresh (verified: distinct remote ports per
        // request). Without this, the boot hydrate stalls ~1 min per page
        // and never finishes before Hostless restarts the container.
        headers: { authorization: `Bearer ${this.authToken}`, "content-type": "application/json", connection: "close" },
        body: JSON.stringify({ baton, requests: wireRequests }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`Turso HTTP ${response.status}: ${detail}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload.results)) throw new Error("Turso returned a malformed pipeline response");
      return { baton: payload.baton ?? null, results: payload.results };
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = new Error(`Turso request timed out after ${this.requestTimeoutMs}ms`);
        timeoutError.cause = error;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async pipeline(statements) {
    if (!statements.length) return [];
    const { results } = await this.request(statements.map(statementRequest), null, true);
    if (results.length < statements.length) throw new Error("Turso returned an incomplete pipeline response");
    return results.slice(0, statements.length).map(decodeStatementResult);
  }

  async execute(sql, args = [], wantRows = false) {
    return (await this.pipeline([{ sql, args, wantRows }]))[0];
  }

  async transaction(work, { mode = "immediate" } = {}) {
    if (typeof work !== "function") throw new TypeError("Turso transaction requires a callback");
    if (!["deferred", "immediate", "exclusive"].includes(mode)) throw new Error("Unsupported Turso transaction mode");
    let baton = null;
    let active = false;
    let serial = Promise.resolve();
    let queuedFailure;
    const send = async (requests, close = false) => {
      const response = await this.request(requests, baton, close);
      baton = response.baton;
      return response.results;
    };
    const enqueue = (requests) => {
      const operation = serial.then(async () => {
        if (queuedFailure) throw queuedFailure;
        return send(requests);
      });
      serial = operation.then(() => undefined, (error) => { queuedFailure ??= error; });
      return operation;
    };
    try {
      const begin = await send([statementRequest({ sql: `BEGIN ${mode.toUpperCase()}` })]);
      decodeStatementResult(begin[0]);
      active = true;
      if (!baton) throw new Error("Turso did not retain the transaction stream");
      const tx = {
        execute: async (sql, args = [], wantRows = false) => {
          if (!active) throw new Error("Turso transaction is no longer active");
          const results = await enqueue([statementRequest({ sql, args, wantRows })]);
          return decodeStatementResult(results[0]);
        },
        pipeline: async (statements) => {
          if (!active) throw new Error("Turso transaction is no longer active");
          if (!statements.length) return [];
          const results = await enqueue(statements.map(statementRequest));
          if (results.length !== statements.length) throw new Error("Turso returned an incomplete transaction pipeline");
          return results.map(decodeStatementResult);
        },
      };
      const value = await work(tx);
      await serial;
      if (queuedFailure) throw queuedFailure;
      const commit = await send([statementRequest({ sql: "COMMIT" })]);
      decodeStatementResult(commit[0]);
      active = false;
      if (baton) await send([], true);
      return value;
    } catch (error) {
      if (active && baton) {
        try {
          await serial;
          const rollback = await send([statementRequest({ sql: "ROLLBACK" })]);
          decodeStatementResult(rollback[0]);
          if (baton) await send([], true);
        } catch {
          // Preserve the original failure. A broken network may make rollback
          // confirmation impossible; callers must treat the outcome as unknown.
        }
      }
      active = false;
      throw error;
    }
  }
}
