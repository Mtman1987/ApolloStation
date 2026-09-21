import type {HearMeOutBroadcastProgram} from './broadcast-program.js';
import type {SqliteHearMeOutRoomMediaRuntime} from './room-media-core.js';

// Public URLs already use this room identifier. The player is resolved through
// the normal room-to-player relationship, never a separate global session.
export const PUBLIC_LOUNGE_ID = 'system-spacemountainlive-lounge';

export function ensurePublicLounge(rooms: SqliteHearMeOutRoomMediaRuntime, program: HearMeOutBroadcastProgram) {
  const {tenantId, executionUserId} = program.binding;
  const room = rooms.getRoom(tenantId, PUBLIC_LOUNGE_ID) ?? rooms.createRoom(
    {tenantId, userId: executionUserId, displayName: '24-Hour Lounge', roles: ['admin']},
    {roomId: PUBLIC_LOUNGE_ID, name: '24-Hour Lounge', privacy: 'public', systemRoom: true, operationId: 'public-lounge:provision'},
  );
  if (!room.systemRoom || room.privacy !== 'public') throw new Error('The public lounge must be a permanent public room');
  return program.ensureAppRoom(tenantId, room.roomId, room.name);
}
