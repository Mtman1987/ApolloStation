import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { transformBlueHearMeOutActivityRoom, type BlueHearMeOutDocumentV1 } from "./blue-import.js";
import { applyBlueHearMeOutActivityRoomTransform } from "./blue-import-apply.js";
import { SqliteHearMeOutRoomMediaRuntime, type HearMeOutPrincipalV1 } from "./room-media-core.js";
import { SqliteHearMeOutVoiceBridgeStore } from "./voice-bridge.js";

export interface HearMeOutPersistentMigrationInput {
  sourcePath: string;
  targetPath: string;
  recoveryPath: string;
  sourceDatabaseSha256: string;
  activityRoom: BlueHearMeOutDocumentV1;
  principal: HearMeOutPrincipalV1;
}

/** Build a new authority beside the running one; activation is a separate step. */
export async function migrateHearMeOutPersistentRoom(input: HearMeOutPersistentMigrationInput) {
  const sourcePath=resolve(input.sourcePath), targetPath=resolve(input.targetPath), recoveryPath=resolve(input.recoveryPath);
  if(new Set([sourcePath,targetPath,recoveryPath]).size!==3)throw Error("Migration source, target and recovery paths must differ");
  if(!/^[a-f0-9]{64}$/.test(input.sourceDatabaseSha256))throw Error("Verified Blue database digest is required");
  if(!input.principal.roles.includes("admin"))throw Error("Migration requires the existing owner/admin principal");
  if(!existsSync(sourcePath))throw Error("Existing HearMeOut authority is missing");
  if(existsSync(targetPath))throw Error("Migration target already exists; review its receipt before replacing it");
  if(existsSync(recoveryPath))throw Error("Recovery point already exists");
  mkdirSync(dirname(targetPath),{recursive:true,mode:0o700});
  mkdirSync(dirname(recoveryPath),{recursive:true,mode:0o700});
  const staged=`${targetPath}.next`;
  if(existsSync(staged))throw Error("An earlier migration is still staged");
  const source=new DatabaseSync(sourcePath,{readOnly:true});
  let beforeRooms=0;
  try {
    if(source.prepare("PRAGMA quick_check").get()?.quick_check!=="ok")throw Error("Existing HearMeOut integrity failed");
    beforeRooms=Number(source.prepare("SELECT COUNT(*) AS n FROM hmo_rooms").get()?.n??0);
    await backup(source,recoveryPath);
  } finally { source.close(); }
  const recovery=new DatabaseSync(recoveryPath,{readOnly:true});
  try { await backup(recovery,staged); } finally { recovery.close(); }
  try {
    const transform=transformBlueHearMeOutActivityRoom(input.activityRoom,input.principal.tenantId);
    const rooms=new SqliteHearMeOutRoomMediaRuntime(staged), voice=new SqliteHearMeOutVoiceBridgeStore(staged);
    let applied;
    try { applied=applyBlueHearMeOutActivityRoomTransform(transform,rooms,voice,input.principal); }
    finally { voice.close();rooms.close(); }
    const check=new DatabaseSync(staged);
    let receipt;
    try {
      if(check.prepare("PRAGMA quick_check").get()?.quick_check!=="ok")throw Error("Migrated HearMeOut integrity failed");
      const afterRooms=Number(check.prepare("SELECT COUNT(*) AS n FROM hmo_rooms").get()?.n??0);
      if(afterRooms<beforeRooms)throw Error("Migration lost an existing room");
      receipt={schemaVersion:1,sourceDatabaseSha256:input.sourceDatabaseSha256,tenantId:input.principal.tenantId,ownerUserId:input.principal.userId,beforeRooms,afterRooms,importedQueueItems:applied.importedQueueItems,playbackState:applied.playbackState,voiceBridgeEnabled:false,createdAt:new Date().toISOString()};
      check.exec("CREATE TABLE hmo_migration_receipt(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL) STRICT");
      check.prepare("INSERT INTO hmo_migration_receipt VALUES(1,?)").run(JSON.stringify(receipt));
      check.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally { check.close(); }
    renameSync(staged,targetPath);
    return receipt;
  } catch(error) {
    for(const suffix of ["","-wal","-shm"])rmSync(staged+suffix,{force:true});
    throw error;
  }
}
