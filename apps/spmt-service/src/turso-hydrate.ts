/**
 * Turso -> local SQLite hydrate for SPMT authority and platform stores.
 * Only fills missing local rows; never writes to Turso or replaces existing accounts.
 * The reverse direction (local writes reaching Turso) lives in turso-sync.ts.
 */
import { TursoHttpAdapter } from "@spmt/turso-http";

export type TursoHydrateReport = {
  enabled: boolean;
  reason?: string;
  tables: Record<string, { remote: number; inserted: number; skipped: number; error?: string }>;
  durationMs: number;
};

type AuthorityLike = {
  getUser(id: string): { id: string } | undefined;
  putUser(user: { id: string; createdAt: string }): void;
  getWorkspace(id: string): { tenantId: string; revision: number } | undefined;
  putWorkspace(profile: Record<string, unknown>): void;
  appendXp?(event: { id: string; tenantId: string; userId: string; delta: number; sourceAppId: string; reason: string; idempotencyKey: string; createdAt: string; eventType?: string; metadata?: Record<string, unknown> }): void;
  getTenant?(id: string): { id: string } | undefined;
  putTenant?(tenant: Record<string, unknown>): void;
  getProviderLink?(provider: string, providerUserId: string): unknown;
  putProviderLink?(link: Record<string, unknown>): void;
  getAccessSessionByTokenHash?(tokenHash: string): unknown;
  putAccessSession?(session: Record<string, unknown>): void;
  getRefreshTokenByTokenHash?(tokenHash: string): unknown;
  putRefreshToken?(token: Record<string, unknown>): void;
};
type PlatformLike = {
  getUserProfile(id: string): unknown | undefined;
  getUserProfileByUsername?(name: string): unknown | undefined;
  putUserProfile(profile: { userId: string; username: string; displayName: string; tenantIds: string[]; createdAt: string; updatedAt: string }): void;
  getUserCredential?(userId: string): unknown | undefined;
  putUserCredential?(userId: string, salt: string, hash: string): void;
};

const env = (name: string) => process.env[name]?.trim() || undefined;
const dbUrl = () => env("TURSO_DATABASE_URL") || env("SHARED_TURSO_DATABASE_URL");
const authToken = () => env("TURSO_AUTH_TOKEN") || env("NODE1_TURSO_AUTH_TOKEN");
const parseBody = (value: unknown): Record<string, unknown> | undefined => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed; } catch {}
  return undefined;
};
const ident = (value: string) => '"' + value.replaceAll('"', '""') + '"';

