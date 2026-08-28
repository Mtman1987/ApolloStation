import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export const HEARMEOUT_USER_MUSIC_CACHE_LIMIT = 25;
export const HEARMEOUT_EXTRACTED_MEDIA_TTL_MS = 5 * 60 * 60 * 1000;

export interface HearMeOutCachedMediaInfoV1 {
  url: string;
  mimeType: string;
  duration: number;
  title: string;
  artist: string;
}

export interface HearMeOutUserMusicEntryV1 {
  videoId: string;
  at: number;
}

export type HearMeOutUserMusicIndexV1 = Record<string, HearMeOutUserMusicEntryV1[]>;

export interface HearMeOutWorkerCacheOptionsV1 {
  cacheDir: string;
  indexFile?: string;
  userLimit?: number;
  nowMs?: () => number;
  removeCachedMedia?: (videoId: string) => void;
}

/**
 * Ephemeral DJ-worker cache state. This deliberately owns no canonical room,
 * queue, permission, or playback state; Apollo room-media-core remains the
 * authority and this cache can be rebuilt or discarded at any time.
 */
export class HearMeOutWorkerMediaCache {
  private readonly cacheDir: string;
  private readonly indexFile: string;
  private readonly userLimit: number;
  private readonly nowMs: () => number;
  private readonly removeCachedMedia: (videoId: string) => void;
  private readonly extracted = new Map<string, { info: HearMeOutCachedMediaInfoV1; expires: number }>();

  constructor(options: HearMeOutWorkerCacheOptionsV1) {
    this.cacheDir = resolve(requiredText(options.cacheDir, "cacheDir"));
    this.indexFile = resolve(options.indexFile ?? resolve(this.cacheDir, "user-music-cache.json"));
    this.userLimit = boundedInteger(options.userLimit ?? HEARMEOUT_USER_MUSIC_CACHE_LIMIT, 1, 500, "userLimit");
    this.nowMs = options.nowMs ?? Date.now;
    this.removeCachedMedia = options.removeCachedMedia ?? ((videoId) => {
      for (const ext of ["m4a", "mp3", "webm", "opus", "ogg"]) {
        const path = resolve(this.cacheDir, `${videoId}.${ext}`);
        if (!isContainedPath(this.cacheDir, path)) continue;
        rmSync(path, { force: true });
      }
    });
  }

