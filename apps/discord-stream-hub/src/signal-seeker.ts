import { DatabaseSync } from "node:sqlite";

export const DSH_SIGNAL_SEEKER_ROLE_NAME = "Signal Seeker";
export const DSH_SIGNAL_DROP_TTL_MS = 10 * 60 * 1_000;

export interface DshSignalDropV1 {
  schemaVersion: 1;
  dropId: string;
  tenantId: string;
  channelId: string;
  messageId: string;
  roleId: string;
  signalUrl: string;
  createdAt: string;
  expiresAt: string;
  state: "open" | "claimed" | "expired";
  winnerProviderUserId?: string;
  winnerCanonicalUserId?: string;
  claimedAt?: string;
}

export function dshSignalSeekerPanelPayload(roleId: string) {
  return { content: `Opt in to random Signal drops with the **${DSH_SIGNAL_SEEKER_ROLE_NAME}** role.`, components: [{ type: 1, components: [{ type: 2, style: 3, label: "Join the Egg Hunt", custom_id: `signal_seekers:join:${snowflake(roleId)}` }, { type: 2, style: 2, label: "Leave the Hunt", custom_id: `signal_seekers:leave:${snowflake(roleId)}` }] }], allowed_mentions: { parse: [] } };
}

export function dshSignalDropPayload(roleId: string, signalUrl: string) {
  const url = credentialFreeHttps(signalUrl);
  return { content: `<@&${snowflake(roleId)}> A lost Signal appeared. It fades after 10 minutes.`, components: [{ type: 1, components: [{ type: 2, style: 5, label: "Claim Signal", url }] }], allowed_mentions: { parse: [], roles: [roleId] } };
}

export function dshRepeatSignalBreadcrumb(random: () => number = Math.random): string {
  const hints = [
    "🚀 **HUNT BREADCRUMB** — The carrier is yours already, but another anomaly looks like it wants to **launch**. Curious explorers sometimes find controls where everyone else only sees decoration.",
    "🕳️ **HUNT BREADCRUMB** — The carrier is yours already, but another anomaly does not transmit at all — it **bends**. If Commlink ever feels like gravity stopped following the rules, investigate it.",
  ];
  return hints[Math.min(hints.length - 1, Math.floor(Math.max(0, Math.min(.999999, random())) * hints.length))]!;
}

export class SqliteDshSignalSeekerStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    if (!path) throw new Error("DSH Signal database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dsh_signal_seekers(tenant_id TEXT NOT NULL,provider_user_id TEXT NOT NULL,canonical_user_id TEXT,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,provider_user_id)) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_signal_drops(drop_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,expires_at TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS dsh_signal_open ON dsh_signal_drops(tenant_id,state,expires_at);
    `);
  }
  close(): void { this.db.close(); }
  setSeeking(input: { tenantId: string; providerUserId: string; canonicalUserId?: string; enabled: boolean; at?: string }) {
    const at = timestamp(input.at ?? this.now());
    this.db.prepare("INSERT INTO dsh_signal_seekers(tenant_id,provider_user_id,canonical_user_id,enabled,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,provider_user_id) DO UPDATE SET canonical_user_id=COALESCE(dsh_signal_seekers.canonical_user_id,excluded.canonical_user_id),enabled=excluded.enabled,updated_at=excluded.updated_at")
      .run(clean(input.tenantId), clean(input.providerUserId), input.canonicalUserId ? clean(input.canonicalUserId) : null, input.enabled ? 1 : 0, at);
    return { enabled: input.enabled, updatedAt: at };
  }
  createDrop(input: { dropId: string; tenantId: string; channelId: string; messageId: string; roleId: string; signalUrl: string; now?: string }): DshSignalDropV1 {
    const createdAt = timestamp(input.now ?? this.now());
    const drop: DshSignalDropV1 = { schemaVersion: 1, dropId: clean(input.dropId), tenantId: clean(input.tenantId), channelId: snowflake(input.channelId), messageId: snowflake(input.messageId), roleId: snowflake(input.roleId), signalUrl: credentialFreeHttps(input.signalUrl), createdAt, expiresAt: new Date(Date.parse(createdAt) + DSH_SIGNAL_DROP_TTL_MS).toISOString(), state: "open" };
    this.db.prepare("INSERT INTO dsh_signal_drops(drop_id,tenant_id,expires_at,state,body) VALUES(?,?,?,'open',?)").run(drop.dropId, drop.tenantId, drop.expiresAt, JSON.stringify(drop));
    return drop;
  }
  claim(input: { dropId: string; tenantId: string; providerUserId: string; canonicalUserId?: string; at?: string }): { won: boolean; reason?: "expired" | "claimed"; drop: DshSignalDropV1; reward?: string } {
    const at = timestamp(input.at ?? this.now());
    this.expire(at);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT body,state FROM dsh_signal_drops WHERE drop_id=? AND tenant_id=?").get(clean(input.dropId), clean(input.tenantId)) as { body: string; state: DshSignalDropV1["state"] } | undefined;
      if (!row) throw new Error("Signal drop was not found");
      const drop = JSON.parse(row.body) as DshSignalDropV1;
      if (row.state !== "open" || Date.parse(drop.expiresAt) <= Date.parse(at)) { this.db.exec("COMMIT"); return { won: false, reason: row.state === "claimed" ? "claimed" : "expired", drop: { ...drop, state: row.state } }; }
      const providerUserId = clean(input.providerUserId);
      const next: DshSignalDropV1 = { ...drop, state: "claimed", winnerProviderUserId: providerUserId, ...(input.canonicalUserId ? { winnerCanonicalUserId: clean(input.canonicalUserId) } : {}), claimedAt: at };
      const changed = Number(this.db.prepare("UPDATE dsh_signal_drops SET state='claimed',body=? WHERE drop_id=? AND state='open'").run(JSON.stringify(next), next.dropId).changes);
      this.db.exec("COMMIT");
      return changed ? { won: true, drop: next, reward: "Your reward is `!signal <message>`. No app sign-in required." } : { won: false, reason: "claimed", drop };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  expire(at = this.now()): DshSignalDropV1[] {
    const now = timestamp(at);
    const rows = this.db.prepare("SELECT body FROM dsh_signal_drops WHERE state='open' AND expires_at<=?").all(now) as Array<{ body: string }>;
    const expired = rows.map((row) => ({ ...(JSON.parse(row.body) as DshSignalDropV1), state: "expired" as const }));
    const update = this.db.prepare("UPDATE dsh_signal_drops SET state='expired',body=? WHERE drop_id=? AND state='open'");
    for (const drop of expired) update.run(JSON.stringify(drop), drop.dropId);
    return expired;
  }
  get(tenantId: string, dropId: string): DshSignalDropV1 | undefined {
    const row = this.db.prepare("SELECT body FROM dsh_signal_drops WHERE tenant_id=? AND drop_id=?").get(clean(tenantId), clean(dropId)) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as DshSignalDropV1 : undefined;
  }
  remove(tenantId: string, dropId: string): boolean {
    return Number(this.db.prepare("DELETE FROM dsh_signal_drops WHERE tenant_id=? AND drop_id=?").run(clean(tenantId), clean(dropId)).changes) === 1;
  }
}

function credentialFreeHttps(value: string): string { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error("Signal URL must be credential-free HTTPS"); return url.toString(); }
function snowflake(value: string): string { if (!/^\d{5,30}$/.test(value)) throw new Error("Signal Discord identity is invalid"); return value; }
function clean(value: string): string { if (!value || value.trim() !== value || value.length > 300 || /[\r\n\0]/.test(value)) throw new Error("Signal identity is invalid"); return value; }
function timestamp(value: string): string { const at = Date.parse(value); if (!Number.isFinite(at)) throw new Error("Signal timestamp is invalid"); return new Date(at).toISOString(); }
