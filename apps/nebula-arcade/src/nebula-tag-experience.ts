import { DatabaseSync } from "node:sqlite";
import { assertNebulaTagStateV1, type NebulaTagInboundMessageV1, type NebulaTagPlayerStateV1, type NebulaTagStateV1 } from "./nebula-tag.js";
import { NebulaTagRuntime, type StoredNebulaTagCommandV1, type NebulaTagDeliveryReportV1 } from "./nebula-tag-runtime.js";
import { migrateLegacyNebulaArcadeStorage } from "./legacy-nebula-migration.js";

export interface NebulaTagChannelSettingsV1 {
  schemaVersion: 1;
  tenantId: string;
  channelId: string;
  overlayMode: boolean;
  optedOut: boolean;
  updatedAt: string;
}

export interface NebulaTagSupportTicketV1 {
  schemaVersion: 1;
  ticketId: string;
  tenantId: string;
  channelId: string;
  requesterUserId: string;
  requesterUsername: string;
  note: string | null;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}

export interface NebulaTagOverlayMessageV1 {
  schemaVersion: 1;
  sequence: number;
  tenantId: string;
  channelId: string;
  code: string;
  text: string;
  createdAt: string;
}

export interface NebulaTagExperienceStore {
  getChannelSettings(tenantId: string, channelId: string): NebulaTagChannelSettingsV1;
  setOverlayMode(tenantId: string, channelId: string, enabled: boolean, occurredAt: string): NebulaTagChannelSettingsV1;
  optOutChannel(tenantId: string, channelId: string, occurredAt: string): NebulaTagChannelSettingsV1;
  createSupportTicket(input: Omit<NebulaTagSupportTicketV1, "schemaVersion" | "status" | "resolvedAt">): NebulaTagSupportTicketV1;
  listSupportTickets(tenantId: string, status?: NebulaTagSupportTicketV1["status"]): NebulaTagSupportTicketV1[];
  enqueueOverlayMessage(input: Omit<NebulaTagOverlayMessageV1, "schemaVersion" | "sequence">): NebulaTagOverlayMessageV1;
  listOverlayMessages(tenantId: string, channelId: string, afterSequence?: number, limit?: number): NebulaTagOverlayMessageV1[];
}

