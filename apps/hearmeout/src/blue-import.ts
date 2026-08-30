import { HEARMEOUT_ACTIVITY_ROOM_ID } from "./activity-contract.js";
import type { HearMeOutMediaRequestV1 } from "./room-media-core.js";
import type { HearMeOutVoiceBridgeConfigV1, HearMeOutVoiceAudioProfileV1 } from "./voice-bridge.js";

export interface BlueHearMeOutDocumentV1 {
  collectionPath: string;
  documentId: string;
  data: unknown;
}

export type BlueHearMeOutMigrationActionV1 =
  | {
      kind: "ensure-activity-room";
      sourceCollection: "rooms";
      sourceDocumentId: string;
      roomId: typeof HEARMEOUT_ACTIVITY_ROOM_ID;
    }
  | {
      kind: "reconcile-user-with-spmt";
      sourceCollection: "users";
      sourceDocumentId: string;
    }
  | {
      kind: "rebuild-room-presence";
      sourceCollection: `rooms/${string}/users`;
      sourceDocumentId: string;
      roomId: string;
    }
  | {
      kind: "retain-legacy-config-for-review";
      sourceCollection: "config";
      sourceDocumentId: string;
    };

export interface BlueHearMeOutMigrationBlockerV1 {
  collectionPath: string;
  documentId: string;
  reason: string;
}

export interface BlueHearMeOutMigrationPlanV1 {
  schemaVersion: 1;
  sourceDocuments: number;
  actions: BlueHearMeOutMigrationActionV1[];
  blockers: BlueHearMeOutMigrationBlockerV1[];
  counts: {
    ensureActivityRoom: number;
    reconcileUsersWithSpmt: number;
    rebuildRoomPresence: number;
    retainLegacyConfigForReview: number;
    blocked: number;
  };
  readyForImport: boolean;
}

export interface BlueHearMeOutActivityRoomTransformV1 {
  schemaVersion: 1;
  roomId: typeof HEARMEOUT_ACTIVITY_ROOM_ID;
  ensureCanonicalRoom: true;
  musicQueue: HearMeOutMediaRequestV1[];
  voiceBridge?: HearMeOutVoiceBridgeConfigV1 & { importedBlueEnabled: boolean };
  restart: {
    presence: true;
    activePlayback: boolean;
    djWorker: boolean;
  };
}

/**
 * Plan the Blue HearMeOut -> Apollo migration without mutating either side.
 *
 * This function is deliberately fail-closed. It understands only the Blue
 * collections observed in the 2026-08-30 production inventory. Unknown rooms,
 * nested collections, or collection names become blockers instead of being
 * silently copied or discarded.
 */
