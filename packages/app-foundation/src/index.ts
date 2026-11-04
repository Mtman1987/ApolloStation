import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  assertAppSettingsDefinitionV1,
  type AppSettingsDefinitionV1,
  type AppSettingsDocumentV1,
  type AppSettingsFieldV1,
  type AppSettingsPatchV1,
  type AppSettingsSubjectV1,
} from "@spmt/contracts";

export type AppPrivateDatasetClassV1 = "private-authority" | "cache" | "staging" | "outbox";
export interface AppPrivateDatasetManifestV1 {
  schemaVersion: 1;
  appId: string;
  dataset: string;
  classification: AppPrivateDatasetClassV1;
  owner: string;
  retention: string;
  maximumBytes: number;
  recovery: string;
}
export interface AppPrivateMigrationV1 { version: number; name: string; checksum: string; up(database: DatabaseSync): void; }
export interface AppPrivateMigrationRecordV1 { version: number; name: string; checksum: string; appliedAt: string; }

interface StoredSettingsV1 {
  appId: string;
  tenantId: string;
  subject: AppSettingsSubjectV1;
  subjectId: string;
  settingsVersion: number;
  revision: number;
  values: Record<string, boolean | string | number>;
  sealedSecrets?: string;
  updatedAt: string;
}

export interface AppSettingsStoreV1 {
  transaction<T>(work: () => T): T;
  get(appId: string, tenantId: string, subject: AppSettingsSubjectV1, subjectId: string): StoredSettingsV1 | undefined;
  put(value: StoredSettingsV1): void;
}
export interface AppSettingsSecretCodecV1 { seal(value: Record<string, string>): string; open(value: string): Record<string, string>; }

export class AppFoundationError extends Error {
  constructor(readonly code: "invalid" | "conflict" | "secrets_unavailable", message: string) { super(message); this.name = "AppFoundationError"; }
}

