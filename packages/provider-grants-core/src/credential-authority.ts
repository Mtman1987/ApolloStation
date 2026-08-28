import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ProviderGrantProviderV1 } from "@spmt/contracts";
import { ProviderGrantError, type ProviderCredentialSourceV1, type ProviderCredentialV1 } from "./index.js";

export const REFRESHABLE_PROVIDER_GRANT_PROVIDERS = ["twitch", "discord", "kick"] as const;
export type RefreshableProviderGrantProviderV1 = (typeof REFRESHABLE_PROVIDER_GRANT_PROVIDERS)[number];
export type ProviderCredentialStateV1 = "ready" | "refreshing" | "reauthorization-required" | "revoked";
export type ProviderCredentialRefreshModeV1 = "oauth" | "replace-only";

export interface ProviderCredentialWriteV1 {
  schemaVersion: 1;
  tenantId: string;
  provider: ProviderGrantProviderV1;
  providerUserId: string;
  accessToken: string;
  refreshToken?: string;
  refreshMode: ProviderCredentialRefreshModeV1;
  metadata: Record<string, string>;
  scopes: string[];
  expiresAt: string;
  refreshExpiresAt?: string;
  allowedAppIds: string[];
  allowedCapabilities: string[];
  expectedRevision?: number;
}

export interface ProviderCredentialProjectionV1 {
  schemaVersion: 1;
  tenantId: string;
  provider: ProviderGrantProviderV1;
  providerUserId: string;
  state: ProviderCredentialStateV1;
  refreshMode: ProviderCredentialRefreshModeV1;
  metadata: Record<string, string>;
  scopes: string[];
  expiresAt: string;
  refreshExpiresAt?: string;
  allowedAppIds: string[];
  allowedCapabilities: string[];
  revision: number;
  updatedAt: string;
  lastRefreshedAt?: string;
  reauthorizationReason?: string;
}

export interface ProviderCredentialRecoveryResultV1 {
  status: "ready" | "reauthorization-required" | "unavailable";
  projection?: ProviderCredentialProjectionV1;
  reason?: string;
}

export interface ProviderCredentialRecoveryV1 {
  recover(input: { tenantId: string; provider: ProviderGrantProviderV1; providerUserId: string; reason: string }): Promise<ProviderCredentialRecoveryResultV1>;
}

export interface ProviderOAuthRefreshInputV1 {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  now: string;
}

export interface ProviderOAuthRefreshResultV1 {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt?: string;
  scopes?: string[];
}

export interface ProviderOAuthRefreshAdapterV1 {
  provider: RefreshableProviderGrantProviderV1;
  refresh(input: ProviderOAuthRefreshInputV1): Promise<ProviderOAuthRefreshResultV1>;
}

export interface ProviderOAuthClientV1 { clientId: string; clientSecret: string; }
export type ProviderOAuthClientsV1 = Partial<Record<RefreshableProviderGrantProviderV1, ProviderOAuthClientV1>>;

export interface LegacyProviderCredentialRecordV1 extends Omit<ProviderCredentialWriteV1, "schemaVersion" | "expectedRevision"> {
  sourceRecordId: string;
}

export interface LegacyProviderCredentialImportV1 {
  schemaVersion: 1;
  migrationId: string;
  records: LegacyProviderCredentialRecordV1[];
}

export interface LegacyProviderCredentialImportReceiptV1 {
  schemaVersion: 1;
  migrationId: string;
  imported: number;
  skippedExisting: number;
  completedAt: string;
}

interface StoredSecretsV1 { accessToken: string; refreshToken?: string; }
interface CredentialRow {
  id: string;
  tenant_id: string;
  provider: ProviderGrantProviderV1;
  provider_user_id: string;
  state: ProviderCredentialStateV1;
  revision: number;
  expires_at: string;
  refresh_owner?: string;
  refresh_expires_at?: string;
  sealed_credentials: string;
  body: string;
}

export interface SqliteProviderCredentialAuthorityOptionsV1 {
  now?: () => string;
  owner?: string;
  refreshSkewMs?: number;
  refreshLeaseMs?: number;
  clients?: ProviderOAuthClientsV1;
}

