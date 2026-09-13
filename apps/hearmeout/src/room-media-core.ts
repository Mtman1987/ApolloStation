import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const HEARMEOUT_ROOM_LIFETIME_MS = 6 * 60 * 60 * 1_000;
export const HEARMEOUT_PRESENCE_STALE_MS = 45_000;
export type HearMeOutMediaLaneV1 = "movie" | "music";
export type HearMeOutModerationActionV1 = "kick" | "timeout" | "ban" | "unban" | "mute" | "unmute" | "move";

export interface HearMeOutPrincipalV1 {
  tenantId: string;
  userId: string;
  displayName: string;
  roles: Array<"admin" | "member">;
}

export interface HearMeOutRoomV1 {
  schemaVersion: 1;
  tenantId: string;
  roomId: string;
  name: string;
  ownerUserId: string;
  privacy: "public" | "private";
  systemRoom: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface HearMeOutRoomInvitationV1 {
  schemaVersion: 1;
  invitationId: string;
  tenantId: string;
  roomId: string;
  inviteeUserId: string;
  invitedByUserId: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export interface HearMeOutPresenceV1 {
  schemaVersion: 1;
  tenantId: string;
  roomId: string;
  userId: string;
  displayName: string;
  connectionId: string;
  lastSeenAt: string;
}

export interface HearMeOutVoiceQueueEntryV1 {
  userId: string; displayName: string; addedAt: string; state: 'waiting' | 'invited';
  invitationId?: string; expiresAt?: string;
}

export interface HearMeOutRadioV1 {
  enabled: boolean; seed: string; revision: number; principal: HearMeOutPrincipalV1;
  history: Array<{ itemId: string; title: string; selectedAt: string }>; error?: string;
}

export interface HearMeOutMediaItemV1 {
  itemId: string;
  type: "movie" | "live" | "music" | "tts";
  title: string;
  source: string;
  playbackUrl: string;
  posterUrl?: string;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface HearMeOutMediaRequestV1 {
  requestId: string;
  requestedBy: { userId: string; displayName: string };
  addedAt: string;
  item: HearMeOutMediaItemV1;
}

export interface HearMeOutMediaSessionV1 {
  schemaVersion: 1;
  tenantId: string;
  roomId: string;
  sessionId: string;
  lane: HearMeOutMediaLaneV1;
  current: HearMeOutMediaRequestV1 | null;
  queue: HearMeOutMediaRequestV1[];
  playback: {
    status: "idle" | "paused" | "playing";
    position: number;
    updatedAt: string;
    muted: boolean;
    volume: number;
  };
  revision: number;
}

export type HearMeOutControlActionV1 = "play" | "pause" | "seek" | "mute" | "unmute" | "volume" | "next" | "jump" | "clear";

export class SqliteHearMeOutRoomMediaRuntime {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(path: string) {
    if (!path) throw new Error("HearMeOut database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hmo_rooms(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_room_members(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_room_access(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, password_salt TEXT, password_hash TEXT,
        PRIMARY KEY(tenant_id,room_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_room_invitations(
        tenant_id TEXT NOT NULL, invitation_id TEXT NOT NULL, room_id TEXT NOT NULL, invitee_user_id TEXT NOT NULL, expires_at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,invitation_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS hmo_room_invitations_lookup ON hmo_room_invitations(tenant_id,room_id,invitee_user_id,expires_at);
      CREATE TABLE IF NOT EXISTS hmo_room_admissions(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_room_restrictions(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at TEXT, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,user_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS hmo_room_restrictions_active ON hmo_room_restrictions(tenant_id,room_id,expires_at);
      CREATE TABLE IF NOT EXISTS hmo_room_member_controls(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL, server_muted INTEGER NOT NULL,
        PRIMARY KEY(tenant_id,room_id,user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_room_moves(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL, target_room_id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_room_voice_queue(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL, added_at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_room_radio(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, body TEXT NOT NULL, lease_owner TEXT, lease_until TEXT, next_attempt_at TEXT,
        PRIMARY KEY(tenant_id,room_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_room_presence(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, user_id TEXT NOT NULL, connection_id TEXT NOT NULL, last_seen_at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,user_id,connection_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS hmo_room_presence_active ON hmo_room_presence(tenant_id,room_id,last_seen_at);
      CREATE TABLE IF NOT EXISTS hmo_media_sessions(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, lane TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,lane)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_operations(
        tenant_id TEXT NOT NULL, operation_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,operation_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_music_favorites(
        tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, item_id TEXT NOT NULL, saved_at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,user_id,item_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_music_history(
        tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, request_id TEXT NOT NULL, item_id TEXT NOT NULL, played_at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,request_id)
      ) STRICT;
    `);
    const columns=this.db.prepare("PRAGMA table_info(hmo_operations)").all() as {name:string}[];
    if(!columns.some(column=>column.name==="request_signature"))this.db.exec("ALTER TABLE hmo_operations ADD COLUMN request_signature TEXT");
    if(!columns.some(column=>column.name==="room_id")) {
      this.db.exec("ALTER TABLE hmo_operations ADD COLUMN room_id TEXT; UPDATE hmo_operations SET room_id=json_extract(body,'$.roomId');");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS hmo_operations_room ON hmo_operations(tenant_id,room_id)");
  }

  close(): void { this.db.close(); }

  /** Remove expired ordinary rooms even when nobody visits the room list. */
  pruneExpiredRooms(now?: string): Array<{ tenantId: string; roomId: string }> {
    const at = validNow(now);
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT body FROM hmo_rooms").all() as Array<{ body: string }>;
      const expired = rows.map(row => JSON.parse(row.body) as HearMeOutRoomV1).filter(room => !room.systemRoom && isExpired(room, at));
      for (const room of expired) this.removeRoomData(room.tenantId, room.roomId);
      return expired.map(({ tenantId, roomId }) => ({ tenantId, roomId }));
    });
  }

  private removeRoomData(tenantId: string, roomId: string): void {
    const tables = new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    for (const table of ["hmo_media_sessions", "hmo_room_presence", "hmo_room_restrictions", "hmo_room_member_controls", "hmo_room_moves", "hmo_room_voice_queue", "hmo_room_radio", "hmo_room_admissions", "hmo_room_invitations", "hmo_room_access", "hmo_room_members", "hmo_room_chat", "hmo_room_personas", "hmo_persona_rooms"]) {
      if (tables.has(table)) this.db.prepare(`DELETE FROM ${table} WHERE tenant_id=? AND room_id=?`).run(tenantId, roomId);
    }
    this.db.prepare("DELETE FROM hmo_room_moves WHERE tenant_id=? AND target_room_id=?").run(tenantId, roomId);
    if (tables.has("hmo_assistant_requests")) this.db.prepare("DELETE FROM hmo_assistant_requests WHERE tenant=? AND room=?").run(tenantId, roomId);
    if (tables.has("hmo_voice_bridge")) {
      // Keep only a durable stop request if the provider still needs cleanup.
      // Deleting a room must not depend on the remote worker being reachable.
      this.db.prepare("UPDATE hmo_voice_bridge SET body=json_set(body,'$.enabled',json('false'),'$.cleanupPending',json('true')) WHERE tenant_id=? AND room_id=? AND json_extract(body,'$.enabled')=1").run(tenantId, roomId);
      this.db.prepare("DELETE FROM hmo_voice_bridge WHERE tenant_id=? AND room_id=? AND COALESCE(json_extract(body,'$.cleanupPending'),0)=0").run(tenantId, roomId);
    }
    this.db.prepare("DELETE FROM hmo_operations WHERE tenant_id=? AND room_id=?").run(tenantId, roomId);
    this.db.prepare("DELETE FROM hmo_rooms WHERE tenant_id=? AND room_id=?").run(tenantId, roomId);
  }

  createRoom(principal: HearMeOutPrincipalV1, input: { roomId: string; name: string; privacy: "public" | "private"; password?: string; systemRoom?: boolean; operationId: string; now?: string }): HearMeOutRoomV1 {
    assertPrincipal(principal);
    const replay = this.replay<HearMeOutRoomV1>(principal.tenantId, input.operationId, "create-room");
    if (replay) return replay;
    const now = validNow(input.now);
    const roomId = cleanId(input.roomId, "roomId");
    const name = cleanText(input.name, "room name", 120);
    if (input.systemRoom && !principal.roles.includes("admin")) throw new Error("Only an admin can create a system room");
    if (input.password !== undefined && input.privacy !== "private") throw new Error("Only a private room may have a password");
    const password = input.password === undefined ? undefined : privateRoomPassword(input.password);
    const passwordRecord = password === undefined ? undefined : hashPrivateRoomPassword(password);
    const room: HearMeOutRoomV1 = {
      schemaVersion: 1, tenantId: principal.tenantId, roomId, name,
      ownerUserId: principal.userId, privacy: input.privacy, systemRoom: Boolean(input.systemRoom),
      createdAt: now, updatedAt: now,
      ...(input.systemRoom ? {} : { expiresAt: new Date(Date.parse(now) + HEARMEOUT_ROOM_LIFETIME_MS).toISOString() }),
    };
    this.transaction(() => {
      const existing = this.db.prepare("SELECT 1 FROM hmo_rooms WHERE tenant_id=? AND room_id=?").get(principal.tenantId, roomId);
      if (existing) throw new Error("HearMeOut room already exists");
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hmo_voice_bridge'").get() && this.db.prepare("SELECT 1 FROM hmo_voice_bridge WHERE tenant_id=? AND room_id=? AND json_extract(body,'$.cleanupPending')=1").get(principal.tenantId, roomId)) throw new Error("HearMeOut room voice cleanup is still pending");
      this.db.prepare("INSERT INTO hmo_rooms(tenant_id,room_id,body) VALUES(?,?,?)").run(principal.tenantId, roomId, JSON.stringify(room));
      this.db.prepare("INSERT INTO hmo_room_access(tenant_id,room_id,password_salt,password_hash) VALUES(?,?,?,?)").run(principal.tenantId, roomId, passwordRecord?.salt ?? null, passwordRecord?.hash ?? null);
      this.putMember(principal, roomId, now);
      this.putAdmission(principal.tenantId, roomId, principal.userId, "owner", principal.userId, now);
      this.remember(principal.tenantId, input.operationId, "create-room", room);
    });
    return room;
  }

  getRoom(tenantId: string, roomId: string, now?: string): HearMeOutRoomV1 | undefined {
    const room = this.readRoom(tenantId, roomId);
    if (!room) return undefined;
    if (isExpired(room, validNow(now))) return undefined;
    return room;
  }

  listRooms(principal: HearMeOutPrincipalV1, now?: string): HearMeOutRoomV1[] {
    assertPrincipal(principal);
    const at = validNow(now);
    const rows = this.db.prepare("SELECT body FROM hmo_rooms WHERE tenant_id=? ORDER BY room_id").all(principal.tenantId) as Array<{ body: string }>;
    return rows.map((row) => JSON.parse(row.body) as HearMeOutRoomV1).filter((room) => !isExpired(room, at));
  }

  joinRoom(principal: HearMeOutPrincipalV1, roomId: string, operationId: string, now?: string, admission: { password?: string } = {}): HearMeOutRoomV1 {
    assertPrincipal(principal);
    const replay = this.replay<HearMeOutRoomV1>(principal.tenantId, operationId, "join-room");
    if (replay) return replay;
    const at = validNow(now);
    const room = this.requireRoom(principal.tenantId, roomId, at);
    this.assertCanJoin(principal, room, at);
    const access = room.privacy === "private" ? this.authorizePrivateAdmission(principal, room, admission.password, at) : undefined;
    this.transaction(() => {
      this.putMember(principal, room.roomId, at);
      this.db.prepare("DELETE FROM hmo_room_moves WHERE tenant_id=? AND room_id=? AND user_id=?").run(principal.tenantId, room.roomId, principal.userId);
      this.db.prepare('DELETE FROM hmo_room_voice_queue WHERE tenant_id=? AND room_id=? AND user_id=?').run(principal.tenantId, room.roomId, principal.userId);
      if (access) {
        this.putAdmission(principal.tenantId, room.roomId, principal.userId, access.method, access.invitation?.invitedByUserId ?? room.ownerUserId, at);
        if (access.invitation) this.acceptInvitation(access.invitation, at);
      }
      this.remember(principal.tenantId, operationId, "join-room", room);
    });
    return room;
  }

  inviteToRoom(principal: HearMeOutPrincipalV1, input: { roomId: string; inviteeUserId: string; operationId: string; ttlMs?: number; now?: string }): HearMeOutRoomInvitationV1 {
    assertPrincipal(principal);
    const replay = this.replay<HearMeOutRoomInvitationV1>(principal.tenantId, input.operationId, "invite-room");
    if (replay) return replay;
    const at = validNow(input.now);
    const room = this.requireRoom(principal.tenantId, input.roomId, at);
    if (!this.canManage(principal, room)) throw new Error("Only the room owner or an admin can invite private-room members");
    const ttlMs = input.ttlMs ?? 24 * 60 * 60 * 1_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 7 * 24 * 60 * 60 * 1_000) throw new Error("HearMeOut invitation lifetime is invalid");
    const invitation: HearMeOutRoomInvitationV1 = {
      schemaVersion: 1,
      invitationId: `hmo-invite:${cleanId(input.operationId, "operationId")}`,
      tenantId: principal.tenantId,
      roomId: room.roomId,
      inviteeUserId: cleanId(input.inviteeUserId, "inviteeUserId"),
      invitedByUserId: principal.userId,
      createdAt: at,
      expiresAt: new Date(Date.parse(at) + ttlMs).toISOString(),
    };
    this.transaction(() => {
      this.db.prepare("INSERT INTO hmo_room_invitations(tenant_id,invitation_id,room_id,invitee_user_id,expires_at,body) VALUES(?,?,?,?,?,?)").run(invitation.tenantId, invitation.invitationId, invitation.roomId, invitation.inviteeUserId, invitation.expiresAt, JSON.stringify(invitation));
      this.remember(principal.tenantId, input.operationId, "invite-room", invitation);
    });
    return invitation;
  }

  requestVoiceTurn(principal: HearMeOutPrincipalV1, roomId: string, now?: string): HearMeOutVoiceQueueEntryV1 {
    assertPrincipal(principal); const at = validNow(now), room = this.requireRoom(principal.tenantId, roomId, at); this.assertCanJoin(principal, room, at);
    const current = this.voiceQueue(principal, roomId, at).find(entry => entry.userId === principal.userId);
    if (current && (current.state === 'waiting' || Date.parse(current.expiresAt || '') > Date.parse(at))) return current;
    const entry: HearMeOutVoiceQueueEntryV1 = { userId: principal.userId, displayName: principal.displayName, addedAt: at, state: 'waiting' };
    this.db.prepare('INSERT INTO hmo_room_voice_queue(tenant_id,room_id,user_id,added_at,body) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,room_id,user_id) DO UPDATE SET added_at=excluded.added_at,body=excluded.body').run(principal.tenantId, roomId, principal.userId, at, JSON.stringify(entry));
    return entry;
  }

  voiceQueue(principal: HearMeOutPrincipalV1, roomId: string, now?: string): HearMeOutVoiceQueueEntryV1[] {
    assertPrincipal(principal); const room = this.requireRoom(principal.tenantId, roomId, validNow(now));
    const rows = this.db.prepare('SELECT body FROM hmo_room_voice_queue WHERE tenant_id=? AND room_id=? ORDER BY added_at,user_id').all(principal.tenantId, roomId);
    return rows.map(row => JSON.parse(String(row.body)) as HearMeOutVoiceQueueEntryV1).filter(entry => this.canManage(principal, room) || entry.userId === principal.userId);
  }

  admitNextVoiceTurn(principal: HearMeOutPrincipalV1, roomId: string, operationId: string, now?: string): HearMeOutVoiceQueueEntryV1 | null {
    assertPrincipal(principal); const at = validNow(now), room = this.requireRoom(principal.tenantId, roomId, at);
    if (!this.canManage(principal, room)) throw new Error('Only the room owner or an admin can admit the next person');
    const signature = JSON.stringify([principal.userId,roomId]);
    return this.transaction(() => {
      const replay = this.replay<HearMeOutVoiceQueueEntryV1>(principal.tenantId, operationId, 'voice-admit', signature); if (replay) return replay;
      const next = this.voiceQueue(principal, roomId, at).find(entry => entry.state === 'waiting'); if (!next) return null;
      this.assertCanJoin({ ...principal, userId: next.userId, roles: ['member'] }, room, at);
      const invitation = this.inviteToRoom(principal, { roomId, inviteeUserId: next.userId, operationId: 'invite:' + operationId, ttlMs: 5 * 60_000, now: at });
      const entry: HearMeOutVoiceQueueEntryV1 = { ...next, state: 'invited', invitationId: invitation.invitationId, expiresAt: invitation.expiresAt };
      this.db.prepare('UPDATE hmo_room_voice_queue SET body=? WHERE tenant_id=? AND room_id=? AND user_id=?').run(JSON.stringify(entry), principal.tenantId, roomId, next.userId);
      this.remember(principal.tenantId, operationId, 'voice-admit', entry, signature, roomId); return entry;
    });
  }

  removeVoiceTurn(principal: HearMeOutPrincipalV1, roomId: string, userId: string, now?: string) {
    assertPrincipal(principal); const at = validNow(now), room = this.requireRoom(principal.tenantId, roomId, at);
    if (userId !== principal.userId && !this.canManage(principal, room)) throw new Error('Only the room owner or an admin can remove another waiting person');
    this.transaction(() => {
      const entry = this.voiceQueue(principal, roomId, at).find(value => value.userId === userId);
      if (entry?.invitationId) this.db.prepare("UPDATE hmo_room_invitations SET body=json_set(body,'$.revokedAt',?) WHERE tenant_id=? AND invitation_id=?").run(at, principal.tenantId, entry.invitationId);
      this.db.prepare('DELETE FROM hmo_room_voice_queue WHERE tenant_id=? AND room_id=? AND user_id=?').run(principal.tenantId, roomId, userId);
    });
    return { removed: true };
  }

  heartbeatPresence(principal: HearMeOutPrincipalV1, roomId: string, connectionId: string, now?: string): HearMeOutPresenceV1 {
    assertPrincipal(principal);
    const at = validNow(now);
    const room = this.requireRoom(principal.tenantId, roomId, at);
    this.requireMember(principal.tenantId, room.roomId, principal.userId);
    const presence: HearMeOutPresenceV1 = { schemaVersion: 1, tenantId: principal.tenantId, roomId: room.roomId, userId: principal.userId, displayName: principal.displayName, connectionId: cleanId(connectionId, "connectionId"), lastSeenAt: at };
    this.db.prepare("INSERT INTO hmo_room_presence(tenant_id,room_id,user_id,connection_id,last_seen_at,body) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,room_id,user_id,connection_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,body=excluded.body").run(presence.tenantId, presence.roomId, presence.userId, presence.connectionId, presence.lastSeenAt, JSON.stringify(presence));
    return presence;
  }

  listActivePresence(tenantId: string, roomId: string, now?: string): HearMeOutPresenceV1[] {
    const at = validNow(now);
    const room = this.requireRoom(tenantId, roomId, at);
    const cutoff = new Date(Date.parse(at) - HEARMEOUT_PRESENCE_STALE_MS).toISOString();
    return this.db.prepare("SELECT body FROM hmo_room_presence WHERE tenant_id=? AND room_id=? AND last_seen_at>? ORDER BY user_id,connection_id").all(room.tenantId, room.roomId, cutoff).map((row) => JSON.parse(String((row as { body: string }).body)) as HearMeOutPresenceV1);
  }

  leavePresence(principal: HearMeOutPrincipalV1, roomId: string, connectionId: string, now?: string): { left: true } {
    assertPrincipal(principal);
    const room = this.requireRoom(principal.tenantId, roomId, validNow(now));
    this.db.prepare("DELETE FROM hmo_room_presence WHERE tenant_id=? AND room_id=? AND user_id=? AND connection_id=?").run(principal.tenantId, room.roomId, principal.userId, cleanId(connectionId, "connectionId"));
    return { left: true };
  }

  prunePresence(now?: string): number {
    const cutoff = new Date(Date.parse(validNow(now)) - HEARMEOUT_PRESENCE_STALE_MS).toISOString();
    return Number(this.db.prepare("DELETE FROM hmo_room_presence WHERE last_seen_at<=?").run(cutoff).changes);
  }

  leaveRoom(principal: HearMeOutPrincipalV1, roomId: string, operationId: string, now?: string): { left: true } {
    assertPrincipal(principal);
    const replay = this.replay<{ left: true }>(principal.tenantId, operationId, "leave-room");
    if (replay) return replay;
    const room = this.requireRoom(principal.tenantId, roomId, validNow(now));
    if (room.ownerUserId === principal.userId) throw new Error("The room owner cannot leave an active room; delete the room instead");
    const result = { left: true } as const;
    this.transaction(() => {
      this.db.prepare("DELETE FROM hmo_room_presence WHERE tenant_id=? AND room_id=? AND user_id=?").run(principal.tenantId, room.roomId, principal.userId);
      this.db.prepare("DELETE FROM hmo_room_members WHERE tenant_id=? AND room_id=? AND user_id=?").run(principal.tenantId, room.roomId, principal.userId);
      this.db.prepare("DELETE FROM hmo_room_admissions WHERE tenant_id=? AND room_id=? AND user_id=? AND instr(body,'\"method\":\"password\"')>0").run(principal.tenantId, room.roomId, principal.userId);
      this.remember(principal.tenantId, operationId, "leave-room", result, undefined, room.roomId);
    });
    return result;
  }

  moderateMember(principal: HearMeOutPrincipalV1, input: { roomId: string; targetUserId: string; action: HearMeOutModerationActionV1; durationSeconds?: number | undefined; targetRoomId?: string | undefined; operationId: string; now?: string }): { action: HearMeOutModerationActionV1; targetUserId: string; expiresAt?: string; targetRoomId?: string } {
    assertPrincipal(principal);
    const signature = JSON.stringify([principal.userId, input.roomId, input.targetUserId, input.action, input.durationSeconds, input.targetRoomId]);
    const replay = this.replay<{ action: HearMeOutModerationActionV1; targetUserId: string; expiresAt?: string; targetRoomId?: string }>(principal.tenantId, input.operationId, "moderate-room-member", signature);
    if (replay) return replay;
    const at = validNow(input.now);
    const room = this.requireRoom(principal.tenantId, input.roomId, at);
    if (!this.canManage(principal, room)) throw new Error("Only the room owner or an admin can moderate room members");
    const targetUserId = cleanId(input.targetUserId, "targetUserId");
    if (targetUserId === room.ownerUserId) throw new Error("The room owner cannot be kicked, timed out, or banned");
    if (targetUserId === principal.userId) throw new Error("A room moderator cannot moderate themselves");
    if (!["kick", "timeout", "ban", "unban", "mute", "unmute", "move"].includes(input.action)) throw new Error("HearMeOut moderation action is invalid");
    let destination: HearMeOutRoomV1 | undefined;
    const target = this.listMembers(principal.tenantId, room.roomId, at).find(member => member.userId === targetUserId);
    if (["mute", "unmute", "move"].includes(input.action) && !target) throw new Error("HearMeOut room member not found");
    if (input.action === "move") {
      destination = this.requireRoom(principal.tenantId, cleanId(input.targetRoomId || "", "targetRoomId"), at);
      if (destination.roomId === room.roomId) throw new Error("Choose another destination room");
      const moving = { ...principal, userId: targetUserId, displayName: target!.displayName, roles: ["member"] as Array<"member"> };
      this.assertCanJoin(moving, destination, at);
      if (destination.privacy === "private" && !this.canManage(principal, destination)) this.authorizePrivateAdmission(moving, destination, undefined, at);
    }
    let expiresAt: string | undefined;
    if (input.action === "timeout") {
      const duration = Number(input.durationSeconds ?? 600);
      if (!Number.isSafeInteger(duration) || duration < 60 || duration > 24 * 60 * 60) throw new Error("HearMeOut timeout must be between 60 seconds and 24 hours");
      expiresAt = new Date(Date.parse(at) + duration * 1_000).toISOString();
    }
    const result = { action: input.action, targetUserId, ...(expiresAt ? { expiresAt } : {}), ...(destination ? { targetRoomId: destination.roomId } : {}) };
    this.transaction(() => {
      if (input.action === "unban") {
        this.db.prepare("DELETE FROM hmo_room_restrictions WHERE tenant_id=? AND room_id=? AND user_id=?").run(principal.tenantId, room.roomId, targetUserId);
      } else if (input.action === "mute" || input.action === "unmute") {
        this.db.prepare("INSERT INTO hmo_room_member_controls(tenant_id,room_id,user_id,server_muted) VALUES(?,?,?,?) ON CONFLICT(tenant_id,room_id,user_id) DO UPDATE SET server_muted=excluded.server_muted").run(principal.tenantId, room.roomId, targetUserId, input.action === "mute" ? 1 : 0);
      } else {
      this.db.prepare("DELETE FROM hmo_room_presence WHERE tenant_id=? AND room_id=? AND user_id=?").run(principal.tenantId, room.roomId, targetUserId);
      this.db.prepare("DELETE FROM hmo_room_members WHERE tenant_id=? AND room_id=? AND user_id=?").run(principal.tenantId, room.roomId, targetUserId);
      this.db.prepare("DELETE FROM hmo_room_admissions WHERE tenant_id=? AND room_id=? AND user_id=?").run(principal.tenantId, room.roomId, targetUserId);
      this.db.prepare('DELETE FROM hmo_room_voice_queue WHERE tenant_id=? AND room_id=? AND user_id=?').run(principal.tenantId, room.roomId, targetUserId);
      if (input.action === "ban" || input.action === "timeout") {
        const body = { schemaVersion: 1, tenantId: principal.tenantId, roomId: room.roomId, userId: targetUserId, kind: input.action, createdByUserId: principal.userId, createdAt: at, ...(expiresAt ? { expiresAt } : {}) };
        this.db.prepare("INSERT INTO hmo_room_restrictions(tenant_id,room_id,user_id,kind,expires_at,body) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,room_id,user_id) DO UPDATE SET kind=excluded.kind,expires_at=excluded.expires_at,body=excluded.body").run(principal.tenantId, room.roomId, targetUserId, input.action, expiresAt ?? null, JSON.stringify(body));
      }
      if (destination && target) {
        this.putMember({ ...principal, userId: targetUserId, displayName: target.displayName }, destination.roomId, at);
        this.putAdmission(principal.tenantId, destination.roomId, targetUserId, "invitation", principal.userId, at);
        const movement = { targetRoomId: destination.roomId, targetRoomName: destination.name, movedAt: at, movedBy: principal.userId };
        this.db.prepare("INSERT INTO hmo_room_moves(tenant_id,room_id,user_id,target_room_id,body) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,room_id,user_id) DO UPDATE SET target_room_id=excluded.target_room_id,body=excluded.body").run(principal.tenantId, room.roomId, targetUserId, destination.roomId, JSON.stringify(movement));
      }
      }
      this.remember(principal.tenantId, input.operationId, "moderate-room-member", result, signature, room.roomId);
    });
    return result;
  }

  deleteRoom(principal: HearMeOutPrincipalV1, roomId: string, operationId: string, now?: string): { deleted: true; roomId: string } {
    assertPrincipal(principal);
    const replay = this.replay<{ deleted: true; roomId: string }>(principal.tenantId, operationId, "delete-room");
    if (replay) return replay;
    validNow(now);
    const room = this.readRoom(principal.tenantId, roomId);
    if (!room) throw new Error("HearMeOut room not found");
    if (!this.canManage(principal, room)) throw new Error("Only the room owner or an admin can delete the room");
    const result = { deleted: true as const, roomId: room.roomId };
    this.transaction(() => {
      this.removeRoomData(principal.tenantId, room.roomId);
      // A small deletion receipt keeps retries idempotent without retaining room contents.
      this.remember(principal.tenantId, operationId, "delete-room", result);
    });
    return result;
  }

  isServerMuted(tenantId: string, roomId: string, userId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM hmo_room_member_controls WHERE tenant_id=? AND room_id=? AND user_id=? AND server_muted=1").get(tenantId, roomId, userId));
  }

  memberMovement(principal: HearMeOutPrincipalV1, roomId: string): { targetRoomId: string; targetRoomName: string; movedAt: string; movedBy: string } | undefined {
    const row = this.db.prepare("SELECT body FROM hmo_room_moves WHERE tenant_id=? AND room_id=? AND user_id=?").get(principal.tenantId, roomId, principal.userId) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  listRestrictions(principal: HearMeOutPrincipalV1, roomId: string, now?: string): Array<{ userId: string; kind: string; expiresAt?: string }> {
    const at = validNow(now), room = this.requireRoom(principal.tenantId, roomId, at);
    if (!this.canManage(principal, room)) throw new Error("Only the room owner or an admin can review room restrictions");
    return this.db.prepare("SELECT body FROM hmo_room_restrictions WHERE tenant_id=? AND room_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY user_id").all(principal.tenantId, roomId, at).map(row => JSON.parse(String(row.body)));
  }

  listMembers(tenantId: string, roomId: string, now?: string): Array<{ userId: string; displayName: string; joinedAt: string; serverMuted: boolean }> {
    this.requireRoom(tenantId, roomId, validNow(now));
    return this.db.prepare("SELECT m.body,COALESCE(c.server_muted,0) AS server_muted FROM hmo_room_members m LEFT JOIN hmo_room_member_controls c USING(tenant_id,room_id,user_id) WHERE m.tenant_id=? AND m.room_id=? ORDER BY m.user_id").all(tenantId, cleanId(roomId, "roomId")).map(row => ({ ...JSON.parse(String(row.body)), serverMuted: Boolean(row.server_muted) }));
  }

  getSession(tenantId: string, roomId: string, lane: HearMeOutMediaLaneV1, now?: string): HearMeOutMediaSessionV1 {
    const at = validNow(now);
    this.requireRoom(tenantId, roomId, at);
    return this.readSession(tenantId, cleanId(roomId, "roomId"), lane) ?? emptySession(tenantId, cleanId(roomId, "roomId"), lane, at);
  }

  radio(tenant:string,roomId:string):HearMeOutRadioV1|undefined{const row=this.db.prepare('SELECT body FROM hmo_room_radio WHERE tenant_id=? AND room_id=?').get(tenant,roomId);return row?JSON.parse(String(row.body)):undefined;}
  configureRadio(principal:HearMeOutPrincipalV1,roomId:string,enabled:boolean,seed:string,now?:string){
    assertPrincipal(principal);const room=this.requireRoom(principal.tenantId,roomId,validNow(now));this.requireMember(principal.tenantId,roomId,principal.userId);if(!this.canManage(principal,room))throw Error('Only the room host or an admin can change auto-radio');
    const query=String(seed).trim();if(enabled&&(!query||query.length>300))throw Error('Choose a song, artist or style for auto-radio');
    const prior=this.radio(principal.tenantId,roomId),state:HearMeOutRadioV1={enabled,seed:query||prior?.seed||'',revision:(prior?.revision??0)+1,principal:structuredClone(principal),history:prior?.history??[]};
    this.db.prepare('INSERT INTO hmo_room_radio(tenant_id,room_id,body) VALUES(?,?,?) ON CONFLICT(tenant_id,room_id) DO UPDATE SET body=excluded.body,lease_owner=NULL,lease_until=NULL,next_attempt_at=NULL').run(principal.tenantId,roomId,JSON.stringify(state));return state;
  }
  radioRooms(){return this.db.prepare('SELECT tenant_id,room_id,body FROM hmo_room_radio').all().map(row=>({tenantId:String(row.tenant_id),roomId:String(row.room_id),state:JSON.parse(String(row.body)) as HearMeOutRadioV1})).filter(item=>item.state.enabled);}
  claimRadio(tenant:string,roomId:string,owner:string,now:string){return this.db.prepare('UPDATE hmo_room_radio SET lease_owner=?,lease_until=? WHERE tenant_id=? AND room_id=? AND (lease_until IS NULL OR lease_until<=?) AND (next_attempt_at IS NULL OR next_attempt_at<=?)').run(owner,new Date(Date.parse(now)+300000).toISOString(),tenant,roomId,now,now).changes===1;}
  completeRadio(tenant:string,roomId:string,owner:string,radioRevision:number,sessionRevision:number,item:HearMeOutMediaItemV1|undefined,error:string|undefined,now:string){return this.transaction(()=>{
    const row=this.db.prepare('SELECT lease_owner FROM hmo_room_radio WHERE tenant_id=? AND room_id=?').get(tenant,roomId),state=this.radio(tenant,roomId);
    if(!row||row.lease_owner!==owner||!state||state.revision!==radioRevision||!state.enabled)return false;
    let added=false;
    if(item&&this.getRoom(tenant,roomId,now)){
      const session=this.getSession(tenant,roomId,'music',now);
      if(session.revision===sessionRevision&&!session.queue.length){
        this.enqueue(state.principal,{roomId,lane:'music',item:{...item,metadata:{...item.metadata,autoRadio:true}},operationId:'radio:'+owner,now});
        state.history=[...state.history,{itemId:item.itemId,title:item.title,selectedAt:now}].slice(-50);delete state.error;added=true;
      }
    }
    if(error)state.error=error.slice(0,500);
    this.db.prepare('UPDATE hmo_room_radio SET body=?,lease_owner=NULL,lease_until=NULL,next_attempt_at=? WHERE tenant_id=? AND room_id=?').run(JSON.stringify(state),new Date(Date.parse(now)+(error?30000:5000)).toISOString(),tenant,roomId);
    return added;
  });}

  enqueue(principal: HearMeOutPrincipalV1, input: { roomId: string; lane: HearMeOutMediaLaneV1; item: HearMeOutMediaItemV1; operationId: string; now?: string }): HearMeOutMediaSessionV1 {
    return this.transaction(() => this.enqueueInTransaction(principal,input));
  }

  private enqueueInTransaction(principal: HearMeOutPrincipalV1, input: { roomId: string; lane: HearMeOutMediaLaneV1; item: HearMeOutMediaItemV1; operationId: string; now?: string }): HearMeOutMediaSessionV1 {
    assertPrincipal(principal);
    const at = validNow(input.now);
    const room = this.requireRoom(principal.tenantId, input.roomId, at);
    this.requireMember(principal.tenantId, room.roomId, principal.userId);
    const signature=JSON.stringify([principal.userId,input.roomId,input.lane,input.item.type,input.item.title,input.item.source,input.item.playbackUrl,input.item.posterUrl,input.item.durationSeconds,input.item.metadata]);
    const replay=this.replay<HearMeOutMediaSessionV1>(principal.tenantId,input.operationId,"enqueue",signature);
    if(replay)return replay;
    assertItem(input.item);
    const session = this.readSession(principal.tenantId, room.roomId, input.lane) ?? emptySession(principal.tenantId, room.roomId, input.lane, at);
    const request: HearMeOutMediaRequestV1 = {
      requestId: "hmo-request:" + input.operationId,
      requestedBy: { userId: principal.userId, displayName: principal.displayName },
      addedAt: at,
      item: structuredClone(input.item),
    };
    if (!session.current) {
      session.current = request;
      session.playback = { ...session.playback, status: "playing", position: 0, updatedAt: at };
    } else {
      const radioIndex=input.lane==='music'&&input.item.metadata?.autoRadio!==true?session.queue.findIndex(entry=>entry.item.metadata?.autoRadio===true):-1;
      if(radioIndex<0)session.queue.push(request);else session.queue.splice(radioIndex,0,request);
    }
    session.revision += 1;
    this.transaction(() => {
      this.writeSession(session);
      if (input.lane === 'music' && session.current?.requestId === request.requestId) this.recordMusicStart(session, at);
      this.remember(principal.tenantId, input.operationId, "enqueue", session,signature);
    });
    return structuredClone(session);
  }

  control(principal: HearMeOutPrincipalV1, input: { roomId: string; lane: HearMeOutMediaLaneV1; action: HearMeOutControlActionV1; operationId: string; position?: number; targetIndex?: number; expectedRequestId?: string; now?: string }): HearMeOutMediaSessionV1 {
    return this.transaction(() => this.controlInTransaction(principal,input));
  }

  private controlInTransaction(principal: HearMeOutPrincipalV1, input: { roomId: string; lane: HearMeOutMediaLaneV1; action: HearMeOutControlActionV1; operationId: string; position?: number; targetIndex?: number; expectedRequestId?: string; now?: string }): HearMeOutMediaSessionV1 {
    assertPrincipal(principal);
    const at = validNow(input.now);
    const room = this.requireRoom(principal.tenantId, input.roomId, at);
    this.requireMember(principal.tenantId, room.roomId, principal.userId);
    const signature=JSON.stringify([principal.userId,input.roomId,input.lane,input.action,input.position,input.targetIndex,input.expectedRequestId]);
    const replay=this.replay<HearMeOutMediaSessionV1>(principal.tenantId,input.operationId,"control",signature);
    if(replay)return replay;
    const session = this.readSession(principal.tenantId, room.roomId, input.lane) ?? emptySession(principal.tenantId, room.roomId, input.lane, at);
    this.assertCanControl(principal, room, session, input.action);

    const effectivePosition = playbackPosition(session, at);
    if (!session.current && ["play", "pause", "seek"].includes(input.action)) {
      session.playback = { ...session.playback, status: "idle", position: 0, updatedAt: at };
    } else if (input.action === "play" || input.action === "pause") {
      session.playback = { ...session.playback, status: input.action === "play" ? "playing" : "paused", position: Math.max(0, input.position ?? effectivePosition), updatedAt: at };
    } else if (input.action === "seek") {
      session.playback = { ...session.playback, position: finiteNonNegative(input.position, "position"), updatedAt: at };
    } else if (input.action === "mute" || input.action === "unmute") {
      session.playback = { ...session.playback, position: effectivePosition, muted: input.action === "mute", updatedAt: at };
    } else if (input.action === "volume") {
      const volume = Math.max(0, Math.min(100, Math.round(finiteNonNegative(input.position, "volume"))));
      session.playback = { ...session.playback, position: effectivePosition, volume, muted: volume === 0, updatedAt: at };
    } else if (input.action === "next") {
      if (!input.expectedRequestId || session.current?.requestId === input.expectedRequestId) {
        session.current = session.queue.shift() ?? null;
        session.playback = { ...session.playback, status: session.current ? "playing" : "idle", position: 0, updatedAt: at };
      }
    } else if (input.action === "jump") {
      const index = Number(input.targetIndex);
      if (!Number.isSafeInteger(index) || index < 0 || index >= session.queue.length) throw new Error("Queue item is no longer available");
      const request = session.queue[index]!;
      session.queue = session.queue.slice(index + 1);
      session.current = request;
      session.playback = { ...session.playback, status: "paused", position: 0, updatedAt: at };
    } else if (input.action === "clear") {
      session.current = null;
      session.queue = [];
      session.playback = { ...session.playback, status: "idle", position: 0, muted: true, updatedAt: at };
    }
    session.revision += 1;
    this.transaction(() => {
      this.writeSession(session);
      this.remember(principal.tenantId, input.operationId, "control", session,signature);
      if (input.lane === 'music' && session.playback.status === 'playing') this.recordMusicStart(session, at);
    });
    return structuredClone(session);
  }

  saveFavorite(principal: HearMeOutPrincipalV1, item: HearMeOutMediaItemV1, now?: string) {
    assertPrincipal(principal); assertItem(item); if (item.type !== 'music') throw new Error('Choose a music track to save');
    const itemId = musicLibraryId(item), savedAt = validNow(now);
    this.db.prepare('INSERT INTO hmo_music_favorites(tenant_id,user_id,item_id,saved_at,body) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,user_id,item_id) DO UPDATE SET body=excluded.body').run(principal.tenantId, principal.userId, itemId, savedAt, JSON.stringify(item));
    return { itemId, item: structuredClone(item) };
  }

  removeFavorite(principal: HearMeOutPrincipalV1, itemId: string) {
    assertPrincipal(principal); this.db.prepare('DELETE FROM hmo_music_favorites WHERE tenant_id=? AND user_id=? AND item_id=?').run(principal.tenantId, principal.userId, cleanId(itemId, 'itemId'));
    return { removed: true };
  }

  musicLibrary(principal: HearMeOutPrincipalV1, offset = 0) {
    assertPrincipal(principal); if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid library page');
    const rows = this.db.prepare('SELECT item_id AS itemId,saved_at AS savedAt,body FROM hmo_music_favorites WHERE tenant_id=? AND user_id=? ORDER BY saved_at DESC,item_id LIMIT 101 OFFSET ?').all(principal.tenantId, principal.userId, offset);
    const favorites = rows.slice(0,100).map(row => ({ itemId: String(row.itemId), savedAt: String(row.savedAt), item: JSON.parse(String(row.body)) as HearMeOutMediaItemV1 }));
    const history = this.db.prepare('SELECT item_id AS itemId,MAX(played_at) AS lastPlayedAt,COUNT(*) AS playCount,body FROM hmo_music_history WHERE tenant_id=? AND user_id=? GROUP BY item_id ORDER BY lastPlayedAt DESC LIMIT 100').all(principal.tenantId, principal.userId).map(row => ({ itemId: String(row.itemId), lastPlayedAt: String(row.lastPlayedAt), playCount: Number(row.playCount), item: JSON.parse(String(row.body)) as HearMeOutMediaItemV1 }));
    const mostPlayed = this.db.prepare('SELECT item_id AS itemId,MAX(played_at) AS lastPlayedAt,COUNT(*) AS playCount,body FROM hmo_music_history WHERE tenant_id=? AND user_id=? GROUP BY item_id ORDER BY playCount DESC,lastPlayedAt DESC LIMIT 100').all(principal.tenantId, principal.userId).map(row => ({ itemId: String(row.itemId), lastPlayedAt: String(row.lastPlayedAt), playCount: Number(row.playCount), item: JSON.parse(String(row.body)) as HearMeOutMediaItemV1 }));
    return { favorites, recent: history, mostPlayed, ...(rows.length > 100 ? { nextOffset: offset + 100 } : {}) };
  }

  queueFavorite(principal: HearMeOutPrincipalV1, roomId: string, itemId: string, operationId: string, now?: string) {
    const row = this.db.prepare('SELECT body FROM hmo_music_favorites WHERE tenant_id=? AND user_id=? AND item_id=?').get(principal.tenantId, principal.userId, cleanId(itemId, 'itemId')) as { body: string } | undefined;
    if (!row) throw new Error('Saved track not found');
    return this.enqueue(principal, { roomId, lane: 'music', item: JSON.parse(row.body), operationId, ...(now ? { now } : {}) });
  }

  private recordMusicStart(session: HearMeOutMediaSessionV1, at: string) {
    const current = session.current; if (!current || current.item.type !== 'music') return;
    this.db.prepare('INSERT INTO hmo_music_history(tenant_id,user_id,request_id,item_id,played_at,body) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,request_id) DO NOTHING').run(session.tenantId, current.requestedBy.userId, current.requestId, musicLibraryId(current.item), at, JSON.stringify(current.item));
  }

  private assertCanControl(principal: HearMeOutPrincipalV1, room: HearMeOutRoomV1, session: HearMeOutMediaSessionV1, action: HearMeOutControlActionV1): void {
    if (this.canManage(principal, room)) return;
    const ownsRequest = [session.current, ...session.queue].some((request) => request?.requestedBy.userId === principal.userId);
    if (ownsRequest && (action === "next" || action === "clear")) return;
    throw new Error("Only the room host or an admin can use that media control");
  }

  private canManage(principal: HearMeOutPrincipalV1, room: HearMeOutRoomV1): boolean {
    return room.ownerUserId === principal.userId || principal.roles.includes("admin");
  }

  private assertCanJoin(principal: HearMeOutPrincipalV1, room: HearMeOutRoomV1, now: string): void {
    if (this.canManage(principal, room)) return;
    const restriction = this.activeRestriction(room.tenantId, room.roomId, principal.userId, now);
    if (!restriction) return;
    if (restriction.kind === "ban") throw new Error("You are banned from this HearMeOut room");
    throw new Error(`You are timed out from this HearMeOut room until ${restriction.expiresAt}`);
  }

  private activeRestriction(tenantId: string, roomId: string, userId: string, now: string): { kind: "timeout" | "ban"; expiresAt?: string } | undefined {
    const row = this.db.prepare("SELECT kind,expires_at FROM hmo_room_restrictions WHERE tenant_id=? AND room_id=? AND user_id=?").get(tenantId, roomId, userId) as { kind: string; expires_at: string | null } | undefined;
    if (!row) return undefined;
    if (row.expires_at && Date.parse(row.expires_at) <= Date.parse(now)) {
      this.db.prepare("DELETE FROM hmo_room_restrictions WHERE tenant_id=? AND room_id=? AND user_id=?").run(tenantId, roomId, userId);
      return undefined;
    }
    return { kind: row.kind === "ban" ? "ban" : "timeout", ...(row.expires_at ? { expiresAt: row.expires_at } : {}) };
  }

  private readRoom(tenantId: string, roomId: string): HearMeOutRoomV1 | undefined {
    const row = this.db.prepare("SELECT body FROM hmo_rooms WHERE tenant_id=? AND room_id=?").get(cleanId(tenantId, "tenantId"), cleanId(roomId, "roomId")) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  private requireRoom(tenantId: string, roomId: string, now: string): HearMeOutRoomV1 {
    const room = this.readRoom(tenantId, roomId);
    if (!room || isExpired(room, now)) throw new Error("HearMeOut room not found or expired");
    return room;
  }

  private requireMember(tenantId: string, roomId: string, userId: string): void {
    const row = this.db.prepare("SELECT 1 FROM hmo_room_members WHERE tenant_id=? AND room_id=? AND user_id=?").get(tenantId, roomId, userId);
    if (!row) throw new Error("HearMeOut room membership is required");
  }

  private authorizePrivateAdmission(principal: HearMeOutPrincipalV1, room: HearMeOutRoomV1, password: string | undefined, now: string): { method: "owner" | "password" | "invitation"; invitation?: HearMeOutRoomInvitationV1 } | undefined {
    if (room.ownerUserId === principal.userId || this.isMember(room.tenantId, room.roomId, principal.userId) || this.hasAdmission(room.tenantId, room.roomId, principal.userId)) return undefined;
    const invitation = this.activeInvitation(room.tenantId, room.roomId, principal.userId, now);
    if (invitation) return { method: "invitation", invitation };
    const access = this.db.prepare("SELECT password_salt,password_hash FROM hmo_room_access WHERE tenant_id=? AND room_id=?").get(room.tenantId, room.roomId) as { password_salt: string | null; password_hash: string | null } | undefined;
    if (access?.password_salt && access.password_hash && password !== undefined && verifyPrivateRoomPassword(privateRoomPassword(password), access.password_salt, access.password_hash)) return { method: "password" };
    throw new Error("Private HearMeOut room admission is required");
  }

  private isMember(tenantId: string, roomId: string, userId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM hmo_room_members WHERE tenant_id=? AND room_id=? AND user_id=?").get(tenantId, roomId, userId));
  }

  private hasAdmission(tenantId: string, roomId: string, userId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM hmo_room_admissions WHERE tenant_id=? AND room_id=? AND user_id=?").get(tenantId, roomId, userId));
  }

  private activeInvitation(tenantId: string, roomId: string, userId: string, now: string): HearMeOutRoomInvitationV1 | undefined {
    const rows = this.db.prepare("SELECT body FROM hmo_room_invitations WHERE tenant_id=? AND room_id=? AND invitee_user_id=? AND expires_at>? ORDER BY expires_at DESC").all(tenantId, roomId, userId, now) as Array<{ body: string }>;
    return rows.map((row) => JSON.parse(row.body) as HearMeOutRoomInvitationV1).find((invitation) => !invitation.revokedAt);
  }

  private putAdmission(tenantId: string, roomId: string, userId: string, method: "owner" | "password" | "invitation", admittedByUserId: string, admittedAt: string): void {
    const body = { schemaVersion: 1, tenantId, roomId, userId, method, admittedByUserId, admittedAt };
    this.db.prepare("INSERT INTO hmo_room_admissions(tenant_id,room_id,user_id,body) VALUES(?,?,?,?) ON CONFLICT(tenant_id,room_id,user_id) DO NOTHING").run(tenantId, roomId, userId, JSON.stringify(body));
  }

  private acceptInvitation(invitation: HearMeOutRoomInvitationV1, acceptedAt: string): void {
    if (invitation.acceptedAt) return;
    const accepted = { ...invitation, acceptedAt };
    this.db.prepare("UPDATE hmo_room_invitations SET body=? WHERE tenant_id=? AND invitation_id=?").run(JSON.stringify(accepted), invitation.tenantId, invitation.invitationId);
  }

  private putMember(principal: HearMeOutPrincipalV1, roomId: string, joinedAt: string): void {
    const body = { userId: principal.userId, displayName: principal.displayName, joinedAt };
    this.db.prepare("INSERT INTO hmo_room_members(tenant_id,room_id,user_id,body) VALUES(?,?,?,?) ON CONFLICT(tenant_id,room_id,user_id) DO UPDATE SET body=excluded.body").run(principal.tenantId, roomId, principal.userId, JSON.stringify(body));
  }

  private readSession(tenantId: string, roomId: string, lane: HearMeOutMediaLaneV1): HearMeOutMediaSessionV1 | undefined {
    assertLane(lane);
    const row = this.db.prepare("SELECT body FROM hmo_media_sessions WHERE tenant_id=? AND room_id=? AND lane=?").get(tenantId, cleanId(roomId, "roomId"), lane) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  private writeSession(session: HearMeOutMediaSessionV1): void {
    this.db.prepare("INSERT INTO hmo_media_sessions(tenant_id,room_id,lane,body) VALUES(?,?,?,?) ON CONFLICT(tenant_id,room_id,lane) DO UPDATE SET body=excluded.body").run(session.tenantId, session.roomId, session.lane, JSON.stringify(session));
  }

  private replay<T>(tenantId: string, operationId: string, kind: string,signature?:string): T | undefined {
    const row = this.db.prepare("SELECT kind,body,request_signature FROM hmo_operations WHERE tenant_id=? AND operation_id=?").get(cleanId(tenantId, "tenantId"), cleanId(operationId, "operationId")) as { kind: string; body: string;request_signature?:string } | undefined;
    if (!row) return undefined;
    if (row.kind !== kind) throw new Error("HearMeOut operation ID was already used for another action");
    if(signature&&row.request_signature&&signature!==row.request_signature)throw new Error("HearMeOut operation ID was already used with different values");
    return JSON.parse(row.body);
  }

  private remember(tenantId: string, operationId: string, kind: string, value: unknown,signature?:string,roomId?:string): void {
    this.db.prepare("INSERT INTO hmo_operations(tenant_id,operation_id,kind,body,request_signature,room_id) VALUES(?,?,?,?,?,?)").run(tenantId, cleanId(operationId, "operationId"), kind, JSON.stringify(value),signature??null,roomId??(value as {roomId?:string})?.roomId??null);
  }

  private transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth++;
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
    finally { this.transactionDepth--; }
  }
}

function musicLibraryId(item: HearMeOutMediaItemV1) { return createHash('sha256').update(JSON.stringify([item.source, item.metadata?.videoId ?? (item.source === 'user-url' ? item.playbackUrl : item.itemId)])).digest('hex'); }

export function playbackPosition(session: HearMeOutMediaSessionV1, now?: string): number {
  const at = Date.parse(validNow(now));
  const base = Math.max(0, Number(session.playback.position || 0));
  return session.playback.status === "playing" ? base + Math.max(0, at - Date.parse(session.playback.updatedAt)) / 1_000 : base;
}

function emptySession(tenantId: string, roomId: string, lane: HearMeOutMediaLaneV1, now: string): HearMeOutMediaSessionV1 {
  assertLane(lane);
  return { schemaVersion: 1, tenantId, roomId, sessionId: `hmo:${roomId}:${lane}`, lane, current: null, queue: [], playback: { status: "idle", position: 0, updatedAt: now, muted: true, volume: 85 }, revision: 0 };
}
function isExpired(room: HearMeOutRoomV1, now: string): boolean { return Boolean(!room.systemRoom && room.expiresAt && Date.parse(room.expiresAt) <= Date.parse(now)); }
function assertLane(lane: string): asserts lane is HearMeOutMediaLaneV1 { if (lane !== "movie" && lane !== "music") throw new Error("HearMeOut media lane is invalid"); }
function validNow(value?: string): string { const result = value ?? new Date().toISOString(); if (!Number.isFinite(Date.parse(result))) throw new Error("HearMeOut timestamp is invalid"); return new Date(result).toISOString(); }
function cleanId(value: string, name: string): string { if (!value || value.trim() !== value || value.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(value)) throw new Error(`HearMeOut ${name} is invalid`); return value; }
function cleanText(value: string, name: string, max: number): string { if (!value || value.trim() !== value || value.length > max) throw new Error(`HearMeOut ${name} is invalid`); return value; }
function finiteNonNegative(value: number | undefined, name: string): number { if (!Number.isFinite(value) || Number(value) < 0) throw new Error(`HearMeOut ${name} is invalid`); return Number(value); }
function assertPrincipal(value: HearMeOutPrincipalV1): void { cleanId(value.tenantId, "tenantId"); cleanId(value.userId, "userId"); cleanText(value.displayName, "displayName", 120); if (!Array.isArray(value.roles) || value.roles.some((role) => role !== "admin" && role !== "member")) throw new Error("HearMeOut principal roles are invalid"); }
function assertItem(item: HearMeOutMediaItemV1): void { cleanId(item.itemId, "itemId"); cleanText(item.title, "media title", 300); cleanText(item.source, "media source", 160); if (!item.playbackUrl || item.playbackUrl.length > 2_000 || (!item.playbackUrl.startsWith("https://") && !item.playbackUrl.startsWith("/"))) throw new Error("HearMeOut playback URL is invalid"); if (item.durationSeconds !== undefined) finiteNonNegative(item.durationSeconds, "duration"); }
function privateRoomPassword(value: string): string { if (typeof value !== "string" || value.length < 8 || value.length > 128 || value.trim() !== value) throw new Error("HearMeOut private-room password must be 8 to 128 characters"); return value; }
function hashPrivateRoomPassword(password: string): { salt: string; hash: string } { const salt = randomBytes(16).toString("hex"); return { salt, hash: scryptSync(password, salt, 32).toString("hex") }; }
function verifyPrivateRoomPassword(password: string, salt: string, expectedHash: string): boolean { const actual = scryptSync(password, salt, 32); const expected = Buffer.from(expectedHash, "hex"); return actual.length === expected.length && timingSafeEqual(actual, expected); }
