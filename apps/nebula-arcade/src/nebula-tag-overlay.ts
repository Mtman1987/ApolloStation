import { assertNebulaTagStateV1, decorateNebulaTagCrowns, getNebulaTagLeaderboard, type NebulaTagStateV1 } from "./nebula-tag.js";

export interface NebulaTagOverlaySnapshotV1 {
  schemaVersion: 1;
  tenantId: string;
  generatedAt: string;
  currentIt: { userId: string; username: string } | null;
  freeForAll: boolean;
  lastTagAt: string | null;
  playerCount: number;
  availablePlayerCount: number;
  viewer: { userId: string; username: string; score: number; rank: number; passCount: number } | null;
  leaderboard: Array<{ rank: number; userId: string; username: string; score: number; tagsMade: number; timesTagged: number; away: boolean; passCount: number }>;
  recentHistory: Array<{ id: string; occurredAt: string; actorUsername: string; targetUsername: string | null; doublePoints: boolean; scoreAwarded: number; announcement: string }>;
  monthlyWinners: Array<{ userId: string; username: string; place: 1 | 2 | 3; monthKey: string }>;
}

export function buildNebulaTagOverlaySnapshot(stateValue: NebulaTagStateV1, options: { viewerUserId?: string; generatedAt?: string } = {}): NebulaTagOverlaySnapshotV1 {
  const state = assertNebulaTagStateV1(stateValue);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generatedAt must be an ISO timestamp");
  const ordered = getNebulaTagLeaderboard(state);
  const current = state.currentItUserId ? state.players[state.currentItUserId] : undefined;
  const viewer = options.viewerUserId ? state.players[options.viewerUserId] : undefined;
  const crowned = (username: string) => decorateNebulaTagCrowns(username, state.monthlyWinners);
  return {
    schemaVersion: 1,
    tenantId: state.tenantId,
    generatedAt,
    currentIt: current ? { userId: current.userId, username: crowned(current.username) } : null,
    freeForAll: !current,
    lastTagAt: state.lastTagAt,
    playerCount: ordered.length,
    availablePlayerCount: ordered.filter((player) => !player.sleeping && !player.offline).length,
    viewer: viewer ? { userId: viewer.userId, username: crowned(viewer.username), score: viewer.score, rank: ordered.findIndex((player) => player.userId === viewer.userId) + 1, passCount: viewer.passCount } : null,
    leaderboard: ordered.slice(0, 10).map((player, index) => ({ rank: index + 1, userId: player.userId, username: crowned(player.username), score: player.score, tagsMade: player.tagsMade, timesTagged: player.timesTagged, away: player.sleeping || player.offline, passCount: player.passCount })),
    recentHistory: [...state.history].reverse().slice(0, 10).map((entry) => {
      const actor = state.players[entry.actorUserId]?.username ?? entry.actorUserId;
      const target = entry.targetUserId ? state.players[entry.targetUserId]?.username ?? entry.targetUserId : null;
      const announcement = entry.kind === "free-for-all" ? "Nebula Arcade tag game is free for all." : `${actor} tagged ${target ?? "someone"}${entry.doublePoints ? " for double points" : ""}.`;
      return { id: entry.id, occurredAt: entry.occurredAt, actorUsername: crowned(actor), targetUsername: target ? crowned(target) : null, doublePoints: entry.doublePoints, scoreAwarded: entry.scoreAwarded, announcement: crowned(announcement) };
    }),
    monthlyWinners: state.monthlyWinners.map(({ userId, username, place, monthKey }) => ({ userId, username: crowned(username), place, monthKey })),
  };
}
