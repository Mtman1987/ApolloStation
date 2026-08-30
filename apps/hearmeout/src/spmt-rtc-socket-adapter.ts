import { SpmtRtcRelayHubV1, type SpmtRtcRelayParticipantRoleV1 } from "./spmt-rtc-relay.js";

export interface SpmtRtcRelaySocketV1 {
  send(data: Uint8Array): boolean | void;
  close(code: number, reason: string): void;
  onBinary(handler: (data: Uint8Array) => void): void;
  onClose(handler: () => void): void;
}

export interface SpmtRtcRelayJoinRequestV1 {
  tenantId: string;
  roomId: string;
  participantId: string;
  role: SpmtRtcRelayParticipantRoleV1;
  authorization: string;
}

export interface SpmtRtcRelayAuthorizerV1 {
  authorize(input: Omit<SpmtRtcRelayJoinRequestV1, "authorization"> & { authorization: string }): Promise<boolean> | boolean;
}

/**
 * Host-neutral adapter for WebSocket implementations.
 *
 * The HTTP/WSS server owns TLS and the WebSocket handshake. Once upgraded, it
 * hands the socket plus the already-parsed join request here. That keeps the
 * relay independent of `ws`, uWebSockets, Fly, Sprites, or any specific host.
 */
export class SpmtRtcRelaySocketAdapterV1 {
  constructor(private readonly hub: SpmtRtcRelayHubV1, private readonly authorizer: SpmtRtcRelayAuthorizerV1) {}

  async attach(socket: SpmtRtcRelaySocketV1, request: SpmtRtcRelayJoinRequestV1) {
    const normalized = normalizeJoin(request);
    let allowed = false;
    try {
      allowed = await this.authorizer.authorize(normalized);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      socket.close(4401, "SPMT RTC authorization failed");
      return { accepted: false as const, reason: "unauthorized" as const };
    }

    const roomKey = `${normalized.tenantId}:${normalized.roomId}`;
    const room = this.hub.room(roomKey);
    try {
      room.join({
        participantId: normalized.participantId,
        role: normalized.role,
        send: (frame) => socket.send(frame),
        close: (code, reason) => socket.close(code, reason),
      });
    } catch (error) {
      socket.close(4409, safeReason(error));
      return { accepted: false as const, reason: "join-rejected" as const };
    }

    let closed = false;
    const leave = () => {
      if (closed) return;
      closed = true;
      room.leave(normalized.participantId);
    };
    socket.onBinary((frame) => {
      if (closed) return;
      try {
        room.publish(normalized.participantId, frame);
      } catch (error) {
        leave();
        socket.close(4400, safeReason(error));
      }
    });
    socket.onClose(leave);

    return { accepted: true as const, roomKey, participantId: normalized.participantId, role: normalized.role };
  }
}

function normalizeJoin(input: SpmtRtcRelayJoinRequestV1) {
  const tenantId = cleanId(input?.tenantId, "tenantId");
  const roomId = cleanId(input?.roomId, "roomId");
  const participantId = cleanId(input?.participantId, "participantId");
  const role = input?.role;
  if (role !== "browser" && role !== "discord-bridge" && role !== "persona" && role !== "music") throw new Error("SPMT RTC relay role is invalid");
  const authorization = String(input?.authorization ?? "").trim();
  if (!/^Bearer [^\r\n]{16,}$/.test(authorization)) throw new Error("SPMT RTC relay authorization is invalid");
  return { tenantId, roomId, participantId, role, authorization };
}
function cleanId(value: unknown, name: string) { const clean = String(value ?? "").trim(); if (!clean || clean.length > 160 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`); return clean; }
function safeReason(error: unknown) { const text = error instanceof Error ? error.message : String(error ?? "SPMT RTC relay error"); return text.replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").replace(/[\r\n\0]/g, " ").slice(0, 120); }