export class AesGcmAppSettingsSecretCodec implements AppSettingsSecretCodecV1 {
  private readonly key: Buffer;
  constructor(key: Uint8Array) { if (key.byteLength !== 32) throw new AppFoundationError("invalid", "App settings encryption key must be 32 bytes"); this.key = Buffer.from(key); }
  seal(value: Record<string, string>) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv), encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`; }
  open(value: string) { const [iv, tag, encrypted] = value.split("."); if (!iv || !tag || !encrypted) throw new AppFoundationError("invalid", "Stored app settings secrets are invalid"); try { const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8")); return secretRecord(parsed); } catch (error) { if (error instanceof AppFoundationError) throw error; throw new AppFoundationError("invalid", "Stored app settings secrets could not be decrypted"); } }
}

export class AppSettingsService {
  readonly definition: AppSettingsDefinitionV1;
  private readonly fields: Map<string, AppSettingsFieldV1>;
  constructor(definition: AppSettingsDefinitionV1, private readonly store: AppSettingsStoreV1, private readonly secrets?: AppSettingsSecretCodecV1, private readonly now: () => string = () => new Date().toISOString()) { this.definition = structuredClone(assertAppSettingsDefinitionV1(definition)); this.fields = new Map(this.definition.fields.map((field) => [field.key, field])); }

  read(tenantId: string, subjectId: string): AppSettingsDocumentV1 { const normalizedTenant = id(tenantId, "tenantId"), normalizedSubject = id(subjectId, "subjectId"), stored = this.store.get(this.definition.appId, normalizedTenant, this.definition.subject, normalizedSubject); return this.document(stored ?? this.initial(normalizedTenant, normalizedSubject)); }

  patch(tenantId: string, subjectId: string, patch: AppSettingsPatchV1): AppSettingsDocumentV1 {
    if (patch.schemaVersion !== 1 || !Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 0) throw new AppFoundationError("invalid", "App settings patch is invalid");
    const normalizedTenant = id(tenantId, "tenantId"), normalizedSubject = id(subjectId, "subjectId");
    return this.store.transaction(() => {
      const current = this.store.get(this.definition.appId, normalizedTenant, this.definition.subject, normalizedSubject) ?? this.initial(normalizedTenant, normalizedSubject);
      if (current.revision !== patch.expectedRevision) throw new AppFoundationError("conflict", `App settings revision is ${current.revision}, not ${patch.expectedRevision}`);
      const values = { ...this.defaults(), ...current.values };
      for (const [key, value] of Object.entries(patch.values ?? {})) { const field = this.field(key, false); if (value === null) delete values[key]; else values[key] = validateValue(field, value); }
      let secretValues = current.sealedSecrets ? this.requireSecrets().open(current.sealedSecrets) : {};
      if (patch.secrets) { const codec = this.requireSecrets(); for (const [key, value] of Object.entries(patch.secrets)) { this.field(key, true); if (value === null) delete secretValues[key]; else secretValues[key] = validateSecret(value); } if (Object.keys(secretValues).length) current.sealedSecrets = codec.seal(secretValues); else delete current.sealedSecrets; }
      this.required(values, secretValues);
      const now = iso(this.now(), "settings clock");
      const next: StoredSettingsV1 = { ...current, settingsVersion: this.definition.settingsVersion, revision: current.revision + 1, values: explicit(values, this.definition.fields), ...(current.sealedSecrets ? { sealedSecrets: current.sealedSecrets } : {}), updatedAt: now };
      this.store.put(next); return this.document(next);
    });
  }

  readSecrets(tenantId: string, subjectId: string): Record<string, string> { const stored = this.store.get(this.definition.appId, id(tenantId, "tenantId"), this.definition.subject, id(subjectId, "subjectId")); return stored?.sealedSecrets ? this.requireSecrets().open(stored.sealedSecrets) : {}; }
  private initial(tenantId: string, subjectId: string): StoredSettingsV1 { return { appId: this.definition.appId, tenantId, subject: this.definition.subject, subjectId, settingsVersion: this.definition.settingsVersion, revision: 0, values: this.defaults(), updatedAt: iso(this.now(), "settings clock") }; }
  private defaults() { const values: Record<string, boolean | string | number> = {}; for (const field of this.definition.fields) if (!field.sensitive && field.defaultValue !== undefined) values[field.key] = validateValue(field, field.defaultValue); return values; }
  private document(value: StoredSettingsV1): AppSettingsDocumentV1 { const secrets = value.sealedSecrets ? this.requireSecrets().open(value.sealedSecrets) : {}; return { schemaVersion: 1, appId: value.appId, tenantId: value.tenantId, subject: value.subject, subjectId: value.subjectId, settingsVersion: this.definition.settingsVersion, revision: value.revision, values: explicit({ ...this.defaults(), ...value.values }, this.definition.fields), configuredSecretKeys: Object.keys(secrets).sort(), updatedAt: value.updatedAt }; }
  private field(key: string, sensitive: boolean) { const field = this.fields.get(id(key, "settings key")); if (!field || field.sensitive !== sensitive) throw new AppFoundationError("invalid", `${key} is not a ${sensitive ? "secret" : "public"} setting for ${this.definition.appId}`); return field; }
  private required(values: Record<string, boolean | string | number>, secrets: Record<string, string>) { for (const field of this.definition.fields) if (field.required && (field.sensitive ? !secrets[field.key] : values[field.key] === undefined)) throw new AppFoundationError("invalid", `${field.key} is required`); }
  private requireSecrets() { if (!this.secrets) throw new AppFoundationError("secrets_unavailable", "Encrypted app settings storage is not configured"); return this.secrets; }
}

export class SqliteAppPrivateDatabase implements AppSettingsStoreV1 {
  private readonly db: DatabaseSync;
  private depth = 0;
  readonly manifest: AppPrivateDatasetManifestV1;
  constructor(path: string, manifest: AppPrivateDatasetManifestV1, migrations: AppPrivateMigrationV1[] = [], private readonly now: () => string = () => new Date().toISOString()) {
    if (!path) throw new AppFoundationError("invalid", "App-private database path is required");
    this.manifest = validateDataset(manifest);
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_private_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS app_settings(app_id TEXT NOT NULL,tenant_id TEXT NOT NULL,subject TEXT NOT NULL,subject_id TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(app_id,tenant_id,subject,subject_id)) STRICT;
      CREATE INDEX IF NOT EXISTS app_settings_tenant ON app_settings(tenant_id,app_id,subject,subject_id);
    `);
    this.applyMigrations(migrations);
  }
  close() { this.db.close(); }
  transaction<T>(work: () => T): T { if (this.depth > 0) return work(); this.db.exec("BEGIN IMMEDIATE"); this.depth++; try { const result = work(); this.db.exec("COMMIT"); return result; } catch (error) { this.db.exec("ROLLBACK"); throw error; } finally { this.depth--; } }
  get(appId: string, tenantId: string, subject: AppSettingsSubjectV1, subjectId: string) { const row = this.db.prepare("SELECT body FROM app_settings WHERE app_id=? AND tenant_id=? AND subject=? AND subject_id=?").get(appId, tenantId, subject, subjectId) as { body: string } | undefined; return row ? JSON.parse(row.body) as StoredSettingsV1 : undefined; }
  put(value: StoredSettingsV1) { if (value.appId !== this.manifest.appId) throw new AppFoundationError("invalid", "App settings do not belong to this app-private database"); this.db.prepare("INSERT INTO app_settings(app_id,tenant_id,subject,subject_id,revision,updated_at,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(app_id,tenant_id,subject,subject_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,body=excluded.body").run(value.appId, value.tenantId, value.subject, value.subjectId, value.revision, value.updatedAt, JSON.stringify(value)); }
  migrationHistory(): AppPrivateMigrationRecordV1[] { return this.db.prepare("SELECT version,name,checksum,applied_at AS appliedAt FROM app_private_migrations ORDER BY version").all() as unknown as AppPrivateMigrationRecordV1[]; }
  integrityCheck() { const row = this.db.prepare("PRAGMA quick_check").get() as Record<string, string> | undefined; return Object.values(row ?? {})[0] === "ok"; }
  checkpoint() { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); return { appId: this.manifest.appId, dataset: this.manifest.dataset, checkedAt: iso(this.now(), "checkpoint clock"), integrity: this.integrityCheck(), migrations: this.migrationHistory() }; }
  private applyMigrations(migrations: AppPrivateMigrationV1[]) { const sorted = [...migrations].sort((a, b) => a.version - b.version), seen = new Set<number>(); for (const migration of sorted) { if (!Number.isSafeInteger(migration.version) || migration.version < 1 || seen.has(migration.version) || !migration.name.trim() || !/^[a-f0-9]{16,64}$/i.test(migration.checksum)) throw new AppFoundationError("invalid", "App-private migration definition is invalid"); seen.add(migration.version); const current = this.db.prepare("SELECT name,checksum FROM app_private_migrations WHERE version=?").get(migration.version) as { name: string; checksum: string } | undefined; if (current) { if (current.name !== migration.name || current.checksum !== migration.checksum) throw new AppFoundationError("conflict", `Applied migration ${migration.version} was rewritten`); continue; } this.transaction(() => { migration.up(this.db); this.db.prepare("INSERT INTO app_private_migrations(version,name,checksum,applied_at) VALUES(?,?,?,?)").run(migration.version, migration.name, migration.checksum, iso(this.now(), "migration clock")); }); } }
}

