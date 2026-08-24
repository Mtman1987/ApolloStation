import { DatabaseSync } from "node:sqlite";

export const DSH_MEMBER_GROUPS = ["Crew", "Partners", "Honored Guests", "Raid Pile", "Everyone Else"] as const;
export type DshMemberGroupV1 = (typeof DSH_MEMBER_GROUPS)[number];

export interface DshLiveMemberV1 {
  canonicalUserId: string;
  discordUserId: string;
  twitchLogin: string;
  group: DshMemberGroupV1;
  shoutoutChannelId: string;
}

export interface DshTwitchStreamV1 {
  twitchLogin: string;
  twitchStreamId: string;
  displayName: string;
  title: string;
  gameName: string;
  viewerCount: number;
  thumbnailUrl: string;
  startedAt: string;
}

export type DshLiveActionV1 =
  | { schemaVersion: 1; type: "shoutout.create" | "shoutout.update"; idempotencyKey: string; tenantId: string; member: DshLiveMemberV1; stream: DshTwitchStreamV1 }
  | { schemaVersion: 1; type: "shoutout.remove"; idempotencyKey: string; tenantId: string; member: DshLiveMemberV1; priorStreamId: string }
  | { schemaVersion: 1; type: "spotlight.update"; idempotencyKey: string; tenantId: string; member: DshLiveMemberV1; stream: DshTwitchStreamV1; priorUserId?: string; nextIndex: number; rotatesEveryMs: number }
  | { schemaVersion: 1; type: "spotlight.clear"; idempotencyKey: string; tenantId: string; priorUserId: string };

export interface DshLivePollV1 {
  schemaVersion: 1;
  tenantId: string;
  pollId: string;
  observedAt: string;
  members: DshLiveMemberV1[];
  streams: DshTwitchStreamV1[];
}

export interface DshLivePollResultV1 { duplicate: boolean; actions: DshLiveActionV1[]; liveCount: number; }
export interface PendingDshLiveActionV1 { action: DshLiveActionV1; attempts: number; }
export interface DshLiveDeliveryReportV1 { attempted: number; delivered: number; failed: number; }
export interface DshLiveActionPublisherV1 { publish(action: DshLiveActionV1): void | Promise<void>; }