export class SqliteProviderCredentialAuthority implements ProviderCredentialSourceV1, ProviderCredentialRecoveryV1 {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  private readonly adapters = new Map<RefreshableProviderGrantProviderV1, ProviderOAuthRefreshAdapterV1>();
  private readonly clients: ProviderOAuthClientsV1;
  private readonly now: () => string;
  private readonly owner: string;
  private readonly refreshSkewMs: number;
  private readonly refreshLeaseMs: number;

  constructor(path: string, encryptionKey: Uint8Array, adapters: ProviderOAuthRefreshAdapterV1[] = [], options: SqliteProviderCredentialAuthorityOptionsV1 = {}) {
    if (!path) throw new ProviderGrantError("invalid", "Provider credential database path is required");
    if (encryptionKey.byteLength !== 32) throw new ProviderGrantError("invalid", "Provider credential encryption key must be 32 bytes");
    this.key = Buffer.from(encryptionKey);
    this.now = options.now ?? (() => new Date().toISOString());
    this.owner = identifier(options.owner ?? `spmt-refresh-${randomBytes(8).toString("hex")}`, "refresh owner");
    this.refreshSkewMs = boundedInteger(options.refreshSkewMs ?? 60_000, "refresh skew", 0, 15 * 60_000);
    this.refreshLeaseMs = boundedInteger(options.refreshLeaseMs ?? 30_000, "refresh lease", 5_000, 5 * 60_000);
    this.clients = validateClients(options.clients ?? {});
    for (const adapter of adapters) {
      if (!isRefreshable(adapter.provider) || this.adapters.has(adapter.provider)) throw new ProviderGrantError("invalid", "Provider refresh adapter registration is invalid");
      this.adapters.set(adapter.provider, adapter);
    }
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_credentials(
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL,
        state TEXT NOT NULL, revision INTEGER NOT NULL, expires_at TEXT NOT NULL,
        refresh_owner TEXT, refresh_expires_at TEXT, sealed_credentials TEXT NOT NULL,
        updated_at TEXT NOT NULL, body TEXT NOT NULL,
        UNIQUE(tenant_id,provider,provider_user_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS provider_credentials_tenant ON provider_credentials(tenant_id,provider,state);
      CREATE TABLE IF NOT EXISTS provider_credential_imports(
        migration_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, body TEXT NOT NULL
      ) STRICT;
    `);
  }

  close(): void { this.db.close(); }

  put(input: ProviderCredentialWriteV1): ProviderCredentialProjectionV1 {
    const value = normalizeWrite(input);
    const key = credentialKey(value.tenantId, value.provider, value.providerUserId);
    const existing = this.row(key);
    if (existing && value.expectedRevision === undefined) throw new ProviderGrantError("denied", "Replacing a provider credential requires its expected revision");
    if (!existing && value.expectedRevision !== undefined && value.expectedRevision !== 0) throw new ProviderGrantError("denied", "Provider credential revision does not match");
    if (existing && value.expectedRevision !== existing.revision) throw new ProviderGrantError("denied", "Provider credential revision does not match");
    const now = timestamp(this.now(), "authority clock");
    const projection: ProviderCredentialProjectionV1 = {
      schemaVersion: 1,
      tenantId: value.tenantId,
      provider: value.provider,
      providerUserId: value.providerUserId,
      state: "ready",
      refreshMode: value.refreshMode,
      metadata: value.metadata,
      scopes: value.scopes,
      expiresAt: value.expiresAt,
      ...(value.refreshExpiresAt ? { refreshExpiresAt: value.refreshExpiresAt } : {}),
      allowedAppIds: value.allowedAppIds,
      allowedCapabilities: value.allowedCapabilities,
      revision: (existing?.revision ?? 0) + 1,
      updatedAt: now,
    };
    const sealed = this.seal(key, { accessToken: value.accessToken, ...(value.refreshToken ? { refreshToken: value.refreshToken } : {}) });
    this.db.prepare(`INSERT INTO provider_credentials(id,tenant_id,provider,provider_user_id,state,revision,expires_at,refresh_owner,refresh_expires_at,sealed_credentials,updated_at,body)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,expires_at=excluded.expires_at,refresh_owner=NULL,refresh_expires_at=NULL,sealed_credentials=excluded.sealed_credentials,updated_at=excluded.updated_at,body=excluded.body`)
      .run(key, value.tenantId, value.provider, value.providerUserId, projection.state, projection.revision, projection.expiresAt, null, null, sealed, now, JSON.stringify(projection));
    return structuredClone(projection);
  }

  get(tenantId: string, provider: ProviderGrantProviderV1, providerUserId: string): ProviderCredentialProjectionV1 | undefined {
    const row = this.row(credentialKey(identifier(tenantId, "tenantId"), providerName(provider), identifier(providerUserId, "providerUserId")));
    return row ? projectionOf(row) : undefined;
  }

  list(tenantId: string): ProviderCredentialProjectionV1[] {
    identifier(tenantId, "tenantId");
    return (this.db.prepare("SELECT * FROM provider_credentials WHERE tenant_id=? ORDER BY provider,provider_user_id").all(tenantId) as unknown as CredentialRow[]).map(projectionOf);
  }

  revoke(tenantId: string, provider: ProviderGrantProviderV1, providerUserId: string, expectedRevision: number): ProviderCredentialProjectionV1 {
    const key = credentialKey(identifier(tenantId, "tenantId"), providerName(provider), identifier(providerUserId, "providerUserId"));
    const row = this.row(key);
    if (!row || row.revision !== expectedRevision) throw new ProviderGrantError("denied", "Provider credential revision does not match");
    const current = projectionOf(row), now = timestamp(this.now(), "authority clock");
    const projection = { ...current, state: "revoked" as const, revision: current.revision + 1, updatedAt: now };
    this.db.prepare("UPDATE provider_credentials SET state='revoked',revision=?,refresh_owner=NULL,refresh_expires_at=NULL,updated_at=?,body=? WHERE id=? AND revision=?").run(projection.revision, now, JSON.stringify(projection), key, expectedRevision);
    return structuredClone(projection);
  }

  async resolve(input: { tenantId: string; provider: ProviderGrantProviderV1; providerUserId: string }): Promise<ProviderCredentialV1 | undefined> {
    const key = credentialKey(identifier(input.tenantId, "tenantId"), providerName(input.provider), identifier(input.providerUserId, "providerUserId"));
    let row = this.row(key);
    if (!row || row.state === "revoked" || row.state === "reauthorization-required") return undefined;
    const now = timestamp(this.now(), "authority clock");
    if (row.state === "ready" && Date.parse(row.expires_at) > Date.parse(now) + this.refreshSkewMs) return this.credential(row);
    const projection = projectionOf(row);
    if (projection.refreshMode !== "oauth") {
      if (Date.parse(row.expires_at) > Date.parse(now)) return this.credential(row);
      this.requireReauthorization(row, "The provider credential expired and must be replaced", now);
      return undefined;
    }
    await this.refreshRow(row, now);
    row = this.row(key);
    return row?.state === "ready" ? this.credential(row) : undefined;
  }

  async recover(input: { tenantId: string; provider: ProviderGrantProviderV1; providerUserId: string; reason: string }): Promise<ProviderCredentialRecoveryResultV1> {
    const key = credentialKey(identifier(input.tenantId, "tenantId"), providerName(input.provider), identifier(input.providerUserId, "providerUserId"));
    const row = this.row(key);
    if (!row || row.state === "revoked") return { status: "reauthorization-required", reason: "The provider credential is not linked" };
    const projection = projectionOf(row);
    if (projection.refreshMode !== "oauth") {
      this.requireReauthorization(row, "The provider rejected this credential; replace it in Account", timestamp(this.now(), "authority clock"));
      const current = this.get(input.tenantId, input.provider, input.providerUserId);
      return { status: "reauthorization-required", ...(current ? { projection: current } : {}), reason: "The provider credential must be replaced" };
    }
    try {
      await this.refreshRow(row, timestamp(this.now(), "authority clock"), true);
      const recovered = this.get(input.tenantId, input.provider, input.providerUserId);
      if (recovered?.state === "ready") return { status: "ready", projection: recovered };
      return { status: "reauthorization-required", ...(recovered ? { projection: recovered } : {}), reason: recovered?.reauthorizationReason ?? "Provider reauthorization is required" };
    } catch (error) {
      if (error instanceof ProviderGrantError && error.code === "unavailable") return { status: "unavailable", reason: error.message };
      throw error;
    }
  }

  importLegacy(input: LegacyProviderCredentialImportV1): LegacyProviderCredentialImportReceiptV1 {
    if (input.schemaVersion !== 1) throw new ProviderGrantError("invalid", "Unsupported provider credential import version");
    const migrationId = identifier(input.migrationId, "migrationId");
    if (!Array.isArray(input.records) || input.records.length > 10_000) throw new ProviderGrantError("invalid", "Provider credential import records are invalid");
    const normalized = input.records.map((record) => ({ sourceRecordId: identifier(record.sourceRecordId, "sourceRecordId"), value: normalizeWrite({ schemaVersion: 1, ...record }) }));
    if (new Set(normalized.map((record) => record.sourceRecordId)).size !== normalized.length) throw new ProviderGrantError("invalid", "Provider credential import source IDs must be unique");
    const existingReceipt = this.db.prepare("SELECT body FROM provider_credential_imports WHERE migration_id=?").get(migrationId) as { body: string } | undefined;
    if (existingReceipt) return JSON.parse(existingReceipt.body) as LegacyProviderCredentialImportReceiptV1;
    const completedAt = timestamp(this.now(), "authority clock");
    let imported = 0, skippedExisting = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.db.prepare("INSERT INTO provider_credentials(id,tenant_id,provider,provider_user_id,state,revision,expires_at,refresh_owner,refresh_expires_at,sealed_credentials,updated_at,body) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
      for (const record of normalized) {
        const value = record.value, key = credentialKey(value.tenantId, value.provider, value.providerUserId);
        if (this.row(key)) { skippedExisting += 1; continue; }
        const projection: ProviderCredentialProjectionV1 = { schemaVersion: 1, tenantId: value.tenantId, provider: value.provider, providerUserId: value.providerUserId, state: "ready", refreshMode: value.refreshMode, metadata: value.metadata, scopes: value.scopes, expiresAt: value.expiresAt, ...(value.refreshExpiresAt ? { refreshExpiresAt: value.refreshExpiresAt } : {}), allowedAppIds: value.allowedAppIds, allowedCapabilities: value.allowedCapabilities, revision: 1, updatedAt: completedAt };
        insert.run(key, value.tenantId, value.provider, value.providerUserId, "ready", 1, value.expiresAt, null, null, this.seal(key, { accessToken: value.accessToken, ...(value.refreshToken ? { refreshToken: value.refreshToken } : {}) }), completedAt, JSON.stringify(projection));
        imported += 1;
      }
      const receipt: LegacyProviderCredentialImportReceiptV1 = { schemaVersion: 1, migrationId, imported, skippedExisting, completedAt };
      this.db.prepare("INSERT INTO provider_credential_imports(migration_id,completed_at,body) VALUES(?,?,?)").run(migrationId, completedAt, JSON.stringify(receipt));
      this.db.exec("COMMIT");
      return receipt;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private async refreshRow(row: CredentialRow, now: string, force = false): Promise<void> {
    if (!force && row.state === "ready" && Date.parse(row.expires_at) > Date.parse(now) + this.refreshSkewMs) return;
    const projection = projectionOf(row);
    if (!isRefreshable(row.provider)) { this.requireReauthorization(row, "This provider does not support automatic refresh", now); return; }
    const adapter = this.adapters.get(row.provider), client = this.clients[row.provider];
    if (!adapter || !client) throw new ProviderGrantError("unavailable", `${row.provider} refresh is not configured`);
    const secrets = this.open(row.id, row.sealed_credentials);
    if (!secrets.refreshToken) { this.requireReauthorization(row, "The linked provider did not supply a refresh token", now); return; }
    if (projection.refreshExpiresAt && Date.parse(projection.refreshExpiresAt) <= Date.parse(now)) { this.requireReauthorization(row, "The provider refresh authorization expired", now); return; }
    const leaseExpiresAt = new Date(Date.parse(now) + this.refreshLeaseMs).toISOString();
    const claimed = this.db.prepare(`UPDATE provider_credentials SET state='refreshing',refresh_owner=?,refresh_expires_at=?,updated_at=?
      WHERE id=? AND state IN ('ready','refreshing') AND (refresh_owner IS NULL OR refresh_expires_at<=?)`).run(this.owner, leaseExpiresAt, now, row.id, now);
    if (!claimed.changes) throw new ProviderGrantError("unavailable", "Provider credential refresh is already in progress");
    try {
      const result = normalizeRefreshResult(await adapter.refresh({ ...client, refreshToken: secrets.refreshToken, now }), now);
      const current = this.row(row.id);
      if (!current || current.refresh_owner !== this.owner) throw new ProviderGrantError("unavailable", "Provider credential refresh lease was lost");
      const next: ProviderCredentialProjectionV1 = { ...projection, state: "ready", scopes: result.scopes ?? projection.scopes, expiresAt: result.expiresAt, ...(result.refreshExpiresAt ? { refreshExpiresAt: result.refreshExpiresAt } : projection.refreshExpiresAt ? { refreshExpiresAt: projection.refreshExpiresAt } : {}), revision: current.revision + 1, updatedAt: now, lastRefreshedAt: now };
      delete next.reauthorizationReason;
      const updated = this.db.prepare("UPDATE provider_credentials SET state='ready',revision=?,expires_at=?,refresh_owner=NULL,refresh_expires_at=NULL,sealed_credentials=?,updated_at=?,body=? WHERE id=? AND refresh_owner=? AND revision=?").run(next.revision, next.expiresAt, this.seal(row.id, { accessToken: result.accessToken, refreshToken: result.refreshToken }), now, JSON.stringify(next), row.id, this.owner, current.revision);
      if (!updated.changes) throw new ProviderGrantError("unavailable", "Provider credential refresh fence was lost");
    } catch (error) {
      if (error instanceof ProviderOAuthRefreshError && error.reauthorizationRequired) {
        const current = this.row(row.id);
        if (current?.refresh_owner === this.owner) this.requireReauthorization(current, error.message, now);
        return;
      }
      this.db.prepare("UPDATE provider_credentials SET state='ready',refresh_owner=NULL,refresh_expires_at=NULL,updated_at=? WHERE id=? AND refresh_owner=?").run(now, row.id, this.owner);
      if (error instanceof ProviderGrantError) throw error;
      throw new ProviderGrantError("unavailable", `Provider credential refresh failed: ${safeReason(error)}`);
    }
  }

  private requireReauthorization(row: CredentialRow, reason: string, now: string): void {
    const current = projectionOf(row);
    const next: ProviderCredentialProjectionV1 = { ...current, state: "reauthorization-required", revision: current.revision + 1, updatedAt: now, reauthorizationReason: safeReason(reason) };
    this.db.prepare("UPDATE provider_credentials SET state='reauthorization-required',revision=?,refresh_owner=NULL,refresh_expires_at=NULL,updated_at=?,body=? WHERE id=?").run(next.revision, now, JSON.stringify(next), row.id);
  }

  private credential(row: CredentialRow): ProviderCredentialV1 {
    const value = projectionOf(row), secrets = this.open(row.id, row.sealed_credentials);
    return { provider: value.provider, providerUserId: value.providerUserId, accessToken: secrets.accessToken, metadata: structuredClone(value.metadata), scopes: [...value.scopes], expiresAt: value.expiresAt, allowedAppIds: [...value.allowedAppIds], allowedCapabilities: [...value.allowedCapabilities] };
  }

  private row(key: string): CredentialRow | undefined { return this.db.prepare("SELECT * FROM provider_credentials WHERE id=?").get(key) as CredentialRow | undefined; }
  private seal(aad: string, value: StoredSecretsV1): string { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv); cipher.setAAD(Buffer.from(aad)); const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`; }
  private open(aad: string, sealed: string): StoredSecretsV1 { try { const [iv, tag, encrypted] = sealed.split("."); if (!iv || !tag || !encrypted) throw new Error("invalid envelope"); const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url")); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(tag, "base64url")); const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8")) as StoredSecretsV1; return { accessToken: credentialSecret(value.accessToken, "accessToken"), ...(value.refreshToken ? { refreshToken: credentialSecret(value.refreshToken, "refreshToken") } : {}) }; } catch { throw new ProviderGrantError("unavailable", "Stored provider credentials could not be decrypted"); } }
}

