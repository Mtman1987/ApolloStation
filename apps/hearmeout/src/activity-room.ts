import type { HearMeOutPrincipalV1, HearMeOutRoomV1, SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";
import { HEARMEOUT_ACTIVITY_ROOM_ID, HEARMEOUT_ACTIVITY_ROOM_NAME } from "./activity-contract.js";

export function ensureHearMeOutDiscordActivityRoom(
  runtime: SqliteHearMeOutRoomMediaRuntime,
  principal: HearMeOutPrincipalV1,
  now?: string,
): HearMeOutRoomV1 {
  if (!principal?.tenantId || !principal?.userId || !principal.roles?.includes("admin")) {
    throw new Error("HearMeOut Discord Activity room creation requires an SPMT admin principal");
  }
  const existing = runtime.getRoom(principal.tenantId, HEARMEOUT_ACTIVITY_ROOM_ID, now);
  if (existing) return existing;
  const systemPrincipal: HearMeOutPrincipalV1 = {
    tenantId: principal.tenantId,
    userId: HEARMEOUT_ACTIVITY_ROOM_ID,
    displayName: HEARMEOUT_ACTIVITY_ROOM_NAME,
    roles: ["admin"],
  };
  return runtime.createRoom(systemPrincipal, {
    roomId: HEARMEOUT_ACTIVITY_ROOM_ID,
    name: HEARMEOUT_ACTIVITY_ROOM_NAME,
    privacy: "public",
    systemRoom: true,
    operationId: "discord-activity-room:ensure:v1",
    ...(now ? { now } : {}),
  });
}

export function joinHearMeOutDiscordActivityRoom(
  runtime: SqliteHearMeOutRoomMediaRuntime,
  principal: HearMeOutPrincipalV1,
  operationId: string,
  now?: string,
): HearMeOutRoomV1 {
  const room = runtime.getRoom(principal.tenantId, HEARMEOUT_ACTIVITY_ROOM_ID, now);
  if (!room) throw new Error("HearMeOut Discord Activity room is not initialized");
  return runtime.joinRoom(principal, room.roomId, operationId, now);
}
