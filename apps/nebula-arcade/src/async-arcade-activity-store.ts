import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore } from "@spmt/async-json-store";
import { NEBULA_ARCADE_GAMES, parseNebulaMessage, type NebulaCommandTargetV1 } from "./game-hub.js";
import { NEBULA_ACTIVITY_VISIBLE_MS, NEBULA_CHAT_ACTIVE_MS } from "./arcade-activity.js";

type ChannelRecord = { gameIds: string[]; lastSpmtAt: number | null };
type MemberRecord = { channelId: string; actorId: string; gameId: string; joined: boolean; lastSeenAt: number };
type ChoiceRecord = { targets: NebulaCommandTargetV1[]; expiresAt: number };
export interface AsyncNebulaArcadeActivityStoreOptions { databasePath?: string; mode?: "sqlite" | "turso"; url?: string; authToken?: string; }

/** Async tenant-scoped activity, membership and pending-choice state. */
export class AsyncNebulaArcadeActivityStore {
  private readonly records: AsyncJsonRecordStore;
  constructor(options: AsyncNebulaArcadeActivityStoreOptions = {}) {
    this.records = createAsyncJsonRecordStore({
      service: "nebula-arcade",
      ...(options.databasePath ? { databasePath: options.databasePath } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.authToken ? { authToken: options.authToken } : {}),
    });
  }
  initialize(): Promise<void> { return this.records.initialize(); }
  health(): Promise<{ ready: boolean }> { return this.records.health(); }
  close(): Promise<void> | void { return this.records.close(); }