// Turso's HTTP adapter returns a whole result set in one JSON response, so a
// full-table read of a large table (the promoted XP ledger is ~182k rows,
// ~110 MB) can spike the boot process's memory before it ever listens. Page
// the big reads so only one page is in flight at a time; the caller still
// sees every row, in rowid order, and the per-table totals are unchanged.
//
// Pages are fetched by rowid cursor (keyset), not OFFSET: the production
// boot logs showed OFFSET page latency growing with depth (~1s/page early,
// ~48s/page by page 25 of the ledger) because Turso must scan and discard
// every skipped row server-side — the whole scan is O(rows^2) in row visits.
// A cursor page is an index range scan of one page, at any depth. Callers
// pass a select whose first column is rowid; the helper consumes it as the
// cursor and hands the full row through.
const HYDRATE_PAGE_SIZE = 5000;
// The XP ledger is the one huge scan (182,648 promoted rows): at the shared
// page size it needs ~37 requests, and per-request Turso latency from the
// node container swings between sub-second and ~100s while Hostless retires
// an unready container after ~15 min. Run sequentially, the scan kept dying
// mid-flight and restarting from zero (best boot: 68.5% in ~12 min). Fatter
// pages backfired — a 25,000-row page is ~15 MB and cannot finish
// transferring inside a slow window — so the binding constraint is
// per-request COMPLETION, not request count. The ledger is therefore fetched
// in parallel rowid-range lanes at the shared page size (see
// forEachHydratePageParallel): the concurrency is network-side, local
// inserts still serialize on the single JS thread. The other paged scan
// (users) keeps the sequential helper.
const HYDRATE_XP_LANES = 6;
const HYDRATE_PARALLEL_PROGRESS_EVERY_ROWS = 25000;
const HYDRATE_PAGE_ATTEMPTS = 3;
const HYDRATE_PROGRESS_EVERY_PAGES = 5;
type HydrateRow = Awaited<ReturnType<TursoHttpAdapter["execute"]>>["rows"][number];
async function forEachHydratePage(db: TursoHttpAdapter, select: string, label: string, onRow: (row: HydrateRow) => void, pageSize: number = HYDRATE_PAGE_SIZE, range?: { after: number; through: number }): Promise<number> {
  let total = 0, pages = 0, lastRowid: number | null = range ? range.after : null;
  const started = Date.now();
  for (;;) {
    // One failed page fetch used to abort the whole boot hydrate: the paged
    // reads make many sequential requests, and a single stale keep-alive
    // connection (undici surfaces it as "fetch failed") killed two boots
    // after they had already fetched most of the ledger. Retry each page in
    // place; rows already fetched are never repeated.
    const sql = range
      ? `${select} WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ${pageSize}`
      : lastRowid === null
        ? `${select} ORDER BY rowid LIMIT ${pageSize}`
        : `${select} WHERE rowid > ? ORDER BY rowid LIMIT ${pageSize}`;
    const args = range ? [lastRowid ?? range.after, range.through] : lastRowid === null ? [] : [lastRowid];
    let page: Awaited<ReturnType<TursoHttpAdapter["execute"]>> | undefined;
    for (let attempt = 1; attempt <= HYDRATE_PAGE_ATTEMPTS; attempt++) {
      try {
        page = await db.execute(sql, args, true);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === HYDRATE_PAGE_ATTEMPTS) throw error;
        console.warn(`[spmt] turso hydrate page retry afterRowid=${lastRowid ?? 0} attempt=${attempt} error=${message}`);
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
    if (!page) throw new Error("turso hydrate page fetch returned no result");
    pages++;
    total += page.rows.length;
    const lastRow = page.rows[page.rows.length - 1];
    if (lastRow) lastRowid = Number(lastRow[0] ?? 0);
    for (const row of page.rows) onRow(row);
    // Progress logging: a boot that pages a large table used to log nothing
    // until the whole hydrate finished, so a slow or hung boot was
    // indistinguishable from a dead one in the runtime logs. Speak every
    // few pages and once at the end.
    if (pages % HYDRATE_PROGRESS_EVERY_PAGES === 0) {
      console.log(`[spmt] turso hydrate progress table=${label} pages=${pages} rows=${total} elapsedMs=${Date.now() - started}`);
    }
    if (page.rows.length < pageSize) break;
    if (range && lastRowid !== null && lastRowid >= range.through) break;
  }
  console.log(`[spmt] turso hydrate scan complete table=${label} pages=${pages} rows=${total} elapsedMs=${Date.now() - started}`);
  return total;
}

// Parallel variant of the paged scan for the one table big enough to need
// it: probe the rowid span once, split it into HYDRATE_XP_LANES contiguous
// ranges, and keyset-page all lanes concurrently. Each lane's rows are
// disjoint by construction (rowid > laneStart AND rowid <= laneEnd), so the
// caller's insert path sees every row exactly once, and a stalled request
// only stalls its own lane. Any probe failure or a small table falls back
// to the sequential helper unchanged.
async function forEachHydratePageParallel(db: TursoHttpAdapter, select: string, table: string, onRow: (row: HydrateRow) => void, pageSize: number): Promise<number> {
  let min = Number.NaN, max = Number.NaN, count = Number.NaN;
  try {
    const probe = await db.execute(`SELECT MIN(rowid), MAX(rowid), COUNT(*) FROM ${ident(table)}`, [], true);
    const row = probe.rows[0];
    if (row) { min = Number(row[0]); max = Number(row[1]); count = Number(row[2]); }
  } catch { /* fall through to the sequential scan */ }
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(count) || count <= pageSize) {
    return forEachHydratePage(db, select, table, onRow, pageSize);
  }
  const started = Date.now();
  let delivered = 0, nextLogAt = HYDRATE_PARALLEL_PROGRESS_EVERY_ROWS;
  const countingRow = (row: HydrateRow) => {
    onRow(row);
    delivered++;
    if (delivered >= nextLogAt) {
      console.log(`[spmt] turso hydrate parallel progress table=${table} rows=${delivered} of=${count} elapsedMs=${Date.now() - started}`);
      nextLogAt += HYDRATE_PARALLEL_PROGRESS_EVERY_ROWS;
    }
  };
  const chunk = Math.ceil((max - min + 1) / HYDRATE_XP_LANES);
  const lanes: Promise<number>[] = [];
  for (let start = min; start <= max; start += chunk) {
    lanes.push(forEachHydratePage(db, select, table, countingRow, pageSize, { after: start - 1, through: Math.min(start + chunk - 1, max) }));
  }
  const totals = await Promise.all(lanes);
  const total = totals.reduce((sum, laneTotal) => sum + laneTotal, 0);
  console.log(`[spmt] turso hydrate parallel scan complete table=${table} lanes=${lanes.length} rows=${total} elapsedMs=${Date.now() - started}`);
  return total;
}