export class SqliteNebulaTagExperienceStore implements NebulaTagExperienceStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (!path) throw new Error("Nebula Arcade tag game experience database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    migrateLegacyNebulaArcadeStorage(this.db);
    this.migrate();
  }

  close(): void { this.db.close(); }

  getChannelSettings(tenantId: string, channelId: string): NebulaTagChannelSettingsV1 {
    requireId(tenantId, "tenantId"); requireId(channelId, "channelId");
    const row = this.db.prepare("SELECT overlay_mode, opted_out, updated_at FROM nebula_tag_channels WHERE tenant_id=? AND channel_id=?").get(tenantId, channelId) as { overlay_mode: number; opted_out: number; updated_at: string } | undefined;
    return { schemaVersion: 1, tenantId, channelId, overlayMode: Boolean(row?.overlay_mode), optedOut: Boolean(row?.opted_out), updatedAt: row?.updated_at ?? new Date(0).toISOString() };
  }

  setOverlayMode(tenantId: string, channelId: string, enabled: boolean, occurredAt: string): NebulaTagChannelSettingsV1 {
    return this.writeChannel(tenantId, channelId, occurredAt, { overlayMode: enabled });
  }

  optOutChannel(tenantId: string, channelId: string, occurredAt: string): NebulaTagChannelSettingsV1 {
    return this.writeChannel(tenantId, channelId, occurredAt, { optedOut: true, overlayMode: false });
  }

  createSupportTicket(input: Omit<NebulaTagSupportTicketV1, "schemaVersion" | "status" | "resolvedAt">): NebulaTagSupportTicketV1 {
    requireId(input.ticketId, "ticketId"); requireId(input.tenantId, "tenantId"); requireId(input.channelId, "channelId"); requireId(input.requesterUserId, "requesterUserId"); requireIso(input.createdAt, "createdAt");
    const ticket: NebulaTagSupportTicketV1 = { schemaVersion: 1, ...input, note: input.note?.slice(0, 500) ?? null, status: "open", resolvedAt: null };
    this.db.prepare("INSERT OR IGNORE INTO nebula_tag_support_tickets(ticket_id,tenant_id,channel_id,requester_user_id,requester_username,note,status,created_at,resolved_at) VALUES(?,?,?,?,?,?,?, ?,NULL)")
      .run(ticket.ticketId, ticket.tenantId, ticket.channelId, ticket.requesterUserId, ticket.requesterUsername.slice(0, 120), ticket.note, ticket.status, ticket.createdAt);
    return this.getTicket(ticket.ticketId) ?? ticket;
  }

  listSupportTickets(tenantId: string, status?: NebulaTagSupportTicketV1["status"]): NebulaTagSupportTicketV1[] {
    requireId(tenantId, "tenantId");
    const rows = (status
      ? this.db.prepare("SELECT * FROM nebula_tag_support_tickets WHERE tenant_id=? AND status=? ORDER BY created_at DESC LIMIT 200").all(tenantId, status)
      : this.db.prepare("SELECT * FROM nebula_tag_support_tickets WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200").all(tenantId)) as TicketRow[];
    return rows.map(ticketFromRow);
  }

  enqueueOverlayMessage(input: Omit<NebulaTagOverlayMessageV1, "schemaVersion" | "sequence">): NebulaTagOverlayMessageV1 {
    requireId(input.tenantId, "tenantId"); requireId(input.channelId, "channelId"); requireId(input.code, "code"); requireIso(input.createdAt, "createdAt");
    const result = this.db.prepare("INSERT INTO nebula_tag_overlay_messages(tenant_id,channel_id,code,text,created_at) VALUES(?,?,?,?,?)").run(input.tenantId, input.channelId, input.code, input.text.slice(0, 1_000), input.createdAt);
    return { schemaVersion: 1, sequence: Number(result.lastInsertRowid), ...input, text: input.text.slice(0, 1_000) };
  }

  listOverlayMessages(tenantId: string, channelId: string, afterSequence = 0, limit = 50): NebulaTagOverlayMessageV1[] {
    requireId(tenantId, "tenantId"); requireId(channelId, "channelId");
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error("afterSequence is invalid");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be from 1 to 100");
    const rows = this.db.prepare("SELECT sequence,tenant_id,channel_id,code,text,created_at FROM nebula_tag_overlay_messages WHERE tenant_id=? AND channel_id=? AND sequence>? ORDER BY sequence LIMIT ?").all(tenantId, channelId, afterSequence, limit) as Array<{ sequence: number; tenant_id: string; channel_id: string; code: string; text: string; created_at: string }>;
    return rows.map((row) => ({ schemaVersion: 1, sequence: row.sequence, tenantId: row.tenant_id, channelId: row.channel_id, code: row.code, text: row.text, createdAt: row.created_at }));
  }

  private writeChannel(tenantId: string, channelId: string, occurredAt: string, patch: { overlayMode?: boolean; optedOut?: boolean }): NebulaTagChannelSettingsV1 {
    requireId(tenantId, "tenantId"); requireId(channelId, "channelId"); requireIso(occurredAt, "occurredAt");
    const current = this.getChannelSettings(tenantId, channelId);
    const next = { ...current, overlayMode: patch.overlayMode ?? current.overlayMode, optedOut: patch.optedOut ?? current.optedOut, updatedAt: occurredAt };
    this.db.prepare("INSERT INTO nebula_tag_channels(tenant_id,channel_id,overlay_mode,opted_out,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,channel_id) DO UPDATE SET overlay_mode=excluded.overlay_mode,opted_out=excluded.opted_out,updated_at=excluded.updated_at")
      .run(tenantId, channelId, Number(next.overlayMode), Number(next.optedOut), occurredAt);
    return next;
  }

  private getTicket(ticketId: string): NebulaTagSupportTicketV1 | undefined {
    const row = this.db.prepare("SELECT * FROM nebula_tag_support_tickets WHERE ticket_id=?").get(ticketId) as TicketRow | undefined;
    return row ? ticketFromRow(row) : undefined;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nebula_tag_channels(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,overlay_mode INTEGER NOT NULL DEFAULT 0,opted_out INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,channel_id)) STRICT;
      CREATE TABLE IF NOT EXISTS nebula_tag_support_tickets(ticket_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,requester_user_id TEXT NOT NULL,requester_username TEXT NOT NULL,note TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT) STRICT;
      CREATE INDEX IF NOT EXISTS nebula_tag_support_status ON nebula_tag_support_tickets(tenant_id,status,created_at);
      CREATE TABLE IF NOT EXISTS nebula_tag_overlay_messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,code TEXT NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS nebula_tag_overlay_feed ON nebula_tag_overlay_messages(tenant_id,channel_id,sequence);
    `);
  }
}

export interface NebulaTagPresenceV1 { liveUserIds?: string[]; channelByUserId?: Record<string, string>; }
export interface NebulaTagDirectoryPageV1 { kind: "players" | "live"; page: number; totalPages: number; playerCount: number; liveCount: number; chattingCount: number; entries: string[]; message: string; }

export function buildNebulaTagDirectoryPage(stateValue: NebulaTagStateV1, input: { kind: "players" | "live"; page?: number; now: string; presence?: NebulaTagPresenceV1; maxCharacters?: number }): NebulaTagDirectoryPageV1 {
  const state = assertNebulaTagStateV1(stateValue); const nowMs = Date.parse(input.now); requireIso(input.now, "now");
  const live = new Set(input.presence?.liveUserIds ?? []); const activeMs = 30 * 60 * 1_000;
  const classified = Object.values(state.players).map((player) => ({ player, status: live.has(player.userId) ? "live" : nowMs - Date.parse(player.lastActiveAt) <= activeMs ? "chatting" : "offline" } as const));
  const ordered = classified.sort((left, right) => statusOrder(left.status) - statusOrder(right.status) || left.player.username.localeCompare(right.player.username));
  const visible = input.kind === "live" ? ordered.filter((entry) => entry.status === "live" || entry.status === "chatting") : ordered;
  const labels = visible.map(({ player, status }) => `${status === "live" ? "🟢" : status === "chatting" ? "💬" : player.sleeping || player.offline ? "😴" : ""}${player.username}`);
  const pages = paginateLabels(labels, input.maxCharacters ?? 360); const requested = Math.max(0, input.page ?? 0); const page = pages.length ? requested % pages.length : 0;
  const entries = pages[page] ?? []; const liveCount = classified.filter((entry) => entry.status === "live").length; const chattingCount = classified.filter((entry) => entry.status === "chatting").length;
  const lead = input.kind === "live" ? `🟢${liveCount} live 💬${chattingCount} chatting` : `${classified.length} players [🟢${liveCount} 💬${chattingCount}]`;
  return { kind: input.kind, page, totalPages: Math.max(1, pages.length), playerCount: classified.length, liveCount, chattingCount, entries, message: `${lead} (${page + 1}/${Math.max(1, pages.length)}): ${entries.join(", ") || "none"}${page + 1 < pages.length ? ' | "spmt more" for next' : ""}` };
}

export function getNebulaTagPinRanking(stateValue: NebulaTagStateV1, pinUserId: string, limit = 5): Array<{ userId: string; username: string; count: number }> {
  const state = assertNebulaTagStateV1(stateValue); requireId(pinUserId, "pinUserId");
  const counts = new Map<string, number>();
  for (const entry of state.history) if (entry.actorUserId === pinUserId && entry.targetUserId) counts.set(entry.targetUserId, (counts.get(entry.targetUserId) ?? 0) + 1);
  return [...counts].flatMap(([userId, count]) => state.players[userId] ? [{ userId, username: state.players[userId]!.username, count }] : []).sort((left, right) => right.count - left.count || left.username.localeCompare(right.username)).slice(0, limit);
}

export type NebulaTagExperienceOutcomeV1 =
  | { kind: "ignored"; code: string }
  | { kind: "reply"; code: string; message: string; route: "chat" | "overlay" }
  | { kind: "executed"; code: string; message: string; route: "chat" | "overlay"; execution: StoredNebulaTagCommandV1 & { kind: "result"; delivery: NebulaTagDeliveryReportV1 } };

export class NebulaTagExperienceService {
  private readonly cursors = new Map<string, { kind: "players" | "live"; page: number; expiresAt: number }>();
  constructor(private readonly runtime: NebulaTagRuntime, private readonly experience: NebulaTagExperienceStore, private readonly pinUserId: string, private readonly now: () => string = () => new Date().toISOString()) {}

  async ingest(message: NebulaTagInboundMessageV1, presence: NebulaTagPresenceV1 = {}): Promise<NebulaTagExperienceOutcomeV1> {
    const settings = this.experience.getChannelSettings(message.tenantId, message.channelId); const parsed = operationalCommand(message.text); const moderator = Boolean(message.roles?.some((role) => role === "broadcaster" || role === "moderator"));
    if (settings.optedOut) return { kind: "ignored", code: "channel-opted-out" };
    if (parsed?.kind === "optout") {
      if (!moderator) return this.reply(settings, message, "moderator-required", "Only the broadcaster or a moderator can opt this channel out.");
      this.experience.optOutChannel(message.tenantId, message.channelId, message.occurredAt);
      return { kind: "reply", code: "channel-opted-out", message: "This channel is now permanently opted out of Nebula Arcade tag game.", route: "chat" };
    }
    if (parsed?.kind === "mute" || parsed?.kind === "unmute") {
      if (!moderator) return this.reply(settings, message, "moderator-required", "Only the broadcaster or a moderator can toggle overlay mode.");
      const enabled = parsed.kind === "mute" ? !settings.overlayMode : false;
      const next = this.experience.setOverlayMode(message.tenantId, message.channelId, enabled, message.occurredAt);
      return this.reply(next, message, enabled ? "overlay-enabled" : "overlay-disabled", enabled ? "Overlay mode is on. Chat replies will appear in the OBS output." : "Overlay mode is off. Chat replies are restored.", enabled ? "chat" : undefined);
    }
    if (parsed?.kind === "support") {
      this.experience.createSupportTicket({ ticketId: `${message.provider}:${message.messageId}`, tenantId: message.tenantId, channelId: message.channelId, requesterUserId: message.userId, requesterUsername: message.username, note: parsed.note, createdAt: message.occurredAt });
      return this.reply(settings, message, "support-ticket-created", "Support ticket sent to admin.");
    }
    if (parsed?.kind === "players" || parsed?.kind === "live" || parsed?.kind === "more") {
      const key = `${message.tenantId}:${message.userId}`; const cursor = this.cursors.get(key); const nowMs = Date.parse(this.now()); const kind = parsed.kind === "more" && cursor && cursor.expiresAt > nowMs ? cursor.kind : parsed.kind === "live" ? "live" : "players"; const page = parsed.kind === "more" && cursor && cursor.expiresAt > nowMs ? cursor.page : 0;
      const result = buildNebulaTagDirectoryPage(this.runtime.getState(message.tenantId).state, { kind, page, now: message.occurredAt, presence });
      this.cursors.set(key, { kind, page: (result.page + 1) % result.totalPages, expiresAt: nowMs + 30 * 60 * 1_000 });
      return this.reply(settings, message, kind, result.message);
    }
    if (parsed?.kind === "pinrank") {
      const ranking = getNebulaTagPinRanking(this.runtime.getState(message.tenantId).state, this.pinUserId);
      return this.reply(settings, message, "pinrank", ranking.length ? `Pin's Top 5: ${ranking.map((entry, index) => `#${index + 1} ${entry.username}: ${entry.count}`).join(" | ")}` : "Pin hasn't tagged anyone yet!");
    }
    const result = await this.runtime.ingest(message);
    if (result.kind === "ignored") return { kind: "ignored", code: "not-a-command" };
    if (result.kind === "command") throw new Error("Nebula Arcade tag game runtime returned an unexecuted command");
    if (result.kind === "response" || result.kind === "rejected") return this.reply(settings, message, result.code, result.message);
    if (result.result.kind === "record-activity") return { kind: "ignored", code: "activity-recorded" };
    const routed = this.reply(settings, message, result.result.code, result.result.message);
    return { kind: "executed", code: routed.code, message: routed.message, route: routed.route, execution: result };
  }

  private reply(settings: NebulaTagChannelSettingsV1, message: NebulaTagInboundMessageV1, code: string, text: string, forceRoute?: "chat" | "overlay"): Extract<NebulaTagExperienceOutcomeV1, { kind: "reply" }> {
    const route = forceRoute ?? (settings.overlayMode ? "overlay" : "chat");
    if (route === "overlay") this.experience.enqueueOverlayMessage({ tenantId: message.tenantId, channelId: message.channelId, code, text, createdAt: message.occurredAt });
    return { kind: "reply", code, message: text, route };
  }
}