export function planBlueHearMeOutMigration(documents: BlueHearMeOutDocumentV1[]): BlueHearMeOutMigrationPlanV1 {
  if (!Array.isArray(documents)) throw new Error("Blue HearMeOut migration documents must be an array");

  const actions: BlueHearMeOutMigrationActionV1[] = [];
  const blockers: BlueHearMeOutMigrationBlockerV1[] = [];
  const seen = new Set<string>();

  for (const document of documents) {
    const collectionPath = cleanPath(document?.collectionPath, "collectionPath");
    const documentId = cleanId(document?.documentId, "documentId");
    const key = `${collectionPath}\u0000${documentId}`;
    if (seen.has(key)) {
      blockers.push({ collectionPath, documentId, reason: "Duplicate Blue document identity" });
      continue;
    }
    seen.add(key);

    if (collectionPath === "users") {
      actions.push({ kind: "reconcile-user-with-spmt", sourceCollection: "users", sourceDocumentId: documentId });
      continue;
    }

    if (collectionPath === "rooms") {
      if (documentId !== HEARMEOUT_ACTIVITY_ROOM_ID) {
        blockers.push({ collectionPath, documentId, reason: "Blue room is not the canonical Discord Activity room and has no approved transform" });
        continue;
      }
      try {
        transformBlueHearMeOutActivityRoom(document, "migration-preview");
      } catch (error) {
        blockers.push({ collectionPath, documentId, reason: `Blue activity room cannot be transformed: ${safeMessage(error)}` });
        continue;
      }
      actions.push({ kind: "ensure-activity-room", sourceCollection: "rooms", sourceDocumentId: documentId, roomId: HEARMEOUT_ACTIVITY_ROOM_ID });
      continue;
    }

    const nestedUsers = collectionPath.match(/^rooms\/([^/]+)\/users$/);
    if (nestedUsers) {
      const roomId = cleanId(nestedUsers[1], "roomId");
      if (roomId !== HEARMEOUT_ACTIVITY_ROOM_ID) {
        blockers.push({ collectionPath, documentId, reason: "Nested Blue room user belongs to a room without an approved transform" });
        continue;
      }
      actions.push({ kind: "rebuild-room-presence", sourceCollection: collectionPath as `rooms/${string}/users`, sourceDocumentId: documentId, roomId });
      continue;
    }

    if (collectionPath === "config") {
      actions.push({ kind: "retain-legacy-config-for-review", sourceCollection: "config", sourceDocumentId: documentId });
      continue;
    }

    blockers.push({ collectionPath, documentId, reason: "Unknown Blue collection has no approved migration classification" });
  }

  actions.sort(compareActions);
  blockers.sort((left, right) => left.collectionPath.localeCompare(right.collectionPath) || left.documentId.localeCompare(right.documentId));

  const counts = {
    ensureActivityRoom: actions.filter((action) => action.kind === "ensure-activity-room").length,
    reconcileUsersWithSpmt: actions.filter((action) => action.kind === "reconcile-user-with-spmt").length,
    rebuildRoomPresence: actions.filter((action) => action.kind === "rebuild-room-presence").length,
    retainLegacyConfigForReview: actions.filter((action) => action.kind === "retain-legacy-config-for-review").length,
    blocked: blockers.length,
  };

  // Legacy config is preserved for explicit review and therefore keeps the
  // production import gate closed until it is intentionally classified.
  const configReviewPending = counts.retainLegacyConfigForReview > 0;

  return {
    schemaVersion: 1,
    sourceDocuments: documents.length,
    actions,
    blockers,
    counts,
    readyForImport: blockers.length === 0 && !configReviewPending,
  };
}

/**
 * Transform only durable state from the canonical Blue Discord Activity room.
 * Active playback, presence and worker ownership are intentionally not resumed.
 */
export function transformBlueHearMeOutActivityRoom(
  document: BlueHearMeOutDocumentV1,
  tenantId: string,
): BlueHearMeOutActivityRoomTransformV1 {
  if (cleanPath(document.collectionPath, "collectionPath") !== "rooms") throw new Error("Activity room source collection must be rooms");
  if (cleanId(document.documentId, "documentId") !== HEARMEOUT_ACTIVITY_ROOM_ID) throw new Error("Only the canonical Discord Activity room is supported");
  const tenant = cleanId(tenantId, "tenantId");
  const data = object(document.data, "activity room data");
  if (data.id !== undefined && String(data.id) !== HEARMEOUT_ACTIVITY_ROOM_ID) throw new Error("Blue activity room ID conflicts with its document ID");
  if (data.systemRoom !== undefined && data.systemRoom !== true) throw new Error("Blue Discord Activity room is not marked as a system room");
  if (data.isPrivate === true || data.password) throw new Error("Blue Discord Activity room unexpectedly contains private-room access state");

  const musicQueue = Array.isArray(data.playlist)
    ? data.playlist.map((value, index) => transformBluePlaylistItem(value, index))
    : [];

  const voiceBridge = data.voiceBridge === undefined
    ? undefined
    : transformBlueVoiceBridge(data.voiceBridge, tenant);

  return {
    schemaVersion: 1,
    roomId: HEARMEOUT_ACTIVITY_ROOM_ID,
    ensureCanonicalRoom: true,
    musicQueue,
    ...(voiceBridge ? { voiceBridge } : {}),
    restart: {
      presence: true,
      activePlayback: Boolean(data.currentTrackId) || data.isPlaying === true,
      djWorker: data.djActive === true,
    },
  };
}

