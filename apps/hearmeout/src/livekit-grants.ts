import type { HearMeOutPrincipalV1, HearMeOutRoomV1, SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";

export type HearMeOutLiveKitModeV1 = "voice-participant" | "voice-listener" | "media-publisher";
export type HearMeOutLiveKitPrincipalV1 =
  | { kind: "human"; tenantId: string; userId: string; displayName: string; roles: Array<"admin" | "member"> }
  | { kind: "service"; tenantId: string; appId: string; subjectId: string; scopes: string[] };

export interface HearMeOutLiveKitClaimsV1 {
  schemaVersion: 1;
  tenantId: string;
  roomId: string;
  grantId: string;
  liveKitRoom: string;
  identity: string;
  name: string;
  mode: HearMeOutLiveKitModeV1;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  allowedSources: Array<"microphone" | "screen_share" | "screen_share_audio">;
  issuedAt: string;
  expiresAt: string;
}

export interface HearMeOutLiveKitSignerV1 { sign(claims: HearMeOutLiveKitClaimsV1): Promise<string>; }
export interface HearMeOutLiveKitTokenV1 { schemaVersion: 1; token: string; url: string; claims: HearMeOutLiveKitClaimsV1; }

export class HearMeOutLiveKitGrantService {
  constructor(private readonly rooms: SqliteHearMeOutRoomMediaRuntime, private readonly signer: HearMeOutLiveKitSignerV1, private readonly liveKitUrl: string, private readonly maxTtlMs = 15 * 60 * 1_000) {
    if (!/^wss:\/\//.test(liveKitUrl)) throw new Error("HearMeOut LiveKit URL must use wss");
    if (!Number.isSafeInteger(maxTtlMs) || maxTtlMs < 60_000 || maxTtlMs > 60 * 60 * 1_000) throw new Error("HearMeOut LiveKit token lifetime is invalid");
  }

  async issue(principal: HearMeOutLiveKitPrincipalV1, input: { roomId: string; mode: HearMeOutLiveKitModeV1; operationId: string; now?: string; ttlMs?: number }): Promise<HearMeOutLiveKitTokenV1> {
    assertPrincipal(principal);
    const now = normalizedTime(input.now);
    const grantId = cleanId(input.operationId, "operationId");
    const room = this.rooms.getRoom(principal.tenantId, input.roomId, now);
    if (!room) throw new Error("HearMeOut room not found or expired");
    const ttlMs = input.ttlMs ?? 10 * 60 * 1_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > this.maxTtlMs) throw new Error("HearMeOut LiveKit token lifetime is invalid");
    const authority = this.authorize(principal, room, input.mode, now);
    const claims: HearMeOutLiveKitClaimsV1 = {
      schemaVersion: 1,
      tenantId: principal.tenantId,
      roomId: room.roomId,
      grantId,
      liveKitRoom: liveKitRoomName(principal.tenantId, room.roomId),
      identity: authority.identity,
      name: authority.name,
      mode: input.mode,
      canPublish: authority.canPublish,
      canSubscribe: true,
      canPublishData: authority.canPublishData,
      allowedSources: authority.allowedSources,
      issuedAt: now,
      expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
    };
    const token = await this.signer.sign(structuredClone(claims));
    if (!token || token.length > 16_000) throw new Error("HearMeOut LiveKit signer returned an invalid token");
    return { schemaVersion: 1, token, url: this.liveKitUrl, claims };
  }

  private authorize(principal: HearMeOutLiveKitPrincipalV1, room: HearMeOutRoomV1, mode: HearMeOutLiveKitModeV1, now: string): { identity: string; name: string; canPublish: boolean; canPublishData: boolean; allowedSources: HearMeOutLiveKitClaimsV1["allowedSources"] } {
    if (principal.kind === "human") {
      const member = this.rooms.listMembers(principal.tenantId, room.roomId, now).find((value) => value.userId === principal.userId);
      if (!member) throw new Error("HearMeOut room membership is required");
      const managesRoom = room.ownerUserId === principal.userId || principal.roles.includes("admin");
      if (mode === "media-publisher" && !managesRoom) throw new Error("Only the room host or an admin can publish room media");
      if (mode === "voice-listener") return { identity: `user:${principal.userId}:listener`, name: principal.displayName, canPublish: false, canPublishData: false, allowedSources: [] };
      if (mode === "media-publisher") return { identity: `user:${principal.userId}:media`, name: principal.displayName, canPublish: true, canPublishData: true, allowedSources: ["screen_share", "screen_share_audio"] };
      return { identity: `user:${principal.userId}`, name: principal.displayName, canPublish: true, canPublishData: true, allowedSources: ["microphone"] };
    }
    if (mode !== "media-publisher" || !["companion", "hearmeout"].includes(principal.appId) || !principal.scopes.includes("rooms:media:publish")) throw new Error("HearMeOut service media authority denied");
    return { identity: `service:${principal.appId}:${principal.subjectId}`, name: principal.appId, canPublish: true, canPublishData: true, allowedSources: ["screen_share", "screen_share_audio"] };
  }
}

export function liveKitRoomName(tenantId: string, roomId: string): string {
  const value = `hmo_${tenantId}_${roomId}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 128);
  if (!value || value.length < 5) throw new Error("HearMeOut LiveKit room name is invalid");
  return value;
}

function assertPrincipal(principal: HearMeOutLiveKitPrincipalV1): void { if (!principal.tenantId) throw new Error("HearMeOut LiveKit principal is invalid"); if (principal.kind === "human") { const compatible: HearMeOutPrincipalV1 = principal; if (!compatible.userId || !compatible.displayName) throw new Error("HearMeOut LiveKit human principal is invalid"); } else if (!principal.appId || !principal.subjectId || !Array.isArray(principal.scopes)) throw new Error("HearMeOut LiveKit service principal is invalid"); }
function normalizedTime(value?: string): string { const result = value ?? new Date().toISOString(); if (!Number.isFinite(Date.parse(result))) throw new Error("HearMeOut LiveKit timestamp is invalid"); return new Date(result).toISOString(); }
function cleanId(value: string, name: string): string { if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`HearMeOut LiveKit ${name} is invalid`); return value; }