  sanitizeUserId(value: string) {
    const clean = String(value ?? "").trim().replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80);
    return clean || "anonymous";
  }

  readUserIndex(): HearMeOutUserMusicIndexV1 {
    try {
      const raw = JSON.parse(readFileSync(this.indexFile, "utf8")) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
      const result: HearMeOutUserMusicIndexV1 = {};
      for (const [userId, entries] of Object.entries(raw)) {
        if (!Array.isArray(entries)) continue;
        const normalized = entries.map(normalizeUserEntry).filter((entry): entry is HearMeOutUserMusicEntryV1 => Boolean(entry)).slice(0, this.userLimit);
        if (normalized.length) result[this.sanitizeUserId(userId)] = normalized;
      }
      return result;
    } catch {
      return {};
    }
  }

  recordUserMusicPlay(userIdInput: string, videoIdInput: string) {
    const userId = this.sanitizeUserId(userIdInput);
    const videoId = validateVideoId(videoIdInput);
    const index = this.readUserIndex();
    const prior = (index[userId] ?? []).filter((entry) => entry.videoId !== videoId);
    const updated = [{ videoId, at: this.nowMs() }, ...prior];
    index[userId] = updated.slice(0, this.userLimit);
    const evicted = updated.slice(this.userLimit);

    for (const entry of evicted) {
      if (this.isVideoReferenced(index, entry.videoId)) continue;
      this.removeCachedMedia(entry.videoId);
    }
    this.writeUserIndex(index);
    return { userId, entries: structuredClone(index[userId] ?? []), evicted: evicted.map((entry) => entry.videoId) };
  }

  listRecent(userId: string) {
    return structuredClone(this.readUserIndex()[this.sanitizeUserId(userId)] ?? []);
  }

  isVideoReferenced(index: HearMeOutUserMusicIndexV1, videoIdInput: string) {
    const videoId = validateVideoId(videoIdInput);
    return Object.values(index).some((entries) => entries.some((entry) => entry.videoId === videoId));
  }

  setExtractedInfo(videoIdInput: string, modeInput: "audio" | "video", infoInput: HearMeOutCachedMediaInfoV1) {
    const videoId = validateVideoId(videoIdInput);
    const mode = validateMode(modeInput);
    const info = normalizeMediaInfo(infoInput);
    this.extracted.set(`${mode}:${videoId}`, { info, expires: this.nowMs() + HEARMEOUT_EXTRACTED_MEDIA_TTL_MS });
    return structuredClone(info);
  }

  getExtractedInfo(videoIdInput: string, modeInput: "audio" | "video") {
    const key = `${validateMode(modeInput)}:${validateVideoId(videoIdInput)}`;
    const cached = this.extracted.get(key);
    if (!cached) return undefined;
    if (cached.expires <= this.nowMs()) {
      this.extracted.delete(key);
      return undefined;
    }
    return structuredClone(cached.info);
  }

  clearExtractedInfo(videoIdInput: string, modeInput?: "audio" | "video") {
    const videoId = validateVideoId(videoIdInput);
    if (modeInput) return this.extracted.delete(`${validateMode(modeInput)}:${videoId}`);
    const audio = this.extracted.delete(`audio:${videoId}`);
    const video = this.extracted.delete(`video:${videoId}`);
    return audio || video;
  }

  resolveOfflinePath(relativePathInput: string) {
    const relativePath = String(relativePathInput ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relativePath || relativePath.includes("\0")) throw new Error("offline media path is invalid");
    const fullPath = resolve(this.cacheDir, relativePath);
    if (!isContainedPath(this.cacheDir, fullPath) || fullPath === this.cacheDir) throw new Error("offline media path escapes the worker cache");
    return { fullPath, relativePath };
  }

  describeOfflineFile(relativePath: string) {
    const resolved = this.resolveOfflinePath(relativePath);
    const stats = statSync(resolved.fullPath);
    if (!stats.isFile()) throw new Error("offline media path is not a file");
    return { ...resolved, size: stats.size };
  }

  private writeUserIndex(index: HearMeOutUserMusicIndexV1) {
    mkdirSync(dirname(this.indexFile), { recursive: true });
    const tmp = `${this.indexFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(index), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.indexFile);
  }
}

export function validateHearMeOutVideoId(value: string) { return validateVideoId(value); }
export function isHearMeOutContainedWorkerPath(root: string, candidate: string) { return isContainedPath(resolve(root), resolve(candidate)); }

function isContainedPath(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}
function validateVideoId(value: string) {
  const clean = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(clean)) throw new Error("Invalid YouTube video id");
  return clean;
}
function validateMode(value: "audio" | "video") {
  if (value !== "audio" && value !== "video") throw new Error("media mode must be audio or video");
  return value;
}
function normalizeMediaInfo(input: HearMeOutCachedMediaInfoV1): HearMeOutCachedMediaInfoV1 {
  const url = requiredText(input.url, "url");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("media URL must be HTTP(S)");
  const mimeType = requiredText(input.mimeType, "mimeType").slice(0, 120);
  const duration = Number(input.duration);
  if (!Number.isFinite(duration) || duration < 0 || duration > 24 * 60 * 60) throw new Error("media duration is invalid");
  return { url: parsed.toString(), mimeType, duration, title: requiredText(input.title, "title").slice(0, 300), artist: requiredText(input.artist, "artist").slice(0, 300) };
}
function normalizeUserEntry(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  try {
    const videoId = validateVideoId(String(entry.videoId ?? ""));
    const at = Math.trunc(Number(entry.at));
    if (!Number.isSafeInteger(at) || at < 0) return undefined;
    return { videoId, at };
  } catch { return undefined; }
}
function requiredText(value: string, name: string) {
  const clean = String(value ?? "").trim();
  if (!clean || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`);
  return clean;
}
function boundedInteger(value: number, min: number, max: number, name: string) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be from ${min} through ${max}`);
  return parsed;
}