export class ProviderOAuthRefreshError extends Error {
  constructor(readonly reauthorizationRequired: boolean, message: string) { super(message); this.name = "ProviderOAuthRefreshError"; }
}

export type ProviderRefreshFetchV1 = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function createFirstPartyProviderRefreshAdapters(fetchImpl: ProviderRefreshFetchV1 = fetch as ProviderRefreshFetchV1): ProviderOAuthRefreshAdapterV1[] {
  return [
    formRefreshAdapter("twitch", "https://id.twitch.tv/oauth2/token", "body", fetchImpl),
    formRefreshAdapter("discord", "https://discord.com/api/v10/oauth2/token", "basic", fetchImpl),
    formRefreshAdapter("kick", "https://id.kick.com/oauth/token", "body", fetchImpl),
  ];
}

function formRefreshAdapter(provider: RefreshableProviderGrantProviderV1, endpoint: string, authentication: "body" | "basic", fetchImpl: ProviderRefreshFetchV1): ProviderOAuthRefreshAdapterV1 {
  return { provider, async refresh(input) {
    const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentialSecret(input.refreshToken, "refreshToken") });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (authentication === "basic") headers.authorization = `Basic ${Buffer.from(`${credentialSecret(input.clientId, "clientId")}:${credentialSecret(input.clientSecret, "clientSecret")}`).toString("base64")}`;
    else { params.set("client_id", credentialSecret(input.clientId, "clientId")); params.set("client_secret", credentialSecret(input.clientSecret, "clientSecret")); }
    let response: Awaited<ReturnType<ProviderRefreshFetchV1>>;
    try { response = await fetchImpl(endpoint, { method: "POST", headers, body: params.toString() }); }
    catch { throw new ProviderOAuthRefreshError(false, `${provider} token endpoint is unavailable`); }
    if (!response.ok) throw new ProviderOAuthRefreshError(response.status === 400 || response.status === 401 || response.status === 403, response.status === 400 || response.status === 401 || response.status === 403 ? `${provider} authorization must be renewed` : `${provider} token endpoint returned ${response.status}`);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ProviderOAuthRefreshError(false, `${provider} token endpoint returned invalid JSON`); }
    const body = object(payload, `${provider} refresh response`), expiresIn = boundedInteger(body.expires_in, "expires_in", 1, 365 * 24 * 60 * 60);
    const scopes = body.scope === undefined ? undefined : Array.isArray(body.scope) ? stringList(body.scope, "scope", 200) : typeof body.scope === "string" ? stringList(body.scope.split(/\s+/).filter(Boolean), "scope", 200) : fail("scope is invalid");
    return { accessToken: credentialSecret(body.access_token, "access_token"), refreshToken: credentialSecret(body.refresh_token, "refresh_token"), expiresAt: new Date(Date.parse(timestamp(input.now, "refresh clock")) + expiresIn * 1000).toISOString(), ...(scopes ? { scopes } : {}) };
  } };
}

