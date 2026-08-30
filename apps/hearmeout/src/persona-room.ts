import { DatabaseSync } from "node:sqlite";
import type { HearMeOutPrincipalV1, SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";

export interface HearMeOutServicePersonaV1 {
  personaId: string;
  displayName: string;
  ownerTenantId: string;
  ownerName?: string;
  aliases: string[];
  interests: string[];
  voice?: string;
  livekitTtsDescriptor?: string;
  avatarUrl?: string;
  idleAvatarUrl?: string;
  talkingAvatarUrl?: string;
  canInvite: boolean;
}
export interface HearMeOutPersonaRoomWorkerV1 {
  control(input: { action: "join" | "leave"; tenantId: string; roomId: string; persona: HearMeOutServicePersonaV1; serviceSession: boolean }): Promise<Record<string, unknown>>;
  speak(input: { tenantId: string; roomId: string; personaId: string; audioDataUri: string }): Promise<Record<string, unknown>>;
}
export interface HearMeOutPersonaPresenceV1 { schemaVersion: 1; tenantId: string; roomId: string; persona: HearMeOutServicePersonaV1; joinedAt: string; updatedBy: string; }

export class SqliteHearMeOutPersonaRoomController {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly rooms: SqliteHearMeOutRoomMediaRuntime, private readonly worker: HearMeOutPersonaRoomWorkerV1, private readonly now: () => string = () => new Date().toISOString()) {
    if (!path) throw new Error("HearMeOut persona-room database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS hmo_persona_rooms(tenant_id TEXT NOT NULL,room_id TEXT NOT NULL,persona_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,room_id,persona_id)) STRICT;");
  }
  close(): void { this.db.close(); }
  list(tenantId: string, roomId: string): HearMeOutPersonaPresenceV1[] {
    return (this.db.prepare("SELECT body FROM hmo_persona_rooms WHERE tenant_id=? AND room_id=? ORDER BY persona_id").all(clean(tenantId), clean(roomId)) as Array<{ body: string }>).map((row) => JSON.parse(row.body) as HearMeOutPersonaPresenceV1);
  }
  async control(principal: HearMeOutPrincipalV1, input: { roomId: string; action: "join" | "leave"; persona: HearMeOutServicePersonaV1 }) {
    const room = this.requireManager(principal, input.roomId);
    const persona = normalizePersona(input.persona);
    if (!persona.canInvite) throw new Error(`${persona.displayName} is not shared for HearMeOut room use`);
    const worker = await this.worker.control({ action: input.action, tenantId: room.tenantId, roomId: room.roomId, persona, serviceSession: input.action === "join" });
    if (input.action === "join") {
      const presence: HearMeOutPersonaPresenceV1 = { schemaVersion: 1, tenantId: room.tenantId, roomId: room.roomId, persona, joinedAt: new Date(this.now()).toISOString(), updatedBy: principal.userId };
      this.db.prepare("INSERT INTO hmo_persona_rooms(tenant_id,room_id,persona_id,body) VALUES(?,?,?,?) ON CONFLICT(tenant_id,room_id,persona_id) DO UPDATE SET body=excluded.body").run(room.tenantId, room.roomId, persona.personaId, JSON.stringify(presence));
      return { success: true as const, action: input.action, presence, worker };
    }
    this.db.prepare("DELETE FROM hmo_persona_rooms WHERE tenant_id=? AND room_id=? AND persona_id=?").run(room.tenantId, room.roomId, persona.personaId);
    return { success: true as const, action: input.action, persona, worker };
  }
  async speak(principal: HearMeOutPrincipalV1, input: { roomId: string; personaId: string; audioDataUri: string }) {
    const room = this.requireManager(principal, input.roomId);
    const personaId = clean(input.personaId);
    const present = this.db.prepare("SELECT 1 FROM hmo_persona_rooms WHERE tenant_id=? AND room_id=? AND persona_id=?").get(room.tenantId, room.roomId, personaId);
    if (!present) throw new Error("HearMeOut persona is not present in this room");
    const audioDataUri = validateAudioDataUri(input.audioDataUri);
    return this.worker.speak({ tenantId: room.tenantId, roomId: room.roomId, personaId, audioDataUri });
  }
  private requireManager(principal: HearMeOutPrincipalV1, roomId: string) {
    const room = this.rooms.getRoom(principal.tenantId, roomId);
    if (!room) throw new Error("HearMeOut room was not found");
    if (room.ownerUserId !== principal.userId && !principal.roles.includes("admin")) throw new Error("HearMeOut room management is required");
    return room;
  }
}

function normalizePersona(value: HearMeOutServicePersonaV1): HearMeOutServicePersonaV1 {
  return { personaId: clean(value.personaId), displayName: label(value.displayName), ownerTenantId: clean(value.ownerTenantId), ...(value.ownerName ? { ownerName: label(value.ownerName) } : {}), aliases: strings(value.aliases), interests: strings(value.interests), ...(value.voice ? { voice: label(value.voice) } : {}), ...(value.livekitTtsDescriptor ? { livekitTtsDescriptor: clean(value.livekitTtsDescriptor) } : {}), ...(value.avatarUrl ? { avatarUrl: https(value.avatarUrl) } : {}), ...(value.idleAvatarUrl ? { idleAvatarUrl: https(value.idleAvatarUrl) } : {}), ...(value.talkingAvatarUrl ? { talkingAvatarUrl: https(value.talkingAvatarUrl) } : {}), canInvite: value.canInvite === true };
}
function validateAudioDataUri(value: string): string { if (!/^data:audio\/(?:mpeg|mp3|wav|ogg|webm);base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 16_000_000) throw new Error("HearMeOut persona audio is invalid"); return value; }
function strings(values: string[]): string[] { return [...new Set(values.map(label))].slice(0, 50); }
function https(value: string): string { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error("HearMeOut persona asset URL is invalid"); return url.toString(); }
function clean(value: string): string { if (!value || value.trim() !== value || value.length > 300 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error("HearMeOut persona identity is invalid"); return value; }
function label(value: string): string { const clean = value.trim(); if (!clean || clean.length > 160 || /[\r\n\0]/.test(clean)) throw new Error("HearMeOut persona label is invalid"); return clean; }
