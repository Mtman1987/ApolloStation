import { DatabaseSync } from "node:sqlite";
import type {
  AuditRecordV1, AuthorityJournalEntryV1, AuthorityStore, PlatformEventV1, ProviderKindV1,
  ProviderLinkV1, UserRecordV1, WorkspaceProfileV1, XpEventV1,
} from "@spmt/authority-core";
import { AuthorityConflictError } from "@spmt/authority-core";
import type { AccessSessionV1, AuthStore, RefreshTokenV1, ServiceIdentityV1 } from "@spmt/auth-core";

export class SqliteAuthorityStore implements AuthorityStore, AuthStore {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(path: string) {
    if (!path) throw new Error("SQLite authority path is required; no in-memory production fallback is allowed");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }

  close() { this.db.close(); }

  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  getUser(userId: string) { return this.oneJson<UserRecordV1>("SELECT body FROM users WHERE id = ?", userId); }
  putUser(user: UserRecordV1) {
    const changed = Number(this.db.prepare("INSERT INTO users(id, body) VALUES(?, ?) ON CONFLICT(id) DO NOTHING").run(user.id, json(user)).changes) > 0;
    if (changed) this.journal("user", user.id, user);
  }

  getProviderLink(provider: ProviderKindV1, providerUserId: string) {
    return this.oneJson<ProviderLinkV1>("SELECT body FROM provider_links WHERE provider = ? AND provider_user_id = ?", provider, providerUserId);
  }
  putProviderLink(link: ProviderLinkV1) {
    this.db.prepare("INSERT INTO provider_links(provider, provider_user_id, user_id, body) VALUES(?, ?, ?, ?)").run(link.provider, link.providerUserId, link.userId, json(link));
    this.journal("provider-link", `${link.provider}:${link.providerUserId}`, link);
  }

  getWorkspace(tenantId: string) { return this.oneJson<WorkspaceProfileV1>("SELECT body FROM workspaces WHERE tenant_id = ?", tenantId); }
  putWorkspace(profile: WorkspaceProfileV1) {
    this.db.prepare("INSERT INTO workspaces(tenant_id, revision, body) VALUES(?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET revision=excluded.revision, body=excluded.body").run(profile.tenantId, profile.revision, json(profile));
    this.journal("workspace", profile.tenantId, profile, profile.tenantId);
  }

  findIdempotent<T>(namespace: string, tenantId: string, key: string) {
    return this.oneJson<T>("SELECT body FROM idempotency WHERE namespace = ? AND tenant_id = ? AND idem_key = ?", namespace, tenantId, key);
  }
  putIdempotent<T>(namespace: string, tenantId: string, key: string, value: T) {
    this.db.prepare("INSERT INTO idempotency(namespace, tenant_id, idem_key, body) VALUES(?, ?, ?, ?) ON CONFLICT(namespace, tenant_id, idem_key) DO NOTHING").run(namespace, tenantId, key, json(value));
  }

  appendXp(event: XpEventV1) {
    this.db.prepare("INSERT INTO xp_events(id, tenant_id, user_id, idempotency_key, delta, body) VALUES(?, ?, ?, ?, ?, ?)").run(event.id, event.tenantId, event.userId, event.idempotencyKey, event.delta, json(event));
    this.journal("xp", event.id, event, event.tenantId);
  }
  listXp(tenantId: string, userId: string) { return this.allJson<XpEventV1>("SELECT body FROM xp_events WHERE tenant_id = ? AND user_id = ? ORDER BY rowid", tenantId, userId); }

  appendEvent(event: PlatformEventV1) {
    this.db.prepare("INSERT INTO platform_events(id, tenant_id, idempotency_key, body) VALUES(?, ?, ?, ?)").run(event.id, event.tenantId, event.idempotencyKey, json(event));
    this.journal("event", event.id, event, event.tenantId);
  }
  listEvents(tenantId: string) { return this.allJson<PlatformEventV1>("SELECT body FROM platform_events WHERE tenant_id = ? ORDER BY rowid", tenantId); }

  appendAudit(record: AuditRecordV1) {
    this.db.prepare("INSERT INTO audit_records(id, tenant_id, body) VALUES(?, ?, ?)").run(record.id, record.tenantId ?? null, json(record));
    this.journal("audit", record.id, record, record.tenantId);
  }
  listAudit(tenantId?: string) {
    return tenantId === undefined
      ? this.allJson<AuditRecordV1>("SELECT body FROM audit_records ORDER BY rowid")
      : this.allJson<AuditRecordV1>("SELECT body FROM audit_records WHERE tenant_id = ? ORDER BY rowid", tenantId);
  }

