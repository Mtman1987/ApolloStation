import { assertNebulaTagStateV1, createNebulaTagState, type NebulaTagHistoryEntryV1, type NebulaTagMonthlyWinnerV1, type NebulaTagStateV1 } from "./nebula-tag.js";

export interface NebulaTagMigrationReportV1 {
  playersImported: number;
  historyImported: number;
  blockedHistorySkipped: number;
  winnersImported: number;
  warnings: string[];
}

export function migrateDonorNebulaTagState(source: unknown, input: { tenantId: string; migratedAt: string }): { state: NebulaTagStateV1; report: NebulaTagMigrationReportV1 } {
  if (!source || typeof source !== "object") throw new Error("Donor Nebula Arcade tag game state must be an object");
  const donor = source as Record<string, any>;
  const state = createNebulaTagState(input.tenantId);
  const warnings: string[] = [];
  const rawPlayers: Array<[string, Record<string, any>]> = Array.isArray(donor.players)
    ? donor.players.map((player: Record<string, any>, index: number) => [String(player.id || player.userId || `unknown-${index}`), player])
    : Object.entries(donor.tagPlayers || {}) as Array<[string, Record<string, any>]>;
  for (const [key, player] of rawPlayers) {
    const userId = String(player.id || player.userId || key).trim();
    const username = String(player.twitchUsername || player.username || player.displayName || userId).trim().toLowerCase().replace(/^@+/, "");
    if (!userId || !username) { warnings.push(`Skipped player ${key}: missing identity`); continue; }
    const joinedAt = toIso(player.joinedAt, input.migratedAt);
    state.players[userId] = {
      userId,
      username,
      joinedAt,
      lastActiveAt: toIso(player.lastChatAt || player.lastPlayedAt, joinedAt),
      score: 0,
      tagsMade: 0,
      timesTagged: 0,
      passCount: Math.max(0, Number(player.passCount || (player.hasPass ? 1 : 0)) || 0),
      sleeping: Boolean(player.sleepingImmunity),
      offline: Boolean(player.offlineImmunity),
      timedImmunityUntil: nullableIso(player.timedImmunityUntil),
      noTagbackFromUserId: player.noTagbackFrom ? String(player.noTagbackFrom) : null,
    };
  }

  const rawHistory = Array.isArray(donor.tagHistory) ? donor.tagHistory : Array.isArray(donor.history) ? donor.history : [];
  let blockedHistorySkipped = 0;
  for (const [index, entry] of rawHistory.entries()) {
    if (entry?.blocked) { blockedHistorySkipped += 1; continue; }
    const actorUserId = String(entry?.taggerId || entry?.from || "system");
    const rawTarget = String(entry?.taggedId || entry?.to || "");
    const freeForAll = rawTarget === "free-for-all";
    if (!freeForAll && (!state.players[actorUserId] || !state.players[rawTarget])) {
      warnings.push(`Skipped history ${entry?.id || index}: player identity was not imported`);
      continue;
    }
    const history: NebulaTagHistoryEntryV1 = {
      id: String(entry?.id || `donor-history-${index}`),
      commandId: `migration:${entry?.id || index}`,
      kind: freeForAll ? "free-for-all" : entry?.passUsed ? "pass" : "tag",
      actorUserId,
      targetUserId: freeForAll ? null : rawTarget,
      channelId: String(entry?.streamerId || entry?.channel || "migration").replace(/^#/, ""),
      occurredAt: toIso(entry?.timestamp, input.migratedAt),
      doublePoints: Boolean(entry?.doublePoints || entry?.passUsed || freeForAll),
      scoreAwarded: freeForAll ? 0 : Number(entry?.scoreAwarded || (entry?.doublePoints || entry?.passUsed ? 200 : 100)),
    };
    state.history.push(history);
    if (!freeForAll) {
      const actor = state.players[actorUserId]!;
      const target = state.players[rawTarget]!;
      actor.tagsMade += 1;
      actor.score += history.scoreAwarded;
      target.timesTagged += 1;
      target.score -= 50;
    }
  }
  for (const [key, player] of rawPlayers) {
    const userId = String(player.id || player.userId || key).trim();
    if (state.players[userId]) state.players[userId]!.score += Math.max(0, Number(player.bingoPoints || 0) || 0);
  }
  const donorGame = donor.tagGame?.state || donor;
  state.currentItUserId = String(donorGame.currentIt || donorGame.it || rawPlayers.find(([, player]) => player.isIt)?.[0] || "") || null;
  if (state.currentItUserId && !state.players[state.currentItUserId]) { warnings.push("Current-it identity was missing; migrated as free for all"); state.currentItUserId = null; }
  state.lastTagAt = nullableIso(donorGame.lastTagTime || donor.lastUpdate) ?? state.history.at(-1)?.occurredAt ?? null;
  const winners = Array.isArray(donorGame.monthlyWinners) ? donorGame.monthlyWinners : [];
  state.monthlyWinners = winners.flatMap((winner: any): NebulaTagMonthlyWinnerV1[] => {
    const userId = String(winner?.userId || "");
    const place = Number(winner?.place);
    if (!state.players[userId] || ![1, 2, 3].includes(place)) return [];
    return [{ userId, username: state.players[userId]!.username, place: place as 1 | 2 | 3, monthKey: donorMonthKey(winner?.month, input.migratedAt), selectedAt: toIso(winner?.selectedAt, input.migratedAt) }];
  }).sort((left: NebulaTagMonthlyWinnerV1, right: NebulaTagMonthlyWinnerV1) => left.place - right.place);
  const payoutKeys: string[] = (Array.isArray(donorGame.crownPayouts) ? donorGame.crownPayouts : []).map((entry: any) => String(entry?.key || "")).filter((value: string) => Boolean(value));
  state.crownAwardKeys = [...new Set<string>(payoutKeys)];
  return { state: assertNebulaTagStateV1(state, input.tenantId), report: { playersImported: Object.keys(state.players).length, historyImported: state.history.length, blockedHistorySkipped, winnersImported: state.monthlyWinners.length, warnings } };
}

function nullableIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const raw = typeof value === "object" && value ? Number((value as any).seconds ?? (value as any)._seconds) * 1_000 : value;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function toIso(value: unknown, fallback: string): string { return nullableIso(value) ?? fallback; }
function donorMonthKey(value: unknown, fallback: string): string {
  const direct = String(value || "");
  if (/^\d{4}-\d{2}$/.test(direct)) return direct;
  const parsed = Date.parse(`1 ${direct}`);
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date(fallback);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