function transformBluePlaylistItem(value: unknown, index: number): HearMeOutMediaRequestV1 {
  const item = object(value, `playlist[${index}]`);
  const blueId = cleanId(item.id, `playlist[${index}].id`);
  const title = text(item.title, `playlist[${index}].title`, 300);
  const playbackUrl = optionalText(item.playbackUrl, 4000) ?? text(item.url, `playlist[${index}].url`, 4000);
  const addedBy = optionalText(item.addedBy, 300) ?? "unknown";
  const addedAt = timestamp(item.addedAt, `playlist[${index}].addedAt`);
  const duration = Number(item.duration);
  const metadata: Record<string, unknown> = { blueItemId: blueId };
  for (const [key, raw] of [["artist", item.artist], ["artId", item.artId], ["addedBy", item.addedBy], ["playbackStrategy", item.playbackStrategy]] as const) {
    const normalized = optionalText(raw, 500);
    if (normalized) metadata[key] = normalized;
  }
  if (Number.isFinite(Number(item.plays)) && Number(item.plays) >= 0) metadata.plays = Math.trunc(Number(item.plays));

  return {
    requestId: `blue-music:${blueId}`,
    requestedBy: { userId: "hearmeout-blue-migration", displayName: "Migrated HearMeOut queue" },
    addedAt,
    item: {
      itemId: blueId,
      type: "music",
      title,
      source: optionalText(item.source, 100) ?? "hearmeout-blue",
      playbackUrl,
      ...(optionalText(item.thumbnail, 4000) ? { posterUrl: optionalText(item.thumbnail, 4000) } : {}),
      ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}),
      metadata,
    },
  };
}

function transformBlueVoiceBridge(value: unknown, tenantId: string): HearMeOutVoiceBridgeConfigV1 & { importedBlueEnabled: boolean } {
  const input = object(value, "voiceBridge");
  const importedBlueEnabled = input.enabled === true;
  const profile = voiceProfile(input.audioProfile);
  const guildId = snowflake(input.guildId, "voiceBridge.guildId");
  const voiceChannelId = snowflake(input.voiceChannelId, "voiceBridge.voiceChannelId");
  const receiveGain = Number(input.discordReceiveGain);
  return {
    schemaVersion: 1,
    tenantId,
    roomId: HEARMEOUT_ACTIVITY_ROOM_ID,
    // Import desired configuration only. A canary handoff must explicitly start
    // the bridge after Blue stops owning the Discord voice channel.
    enabled: false,
    importedBlueEnabled,
    guildId,
    voiceChannelId,
    roomVoiceOutboundEnabled: typeof input.roomVoiceOutboundEnabled === "boolean" ? input.roomVoiceOutboundEnabled : true,
    audioProfile: profile,
    discordReceiveGain: Number.isFinite(receiveGain) ? Math.max(0, Math.min(4, receiveGain)) : 1,
    ...(optionalId(input.updatedBy) ? { updatedBy: optionalId(input.updatedBy) } : {}),
    ...(optionalTimestamp(input.updatedAt) ? { updatedAt: optionalTimestamp(input.updatedAt) } : {}),
  };
}

function voiceProfile(value: unknown): HearMeOutVoiceAudioProfileV1 {
  if (value === "low-latency" || value === "balanced" || value === "resilient" || value === "clean") return value;
  return "clean";
}

function compareActions(left: BlueHearMeOutMigrationActionV1, right: BlueHearMeOutMigrationActionV1) {
  const order: Record<BlueHearMeOutMigrationActionV1["kind"], number> = {
    "ensure-activity-room": 0,
    "reconcile-user-with-spmt": 1,
    "rebuild-room-presence": 2,
    "retain-legacy-config-for-review": 3,
  };
  return order[left.kind] - order[right.kind]
    || left.sourceCollection.localeCompare(right.sourceCollection)
    || left.sourceDocumentId.localeCompare(right.sourceDocumentId);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} is invalid`);
  return value.trim();
}
function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max) throw new Error("Optional Blue text field is invalid");
  return value.trim() || undefined;
}
function timestamp(value: unknown, name: string) {
  const normalized = optionalTimestamp(value);
  if (!normalized) throw new Error(`${name} is invalid`);
  return normalized;
}
function optionalTimestamp(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
function optionalId(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && /^[A-Za-z0-9._:@/-]{1,200}$/.test(value) ? value : undefined;
}
function snowflake(value: unknown, name: string) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{5,30}$/.test(normalized)) throw new Error(`${name} must be a Discord snowflake`);
  return normalized;
}
function cleanPath(value: unknown, name: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,300}$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}
function cleanId(value: unknown, name: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,200}$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}
function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error ?? "unknown migration error")).replace(/[\r\n]+/g, " ").slice(0, 240);
}
