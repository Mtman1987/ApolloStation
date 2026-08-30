import { DatabaseSync } from "node:sqlite";
import { buildNebulaTagOverlaySnapshot } from "./nebula-tag-overlay.js";
import { NEBULA_GAMEPLAY_ROTATION_SECONDS } from "./gameplay-showcase.js";
import type { NebulaTagStateV1 } from "./nebula-tag.js";

export const NEBULA_DISCORD_WEBHOOK_NAME = "Nebula Arcade";
export const NEBULA_DISCORD_SHOWCASE_FRAME_COUNT = 20;
export const NEBULA_DISCORD_SHOWCASE_FRAME_DURATION_MS = 2_900;

export interface NebulaDiscordEmbedFieldV1 { name: string; value: string; inline: true; }
export interface NebulaDiscordDashboardPayloadV1 {
  embeds: Array<{
    title: string;
    url?: string;
    description: string;
    color: number;
    fields: NebulaDiscordEmbedFieldV1[];
    author: { name: string; icon_url?: string };
    image?: { url: string };
    thumbnail?: { url: string };
    footer: { text: string };
    timestamp: string;
  }>;
  components: Array<{ type: 1; components: Array<{ type: 2; style: 5; label: string; emoji: { name: string }; url: string }> }>;
  allowed_mentions: { parse: [] };
}

export interface NebulaDiscordDashboardPublishV1 {
  schemaVersion: 1;
  tenantId: string;
  connectionId: string;
  channelId: string;
  webhookName: string;
  avatarUrl?: string;
  previousMessageId?: string;
  previousTransport?: "webhook" | "bot";
  payload: NebulaDiscordDashboardPayloadV1;
}

export interface NebulaDiscordDashboardResultV1 { providerMessageId: string; transport: "webhook" | "bot"; }
export interface NebulaDiscordDashboardEgressV1 { upsertDiscordDashboard(message: NebulaDiscordDashboardPublishV1): Promise<NebulaDiscordDashboardResultV1>; }

export interface NebulaDiscordDashboardRecordV1 {
  tenantId: string;
  connectionId: string;
  channelId: string;
  messageId: string;
  transport: "webhook" | "bot";
  updatedAt: string;
}

export class SqliteNebulaDiscordDashboardStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("Nebula Discord dashboard database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS nebula_discord_dashboards(tenant_id TEXT NOT NULL,connection_id TEXT NOT NULL,channel_id TEXT NOT NULL,message_id TEXT NOT NULL,transport TEXT NOT NULL CHECK(transport IN ('webhook','bot')),updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,connection_id,channel_id)) STRICT;");
  }
  close() { this.db.close(); }
  get(tenantId: string, connectionId: string, channelId: string): NebulaDiscordDashboardRecordV1 | undefined {
    const row = this.db.prepare("SELECT tenant_id AS tenantId,connection_id AS connectionId,channel_id AS channelId,message_id AS messageId,transport,updated_at AS updatedAt FROM nebula_discord_dashboards WHERE tenant_id=? AND connection_id=? AND channel_id=?").get(cleanId(tenantId, "tenantId"), cleanId(connectionId, "connectionId"), snowflake(channelId, "channelId")) as NebulaDiscordDashboardRecordV1 | undefined;
    return row ? structuredClone(row) : undefined;
  }
  put(value: NebulaDiscordDashboardRecordV1): NebulaDiscordDashboardRecordV1 {
    const checked = {
      tenantId: cleanId(value.tenantId, "tenantId"), connectionId: cleanId(value.connectionId, "connectionId"), channelId: snowflake(value.channelId, "channelId"),
      messageId: snowflake(value.messageId, "messageId"), transport: value.transport, updatedAt: iso(value.updatedAt),
    };
    if (checked.transport !== "webhook" && checked.transport !== "bot") throw new Error("Nebula Discord dashboard transport is invalid");
    this.db.prepare("INSERT INTO nebula_discord_dashboards(tenant_id,connection_id,channel_id,message_id,transport,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,connection_id,channel_id) DO UPDATE SET message_id=excluded.message_id,transport=excluded.transport,updated_at=excluded.updated_at").run(checked.tenantId, checked.connectionId, checked.channelId, checked.messageId, checked.transport, checked.updatedAt);
    return checked;
  }
}