function normalizeWrite(input: ProviderCredentialWriteV1): ProviderCredentialWriteV1 {
  if (input.schemaVersion !== 1) throw new ProviderGrantError("invalid", "Unsupported provider credential version");
  const refreshMode = input.refreshMode;
  if (refreshMode !== "oauth" && refreshMode !== "replace-only") throw new ProviderGrantError("invalid", "Provider credential refresh mode is invalid");
  const refreshToken = input.refreshToken === undefined ? undefined : credentialSecret(input.refreshToken, "refreshToken");
  if (refreshMode === "oauth" && (!isRefreshable(input.provider) || !refreshToken)) throw new ProviderGrantError("invalid", "OAuth provider credentials require a supported provider and refresh token");
  const expiresAt = timestamp(input.expiresAt, "expiresAt"), refreshExpiresAt = input.refreshExpiresAt === undefined ? undefined : timestamp(input.refreshExpiresAt, "refreshExpiresAt");
  if (refreshExpiresAt && Date.parse(refreshExpiresAt) <= Date.parse(expiresAt)) throw new ProviderGrantError("invalid", "Refresh authorization must outlive the access token");
  return { schemaVersion: 1, tenantId: identifier(input.tenantId, "tenantId"), provider: providerName(input.provider), providerUserId: identifier(input.providerUserId, "providerUserId"), accessToken: credentialSecret(input.accessToken, "accessToken"), ...(refreshToken ? { refreshToken } : {}), refreshMode, metadata: stringRecord(input.metadata, "metadata"), scopes: stringList(input.scopes, "scopes", 200), expiresAt, ...(refreshExpiresAt ? { refreshExpiresAt } : {}), allowedAppIds: stringList(input.allowedAppIds, "allowedAppIds", 100), allowedCapabilities: stringList(input.allowedCapabilities, "allowedCapabilities", 100), ...(input.expectedRevision === undefined ? {} : { expectedRevision: boundedInteger(input.expectedRevision, "expectedRevision", 0, Number.MAX_SAFE_INTEGER) }) };
}
function normalizeRefreshResult(value: ProviderOAuthRefreshResultV1, now: string): ProviderOAuthRefreshResultV1 { const expiresAt = timestamp(value.expiresAt, "refreshed expiresAt"); if (Date.parse(expiresAt) <= Date.parse(now)) throw new ProviderGrantError("unavailable", "Provider returned an already-expired credential"); return { accessToken: credentialSecret(value.accessToken, "accessToken"), refreshToken: credentialSecret(value.refreshToken, "refreshToken"), expiresAt, ...(value.refreshExpiresAt ? { refreshExpiresAt: timestamp(value.refreshExpiresAt, "refreshExpiresAt") } : {}), ...(value.scopes ? { scopes: stringList(value.scopes, "scopes", 200) } : {}) }; }
function projectionOf(row: CredentialRow): ProviderCredentialProjectionV1 { const value = JSON.parse(row.body) as ProviderCredentialProjectionV1; return structuredClone({ ...value, state: row.state, revision: row.revision, expiresAt: row.expires_at }); }
function validateClients(value: ProviderOAuthClientsV1): ProviderOAuthClientsV1 { const result: ProviderOAuthClientsV1 = {}; for (const provider of REFRESHABLE_PROVIDER_GRANT_PROVIDERS) { const item = value[provider]; if (item) result[provider] = { clientId: credentialSecret(item.clientId, `${provider} clientId`), clientSecret: credentialSecret(item.clientSecret, `${provider} clientSecret`) }; } return result; }
function credentialKey(tenantId: string, provider: ProviderGrantProviderV1, providerUserId: string): string { return createHash("sha256").update(`${tenantId}\0${provider}\0${providerUserId}`).digest("hex"); }
function isRefreshable(value: ProviderGrantProviderV1): value is RefreshableProviderGrantProviderV1 { return (REFRESHABLE_PROVIDER_GRANT_PROVIDERS as readonly string[]).includes(value); }
function providerName(value: unknown): ProviderGrantProviderV1 { if (typeof value !== "string" || !["discord", "twitch", "kick", "xbox", "github", "livekit"].includes(value)) throw new ProviderGrantError("invalid", "provider is invalid"); return value as ProviderGrantProviderV1; }
function identifier(value: unknown, name: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,200}$/.test(value)) throw new ProviderGrantError("invalid", `${name} is invalid`); return value; }
function credentialSecret(value: unknown, name: string): string { if (typeof value !== "string" || value.length < 8 || value.length > 8192) throw new ProviderGrantError("invalid", `${name} is invalid`); return value; }
function timestamp(value: unknown, name: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new ProviderGrantError("invalid", `${name} is invalid`); return new Date(value).toISOString(); }
function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new ProviderGrantError("invalid", `${name} is invalid`); return value as number; }
function stringList(value: unknown, name: string, maximum: number): string[] { if (!Array.isArray(value) || !value.length || value.length > maximum) throw new ProviderGrantError("invalid", `${name} is invalid`); return [...new Set(value.map((item) => identifier(item, name)))].sort(); }
function stringRecord(value: unknown, name: string): Record<string, string> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderGrantError("invalid", `${name} is invalid`); const result: Record<string, string> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) { identifier(key, `${name} key`); if (typeof item !== "string" || item.length > 1_000) throw new ProviderGrantError("invalid", `${name} is invalid`); result[key] = item; } return result; }
function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderOAuthRefreshError(false, `${name} is invalid`); return value as Record<string, unknown>; }
function safeReason(value: unknown): string { const text = value instanceof Error ? value.message : String(value); return text.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 500); }
function fail(message: string): never { throw new ProviderOAuthRefreshError(false, message); }