export function appPrivateMigrationChecksum(source: string) { if (!source.trim()) throw new AppFoundationError("invalid", "Migration source is empty"); return createHash("sha256").update(source).digest("hex"); }
function validateDataset(value: AppPrivateDatasetManifestV1) { if (value.schemaVersion !== 1 || !["private-authority", "cache", "staging", "outbox"].includes(value.classification) || !Number.isSafeInteger(value.maximumBytes) || value.maximumBytes < 1024 || !value.retention.trim() || !value.recovery.trim()) throw new AppFoundationError("invalid", "App-private dataset manifest is invalid"); return { ...value, appId: id(value.appId, "appId"), dataset: id(value.dataset, "dataset"), owner: id(value.owner, "owner") }; }
function explicit(values: Record<string, boolean | string | number>, fields: AppSettingsFieldV1[]) { const output: Record<string, boolean | string | number> = {}; for (const field of fields) if (!field.sensitive && values[field.key] !== undefined) output[field.key] = validateValue(field, values[field.key]); return output; }
function validateValue(field: AppSettingsFieldV1, value: unknown): boolean | string | number { if (field.type === "boolean") { if (typeof value !== "boolean") bad(field.key); return value; } if (field.type === "number") { if (typeof value !== "number" || !Number.isFinite(value) || (field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) bad(field.key); return value; } if (typeof value !== "string" || value.length > 4000) bad(field.key); if (field.type === "enum" && !field.options?.some((option) => option.value === value)) bad(field.key); return value; }
function validateSecret(value: unknown) { if (typeof value !== "string" || value.length < 1 || value.length > 8192) throw new AppFoundationError("invalid", "Secret setting is invalid"); return value; }
function secretRecord(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppFoundationError("invalid", "Stored app settings secrets are invalid"); const result: Record<string, string> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[id(key, "secret key")] = validateSecret(item); return result; }
function id(value: unknown, name: string) { if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,200}$/.test(value)) throw new AppFoundationError("invalid", `${name} is invalid`); return value; }
function iso(value: unknown, name: string) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new AppFoundationError("invalid", `${name} is invalid`); return new Date(value).toISOString(); }
function bad(key: string): never { throw new AppFoundationError("invalid", `${key} has an invalid value`); }