export function buildNebulaDiscordDashboard(
  state: NebulaTagStateV1,
  options: { publicOrigin?: string; gameplayOrigin?: string; generatedAt?: string; webhookName?: string; avatarUrl?: string } = {},
): { webhookName: string; avatarUrl?: string; payload: NebulaDiscordDashboardPayloadV1 } {
  const snapshot = buildNebulaTagOverlaySnapshot(state, options.generatedAt ? { generatedAt: options.generatedAt } : {});
  const generatedAt = snapshot.generatedAt;
  const origin = optionalOrigin(options.publicOrigin);
  const gamesUrl = origin ? new URL("/apps/nebula-arcade?view=games", origin).toString() : undefined;
  const iconUrl = absoluteImage(options.avatarUrl, origin, "/assets/nebula-arcade/icon.png");
  const gameplayOrigin = optionalOrigin(options.gameplayOrigin, "Nebula gameplay");
  const showcaseUrl = gameplayOrigin
    ? nebulaGameplayDashboardImageUrl(gameplayOrigin, Date.parse(generatedAt))
    : origin ? `${new URL("/assets/nebula-arcade/games-showcase.gif", origin).toString()}?v=3` : undefined;
  const taggedAtUnix = snapshot.lastTagAt ? Math.floor(Date.parse(snapshot.lastTagAt) / 1_000) : 0;
  const currentTag = snapshot.currentIt
    ? [`**${snapshot.currentIt.username} is IT**`, taggedAtUnix ? `<t:${taggedAtUnix}:R>` : "Tag time unavailable", `${snapshot.playerCount} players`].join("\n")
    : ["**FREE FOR ALL**", taggedAtUnix ? `Last tag <t:${taggedAtUnix}:R>` : "No tags yet", `${snapshot.playerCount} players`].join("\n");
  const recentTags = snapshot.recentHistory.slice(0, 3).map((entry) => `${entry.doublePoints ? "🔥" : "🎯"} ${entry.actorUsername} → ${entry.targetUsername ?? "someone"}${entry.doublePoints ? " · 2x" : ""}`).join("\n") || "No recent tags";
  const medals = ["🥇", "🥈", "🥉"];
  const top3 = snapshot.leaderboard.filter((player) => player.username.toLowerCase() !== "mtman1987").slice(0, 3).map((player, index) => `${medals[index]} **${player.username}** · ${player.score} pts`).join("\n") || "No players yet";
  const recent = snapshot.recentHistory.slice(0, 3);
  const announcements: NebulaDiscordEmbedFieldV1[] = Array.from({ length: 3 }, (_, index) => {
    const entry = recent[index];
    if (!entry) return { name: index === 0 ? "📣 Latest" : "📢 Previous", value: "No announcement yet.", inline: true };
    return {
      name: (index === 0 ? "📣 Latest · Tag Update" : "📢 Previous Tag Update").slice(0, 80),
      value: [`**${entry.actorUsername}** tagged **${entry.targetUsername ?? "someone"}**${entry.doublePoints ? " for **DOUBLE POINTS**" : ""}.`, entry.targetUsername ? `**Now IT:** ${entry.targetUsername}` : "", `🕒 <t:${Math.floor(Date.parse(entry.occurredAt) / 1_000)}:R>`].filter(Boolean).join("\n").slice(0, 240),
      inline: true,
    };
  });
  const currentAvatarUrl = snapshot.currentIt ? safeHttpsImage(state.players[snapshot.currentIt.userId]?.avatarUrl) : undefined;
  const payload: NebulaDiscordDashboardPayloadV1 = {
    embeds: [{
      title: "🎮 Nebula Arcade · Tag Live", ...(gamesUrl ? { url: gamesUrl } : {}), description: "One bot · 20 equal games · live community status", color: snapshot.freeForAll ? 0xff4500 : 0x00d9ff,
      fields: [{ name: "🎯 Current Tag", value: currentTag, inline: true }, { name: "📜 Recent Tags", value: recentTags, inline: true }, { name: "🏆 Top 3", value: top3, inline: true }, ...announcements],
      author: { name: "Nebula Arcade · 20 Games", ...(iconUrl ? { icon_url: iconUrl } : {}) }, ...(showcaseUrl ? { image: { url: showcaseUrl } } : {}), ...(currentAvatarUrl ? { thumbnail: { url: currentAvatarUrl } } : {}), footer: { text: "Nebula Arcade · type spmt controls to play Tag" }, timestamp: generatedAt,
    }],
    components: gamesUrl ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open all 20 games", emoji: { name: "🎮" }, url: gamesUrl }] }] : [],
    allowed_mentions: { parse: [] },
  };
  return { webhookName: cleanName(options.webhookName ?? NEBULA_DISCORD_WEBHOOK_NAME), ...(iconUrl ? { avatarUrl: iconUrl } : {}), payload };
}