  async configure(tenantId: string, channelId: string, gameIds: string[]) {
    const tenant = clean(tenantId), channel = cleanChannel(channelId);
    await this.records.transaction(async (tx) => {
      const current = await tx.get<ChannelRecord>("arcade-activity-channels", tenant, channel);
      await tx.put("arcade-activity-channels", tenant, channel, { gameIds: [...new Set(gameIds)], lastSpmtAt: current?.lastSpmtAt ?? null });
    });
  }
  async configuredGames(tenantId: string, channelId: string): Promise<string[]> {
    const value = await this.records.get<ChannelRecord>("arcade-activity-channels", clean(tenantId), cleanChannel(channelId));
    return value?.gameIds ?? [];
  }
  async observe(tenantId: string, channelId: string, actorId: string, text: string, now: number) {
    const tenant = clean(tenantId), channel = cleanChannel(channelId), actor = clean(actorId);
    await this.records.transaction(async (tx) => {
      const members = await tx.list<MemberRecord>("arcade-activity-members", tenant);
      for (const row of members) if (row.value.channelId === channel && row.value.actorId === actor) {
        await tx.put("arcade-activity-members", tenant, row.key, { ...row.value, lastSeenAt: Math.max(row.value.lastSeenAt, now) });
      }
      if (parseNebulaMessage(text)) {
        const current = await tx.get<ChannelRecord>("arcade-activity-channels", tenant, channel);
        await tx.put("arcade-activity-channels", tenant, channel, { gameIds: current?.gameIds ?? [], lastSpmtAt: Math.max(current?.lastSpmtAt ?? 0, now) });
      }
    });
  }
  async membership(tenantId: string, channelId: string, actorId: string, gameId: string, joined: boolean, now: number) {
    const tenant = clean(tenantId), channel = cleanChannel(channelId), actor = clean(actorId), game = clean(gameId);
    const key = memberKey(channel, actor, game);
    await this.records.transaction(async (tx) => {
      const old = await tx.get<MemberRecord>("arcade-activity-members", tenant, key);
      await tx.put("arcade-activity-members", tenant, key, { channelId: channel, actorId: actor, gameId: game, joined, lastSeenAt: Math.max(old?.lastSeenAt ?? 0, now) });
    });
  }
  async joinedGames(tenantId: string, channelId: string, actorId: string): Promise<string[]> {
    const tenant = clean(tenantId), channel = cleanChannel(channelId), actor = clean(actorId);
    const rows = await this.records.list<MemberRecord>("arcade-activity-members", tenant);
    return rows.map((row) => row.value).filter((item) => item.channelId === channel && item.actorId === actor && item.joined).map((item) => item.gameId);
  }
  async choice(tenantId: string, channelId: string, actorId: string, now: number): Promise<NebulaCommandTargetV1[] | undefined> {
    const tenant = clean(tenantId), key = choiceKey(cleanChannel(channelId), clean(actorId));
    const value = await this.records.get<ChoiceRecord>("arcade-activity-choices", tenant, key);
    if (!value) return undefined;
    if (value.expiresAt <= now) { await this.records.delete("arcade-activity-choices", tenant, key); return undefined; }
    return value.targets;
  }
  async saveChoice(tenantId: string, channelId: string, actorId: string, targets: NebulaCommandTargetV1[], now: number) {
    await this.records.put("arcade-activity-choices", clean(tenantId), choiceKey(cleanChannel(channelId), clean(actorId)), { targets, expiresAt: now + 30_000 });
  }
  async clearChoice(tenantId: string, channelId: string, actorId: string) {
    await this.records.delete("arcade-activity-choices", clean(tenantId), choiceKey(cleanChannel(channelId), clean(actorId)));
  }
  async snapshot(tenantId: string, channelId: string, overlayGameIds: string[], runningGameIds: string[], now = Date.now()) {
    const tenant = clean(tenantId), channel = cleanChannel(channelId);
    const [config, members] = await Promise.all([
      this.records.get<ChannelRecord>("arcade-activity-channels", tenant, channel),
      this.records.list<MemberRecord>("arcade-activity-members", tenant),
    ]);
    const lastSpmtAt = config?.lastSpmtAt ?? null, visibleUntil = lastSpmtAt === null ? 0 : lastSpmtAt + NEBULA_ACTIVITY_VISIBLE_MS;
    const counts = new Map<string, number>();
    for (const { value } of members) if (value.channelId === channel && value.joined && value.lastSeenAt >= now - NEBULA_CHAT_ACTIVE_MS && value.lastSeenAt <= now) counts.set(value.gameId, (counts.get(value.gameId) ?? 0) + 1);
    const games = [...new Set([...overlayGameIds, ...runningGameIds])].flatMap((id) => {
      const game = NEBULA_ARCADE_GAMES.find((item) => item.id === id); if (!game) return [];
      const running = runningGameIds.includes(id), players = running ? counts.get(id) ?? 0 : 0;
      return [{ id, name: game.name, onOverlay: overlayGameIds.includes(id), running, players, status: players > 0 ? "active" : "inactive" }];
    });
    return { channelId: channel, lastSpmtAt, visibleUntil, visible: now < visibleUntil, remainingMs: Math.max(0, Math.min(NEBULA_ACTIVITY_VISIBLE_MS, visibleUntil - now)), activeWindowSeconds: NEBULA_CHAT_ACTIVE_MS / 1000, games };
  }
}
function clean(value: string) { const result = String(value ?? "").trim(); if (!result || result.length > 300 || /[\\r\\n\\0]/.test(result)) throw new Error("Nebula activity key is invalid"); return result; }
function cleanChannel(value: string) { const result = clean(value).toLowerCase().replace(/^#/, "").slice(0, 80); if (!result) throw new Error("Nebula channel is required"); return result; }
function memberKey(channel: string, actor: string, game: string) { return [channel, actor, game].map(encodeURIComponent).join("|"); }
function choiceKey(channel: string, actor: string) { return [channel, actor].map(encodeURIComponent).join("|"); }
function cleanGame(value: string) { const result = clean(value).toLowerCase(); if (!NEBULA_ARCADE_GAMES.some((game) => game.id === result)) throw new Error("Unknown Nebula game"); return result; }