  getServiceIdentity(serviceId: string) {
    return this.oneJson<ServiceIdentityV1>("SELECT body FROM service_identities WHERE id = ?", serviceId);
  }
  putServiceIdentity(identity: ServiceIdentityV1) {
    this.db.prepare("INSERT INTO service_identities(id, body) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(identity.id, json(identity));
    this.journal("service-identity", identity.id, identity);
  }
  listServiceIdentities() {
    return this.allJson<ServiceIdentityV1>("SELECT body FROM service_identities ORDER BY id");
  }
  getAccessSessionByTokenHash(tokenHash: string) {
    return this.oneJson<AccessSessionV1>("SELECT body FROM access_sessions WHERE token_hash = ?", tokenHash);
  }
  putAccessSession(session: AccessSessionV1) {
    this.db.prepare("INSERT INTO access_sessions(id, token_hash, expires_at, body) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at, body=excluded.body").run(session.id, session.tokenHash, session.expiresAt, json(session));
  }
  getRefreshTokenByTokenHash(tokenHash: string) {
    return this.oneJson<RefreshTokenV1>("SELECT body FROM refresh_tokens WHERE token_hash = ?", tokenHash);
  }
  putRefreshToken(token: RefreshTokenV1) {
    this.db.prepare("INSERT INTO refresh_tokens(id, token_hash, family_id, expires_at, body) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(token.id, token.tokenHash, token.familyId, token.expiresAt, json(token));
  }
  revokeRefreshFamily(familyId: string, revokedAt: string) {
    const rows = this.db.prepare("SELECT id, body FROM refresh_tokens WHERE family_id = ?").all(familyId) as Array<{ id: string; body: string }>;
    const update = this.db.prepare("UPDATE refresh_tokens SET body = ? WHERE id = ?");
    for (const row of rows) {
      const token = JSON.parse(row.body) as RefreshTokenV1;
      if (!token.revokedAt) update.run(json({ ...token, revokedAt }), row.id);
    }
  }

  getAuthorityEpoch() {
    const row = this.db.prepare("SELECT value FROM authority_meta WHERE key = 'epoch'").get() as { value: string } | undefined;
    return Number(row?.value ?? 1);
  }

  promoteAuthorityEpoch(nextEpoch: number) {
    return this.transaction(() => {
      const current = this.getAuthorityEpoch();
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= current) throw new AuthorityConflictError(`Authority epoch must increase beyond ${current}`);
      this.db.prepare("UPDATE authority_meta SET value = ? WHERE key = 'epoch'").run(String(nextEpoch));
      return nextEpoch;
    });
  }

  listJournal(afterSequence = 0) {
    const rows = this.db.prepare("SELECT sequence, epoch, kind, tenant_id, record_id, body, created_at FROM authority_journal WHERE sequence > ? ORDER BY sequence").all(afterSequence) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      sequence: Number(row.sequence), epoch: Number(row.epoch), kind: String(row.kind) as AuthorityJournalEntryV1["kind"],
      ...(row.tenant_id ? { tenantId: String(row.tenant_id) } : {}), recordId: String(row.record_id),
      payload: JSON.parse(String(row.body)) as Record<string, unknown>, createdAt: String(row.created_at),
    }));
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS authority_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO authority_meta(key, value) VALUES('epoch', '1') ON CONFLICT(key) DO NOTHING;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS provider_links(provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(provider, provider_user_id)) STRICT;
      CREATE TABLE IF NOT EXISTS workspaces(tenant_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS idempotency(namespace TEXT NOT NULL, tenant_id TEXT NOT NULL, idem_key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(namespace, tenant_id, idem_key)) STRICT;
      CREATE TABLE IF NOT EXISTS xp_events(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, delta INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(tenant_id, idempotency_key)) STRICT;
      CREATE TABLE IF NOT EXISTS platform_events(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(tenant_id, idempotency_key)) STRICT;
      CREATE TABLE IF NOT EXISTS audit_records(id TEXT PRIMARY KEY, tenant_id TEXT, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS service_identities(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS access_sessions(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS refresh_tokens(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, family_id TEXT NOT NULL, expires_at TEXT NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS refresh_tokens_family ON refresh_tokens(family_id);
      CREATE TABLE IF NOT EXISTS authority_journal(sequence INTEGER PRIMARY KEY AUTOINCREMENT, epoch INTEGER NOT NULL, kind TEXT NOT NULL, tenant_id TEXT, record_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    `);
  }

  private journal(kind: AuthorityJournalEntryV1["kind"], recordId: string, payload: object, tenantId?: string) {
    this.db.prepare("INSERT INTO authority_journal(epoch, kind, tenant_id, record_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)").run(
      this.getAuthorityEpoch(), kind, tenantId ?? null, recordId, json(payload), new Date().toISOString(),
    );
  }

  private oneJson<T>(sql: string, ...params: Array<string | number>) {
    const row = this.db.prepare(sql).get(...params) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as T : undefined;
  }
  private allJson<T>(sql: string, ...params: Array<string | number>) {
    const rows = this.db.prepare(sql).all(...params) as Array<{ body: string }>;
    return rows.map((row) => JSON.parse(row.body) as T);
  }
}

function json(value: unknown) { return JSON.stringify(value); }