export function nebulaDiscordDashboardSignature(state: NebulaTagStateV1, generatedAtMs = Date.now()): string {
  return JSON.stringify({ gameplaySlot: Math.floor(generatedAtMs / (NEBULA_GAMEPLAY_ROTATION_SECONDS * 1_000)), currentItUserId: state.currentItUserId, lastTagAt: state.lastTagAt, players: Object.values(state.players).map((player) => [player.userId, player.username, player.avatarUrl, player.score, player.tagsMade, player.timesTagged]), history: state.history.slice(-3).map((entry) => [entry.id, entry.occurredAt, entry.actorUserId, entry.targetUserId, entry.doublePoints]) });
}

export function nebulaGameplayDashboardImageUrl(originValue: string | URL, generatedAtMs = Date.now()): string {
  const origin = typeof originValue === "string" ? optionalOrigin(originValue, "Nebula gameplay")! : originValue;
  const url = new URL("/v1/discord-stream-hub/nebula-gameplay/current.gif", origin);
  url.searchParams.set("slot", String(Math.floor(generatedAtMs / (NEBULA_GAMEPLAY_ROTATION_SECONDS * 1_000))));
  return url.toString();
}

function optionalOrigin(value?: string, name = "Nebula Arcade public") { if (!value) return undefined; const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} origin must be a credential-free HTTPS origin`); return url; }
function safeHttpsImage(value?: string) { if (!value) return undefined; const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined; }
function absoluteImage(value: string | undefined, origin: URL | undefined, fallback: string) { const raw = String(value ?? "").trim(); if (raw) { const url = new URL(raw); if (url.protocol !== "https:" || url.username || url.password) throw new Error("Nebula Arcade avatar URL must use credential-free HTTPS"); return url.toString(); } return origin ? new URL(fallback, origin).toString() : undefined; }
function cleanName(value: string) { const result = String(value ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 80); if (!result) throw new Error("Nebula Discord webhook name is invalid"); return result; }
function cleanId(value: string, name: string) { const result = String(value ?? "").trim(); if (!result || result.length > 300 || /[\r\n\0]/.test(result)) throw new Error(`${name} is invalid`); return result; }
function snowflake(value: string, name: string) { const result = String(value ?? "").trim(); if (!/^\d{5,30}$/.test(result)) throw new Error(`${name} must be a Discord snowflake`); return result; }
function iso(value: string) { if (!Number.isFinite(Date.parse(value))) throw new Error("Nebula Discord dashboard timestamp is invalid"); return new Date(value).toISOString(); }
