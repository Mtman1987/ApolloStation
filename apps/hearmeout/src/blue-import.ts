import { HEARMEOUT_ACTIVITY_ROOM_ID } from "./activity-contract.js";

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

function cleanPath(value: unknown, name: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,300}$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function cleanId(value: unknown, name: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,200}$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}
