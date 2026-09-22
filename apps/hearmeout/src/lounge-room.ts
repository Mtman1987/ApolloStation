import type {HearMeOutBroadcastProgram} from './broadcast-program.js';
import type {SqliteHearMeOutRoomMediaRuntime} from './room-media-core.js';

// Public URLs already use this room identifier. The player is resolved through
// the normal room-to-player relationship, never a separate global session.
export const PUBLIC_LOUNGE_ID = 'system-spacemountainlive-lounge';
export const SPOTLIGHT_MEDIA_ID = 'system-spacemountainlive-spotlight-media';

const SYSTEM_MEDIA_ROOMS = [
  {roomId: PUBLIC_LOUNGE_ID, name: '24-Hour Lounge'},
  {roomId: SPOTLIGHT_MEDIA_ID, name: 'Spotlight Media'},
] as const;

export function isPublicSystemMediaRoom(roomId: string) {
  return SYSTEM_MEDIA_ROOMS.some((room) => room.roomId === roomId);
}

function ensureSystemMediaRoom(rooms: SqliteHearMeOutRoomMediaRuntime, program: HearMeOutBroadcastProgram, roomId: string, name: string) {
  const {tenantId, executionUserId} = program.binding;
  const room = rooms.getRoom(tenantId, roomId) ?? rooms.createRoom(
    {tenantId, userId: executionUserId, displayName: name, roles: ['admin']},
    {roomId, name, privacy: 'public', systemRoom: true, operationId: `${roomId}:provision`},
  );
  if (!room.systemRoom || room.privacy !== 'public') throw new Error(`${name} must be a permanent public room`);
  return program.ensureAppRoom(tenantId, room.roomId, room.name);
}

export function ensurePublicSystemMediaRooms(rooms: SqliteHearMeOutRoomMediaRuntime, program: HearMeOutBroadcastProgram) {
  return SYSTEM_MEDIA_ROOMS.map(({roomId, name}) => ensureSystemMediaRoom(rooms, program, roomId, name));
}

/** Compatibility export for callers that only need the Lounge program. */
export function ensurePublicLounge(rooms: SqliteHearMeOutRoomMediaRuntime, program: HearMeOutBroadcastProgram) {
  return ensureSystemMediaRoom(rooms, program, PUBLIC_LOUNGE_ID, '24-Hour Lounge');
}
