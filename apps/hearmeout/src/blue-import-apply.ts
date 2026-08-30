import { ensureHearMeOutDiscordActivityRoom, joinHearMeOutDiscordActivityRoom } from "./activity-room.js";
import type { BlueHearMeOutActivityRoomTransformV1 } from "./blue-import.js";
import type { HearMeOutPrincipalV1, SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";
import type { SqliteHearMeOutVoiceBridgeStore } from "./voice-bridge.js";

export interface BlueHearMeOutApplyResultV1 {
  schemaVersion: 1;
  roomId: string;
  importedQueueItems: number;
  playbackState: "idle" | "paused";
  voiceBridgeConfigured: boolean;
  voiceBridgeEnabled: false;
  requiresExplicitHandoffStart: boolean;
}

/**
 * Apply an already-validated Blue transform to isolated Green stores.
 *
 * The caller is responsible for ensuring these stores are not a live authority.
 * This helper never starts workers or provider connections. Imported playback is
 * paused and imported Discord voice configuration is forced disabled.
 */
export function applyBlueHearMeOutActivityRoomTransform(
  transform: BlueHearMeOutActivityRoomTransformV1,
  rooms: SqliteHearMeOutRoomMediaRuntime,
  voiceStore: SqliteHearMeOutVoiceBridgeStore,
  principal: HearMeOutPrincipalV1,
  now = new Date().toISOString(),
): BlueHearMeOutApplyResultV1 {
  if (!principal.roles.includes("admin")) throw new Error("Blue HearMeOut import requires an SPMT admin principal");
  if (principal.tenantId !== transform.voiceBridge?.tenantId && transform.voiceBridge) throw new Error("Blue voice bridge tenant does not match import principal");

  const room = ensureHearMeOutDiscordActivityRoom(rooms, principal, now);
  joinHearMeOutDiscordActivityRoom(rooms, principal, `blue-import:join:${principal.userId}`, now);

  let session = rooms.getSession(principal.tenantId, room.roomId, "music", now);
  for (const request of transform.musicQueue) {
    session = rooms.enqueue(principal, {
      roomId: room.roomId,
      lane: "music",
      item: request.item,
      operationId: `blue-import:queue:${request.item.itemId}`,
      now: request.addedAt,
    });
  }

  if (session.current && session.playback.status !== "paused") {
    session = rooms.control(principal, {
      roomId: room.roomId,
      lane: "music",
      action: "pause",
      operationId: "blue-import:pause-before-handoff",
      now,
    });
  }

  if (transform.voiceBridge) {
    voiceStore.put({ ...transform.voiceBridge, enabled: false });
  }

  return {
    schemaVersion: 1,
    roomId: room.roomId,
    importedQueueItems: transform.musicQueue.length,
    playbackState: session.current ? "paused" : "idle",
    voiceBridgeConfigured: Boolean(transform.voiceBridge),
    voiceBridgeEnabled: false,
    requiresExplicitHandoffStart: Boolean(transform.voiceBridge?.importedBlueEnabled || transform.restart.activePlayback || transform.restart.djWorker),
  };
}
