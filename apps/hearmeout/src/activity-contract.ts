export const HEARMEOUT_GLOBAL_WATCH_SESSION_ID = "discord-watch-room";
export const HEARMEOUT_MUSIC_WATCH_SESSION_ID = "discord-music-room";
export const HEARMEOUT_ACTIVITY_ROOM_ID = "discord-activity";
export const HEARMEOUT_ACTIVITY_ROOM_NAME = "Discord Activities";
export type HearMeOutWatchMediaKindV1 = "movie" | "music";

export function isHearMeOutActivityRoomId(roomId: string | null | undefined): boolean {
  return cleanScopePart(roomId, "", 64) === HEARMEOUT_ACTIVITY_ROOM_ID;
}

export function getHearMeOutRoomWatchSessionId(roomId: string, kind: HearMeOutWatchMediaKindV1 = "movie"): string {
  if (isHearMeOutActivityRoomId(roomId)) return kind === "music" ? HEARMEOUT_MUSIC_WATCH_SESSION_ID : HEARMEOUT_GLOBAL_WATCH_SESSION_ID;
  return `watch-room-${cleanScopePart(roomId, "room", 48)}-${kind}`;
}

export function getHearMeOutDiscordWatchSessionId(guildId?: string | null, channelId?: string | null, kind: HearMeOutWatchMediaKindV1 = "movie"): string {
  const guild = cleanDiscordScopePart(guildId, "", 48);
  const channel = cleanDiscordScopePart(channelId, "", 48);
  if (!guild || !channel) return kind === "music" ? HEARMEOUT_MUSIC_WATCH_SESSION_ID : HEARMEOUT_GLOBAL_WATCH_SESSION_ID;
  return `watch-discord-${guild}-${channel}-${kind}`;
}

export function normalizeHearMeOutWatchSessionAlias(value?: string | null, fallback = HEARMEOUT_GLOBAL_WATCH_SESSION_ID): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  const discordScopedMatch = raw.match(/^watch-discord-[a-z0-9_]+-[a-z0-9_]+-(movie|music)$/);
  if (discordScopedMatch) return discordScopedMatch[1] === "music" ? HEARMEOUT_MUSIC_WATCH_SESSION_ID : HEARMEOUT_GLOBAL_WATCH_SESSION_ID;
  if (raw === HEARMEOUT_GLOBAL_WATCH_SESSION_ID || raw === HEARMEOUT_MUSIC_WATCH_SESSION_ID || raw.startsWith("watch-")) return raw;
  if (["watch", "movie", "movies", "video", "videos", "main", "default", "global"].includes(raw)) return HEARMEOUT_GLOBAL_WATCH_SESSION_ID;
  if (["music", "song", "songs", "radio", "dj"].includes(raw)) return HEARMEOUT_MUSIC_WATCH_SESSION_ID;
  const slug = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug ? `watch-${slug}` : fallback;
}

export function isHearMeOutDiscordActivityWatchSession(sessionId: unknown): boolean {
  const normalized = normalizeHearMeOutWatchSessionAlias(String(sessionId || ""), HEARMEOUT_GLOBAL_WATCH_SESSION_ID);
  return normalized === HEARMEOUT_GLOBAL_WATCH_SESSION_ID || normalized === HEARMEOUT_MUSIC_WATCH_SESSION_ID;
}

export function hearMeOutLaneForWatchSession(sessionId: unknown): HearMeOutWatchMediaKindV1 {
  return normalizeHearMeOutWatchSessionAlias(String(sessionId || ""), HEARMEOUT_GLOBAL_WATCH_SESSION_ID) === HEARMEOUT_MUSIC_WATCH_SESSION_ID ? "music" : "movie";
}

function cleanScopePart(value: string | null | undefined, fallback: string, maxLength = 64): string {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLength) || fallback;
}
function cleanDiscordScopePart(value: string | null | undefined, fallback: string, maxLength = 64): string {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, maxLength) || fallback;
}