async function exists(db: TursoHttpAdapter, table: string) {
  const r = await db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", [table], true);
  return r.rows.length > 0;
}
async function columns(db: TursoHttpAdapter, table: string) {
  const r = await db.execute(`PRAGMA table_info(${ident(table)})`, [], true);
  return r.rows.map(row => String(row[1] ?? ""));
}

export async function hydrateSpmtFromTurso(options: { authority: AuthorityLike; platform: PlatformLike; now?: () => string; fetchImpl?: typeof fetch; pageSize?: number }): Promise<TursoHydrateReport> {
  const started = Date.now();
  const report: TursoHydrateReport = { enabled: false, tables: {}, durationMs: 0 };
  const url = dbUrl(), token = authToken();
  if (!url || !token) {
    report.reason = "TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set; local SQLite only";
    report.durationMs = Date.now() - started;
    return report;
  }
  report.enabled = true;
  const db = new TursoHttpAdapter({ url, authToken: token, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const now = options.now ?? (() => new Date().toISOString());
  // Seed-era user bodies may carry profile fields (see the fallback at the
  // end); keep them while the users table is being read.
  const profileHints = new Map<string, Record<string, unknown>>();

  for (const table of ["spmt_users", "users"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table), idCol = cols.includes("id") ? "id" : cols.includes("user_id") ? "user_id" : undefined;
    if (!idCol) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "no user id column" }; continue; }
    const hasBody = cols.includes("body");
    let inserted = 0, skipped = 0;
    const remote = await forEachHydratePage(db, `SELECT rowid, ${ident(idCol)}${hasBody ? ", body" : ""} FROM ${ident(table)}`, table, (row) => {
      const id = String(row[1] ?? "");
      if (!id) return;
      const body = hasBody ? parseBody(row[2]) : undefined;
      if (body && typeof body.username === "string" && body.username.trim()) profileHints.set(id, body);
      if (options.authority.getUser(id)) { skipped++; return; }
      options.authority.putUser({ id, createdAt: typeof body?.createdAt === "string" ? body.createdAt : now() });
      inserted++;
    }, options.pageSize);
    report.tables[table] = { remote, inserted, skipped };
    break;
  }

  if (options.authority.getTenant && options.authority.putTenant) for (const table of ["spmt_tenants", "tenants"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table);
    if (!cols.includes("id") || !cols.includes("body")) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "expected id + body" }; continue; }
    const result = await db.execute(`SELECT id, body FROM ${ident(table)}`, [], true);
    let inserted = 0, skipped = 0;
    for (const row of result.rows) {
      const id = String(row[0] ?? "");
      const body = parseBody(row[1]);
      if (!id || !body || body.id !== id) { skipped++; continue; }
      if (options.authority.getTenant(id)) { skipped++; continue; }
      options.authority.putTenant(body);
      inserted++;
    }
    report.tables[table] = { remote: result.rows.length, inserted, skipped };
    break;
  }

  if (options.authority.getProviderLink && options.authority.putProviderLink) for (const table of ["spmt_provider_links", "provider_links"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table);
    if (!cols.includes("provider") || !cols.includes("provider_user_id") || !cols.includes("body")) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "expected provider + provider_user_id + body" }; continue; }
    const result = await db.execute(`SELECT provider, provider_user_id, body FROM ${ident(table)}`, [], true);
    let inserted = 0, skipped = 0;
    for (const row of result.rows) {
      const provider = String(row[0] ?? ""), providerUserId = String(row[1] ?? "");
      const body = parseBody(row[2]);
      if (!provider || !providerUserId || !body) { skipped++; continue; }
      if (options.authority.getProviderLink(provider, providerUserId)) { skipped++; continue; }
      options.authority.putProviderLink(body);
      inserted++;
    }
    report.tables[table] = { remote: result.rows.length, inserted, skipped };
    break;
  }

  for (const table of ["spmt_workspace_profiles", "workspaces", "workspace_profiles"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table), tenantCol = cols.includes("tenant_id") ? "tenant_id" : cols.includes("tenantId") ? "tenantId" : undefined;
    if (!tenantCol) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "no tenant column" }; continue; }
    const hasBody = cols.includes("body"), hasRevision = cols.includes("revision");
    const select = `SELECT ${ident(tenantCol)}${hasRevision ? ", revision" : ""}${hasBody ? (hasRevision ? ", body" : ", body") : ""} FROM ${ident(table)}`;
    const result = await db.execute(select, [], true);
    let inserted = 0, skipped = 0;
    for (const row of result.rows) {
      const tenantId = String(row[0] ?? "");
      if (!tenantId) continue;
      if (options.authority.getWorkspace(tenantId)) { skipped++; continue; }
      let revision = hasRevision ? Number(row[1] ?? 1) || 1 : 1;
      const body = hasBody ? parseBody(row[hasRevision ? 2 : 1]) : undefined;
      if (typeof body?.revision === "number" && !hasRevision) revision = body.revision;
      // Rows mirrored by turso-sync carry the complete workspace profile;
      // restore those verbatim instead of rebuilding the reduced seed shape.
      if (body && body.tenantId === tenantId && Array.isArray(body.dockSlots) && body.appearance && typeof body.appearance === "object") {
        options.authority.putWorkspace({ ...body, tenantId, revision });
        inserted++;
        continue;
      }
      const appearance = body?.appearance && typeof body.appearance === "object" ? body.appearance as Record<string, unknown> : {};
      options.authority.putWorkspace({
        tenantId, revision, appearance: { theme: String(appearance.theme ?? "system") },
        dockSlots: [null, null, null],
        ttsSubscriptionIds: Array.isArray(body?.ttsSubscriptionIds) ? body.ttsSubscriptionIds : [],
        appThemes: body?.appThemes && typeof body.appThemes === "object" ? body.appThemes : {},
        updatedAt: typeof body?.updatedAt === "string" ? body.updatedAt : now(),
      });
      inserted++;
    }
    report.tables[table] = { remote: result.rows.length, inserted, skipped };
    break;
  }

  if (options.authority.appendXp) for (const table of ["spmt_xp_ledger", "xp_events", "xp_ledger"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table);
    if (!cols.includes("id")) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "no id column" }; continue; }
    const hasBody = cols.includes("body");
    // Legacy Turso ledgers are not schema-uniform. Some tables named
    // spmt_xp_ledger/xp_events are unrelated or predate the tenant columns.
    // Do not let one incompatible candidate abort the entire authority hydrate;
    // report it and continue looking for a compatible ledger table.
    const requiredColumns = ["tenant_id", "user_id", "delta", "idempotency_key"];
    const missingColumns = hasBody ? [] : requiredColumns.filter(column => !cols.includes(column));
    if (missingColumns.length) {
      report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: `missing columns: ${missingColumns.join(", ")}` };
      continue;
    }
    // Capture the optional method while the outer `if (options.authority.appendXp)`
    // guard still narrows it: the page callback is a separate closure, so the
    // guard's narrowing does not reach inside it. Bind it: the store method
    // reads this.db, so an unbound capture would throw on every event.
    const appendXp = options.authority.appendXp.bind(options.authority);
    let inserted = 0, skipped = 0;
    const xpSelect = hasBody ? `SELECT rowid, id, body FROM ${ident(table)}` : `SELECT rowid, id, tenant_id, user_id, delta, idempotency_key FROM ${ident(table)}`;
    const onXpRow = (row: HydrateRow) => {
      const id = String(row[1] ?? "");
      if (!id) return;
      let event: { id: string; tenantId: string; userId: string; delta: number; sourceAppId: string; reason: string; idempotencyKey: string; createdAt: string; eventType?: string; metadata?: Record<string, unknown> };
      if (hasBody) {
        const body = parseBody(row[2]);
        if (!body) { skipped++; return; }
        event = { id, tenantId: String(body.tenantId ?? body.tenant_id ?? ""), userId: String(body.userId ?? body.user_id ?? ""), delta: Number(body.delta ?? 0), sourceAppId: String(body.sourceAppId ?? body.source_app_id ?? "spmt"), reason: String(body.reason ?? "imported"), idempotencyKey: String(body.idempotencyKey ?? body.idempotency_key ?? id), createdAt: String(body.createdAt ?? body.created_at ?? now()) };
        // Carry the optional event facets through the round trip: the local
        // store persists the whole event as its body and turso-sync mirrors
        // it back, so dropping them here would silently strip them from the
        // Turso copy on the next sync (seed-era events keep their Discord
        // server/channel context only in metadata).
        if (typeof body.eventType === "string" && body.eventType) event.eventType = body.eventType;
        if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) event.metadata = body.metadata as Record<string, unknown>;
      } else {
        event = { id, tenantId: String(row[2] ?? ""), userId: String(row[3] ?? ""), delta: Number(row[4] ?? 0), sourceAppId: "spmt", reason: "imported", idempotencyKey: String(row[5] ?? id), createdAt: now() };
      }
      if (!event.tenantId || !event.userId) { skipped++; return; }
      try { appendXp(event); inserted++; } catch { skipped++; }
    };
    // An explicit page size (tests pin the sequential helper's behavior)
    // keeps the plain sequential scan; production takes the parallel
    // rowid-range scan at the shared page size.
    const remote = options.pageSize !== undefined
      ? await forEachHydratePage(db, xpSelect, table, onXpRow, options.pageSize)
      : await forEachHydratePageParallel(db, xpSelect, table, onXpRow, HYDRATE_PAGE_SIZE);
    report.tables[table] = { remote, inserted, skipped };
    break;
  }

  for (const table of ["spmt_user_profiles", "user_profiles"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table), userCol = cols.includes("user_id") ? "user_id" : cols.includes("userId") ? "userId" : undefined;
    if (!cols.includes("body") || !userCol) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "expected user id + body" }; continue; }
    const hasUsername = cols.includes("username");
    const result = await db.execute(`SELECT ${ident(userCol)}${hasUsername ? ", username" : ""}, body FROM ${ident(table)}`, [], true);
    let inserted = 0, skipped = 0;
    for (const row of result.rows) {
      const userId = String(row[0] ?? "");
      if (!userId) continue;
      if (options.platform.getUserProfile(userId)) { skipped++; continue; }
      const body = parseBody(row[hasUsername ? 2 : 1]);
      if (!body) { skipped++; continue; }
      const username = String(hasUsername ? row[1] : body.username ?? "").trim().toLowerCase();
      if (!username || options.platform.getUserProfileByUsername?.(username)) { skipped++; continue; }
      options.platform.putUserProfile({ userId, username, displayName: String(body.displayName ?? username).slice(0, 120), tenantIds: Array.isArray(body.tenantIds) ? body.tenantIds.map(String) : [], createdAt: String(body.createdAt ?? now()), updatedAt: String(body.updatedAt ?? now()) });
      inserted++;
    }
    report.tables[table] = { remote: result.rows.length, inserted, skipped };
    break;
  }

  if (options.platform.getUserCredential && options.platform.putUserCredential) for (const table of ["spmt_user_credentials", "user_credentials"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table);
    if (!cols.includes("user_id") || !cols.includes("salt") || !cols.includes("password_hash")) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "expected user_id + salt + password_hash" }; continue; }
    const result = await db.execute(`SELECT user_id, salt, password_hash FROM ${ident(table)}`, [], true);
    let inserted = 0, skipped = 0;
    for (const row of result.rows) {
      const userId = String(row[0] ?? ""), salt = String(row[1] ?? ""), hash = String(row[2] ?? "");
      if (!userId || !salt || !hash) { skipped++; continue; }
      if (options.platform.getUserCredential(userId)) { skipped++; continue; }
      options.platform.putUserCredential(userId, salt, hash);
      inserted++;
    }
    report.tables[table] = { remote: result.rows.length, inserted, skipped };
    break;
  }

  if (options.authority.getAccessSessionByTokenHash && options.authority.putAccessSession) for (const table of ["spmt_access_sessions", "access_sessions"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table);
    if (!cols.includes("id") || !cols.includes("body")) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "expected id + body" }; continue; }
    const result = await db.execute(`SELECT id, body FROM ${ident(table)}`, [], true);
    let inserted = 0, skipped = 0;
    for (const row of result.rows) {
      const body = parseBody(row[1]);
      // Expired rows are useless, but revoked rows must come back: a logout
      // recorded only in the mirrored row must stay revoked after a restart.
      if (!body || typeof body.tokenHash !== "string" || typeof body.expiresAt !== "string" || body.expiresAt <= now()) { skipped++; continue; }
      if (options.authority.getAccessSessionByTokenHash(body.tokenHash)) { skipped++; continue; }
      options.authority.putAccessSession(body);
      inserted++;
    }
    report.tables[table] = { remote: result.rows.length, inserted, skipped };
    break;
  }

  if (options.authority.getRefreshTokenByTokenHash && options.authority.putRefreshToken) for (const table of ["spmt_refresh_tokens", "refresh_tokens"]) {
    if (!(await exists(db, table))) continue;
    const cols = await columns(db, table);
    if (!cols.includes("id") || !cols.includes("body")) { report.tables[table] = { remote: 0, inserted: 0, skipped: 0, error: "expected id + body" }; continue; }
    const result = await db.execute(`SELECT id, body FROM ${ident(table)}`, [], true);
    let inserted = 0, skipped = 0;
    for (const row of result.rows) {
      const body = parseBody(row[1]);
      if (!body || typeof body.tokenHash !== "string" || typeof body.expiresAt !== "string" || body.expiresAt <= now()) { skipped++; continue; }
      if (options.authority.getRefreshTokenByTokenHash(body.tokenHash)) { skipped++; continue; }
      options.authority.putRefreshToken(body);
      inserted++;
    }
    report.tables[table] = { remote: result.rows.length, inserted, skipped };
    break;
  }

  // Seed-era exports kept profile fields inside the users body and never
  // wrote a dedicated profiles table (the XP seed's source list has no
  // profiles table). Derive any still-missing profiles from those bodies
  // so recovered accounts come back with their usernames attached.
  if (profileHints.size) {
    let inserted = 0, skipped = 0;
    for (const [userId, body] of profileHints) {
      const username = String(body.username ?? "").trim().toLowerCase();
      if (!username || options.platform.getUserProfile(userId) || options.platform.getUserProfileByUsername?.(username)) { skipped++; continue; }
      options.platform.putUserProfile({ userId, username, displayName: String(body.displayName ?? username).slice(0, 120), tenantIds: Array.isArray(body.tenantIds) ? body.tenantIds.map(String) : [], createdAt: String(body.createdAt ?? now()), updatedAt: String(body.updatedAt ?? now()) });
      inserted++;
    }
    report.tables["user_profile_hints"] = { remote: profileHints.size, inserted, skipped };
  }
  report.durationMs = Date.now() - started;
  return report;
}

