import { backup, DatabaseSync } from "node:sqlite";
import type { RecoveryInventoryV1, RecoverySnapshotDescriptorV1, RecoverySnapshotSourceV1 } from "@spmt/recovery-core";

export class SqliteRecoverySource implements RecoverySnapshotSourceV1 {
  constructor(private readonly authorityPath: string) {
    if (!authorityPath) throw new Error("Authority database path is required");
  }

  async createSnapshot(destinationPath: string): Promise<RecoverySnapshotDescriptorV1> {
    const source = new DatabaseSync(this.authorityPath, { readOnly: true, timeout: 5000 });
    try {
      const integrity = String((source.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined)?.integrity_check ?? "");
      if (integrity !== "ok") throw new Error(`Authority integrity check failed: ${integrity || "unknown"}`);
      const descriptor = describeDatabase(source);
      await backup(source, destinationPath, { rate: 128 });
      const snapshot = new DatabaseSync(destinationPath, { readOnly: true, timeout: 5000 });
      try {
        const verified = describeDatabase(snapshot);
        if (verified.authorityEpoch !== descriptor.authorityEpoch || verified.journalSequence !== descriptor.journalSequence || JSON.stringify(verified.inventory) !== JSON.stringify(descriptor.inventory)) {
          throw new Error("Recovery snapshot inventory or epoch changed during verification");
        }
      } finally {
        snapshot.close();
      }
      return descriptor;
    } finally {
      source.close();
    }
  }
}

export function verifySqliteRecoverySnapshot(path: string): RecoverySnapshotDescriptorV1 {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    const integrity = String((db.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined)?.integrity_check ?? "");
    if (integrity !== "ok") throw new Error(`Recovery integrity check failed: ${integrity || "unknown"}`);
    return describeDatabase(db);
  } finally {
    db.close();
  }
}

function describeDatabase(db: DatabaseSync): RecoverySnapshotDescriptorV1 {
  const epochRow = db.prepare("SELECT value FROM authority_meta WHERE key = 'epoch'").get() as { value?: string } | undefined;
  const journalRow = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM authority_journal").get() as { sequence?: number | bigint } | undefined;
  return {
    format: "spmt-authority-sqlite-v1",
    authorityEpoch: Number(epochRow?.value ?? 1),
    journalSequence: Number(journalRow?.sequence ?? 0),
    inventory: inventory(db),
    integrity: "ok",
  };
}

function inventory(db: DatabaseSync): RecoveryInventoryV1 {
  return {
    users: count(db, "users"),
    providerLinks: count(db, "provider_links"),
    workspaces: count(db, "workspaces"),
    xpEvents: count(db, "xp_events"),
    platformEvents: count(db, "platform_events"),
    auditRecords: count(db, "audit_records"),
    serviceIdentities: count(db, "service_identities"),
    tenants: count(db, "tenants"),
    apps: count(db, "apps"),
    appInstalls: count(db, "app_installs"),
    entitlements: count(db, "entitlements"),
    userProfiles: count(db, "user_profiles"),
    userCredentials: count(db, "user_credentials"),
    oauthClients: count(db, "oauth_clients"),
    oauthCodes: count(db, "oauth_codes"),
    commlinkConversations: count(db, "commlink_conversations"),
    commlinkMessages: count(db, "commlink_messages"),
    notifications: count(db, "notifications"),
    webhooks: count(db, "webhooks"),
    stellarContext: count(db, "stellar_context"),
    stellarCapabilities: count(db, "stellar_capabilities"),
  };
}

function count(db: DatabaseSync, table: string) {
  const allowed = new Set([
    "users", "provider_links", "workspaces", "xp_events", "platform_events", "audit_records", "service_identities",
    "tenants", "apps", "app_installs", "entitlements", "user_profiles", "user_credentials", "oauth_clients", "oauth_codes",
    "commlink_conversations", "commlink_messages", "notifications", "webhooks", "stellar_context", "stellar_capabilities",
  ]);
  if (!allowed.has(table)) throw new Error("Unknown recovery inventory table");
  const exists = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(table) as { present?: number } | undefined;
  if (!exists) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number | bigint } | undefined;
  return Number(row?.count ?? 0);
}