type TicketRow = { ticket_id: string; tenant_id: string; channel_id: string; requester_user_id: string; requester_username: string; note: string | null; status: "open" | "resolved"; created_at: string; resolved_at: string | null };
function ticketFromRow(row: TicketRow): NebulaTagSupportTicketV1 { return { schemaVersion: 1, ticketId: row.ticket_id, tenantId: row.tenant_id, channelId: row.channel_id, requesterUserId: row.requester_user_id, requesterUsername: row.requester_username, note: row.note, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at }; }
function operationalCommand(text: string): { kind: "players" | "live" | "more" | "pinrank" | "mute" | "unmute" | "optout" } | { kind: "support"; note: string | null } | undefined { const match = /^spmt\s+(?:arcade\s+)?(\S+)(?:\s+(.*))?$/i.exec(text.trim()); if (!match) return undefined; const name = match[1]!.toLowerCase(); if (["players", "live", "more", "pinrank", "mute", "unmute", "optout"].includes(name)) return { kind: name as "players" | "live" | "more" | "pinrank" | "mute" | "unmute" | "optout" }; if (name === "support" || name === "ticket") return { kind: "support", note: match[2]?.trim().slice(0, 500) || null }; return undefined; }
function paginateLabels(labels: string[], max: number): string[][] { const pages: string[][] = [[]]; let length = 0; for (const label of labels) { const extra = (pages.at(-1)!.length ? 2 : 0) + label.length; if (length + extra > max && pages.at(-1)!.length) { pages.push([]); length = 0; } pages.at(-1)!.push(label); length += (length ? 2 : 0) + label.length; } return labels.length ? pages : []; }
function statusOrder(status: "live" | "chatting" | "offline"): number { return status === "live" ? 0 : status === "chatting" ? 1 : 2; }
function requireId(value: string, name: string): void { if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); }
function requireIso(value: string, name: string): void { if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp`); }
