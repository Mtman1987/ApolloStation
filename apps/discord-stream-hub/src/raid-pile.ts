import { DatabaseSync } from "node:sqlite";

export interface DshRaidPileSettingsV1 {
  maxSize: number;
  minSize: number;
  pointsReward: number;
  handoffHours: number;
  monthlyStrikeLimit: number;
}

export const DEFAULT_DSH_RAID_PILE_SETTINGS: DshRaidPileSettingsV1 = {
  maxSize: 40,
  minSize: 10,
  pointsReward: 25,
  handoffHours: 4,
  monthlyStrikeLimit: 3,
};

export interface DshRaidPileMemberV1 {
  userId: string;
  twitchLogin: string;
  displayName: string;
  pileId: string;
  joinedAt: string;
  lastRaidedAt?: string;
  currentViewers: number;
  isLive: boolean;
}

export interface DshRaidPileViewV1 {
  id: string;
  members: DshRaidPileMemberV1[];
  target?: DshRaidPileMemberV1;
  targetSince?: string;
}

export interface DshRaidPileHandoffV1 {
  pileId: string;
  priorTarget: DshRaidPileMemberV1;
  nextTarget: DshRaidPileMemberV1;
  heldHours: number;
  message: string;
}

/** DSH owns Raid Pile membership/routing. Twitch remains voluntary: this state never initiates a raid. */
export class DshRaidPileStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly settings: () => DshRaidPileSettingsV1 = () => DEFAULT_DSH_RAID_PILE_SETTINGS, private readonly now: () => string = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }
  close() { this.db.close(); }

  join(tenantId: string, input: { userId: string; twitchLogin: string; displayName: string }) {
    requireId(tenantId, "tenantId"); requireId(input.userId, "userId");
    const existing = this.member(tenantId, input.userId);
    if (existing) return { duplicate: true, member: existing, piles: this.piles(tenantId) };
    const piles = this.piles(tenantId), pileId = smallestPileId(piles) ?? this.createPile(tenantId);
    const joinedAt = this.now();
    this.db.prepare("INSERT INTO raid_pile_members(tenant_id,user_id,pile_id,twitch_login,display_name,joined_at,last_raided_at,current_viewers,is_live) VALUES(?,?,?,?,?,?,NULL,0,0)")
      .run(tenantId, input.userId, pileId, login(input.twitchLogin), text(input.displayName, 100), joinedAt);
    this.rebalance(tenantId, "grow");
    return { duplicate: false, member: this.member(tenantId, input.userId)!, piles: this.piles(tenantId) };
  }

  leave(tenantId: string, userId: string, reason = "left") {
    const member = this.member(tenantId, userId); if (!member) return { removed: false, piles: this.piles(tenantId) };
    this.db.prepare("DELETE FROM raid_pile_members WHERE tenant_id=? AND user_id=?").run(tenantId, userId);
    this.db.prepare("INSERT INTO raid_pile_events(tenant_id,user_id,event_type,created_at,body) VALUES(?,?,?,?,?)").run(tenantId, userId, "leave", this.now(), JSON.stringify({ reason }));
    const target = this.target(member.pileId, tenantId);
    if (target?.userId === userId) this.clearTarget(tenantId, member.pileId);
    this.rebalance(tenantId, "shrink");
    this.ensureTargets(tenantId);
    return { removed: true, piles: this.piles(tenantId) };
  }

  updatePresence(tenantId: string, userId: string, viewers: number, isLive: boolean) {
    if (!Number.isSafeInteger(viewers) || viewers < 0) throw new Error("viewer count is invalid");
    this.db.prepare("UPDATE raid_pile_members SET current_viewers=?,is_live=? WHERE tenant_id=? AND user_id=?").run(viewers, isLive ? 1 : 0, tenantId, userId);
  }

  /** Returns the weighted recommendation without changing state. 60% low viewers, 40% longest wait. */
  next(tenantId: string, pileId: string, excludeUserId?: string) {
    const members = this.members(tenantId, pileId).filter((member) => member.isLive && member.userId !== excludeUserId);
    if (!members.length) return undefined;
    return [...members].sort((a, b) => score(b, this.now()) - score(a, this.now()) || a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId))[0];
  }

  /** Moves the canonical pile target; it does not and cannot force the prior streamer to raid or end stream. */
  advance(tenantId: string, pileId: string, reason: "manual" | "handoff" | "initial" = "manual") {
    const prior = this.target(pileId, tenantId), selected = this.next(tenantId, pileId, prior?.userId);
    if (!selected) return prior;
    const at = this.now();
    this.db.prepare("INSERT INTO raid_pile_targets(tenant_id,pile_id,user_id,target_since) VALUES(?,?,?,?) ON CONFLICT(tenant_id,pile_id) DO UPDATE SET user_id=excluded.user_id,target_since=excluded.target_since")
      .run(tenantId, pileId, selected.userId, at);
    this.db.prepare("UPDATE raid_pile_members SET last_raided_at=? WHERE tenant_id=? AND user_id=?").run(at, tenantId, selected.userId);
    this.db.prepare("INSERT INTO raid_pile_events(tenant_id,user_id,event_type,created_at,body) VALUES(?,?,?,?,?)").run(tenantId, selected.userId, "target", at, JSON.stringify({ pileId, reason, priorUserId: prior?.userId }));
    return this.member(tenantId, selected.userId);
  }

  ensureTargets(tenantId: string) {
    for (const pile of this.piles(tenantId)) {
      const current = pile.target;
      if (!current || !current.isLive) this.advance(tenantId, pile.id, "initial");
    }
    return this.piles(tenantId);
  }

  /** After the configured hold time, announce a soft handoff and move all surfaces to the new canonical target. */
  dueHandoffs(tenantId: string): DshRaidPileHandoffV1[] {
    const settings = validateSettings(this.settings()), now = Date.parse(this.now()), output: DshRaidPileHandoffV1[] = [];
    for (const pile of this.piles(tenantId)) {
      if (!pile.target || !pile.targetSince) continue;
      const heldHours = (now - Date.parse(pile.targetSince)) / 3_600_000;
      if (heldHours < settings.handoffHours) continue;
      const prior = pile.target, next = this.advance(tenantId, pile.id, "handoff");
      if (!next || next.userId === prior.userId) continue;
      output.push({ pileId: pile.id, priorTarget: prior, nextTarget: next, heldHours, message: `${prior.displayName} has had the Raid Pile for ${Math.floor(heldHours)} hours. It would help the most people if they raid the pile onward when convenient. The canonical pile is now on ${next.displayName}; late joiners should go there.` });
    }
    return output;
  }

  /** Records a voluntary raid choice. Off-pile raids are strikes; the third strike in a UTC month removes membership. */
  recordRaidOut(tenantId: string, raiderUserId: string, targetUserId: string, eventId: string) {
    requireId(eventId, "eventId"); const raider = this.member(tenantId, raiderUserId); if (!raider) return { member: false, compliant: true, strikes: 0, removed: false };
    const canonical = this.target(raider.pileId, tenantId), compliant = canonical?.userId === targetUserId;
    const at = this.now(), month = at.slice(0, 7);
    const inserted = this.db.prepare("INSERT INTO raid_pile_events(tenant_id,user_id,event_type,created_at,body,event_key) VALUES(?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING")
      .run(tenantId, raiderUserId, compliant ? "raid-compliant" : "raid-off-pile", at, JSON.stringify({ pileId: raider.pileId, targetUserId, canonicalTargetUserId: canonical?.userId }), `${tenantId}:${eventId}`).changes;
    const strikes = Number((this.db.prepare("SELECT COUNT(*) AS count FROM raid_pile_events WHERE tenant_id=? AND user_id=? AND event_type='raid-off-pile' AND substr(created_at,1,7)=?").get(tenantId, raiderUserId, month) as { count: number }).count);
    const limit = validateSettings(this.settings()).monthlyStrikeLimit, removed = !compliant && inserted > 0 && strikes >= limit;
    if (removed) this.leave(tenantId, raiderUserId, "monthly-strike-limit");
    return { member: true, compliant, strikes, removed, limit, canonicalTarget: canonical };
  }

  piles(tenantId: string): DshRaidPileViewV1[] {
    const ids = this.db.prepare("SELECT pile_id AS pileId FROM raid_piles WHERE tenant_id=? ORDER BY created_at,pile_id").all(tenantId) as Array<{ pileId: string }>;
    return ids.map(({ pileId }) => ({ id: pileId, members: this.members(tenantId, pileId), ...this.targetView(tenantId, pileId) }));
  }
  member(tenantId: string, userId: string): DshRaidPileMemberV1 | undefined {
    const row = this.db.prepare("SELECT user_id AS userId,pile_id AS pileId,twitch_login AS twitchLogin,display_name AS displayName,joined_at AS joinedAt,last_raided_at AS lastRaidedAt,current_viewers AS currentViewers,is_live AS isLive FROM raid_pile_members WHERE tenant_id=? AND user_id=?").get(tenantId, userId) as any;
    return row ? normalize(row) : undefined;
  }

  private members(tenantId: string, pileId: string) {
    return (this.db.prepare("SELECT user_id AS userId,pile_id AS pileId,twitch_login AS twitchLogin,display_name AS displayName,joined_at AS joinedAt,last_raided_at AS lastRaidedAt,current_viewers AS currentViewers,is_live AS isLive FROM raid_pile_members WHERE tenant_id=? AND pile_id=? ORDER BY joined_at,user_id").all(tenantId, pileId) as any[]).map(normalize);
  }
  private target(pileId: string, tenantId: string) { return this.targetView(tenantId, pileId).target; }
  private targetView(tenantId: string, pileId: string): Pick<DshRaidPileViewV1, "target" | "targetSince"> {
    const row = this.db.prepare("SELECT user_id AS userId,target_since AS targetSince FROM raid_pile_targets WHERE tenant_id=? AND pile_id=?").get(tenantId, pileId) as { userId: string; targetSince: string } | undefined;
    if (!row) return {}; const target = this.member(tenantId, row.userId); return target ? { target, targetSince: row.targetSince } : {};
  }
  private clearTarget(tenantId: string, pileId: string) { this.db.prepare("DELETE FROM raid_pile_targets WHERE tenant_id=? AND pile_id=?").run(tenantId, pileId); }
  private createPile(tenantId: string) { const id = `pile-${crypto.randomUUID()}`; this.db.prepare("INSERT INTO raid_piles(tenant_id,pile_id,created_at) VALUES(?,?,?)").run(tenantId, id, this.now()); return id; }

  private rebalance(tenantId: string, direction: "grow" | "shrink") {
    const settings = validateSettings(this.settings()), members = this.piles(tenantId).flatMap((pile) => pile.members).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId));
    let piles = this.piles(tenantId); let desired = Math.max(1, piles.length || 1);
    if (direction === "grow") desired = Math.max(desired, Math.ceil(members.length / settings.maxSize));
    else while (desired > 1 && members.length < (desired - 1) * settings.minSize) desired -= 1;
    while (piles.length < desired) { this.createPile(tenantId); piles = this.piles(tenantId); }
    while (piles.length > desired) { const doomed = piles.at(-1)!; this.clearTarget(tenantId, doomed.id); this.db.prepare("DELETE FROM raid_piles WHERE tenant_id=? AND pile_id=?").run(tenantId, doomed.id); piles = this.piles(tenantId); }
    piles = this.piles(tenantId); if (!piles.length) { this.createPile(tenantId); piles = this.piles(tenantId); }
    members.forEach((member, index) => this.db.prepare("UPDATE raid_pile_members SET pile_id=? WHERE tenant_id=? AND user_id=?").run(piles[index % piles.length]!.id, tenantId, member.userId));
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS raid_piles(tenant_id TEXT NOT NULL,pile_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(tenant_id,pile_id)) STRICT;
      CREATE TABLE IF NOT EXISTS raid_pile_members(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,pile_id TEXT NOT NULL,twitch_login TEXT NOT NULL,display_name TEXT NOT NULL,joined_at TEXT NOT NULL,last_raided_at TEXT,current_viewers INTEGER NOT NULL,is_live INTEGER NOT NULL,PRIMARY KEY(tenant_id,user_id),FOREIGN KEY(tenant_id,pile_id) REFERENCES raid_piles(tenant_id,pile_id) ON DELETE CASCADE) STRICT;
      CREATE INDEX IF NOT EXISTS raid_pile_members_pile ON raid_pile_members(tenant_id,pile_id,is_live,current_viewers);
      CREATE TABLE IF NOT EXISTS raid_pile_targets(tenant_id TEXT NOT NULL,pile_id TEXT NOT NULL,user_id TEXT NOT NULL,target_since TEXT NOT NULL,PRIMARY KEY(tenant_id,pile_id)) STRICT;
      CREATE TABLE IF NOT EXISTS raid_pile_events(id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,event_type TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL,event_key TEXT UNIQUE) STRICT;
      CREATE INDEX IF NOT EXISTS raid_pile_events_strikes ON raid_pile_events(tenant_id,user_id,event_type,created_at);
    `);
  }
}

function score(member: DshRaidPileMemberV1, now: string) { const viewer = Math.max(0, (1000 - member.currentViewers) / 1000), wait = member.lastRaidedAt ? Math.min(1, Math.max(0, (Date.parse(now) - Date.parse(member.lastRaidedAt)) / (168 * 3_600_000))) : 1; return viewer * 0.6 + wait * 0.4; }
function normalize(row: any): DshRaidPileMemberV1 { return { userId: String(row.userId), pileId: String(row.pileId), twitchLogin: String(row.twitchLogin), displayName: String(row.displayName), joinedAt: String(row.joinedAt), ...(row.lastRaidedAt ? { lastRaidedAt: String(row.lastRaidedAt) } : {}), currentViewers: Number(row.currentViewers), isLive: Number(row.isLive) === 1 }; }
function smallestPileId(piles: DshRaidPileViewV1[]) { return [...piles].sort((a, b) => a.members.length - b.members.length || a.id.localeCompare(b.id))[0]?.id; }
function validateSettings(value: DshRaidPileSettingsV1) { if (!Number.isSafeInteger(value.maxSize) || value.maxSize < 2 || !Number.isSafeInteger(value.minSize) || value.minSize < 1 || value.minSize >= value.maxSize || !Number.isFinite(value.pointsReward) || value.pointsReward < 0 || !Number.isFinite(value.handoffHours) || value.handoffHours <= 0 || !Number.isSafeInteger(value.monthlyStrikeLimit) || value.monthlyStrikeLimit < 1) throw new Error("Raid Pile settings are invalid"); return value; }
function requireId(value: string, name: string) { if (!value || value.length > 180 || /[\r\n\0]/.test(value)) throw new Error(`${name} is invalid`); }
function login(value: string) { const result = value.trim().toLowerCase(); if (!/^[a-z0-9_]{1,25}$/.test(result)) throw new Error("Twitch login is invalid"); return result; }
function text(value: string, max: number) { const result = value.trim(); if (!result || result.length > max || /[\r\n\0]/.test(result)) throw new Error("display name is invalid"); return result; }