/** DSH-private durable projection. Canonical identity and XP remain in SPMT. */
export class SqliteDshLiveMonitor {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly spotlightRotationMs = 10 * 60 * 1_000) {
    if (!path) throw new Error("DSH live monitor database path is required");
    if (!Number.isSafeInteger(spotlightRotationMs) || spotlightRotationMs < 1) throw new Error("spotlightRotationMs must be positive");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }
  close(): void { this.db.close(); }

  reconcile(poll: DshLivePollV1): DshLivePollResultV1 {
    assertPoll(poll);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const priorPoll = this.db.prepare("SELECT result FROM live_polls WHERE tenant_id=? AND poll_id=?").get(poll.tenantId, poll.pollId) as { result: string } | undefined;
      if (priorPoll) { this.db.exec("COMMIT"); return { ...(JSON.parse(priorPoll.result) as DshLivePollResultV1), duplicate: true }; }
      const streams = new Map(poll.streams.map((stream) => [stream.twitchLogin.toLowerCase(), stream]));
      const actions: DshLiveActionV1[] = [];
      const live: Array<{ member: DshLiveMemberV1; stream: DshTwitchStreamV1 }> = [];
      const currentMemberIds = new Set(poll.members.map((member) => member.canonicalUserId));
      const removedMembers = this.db.prepare("SELECT user_id AS userId,is_live AS isLive,stream_id AS streamId,body FROM live_members WHERE tenant_id=?").all(poll.tenantId) as Array<{ userId: string; isLive: number; streamId: string | null; body: string }>;
      for (const prior of removedMembers) {
        if (currentMemberIds.has(prior.userId)) continue;
        const member = (JSON.parse(prior.body) as { member: DshLiveMemberV1 }).member;
        if (prior.isLive === 1 && prior.streamId) actions.push({ schemaVersion: 1, type: "shoutout.remove", idempotencyKey: "dsh:shoutout.remove:" + poll.tenantId + ":" + member.canonicalUserId + ":" + prior.streamId, tenantId: poll.tenantId, member, priorStreamId: prior.streamId });
        this.db.prepare("DELETE FROM live_members WHERE tenant_id=? AND user_id=?").run(poll.tenantId, prior.userId);
      }
      for (const member of [...poll.members].sort((a, b) => a.twitchLogin.localeCompare(b.twitchLogin))) {
        const stream = streams.get(member.twitchLogin.toLowerCase());
        const prior = this.getMemberState(poll.tenantId, member.canonicalUserId);
        if (stream) {
          live.push({ member, stream });
          const type = prior?.live ? "shoutout.update" : "shoutout.create";
          const actionVersion = type === "shoutout.create" ? stream.twitchStreamId : poll.pollId;
          actions.push({ schemaVersion: 1, type, idempotencyKey: "dsh:" + type + ":" + poll.tenantId + ":" + member.canonicalUserId + ":" + actionVersion, tenantId: poll.tenantId, member, stream });
          this.putMemberState(poll.tenantId, member, true, stream.twitchStreamId, poll.observedAt);
        } else {
          if (prior?.live && prior.streamId) actions.push({ schemaVersion: 1, type: "shoutout.remove", idempotencyKey: "dsh:shoutout.remove:" + poll.tenantId + ":" + member.canonicalUserId + ":" + prior.streamId, tenantId: poll.tenantId, member, priorStreamId: prior.streamId });
          this.putMemberState(poll.tenantId, member, false, undefined, poll.observedAt);
        }
      }
      const spotlight = this.getSpotlight(poll.tenantId);
      if (!live.length) {
        if (spotlight) actions.push({ schemaVersion: 1, type: "spotlight.clear", idempotencyKey: "dsh:spotlight.clear:" + poll.tenantId + ":" + spotlight.userId + ":" + poll.pollId, tenantId: poll.tenantId, priorUserId: spotlight.userId });
        this.db.prepare("DELETE FROM spotlight WHERE tenant_id=?").run(poll.tenantId);
      } else if (!spotlight || Date.parse(poll.observedAt) - Date.parse(spotlight.rotatedAt) >= this.spotlightRotationMs || !live.some((item) => item.member.canonicalUserId === spotlight.userId)) {
        const index = live.length === 1 ? 0 : (spotlight?.nextIndex ?? 0) % live.length;
        const selected = live[index]!;
        const nextIndex = index + 1;
        actions.push({ schemaVersion: 1, type: "spotlight.update", idempotencyKey: "dsh:spotlight.update:" + poll.tenantId + ":" + selected.member.canonicalUserId + ":" + poll.pollId, tenantId: poll.tenantId, member: selected.member, stream: selected.stream, ...(spotlight ? { priorUserId: spotlight.userId } : {}), nextIndex, rotatesEveryMs: this.spotlightRotationMs });
        this.db.prepare("INSERT INTO spotlight(tenant_id,user_id,next_index,rotated_at,body) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET user_id=excluded.user_id,next_index=excluded.next_index,rotated_at=excluded.rotated_at,body=excluded.body").run(poll.tenantId, selected.member.canonicalUserId, nextIndex, poll.observedAt, JSON.stringify({ member: selected.member, stream: selected.stream }));
      }
      const result: DshLivePollResultV1 = { duplicate: false, actions, liveCount: live.length };
      const queue = this.db.prepare("INSERT INTO live_action_outbox(id,tenant_id,state,attempts,created_at,body) VALUES(?,?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING");
      for (const action of actions) queue.run(action.idempotencyKey, poll.tenantId, poll.observedAt, JSON.stringify(action));
      this.db.prepare("INSERT INTO live_polls(tenant_id,poll_id,observed_at,result) VALUES(?,?,?,?)").run(poll.tenantId, poll.pollId, poll.observedAt, JSON.stringify(result));
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  getLiveMembers(tenantId: string): DshLiveMemberV1[] {
    requireId(tenantId, "tenantId");
    const rows = this.db.prepare("SELECT body FROM live_members WHERE tenant_id=? AND is_live=1 ORDER BY twitch_login").all(tenantId) as Array<{ body: string }>;
    return rows.map((row) => (JSON.parse(row.body) as { member: DshLiveMemberV1 }).member);
  }

  listPendingActions(tenantId: string, limit = 100): PendingDshLiveActionV1[] {
    requireId(tenantId, "tenantId");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("limit must be from 1 to 500");
    const rows = this.db.prepare("SELECT attempts,body FROM live_action_outbox WHERE tenant_id=? AND state='pending' ORDER BY rowid LIMIT ?").all(tenantId, limit) as Array<{ attempts: number; body: string }>;
    return rows.map((row) => ({ attempts: row.attempts, action: JSON.parse(row.body) as DshLiveActionV1 }));
  }
  completeAction(idempotencyKey: string): void { requireId(idempotencyKey, "idempotencyKey"); this.db.prepare("UPDATE live_action_outbox SET state='delivered',last_error=NULL WHERE id=?").run(idempotencyKey); }
  failAction(idempotencyKey: string, error: string): void { requireId(idempotencyKey, "idempotencyKey"); this.db.prepare("UPDATE live_action_outbox SET attempts=attempts+1,last_error=? WHERE id=?").run(redact(error), idempotencyKey); }

  private getMemberState(tenantId: string, userId: string): { live: boolean; streamId?: string } | undefined {
    const row = this.db.prepare("SELECT is_live,stream_id FROM live_members WHERE tenant_id=? AND user_id=?").get(tenantId, userId) as { is_live: number; stream_id: string | null } | undefined;
    return row ? { live: row.is_live === 1, ...(row.stream_id ? { streamId: row.stream_id } : {}) } : undefined;
  }
  private putMemberState(tenantId: string, member: DshLiveMemberV1, live: boolean, streamId: string | undefined, observedAt: string): void {
    this.db.prepare("INSERT INTO live_members(tenant_id,user_id,twitch_login,is_live,stream_id,observed_at,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET twitch_login=excluded.twitch_login,is_live=excluded.is_live,stream_id=excluded.stream_id,observed_at=excluded.observed_at,body=excluded.body").run(tenantId, member.canonicalUserId, member.twitchLogin.toLowerCase(), live ? 1 : 0, streamId ?? null, observedAt, JSON.stringify({ member }));
  }
  private getSpotlight(tenantId: string): { userId: string; nextIndex: number; rotatedAt: string } | undefined {
    return this.db.prepare("SELECT user_id AS userId,next_index AS nextIndex,rotated_at AS rotatedAt FROM spotlight WHERE tenant_id=?").get(tenantId) as { userId: string; nextIndex: number; rotatedAt: string } | undefined;
  }
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS live_members(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,twitch_login TEXT NOT NULL,is_live INTEGER NOT NULL,stream_id TEXT,observed_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,user_id)) STRICT;
      CREATE INDEX IF NOT EXISTS live_members_status ON live_members(tenant_id,is_live,twitch_login);
      CREATE TABLE IF NOT EXISTS spotlight(tenant_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,next_index INTEGER NOT NULL,rotated_at TEXT NOT NULL,body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS live_polls(tenant_id TEXT NOT NULL,poll_id TEXT NOT NULL,observed_at TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(tenant_id,poll_id)) STRICT;
      CREATE TABLE IF NOT EXISTS live_action_outbox(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,created_at TEXT NOT NULL,last_error TEXT,body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS live_action_outbox_pending ON live_action_outbox(tenant_id,state,created_at);
    `);
  }
}

export class DshLiveRuntime {
  constructor(private readonly monitor: SqliteDshLiveMonitor, private readonly publisher: DshLiveActionPublisherV1) {}
  async reconcile(poll: DshLivePollV1): Promise<DshLivePollResultV1 & { delivery: DshLiveDeliveryReportV1 }> {
    const result = this.monitor.reconcile(poll);
    const delivery = await this.flush(poll.tenantId);
    return { ...result, delivery };
  }
  async flush(tenantId: string, limit = 100): Promise<DshLiveDeliveryReportV1> {
    const pending = this.monitor.listPendingActions(tenantId, limit);
    const report = { attempted: pending.length, delivered: 0, failed: 0 };
    for (const item of pending) {
      try { await this.publisher.publish(item.action); this.monitor.completeAction(item.action.idempotencyKey); report.delivered += 1; }
      catch (error) { this.monitor.failAction(item.action.idempotencyKey, error instanceof Error ? error.message : String(error)); report.failed += 1; }
    }
    return report;
  }
}

function assertPoll(poll: DshLivePollV1): void {
  if (poll.schemaVersion !== 1) throw new Error("Unsupported DSH live poll version");
  requireId(poll.tenantId, "tenantId"); requireId(poll.pollId, "pollId");
  if (!Number.isFinite(Date.parse(poll.observedAt))) throw new Error("observedAt must be an ISO timestamp");
  const users = new Set<string>(); const logins = new Set<string>();
  for (const member of poll.members) { requireId(member.canonicalUserId, "canonicalUserId"); requireId(member.discordUserId, "discordUserId"); requireId(member.twitchLogin, "twitchLogin"); requireId(member.shoutoutChannelId, "shoutoutChannelId"); if (!(DSH_MEMBER_GROUPS as readonly string[]).includes(member.group)) throw new Error("Member group is invalid"); if (users.has(member.canonicalUserId) || logins.has(member.twitchLogin.toLowerCase())) throw new Error("Live poll members must be unique"); users.add(member.canonicalUserId); logins.add(member.twitchLogin.toLowerCase()); }
  for (const stream of poll.streams) { requireId(stream.twitchLogin, "stream twitchLogin"); requireId(stream.twitchStreamId, "twitchStreamId"); if (!Number.isSafeInteger(stream.viewerCount) || stream.viewerCount < 0 || !Number.isFinite(Date.parse(stream.startedAt))) throw new Error("Stream snapshot is invalid"); }
}
function requireId(value: string, name: string): void { if (!value || value.trim() !== value || value.length > 300 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); }
function redact(value: string): string { return value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 1_000); }
