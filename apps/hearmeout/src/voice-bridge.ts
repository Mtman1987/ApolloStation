import { DatabaseSync } from "node:sqlite";
import type { HearMeOutPrincipalV1, SqliteHearMeOutRoomMediaRuntime } from "./room-media-core.js";

export type HearMeOutVoiceAudioProfileV1 = "low-latency" | "balanced" | "resilient";

export interface HearMeOutVoiceBridgeConfigV1 {
  schemaVersion: 1;
  tenantId: string;
  roomId: string;
  enabled: boolean;
  guildId: string;
  voiceChannelId: string;
  roomVoiceOutboundEnabled: boolean;
  audioProfile: HearMeOutVoiceAudioProfileV1;
  updatedBy?: string;
  updatedAt?: string;
}

export interface HearMeOutVoiceBridgeWorkerV1 {
  status(input: { tenantId: string; roomId: string }): Promise<Record<string, unknown>>;
  start(input: { tenantId: string; roomId: string; guildId: string; voiceChannelId: string; audioProfile: HearMeOutVoiceAudioProfileV1 }): Promise<Record<string, unknown>>;
  stop(input: { tenantId: string; roomId: string }): Promise<Record<string, unknown>>;
  setRoomOutbound(input: { tenantId: string; roomId: string; roomVoiceOutboundEnabled: boolean }): Promise<Record<string, unknown>>;
  setAudioProfile(input: { tenantId: string; roomId: string; audioProfile: HearMeOutVoiceAudioProfileV1 }): Promise<Record<string, unknown>>;
}

export interface HearMeOutVoiceBridgeReconcileResultV1 {
  tenantId: string;
  roomId: string;
  outcome: "resumed" | "already-running" | "disabled-stale" | "conflict" | "retryable-error";
  message?: string;
}

export class SqliteHearMeOutVoiceBridgeStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("HearMeOut voice bridge database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS hmo_voice_bridge(
      tenant_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY(tenant_id,room_id)
    ) STRICT;`);
  }
  close() { this.db.close(); }
  get(tenantId: string, roomId: string): HearMeOutVoiceBridgeConfigV1 {
    const row = this.db.prepare("SELECT body FROM hmo_voice_bridge WHERE tenant_id=? AND room_id=?").get(cleanId(tenantId, "tenantId"), cleanId(roomId, "roomId")) as { body?: string } | undefined;
    if (!row?.body) return defaultVoiceBridgeConfig(tenantId, roomId);
    return normalizeConfig(JSON.parse(row.body) as Partial<HearMeOutVoiceBridgeConfigV1>, tenantId, roomId);
  }
  put(config: HearMeOutVoiceBridgeConfigV1) {
    const value = normalizeConfig(config, config.tenantId, config.roomId);
    this.db.prepare("INSERT INTO hmo_voice_bridge(tenant_id,room_id,body) VALUES(?,?,?) ON CONFLICT(tenant_id,room_id) DO UPDATE SET body=excluded.body").run(value.tenantId, value.roomId, JSON.stringify(value));
    return value;
  }
  listEnabled(limit = 500): HearMeOutVoiceBridgeConfigV1[] {
    const bounded = Math.max(1, Math.min(2_000, Math.trunc(limit)));
    const rows = this.db.prepare("SELECT tenant_id,room_id,body FROM hmo_voice_bridge ORDER BY tenant_id,room_id LIMIT ?").all(bounded) as { tenant_id: string; room_id: string; body: string }[];
    return rows.map((row) => normalizeConfig(JSON.parse(row.body) as Partial<HearMeOutVoiceBridgeConfigV1>, row.tenant_id, row.room_id)).filter((value) => value.enabled);
  }
}

export class HearMeOutVoiceBridgeController {
  constructor(private readonly rooms: SqliteHearMeOutRoomMediaRuntime, private readonly store: SqliteHearMeOutVoiceBridgeStore, private readonly worker: HearMeOutVoiceBridgeWorkerV1, private readonly now: () => string = () => new Date().toISOString()) {}

  async status(principal: HearMeOutPrincipalV1, roomId: string) {
    const room = this.requireManager(principal, roomId);
    const config = this.store.get(principal.tenantId, room.roomId);
    const worker = await this.worker.status({ tenantId: principal.tenantId, roomId: room.roomId });
    return { config, worker };
  }

  async start(principal: HearMeOutPrincipalV1, input: { roomId: string; guildId: string; voiceChannelId: string }) {
    const room = this.requireManager(principal, input.roomId);
    const current = this.store.get(principal.tenantId, room.roomId);
    const next: HearMeOutVoiceBridgeConfigV1 = {
      ...current,
      enabled: true,
      guildId: snowflake(input.guildId, "guildId"),
      voiceChannelId: snowflake(input.voiceChannelId, "voiceChannelId"),
      updatedBy: principal.userId,
      updatedAt: this.now(),
    };
    this.assertNoChannelCollision(next);
    this.store.put(next);
    try {
      const worker = await this.worker.start({ tenantId: principal.tenantId, roomId: room.roomId, guildId: next.guildId, voiceChannelId: next.voiceChannelId, audioProfile: next.audioProfile });
      try {
        const gate = await this.worker.setRoomOutbound({ tenantId: principal.tenantId, roomId: room.roomId, roomVoiceOutboundEnabled: next.roomVoiceOutboundEnabled });
        return { success: true as const, config: next, worker, gate };
      } catch (error) {
        await this.worker.stop({ tenantId: principal.tenantId, roomId: room.roomId }).catch(() => undefined);
        this.store.put({ ...next, enabled: false, updatedAt: this.now() });
        throw error;
      }
    } catch (error) {
      this.store.put({ ...next, enabled: false, updatedAt: this.now() });
      throw error;
    }
  }

  async stop(principal: HearMeOutPrincipalV1, roomId: string) {
    const room = this.requireManager(principal, roomId);
    const current = this.store.get(principal.tenantId, room.roomId);
    const worker = await this.worker.stop({ tenantId: principal.tenantId, roomId: room.roomId });
    const config = this.store.put({ ...current, enabled: false, updatedBy: principal.userId, updatedAt: this.now() });
    return { success: true as const, config, worker };
  }

  async setRoomOutbound(principal: HearMeOutPrincipalV1, roomId: string, roomVoiceOutboundEnabled: boolean) {
    const room = this.requireManager(principal, roomId);
    if (typeof roomVoiceOutboundEnabled !== "boolean") throw new Error("roomVoiceOutboundEnabled must be boolean");
    const current = this.store.get(principal.tenantId, room.roomId);
    const config = this.store.put({ ...current, roomVoiceOutboundEnabled, updatedBy: principal.userId, updatedAt: this.now() });
    if (!current.enabled) return { success: true as const, config, worker: { running: false, mode: roomVoiceOutboundEnabled ? "two-way" : "listen-only" } };
    const worker = await this.worker.setRoomOutbound({ tenantId: principal.tenantId, roomId: room.roomId, roomVoiceOutboundEnabled });
    return { success: true as const, config, worker };
  }

  async setAudioProfile(principal: HearMeOutPrincipalV1, roomId: string, audioProfile: HearMeOutVoiceAudioProfileV1) {
    const room = this.requireManager(principal, roomId);
    if (!isAudioProfile(audioProfile)) throw new Error("Invalid audio profile");
    const current = this.store.get(principal.tenantId, room.roomId);
    const config = this.store.put({ ...current, audioProfile, updatedBy: principal.userId, updatedAt: this.now() });
    const worker = current.enabled ? await this.worker.setAudioProfile({ tenantId: principal.tenantId, roomId: room.roomId, audioProfile }) : { running: false, audioProfile };
    return { success: true as const, config, worker };
  }

  /** Reconcile persisted desired bridge state after a process/worker restart. */
  async reconcileEnabled(): Promise<HearMeOutVoiceBridgeReconcileResultV1[]> {
    const results: HearMeOutVoiceBridgeReconcileResultV1[] = [];
    const claimed = new Map<string, string>();
    for (const config of this.store.listEnabled()) {
      const identity = `${config.tenantId}:${config.roomId}`;
      const room = this.rooms.getRoom(config.tenantId, config.roomId, this.now());
      if (!room) {
        this.store.put({ ...config, enabled: false, updatedAt: this.now() });
        await this.worker.stop({ tenantId: config.tenantId, roomId: config.roomId }).catch(() => undefined);
        results.push({ tenantId: config.tenantId, roomId: config.roomId, outcome: "disabled-stale" });
        continue;
      }
      const channelKey = `${config.guildId}:${config.voiceChannelId}`;
      const prior = claimed.get(channelKey);
      if (prior && prior !== identity) {
        results.push({ tenantId: config.tenantId, roomId: config.roomId, outcome: "conflict", message: `Discord voice channel already claimed by ${prior}` });
        continue;
      }
      claimed.set(channelKey, identity);
      try {
        const status = await this.worker.status({ tenantId: config.tenantId, roomId: config.roomId });
        if (workerMatches(status, config)) {
          await this.worker.setAudioProfile({ tenantId: config.tenantId, roomId: config.roomId, audioProfile: config.audioProfile });
          await this.worker.setRoomOutbound({ tenantId: config.tenantId, roomId: config.roomId, roomVoiceOutboundEnabled: config.roomVoiceOutboundEnabled });
          results.push({ tenantId: config.tenantId, roomId: config.roomId, outcome: "already-running" });
          continue;
        }
        await this.worker.start({ tenantId: config.tenantId, roomId: config.roomId, guildId: config.guildId, voiceChannelId: config.voiceChannelId, audioProfile: config.audioProfile });
        await this.worker.setRoomOutbound({ tenantId: config.tenantId, roomId: config.roomId, roomVoiceOutboundEnabled: config.roomVoiceOutboundEnabled });
        results.push({ tenantId: config.tenantId, roomId: config.roomId, outcome: "resumed" });
      } catch (error) {
        results.push({ tenantId: config.tenantId, roomId: config.roomId, outcome: "retryable-error", message: safeError(error) });
      }
    }
    return results;
  }

  private assertNoChannelCollision(candidate: HearMeOutVoiceBridgeConfigV1) {
    const collision = this.store.listEnabled().find((value) => value.enabled && (value.tenantId !== candidate.tenantId || value.roomId !== candidate.roomId) && value.guildId === candidate.guildId && value.voiceChannelId === candidate.voiceChannelId);
    if (collision) throw new Error(`Discord voice channel is already bridged by ${collision.tenantId}:${collision.roomId}`);
  }

  private requireManager(principal: HearMeOutPrincipalV1, roomId: string) {
    if (!principal?.tenantId || !principal?.userId) throw new Error("HearMeOut principal is required");
    const room = this.rooms.getRoom(principal.tenantId, cleanId(roomId, "roomId"), this.now());
    if (!room) throw new Error("HearMeOut room not found");
    if (room.ownerUserId !== principal.userId && !principal.roles.includes("admin")) throw new Error("Only the room owner or an admin can manage the Discord voice bridge");
    return room;
  }
}

function workerMatches(status: Record<string, unknown>, config: HearMeOutVoiceBridgeConfigV1) {
  if (status.running !== true) return false;
  const guildId = typeof status.guildId === "string" ? status.guildId : undefined;
  const voiceChannelId = typeof status.voiceChannelId === "string" ? status.voiceChannelId : undefined;
  if (guildId && guildId !== config.guildId) return false;
  if (voiceChannelId && voiceChannelId !== config.voiceChannelId) return false;
  return true;
}
function safeError(error: unknown) { const text = error instanceof Error ? error.message : String(error ?? "voice bridge reconciliation failed"); return text.replace(/(?:token|authorization|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 300); }
function defaultVoiceBridgeConfig(tenantId: string, roomId: string): HearMeOutVoiceBridgeConfigV1 { return { schemaVersion: 1, tenantId: cleanId(tenantId, "tenantId"), roomId: cleanId(roomId, "roomId"), enabled: false, guildId: "", voiceChannelId: "", roomVoiceOutboundEnabled: true, audioProfile: "balanced" }; }
function normalizeConfig(input: Partial<HearMeOutVoiceBridgeConfigV1>, tenantId: string, roomId: string): HearMeOutVoiceBridgeConfigV1 {
  const profile = isAudioProfile(input.audioProfile) ? input.audioProfile : "balanced";
  return { schemaVersion: 1, tenantId: cleanId(tenantId, "tenantId"), roomId: cleanId(roomId, "roomId"), enabled: Boolean(input.enabled), guildId: input.guildId ? snowflake(input.guildId, "guildId") : "", voiceChannelId: input.voiceChannelId ? snowflake(input.voiceChannelId, "voiceChannelId") : "", roomVoiceOutboundEnabled: typeof input.roomVoiceOutboundEnabled === "boolean" ? input.roomVoiceOutboundEnabled : true, audioProfile: profile, ...(input.updatedBy ? { updatedBy: cleanId(input.updatedBy, "updatedBy") } : {}), ...(input.updatedAt ? { updatedAt: validTimestamp(input.updatedAt, "updatedAt") } : {}) };
}
function isAudioProfile(value: unknown): value is HearMeOutVoiceAudioProfileV1 { return value === "low-latency" || value === "balanced" || value === "resilient"; }
function snowflake(value: string, name: string) { const clean = String(value ?? "").trim(); if (!/^\d{5,30}$/.test(clean)) throw new Error(`${name} must be a Discord snowflake`); return clean; }
function cleanId(value: string, name: string) { const clean = String(value ?? "").trim(); if (!clean || clean.length > 160 || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`); return clean; }
function validTimestamp(value: string, name: string) { if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp`); return new Date(Date.parse(value)).toISOString(); }
