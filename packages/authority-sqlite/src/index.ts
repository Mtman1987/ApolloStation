import { DatabaseSync } from "node:sqlite";
import type {
  AuditRecordV1, AuthorityJournalEntryV1, AuthorityStore, OutboxRecordV1, PlatformEventV1, ProviderKindV1,
  ProviderLinkV1, UserRecordV1, WorkspaceProfileV1, XpEventV1,
} from "@spmt/authority-core";
import { AuthorityConflictError } from "@spmt/authority-core";
import type { AccessSessionV1, AuthStore, RefreshTokenV1, ServiceIdentityV1 } from "@spmt/auth-core";
import type { AppInstallV1, AppManifestV1, ControlStore, EntitlementV1, StoredOverlayOutputGrantV1, TenantRecordV1 } from "@spmt/control-core";
import type { AppRuntimeProjectionV1, RegisteredOverlayWidgetV1 } from "@spmt/contracts";

export class SqliteAuthorityStore implements AuthorityStore, AuthStore, ControlStore {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(path: string) {
    if (!path) throw new Error("SQLite authority path is required; no in-memory production fallback is allowed");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }

  close() { this.db.close(); }
  quickCheck() { return String((this.db.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined)?.quick_check ?? "unknown"); }
  journalMode() { return String((this.db.prepare("PRAGMA journal_mode").get() as Record<string, unknown> | undefined)?.journal_mode ?? "unknown"); }
  probe() {
    const row = this.db.prepare("SELECT value FROM authority_meta WHERE key = 'epoch'").get() as { value?: string } | undefined;
    const epoch = Number(row?.value ?? NaN);
    return { ready: Number.isSafeInteger(epoch) && epoch > 0, authorityEpoch: epoch, journalMode: this.journalMode() };
  }

  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
    finally { this.transactionDepth -= 1; }
  }

  getUser(userId: string) { return this.oneJson<UserRecordV1>("SELECT body FROM users WHERE id = ?", userId); }
  putUser(user: UserRecordV1) { if (Number(this.db.prepare("INSERT INTO users(id, body) VALUES(?, ?) ON CONFLICT(id) DO NOTHING").run(user.id, json(user)).changes) > 0) this.journal("user", user.id, user); }
  getProviderLink(provider: ProviderKindV1, providerUserId: string) { return this.oneJson<ProviderLinkV1>("SELECT body FROM provider_links WHERE provider = ? AND provider_user_id = ?", provider, providerUserId); }
  listProviderLinks(userId: string) { return this.allJson<ProviderLinkV1>("SELECT body FROM provider_links WHERE user_id = ? ORDER BY provider, provider_user_id", userId); }
  putProviderLink(link: ProviderLinkV1) { this.db.prepare("INSERT INTO provider_links(provider, provider_user_id, user_id, body) VALUES(?, ?, ?, ?) ON CONFLICT(provider, provider_user_id) DO UPDATE SET user_id=excluded.user_id, body=excluded.body").run(link.provider, link.providerUserId, link.userId, json(link)); this.journal("provider-link", `${link.provider}:${link.providerUserId}`, link); }
  getWorkspace(tenantId: string) { return this.oneJson<WorkspaceProfileV1>("SELECT body FROM workspaces WHERE tenant_id = ?", tenantId); }
  putWorkspace(profile: WorkspaceProfileV1) { this.db.prepare("INSERT INTO workspaces(tenant_id, revision, body) VALUES(?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET revision=excluded.revision, body=excluded.body").run(profile.tenantId, profile.revision, json(profile)); this.journal("workspace", profile.tenantId, profile, profile.tenantId); }
  findIdempotent<T>(namespace: string, tenantId: string, key: string) { return this.oneJson<T>("SELECT body FROM idempotency WHERE namespace = ? AND tenant_id = ? AND idem_key = ?", namespace, tenantId, key); }
  putIdempotent<T>(namespace: string, tenantId: string, key: string, value: T) { this.db.prepare("INSERT INTO idempotency(namespace, tenant_id, idem_key, body) VALUES(?, ?, ?, ?) ON CONFLICT(namespace, tenant_id, idem_key) DO NOTHING").run(namespace, tenantId, key, json(value)); }
  appendXp(event: XpEventV1) { this.db.prepare("INSERT INTO xp_events(id, tenant_id, user_id, idempotency_key, delta, body) VALUES(?, ?, ?, ?, ?, ?)").run(event.id, event.tenantId, event.userId, event.idempotencyKey, event.delta, json(event)); this.journal("xp", event.id, event, event.tenantId); }
  listXp(tenantId: string, userId: string) { return this.allJson<XpEventV1>("SELECT body FROM xp_events WHERE tenant_id = ? AND user_id = ? ORDER BY rowid", tenantId, userId); }
  appendEvent(event: PlatformEventV1) { this.db.prepare("INSERT INTO platform_events(id, tenant_id, idempotency_key, body) VALUES(?, ?, ?, ?)").run(event.id, event.tenantId, event.idempotencyKey, json(event)); this.journal("event", event.id, event, event.tenantId); }
  listEvents(tenantId: string) { return this.allJson<PlatformEventV1>("SELECT body FROM platform_events WHERE tenant_id = ? ORDER BY rowid", tenantId); }
  appendAudit(record: AuditRecordV1) { this.db.prepare("INSERT INTO audit_records(id, tenant_id, body) VALUES(?, ?, ?)").run(record.id, record.tenantId ?? null, json(record)); this.journal("audit", record.id, record, record.tenantId); }
  listAudit(tenantId?: string) { return tenantId === undefined ? this.allJson<AuditRecordV1>("SELECT body FROM audit_records ORDER BY rowid") : this.allJson<AuditRecordV1>("SELECT body FROM audit_records WHERE tenant_id = ? ORDER BY rowid", tenantId); }
  getOutbox(id: string) { return this.oneJson<OutboxRecordV1>("SELECT body FROM outbox WHERE id = ?", id); }
  putOutbox(record: OutboxRecordV1) { this.db.prepare("INSERT INTO outbox(id, state, available_at, lease_until, body) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, available_at=excluded.available_at, lease_until=excluded.lease_until, body=excluded.body").run(record.id, record.state, record.availableAt, record.leaseUntil ?? null, json(record)); this.journal("outbox", record.id, record, record.tenantId); }
  listClaimableOutbox(now: string, limit: number) { return this.allJson<OutboxRecordV1>("SELECT body FROM outbox WHERE (state = 'pending' AND available_at <= ?) OR (state = 'leased' AND lease_until IS NOT NULL AND lease_until <= ?) ORDER BY rowid LIMIT ?", now, now, limit); }
  listOutbox() { return this.allJson<OutboxRecordV1>("SELECT body FROM outbox ORDER BY rowid"); }
  getServiceIdentity(serviceId: string) { return this.oneJson<ServiceIdentityV1>("SELECT body FROM service_identities WHERE id = ?", serviceId); }
  putServiceIdentity(identity: ServiceIdentityV1) { this.db.prepare("INSERT INTO service_identities(id, body) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(identity.id, json(identity)); this.journal("service-identity", identity.id, identity); }
  listServiceIdentities() { return this.allJson<ServiceIdentityV1>("SELECT body FROM service_identities ORDER BY id"); }
  getAccessSessionByTokenHash(tokenHash: string) { return this.oneJson<AccessSessionV1>("SELECT body FROM access_sessions WHERE token_hash = ?", tokenHash); }
  putAccessSession(session: AccessSessionV1) { this.db.prepare("INSERT INTO access_sessions(id, token_hash, expires_at, body) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at, body=excluded.body").run(session.id, session.tokenHash, session.expiresAt, json(session)); }
  getRefreshTokenByTokenHash(tokenHash: string) { return this.oneJson<RefreshTokenV1>("SELECT body FROM refresh_tokens WHERE token_hash = ?", tokenHash); }
  putRefreshToken(token: RefreshTokenV1) { this.db.prepare("INSERT INTO refresh_tokens(id, token_hash, family_id, expires_at, body) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(token.id, token.tokenHash, token.familyId, token.expiresAt, json(token)); }
  revokeRefreshFamily(familyId: string, revokedAt: string) { const rows = this.db.prepare("SELECT id, body FROM refresh_tokens WHERE family_id = ?").all(familyId) as Array<{ id: string; body: string }>; const update = this.db.prepare("UPDATE refresh_tokens SET body = ? WHERE id = ?"); for (const row of rows) { const token = JSON.parse(row.body) as RefreshTokenV1; if (!token.revokedAt) update.run(json({ ...token, revokedAt }), row.id); } }
  getTenant(tenantId: string) { return this.oneJson<TenantRecordV1>("SELECT body FROM tenants WHERE id = ?", tenantId); }
  putTenant(tenant: TenantRecordV1) { this.db.prepare("INSERT INTO tenants(id, owner_user_id, status, body) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_user_id=excluded.owner_user_id, status=excluded.status, body=excluded.body").run(tenant.id, tenant.ownerUserId, tenant.status, json(tenant)); this.journal("tenant", tenant.id, tenant, tenant.id); }
  listTenants() { return this.allJson<TenantRecordV1>("SELECT body FROM tenants ORDER BY id"); }
  getApp(appId: string) { return this.oneJson<AppManifestV1>("SELECT body FROM apps WHERE app_id = ?", appId); }
  putApp(app: AppManifestV1) { this.db.prepare("INSERT INTO apps(app_id, status, body) VALUES(?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET status=excluded.status, body=excluded.body").run(app.appId, app.status, json(app)); this.journal("app", app.appId, app); }
  listApps() { return this.allJson<AppManifestV1>("SELECT body FROM apps ORDER BY app_id"); }
  getInstall(tenantId: string, appId: string) { return this.oneJson<AppInstallV1>("SELECT body FROM app_installs WHERE tenant_id = ? AND app_id = ?", tenantId, appId); }
  putInstall(install: AppInstallV1) { this.db.prepare("INSERT INTO app_installs(tenant_id, app_id, enabled, body) VALUES(?, ?, ?, ?) ON CONFLICT(tenant_id, app_id) DO UPDATE SET enabled=excluded.enabled, body=excluded.body").run(install.tenantId, install.appId, install.enabled ? 1 : 0, json(install)); this.journal("install", `${install.tenantId}:${install.appId}`, install, install.tenantId); }
  listInstalls(tenantId: string) { return this.allJson<AppInstallV1>("SELECT body FROM app_installs WHERE tenant_id = ? ORDER BY app_id", tenantId); }
  getEntitlement(tenantId: string, appId: string, key: string) { return this.oneJson<EntitlementV1>("SELECT body FROM entitlements WHERE tenant_id = ? AND app_id = ? AND entitlement_key = ?", tenantId, appId, key); }
  putEntitlement(entitlement: EntitlementV1) { this.db.prepare("INSERT INTO entitlements(tenant_id, app_id, entitlement_key, body) VALUES(?, ?, ?, ?) ON CONFLICT(tenant_id, app_id, entitlement_key) DO UPDATE SET body=excluded.body").run(entitlement.tenantId, entitlement.appId, entitlement.key, json(entitlement)); this.journal("entitlement", `${entitlement.tenantId}:${entitlement.appId}:${entitlement.key}`, entitlement, entitlement.tenantId); }
  listEntitlements(tenantId: string, appId?: string) { return appId ? this.allJson<EntitlementV1>("SELECT body FROM entitlements WHERE tenant_id = ? AND app_id = ? ORDER BY entitlement_key", tenantId, appId) : this.allJson<EntitlementV1>("SELECT body FROM entitlements WHERE tenant_id = ? ORDER BY app_id, entitlement_key", tenantId); }
  getOverlayWidget(tenantId: string, appId: string, widgetId: string) { return this.oneJson<RegisteredOverlayWidgetV1>("SELECT body FROM overlay_widgets WHERE tenant_id = ? AND app_id = ? AND widget_id = ?", tenantId, appId, widgetId); }
  putOverlayWidget(widget: RegisteredOverlayWidgetV1) { this.db.prepare("INSERT INTO overlay_widgets(tenant_id, app_id, widget_id, body) VALUES(?, ?, ?, ?) ON CONFLICT(tenant_id, app_id, widget_id) DO UPDATE SET body=excluded.body").run(widget.tenantId, widget.manifest.appId, widget.manifest.widgetId, json(widget)); this.journal("overlay-widget", `${widget.tenantId}:${widget.manifest.appId}:${widget.manifest.widgetId}`, widget, widget.tenantId); }
  listOverlayWidgets(tenantId: string, appId?: string) { return appId ? this.allJson<RegisteredOverlayWidgetV1>("SELECT body FROM overlay_widgets WHERE tenant_id = ? AND app_id = ? ORDER BY widget_id", tenantId, appId) : this.allJson<RegisteredOverlayWidgetV1>("SELECT body FROM overlay_widgets WHERE tenant_id = ? ORDER BY app_id, widget_id", tenantId); }
  getOverlayOutputGrant(grantId: string) { return this.oneJson<StoredOverlayOutputGrantV1>("SELECT body FROM overlay_output_grants WHERE grant_id = ?", grantId); }
  getOverlayOutputGrantByTokenHash(tokenHash: string) { return this.oneJson<StoredOverlayOutputGrantV1>("SELECT body FROM overlay_output_grants WHERE token_hash = ?", tokenHash); }
  putOverlayOutputGrant(grant: StoredOverlayOutputGrantV1) { this.db.prepare("INSERT INTO overlay_output_grants(grant_id, tenant_id, app_id, widget_id, token_hash, expires_at, revoked_at, body) VALUES(?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(grant_id) DO UPDATE SET expires_at=excluded.expires_at, revoked_at=excluded.revoked_at, body=excluded.body").run(grant.grantId, grant.tenantId, grant.appId, grant.widgetId, grant.tokenHash, grant.expiresAt, grant.revokedAt ?? null, json(grant)); this.journal("overlay-output-grant", grant.grantId, publicStoredGrant(grant), grant.tenantId); }
  listOverlayOutputGrants(tenantId: string, appId?: string) { return appId ? this.allJson<StoredOverlayOutputGrantV1>("SELECT body FROM overlay_output_grants WHERE tenant_id = ? AND app_id = ? ORDER BY created_at DESC, grant_id", tenantId, appId) : this.allJson<StoredOverlayOutputGrantV1>("SELECT body FROM overlay_output_grants WHERE tenant_id = ? ORDER BY created_at DESC, grant_id", tenantId); }
  getRuntimeProjection(tenantId: string, appId: string) { return this.oneJson<AppRuntimeProjectionV1>("SELECT body FROM runtime_projections WHERE tenant_id = ? AND app_id = ?", tenantId, appId); }
  putRuntimeProjection(projection: AppRuntimeProjectionV1) { this.db.prepare("INSERT INTO runtime_projections(tenant_id, app_id, state, updated_at, body) VALUES(?, ?, ?, ?, ?) ON CONFLICT(tenant_id, app_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at, body=excluded.body").run(projection.tenantId, projection.appId, projection.state, projection.updatedAt, json(projection)); this.journal("runtime-projection", `${projection.tenantId}:${projection.appId}`, projection, projection.tenantId); }
  listRuntimeProjections(tenantId: string, appId?: string) { return appId ? this.allJson<AppRuntimeProjectionV1>("SELECT body FROM runtime_projections WHERE tenant_id = ? AND app_id = ?", tenantId, appId) : this.allJson<AppRuntimeProjectionV1>("SELECT body FROM runtime_projections WHERE tenant_id = ? ORDER BY app_id", tenantId); }
  getAuthorityEpoch() { const row = this.db.prepare("SELECT value FROM authority_meta WHERE key = 'epoch'").get() as { value: string } | undefined; return Number(row?.value ?? 1); }
  promoteAuthorityEpoch(nextEpoch: number) { return this.transaction(() => { const current = this.getAuthorityEpoch(); if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= current) throw new AuthorityConflictError(`Authority epoch must increase beyond ${current}`); this.db.prepare("UPDATE authority_meta SET value = ? WHERE key = 'epoch'").run(String(nextEpoch)); return nextEpoch; }); }
  listJournal(afterSequence = 0) { const rows = this.db.prepare("SELECT sequence, epoch, kind, tenant_id, record_id, body, created_at FROM authority_journal WHERE sequence > ? ORDER BY sequence").all(afterSequence) as Array<Record<string, unknown>>; return rows.map((row) => ({ sequence: Number(row.sequence), epoch: Number(row.epoch), kind: String(row.kind) as AuthorityJournalEntryV1["kind"], ...(row.tenant_id ? { tenantId: String(row.tenant_id) } : {}), recordId: String(row.record_id), payload: JSON.parse(String(row.body)) as Record<string, unknown>, createdAt: String(row.created_at) })); }

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
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, state TEXT NOT NULL, available_at TEXT NOT NULL, lease_until TEXT, body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS outbox_claimable ON outbox(state, available_at, lease_until);
      CREATE TABLE IF NOT EXISTS service_identities(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS access_sessions(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS refresh_tokens(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, family_id TEXT NOT NULL, expires_at TEXT NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS refresh_tokens_family ON refresh_tokens(family_id);
      CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS apps(app_id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS app_installs(tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, enabled INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tenant_id, app_id)) STRICT;
      CREATE TABLE IF NOT EXISTS entitlements(tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, entitlement_key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tenant_id, app_id, entitlement_key)) STRICT;
      CREATE TABLE IF NOT EXISTS overlay_widgets(tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, widget_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tenant_id, app_id, widget_id)) STRICT;
      CREATE TABLE IF NOT EXISTS overlay_output_grants(grant_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, widget_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT GENERATED ALWAYS AS (json_extract(body, '$.createdAt')) VIRTUAL, expires_at TEXT NOT NULL, revoked_at TEXT, body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS overlay_output_grants_tenant_app ON overlay_output_grants(tenant_id, app_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS runtime_projections(tenant_id TEXT NOT NULL, app_id TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tenant_id, app_id)) STRICT;
      CREATE TABLE IF NOT EXISTS authority_journal(sequence INTEGER PRIMARY KEY AUTOINCREMENT, epoch INTEGER NOT NULL, kind TEXT NOT NULL, tenant_id TEXT, record_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    `);
  }
  private journal(kind: AuthorityJournalEntryV1["kind"], recordId: string, payload: object, tenantId?: string) { this.db.prepare("INSERT INTO authority_journal(epoch, kind, tenant_id, record_id, body, created_at) VALUES(?, ?, ?, ?, ?, ?)").run(this.getAuthorityEpoch(), kind, tenantId ?? null, recordId, json(payload), new Date().toISOString()); }
  private oneJson<T>(sql: string, ...params: Array<string | number>) { const row = this.db.prepare(sql).get(...params) as { body: string } | undefined; return row ? JSON.parse(row.body) as T : undefined; }
  private allJson<T>(sql: string, ...params: Array<string | number>) { const rows = this.db.prepare(sql).all(...params) as Array<{ body: string }>; return rows.map((row) => JSON.parse(row.body) as T); }
}
function json(value: unknown) { return JSON.stringify(value); }
function publicStoredGrant(grant: StoredOverlayOutputGrantV1) { const { tokenHash: _tokenHash, ...value } = grant; return value; }
