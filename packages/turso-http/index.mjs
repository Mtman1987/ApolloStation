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
  throw new Error(`Unsupported Turso parameter type: ${typeof value}`);
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
  constructor({ url, authToken, fetchImpl = fetch }) {
    if (!url || !authToken) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");
    this.endpoint = normalizeTursoUrl(url);
    this.authToken = authToken;
    this.fetchImpl = fetchImpl;
  }

  async request(requests, baton = null, close = true) {
    const wireRequests = close ? [...requests, { type: "close" }] : requests;
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.authToken}`, "content-type": "application/json" },
      body: JSON.stringify({ baton, requests: wireRequests }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Turso HTTP ${response.status}: ${detail}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload.results)) throw new Error("Turso returned a malformed pipeline response");
    return { baton: payload.baton ?? null, results: payload.results };
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
    const send = async (requests, close = false) => {
      const response = await this.request(requests, baton, close);
      baton = response.baton;
      return response.results;
    };
    try {
      const begin = await send([statementRequest({ sql: `BEGIN ${mode.toUpperCase()}` })]);
      decodeStatementResult(begin[0]);
      active = true;
      if (!baton) throw new Error("Turso did not retain the transaction stream");
      const tx = {
        execute: async (sql, args = [], wantRows = false) => {
          if (!active) throw new Error("Turso transaction is no longer active");
          const results = await send([statementRequest({ sql, args, wantRows })]);
          return decodeStatementResult(results[0]);
        },
        pipeline: async (statements) => {
          if (!active) throw new Error("Turso transaction is no longer active");
          if (!statements.length) return [];
          const results = await send(statements.map(statementRequest));
          if (results.length !== statements.length) throw new Error("Turso returned an incomplete transaction pipeline");
          return results.map(decodeStatementResult);
        },
      };
      const value = await work(tx);
      const commit = await send([statementRequest({ sql: "COMMIT" })]);
      decodeStatementResult(commit[0]);
      active = false;
      if (baton) await send([{ type: "close" }], true);
      return value;
    } catch (error) {
      if (active && baton) {
        try {
          const rollback = await send([statementRequest({ sql: "ROLLBACK" })]);
          decodeStatementResult(rollback[0]);
          if (baton) await send([{ type: "close" }], true);
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
