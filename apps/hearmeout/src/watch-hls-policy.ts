import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";

export const HEARMEOUT_WATCH_HLS_SEGMENT_SECONDS = 6;
export const HEARMEOUT_WATCH_HLS_LIST_SIZE = 90;
export const HEARMEOUT_WATCH_HLS_DELETE_THRESHOLD = 12;
export const HEARMEOUT_WATCH_HLS_BUDGET_BYTES = 1_536 * 1024 * 1024;
export const HEARMEOUT_WATCH_HLS_FAILURE_TTL_MS = 2 * 60 * 1000;
export const HEARMEOUT_WATCH_HLS_INDEX_WAIT_MS = 45_000;
export const HEARMEOUT_WATCH_HLS_FILE_WAIT_MS = 10_000;
export const HEARMEOUT_WATCH_PROXY_MAX_WAIT_MS = 55_000;
export const HEARMEOUT_WATCH_PROXY_POLL_MS = 2_500;

export interface HearMeOutWatchAudioTrackV1 {
  sourceIndex: number;
  sourceSpecifier?: string;
  language?: string;
  title?: string;
  index: number;
}

export interface HearMeOutWatchMediaProbeV1 {
  hasVideo: boolean;
  audio: HearMeOutWatchAudioTrackV1[];
}

export interface HearMeOutWatchHlsEntryV1 {
  streamId: string;
  bytes: number;
  files: number;
  ready: boolean;
  active: boolean;
  updatedAt: string | null;
}

export interface HearMeOutWatchHlsSnapshotV1 {
  root: "worker-managed";
  bytes: number;
  budgetBytes: number;
  segmentSeconds: number;
  playlistWindow: string;
  entries: HearMeOutWatchHlsEntryV1[];
}

export interface HearMeOutWatchHlsPruneResultV1 {
  bytes: number;
  removed: Array<{ streamId: string; bytes: number }>;
}

export interface HearMeOutWatchHlsFfmpegOptionsV1 {
  segmentSeconds?: number;
  listSize?: number;
  deleteThreshold?: number;
}

export function cleanHearMeOutWatchStreamId(value: unknown): string {
  const raw = String(value ?? "").trim();
  const youtube = raw.match(/^yt-([A-Za-z0-9_-]{11})$/) ?? raw.match(/^youtube-([A-Za-z0-9_-]{11})$/);
  if (youtube) return `yt-${youtube[1]}`;
  const typed = raw.toLowerCase().match(/^(vod|series|live)-(\d+)$/) ?? raw.toLowerCase().match(/^(episode)-(\d+)-([a-z0-9]+)$/);
  if (typed) return `${typed[1]}-${typed[2]}${typed[3] ? `-${typed[3]}` : ""}-multiaudio-v2`;
  const numeric = raw.replace(/[^0-9]/g, "");
  if (!numeric) throw new Error("Invalid stream id");
  return `vod-${numeric}-multiaudio-v2`;
}

export function hearMeOutYoutubeWatchHlsId(videoId: unknown): string {
  const clean = String(videoId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(clean)) throw new Error("Invalid YouTube video id");
  return `yt-${clean}`;
}

export function cleanHearMeOutHlsFileName(value: unknown): string {
  const clean = String(value ?? "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!clean || clean.includes("..")) throw new Error("Invalid HLS file");
  return clean;
}

export function cleanHearMeOutFlyMachineId(value: unknown): string | null {
  const clean = String(value ?? "").replace(/[^a-zA-Z0-9]/g, "");
  return clean || null;
}

export function isAllowedHearMeOutYoutubeMediaUrl(value: unknown): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return ["googlevideo.com", "youtube.com", "ytimg.com"].some((base) => host === base || host.endsWith(`.${base}`));
  } catch {
    return false;
  }
}

export function firstHearMeOutHlsMediaReference(manifest: string): string | null {
  return String(manifest ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) ?? null;
}

export function isLegacyHearMeOutEventPlaylist(manifest: string): boolean {
  return String(manifest ?? "").includes("#EXT-X-PLAYLIST-TYPE:EVENT");
}

export function pinHearMeOutHlsManifestToMachine(manifest: string, machineId: unknown): string {
  const machine = cleanHearMeOutFlyMachineId(machineId);
  if (!machine) return String(manifest ?? "");
  const machineParam = `machine=${encodeURIComponent(machine)}`;
  return String(manifest ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (/^#EXT-X-MEDIA:/i.test(trimmed) && /URI="[^"]+"/i.test(line)) {
        return line.replace(/URI="([^"]+)"/i, (_match, uri: string) => {
          if (/[?&]machine=/.test(uri)) return `URI="${uri}"`;
          return `URI="${uri}${uri.includes("?") ? "&" : "?"}${machineParam}"`;
        });
      }
      if (!trimmed || trimmed.startsWith("#") || /[?&]machine=/.test(trimmed)) return line;
      return `${line}${line.includes("?") ? "&" : "?"}${machineParam}`;
    })
    .join("\n");
}

export function hearMeOutHlsContentType(fileName: unknown): string {
  const file = cleanHearMeOutHlsFileName(fileName);
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

export function hearMeOutHlsCacheControl(fileName: unknown): string {
  return cleanHearMeOutHlsFileName(fileName).endsWith(".m3u8") ? "no-store" : "public, max-age=3600";
}

export function isHearMeOutEnglishAudioTrack(track: Pick<HearMeOutWatchAudioTrackV1, "language" | "title">): boolean {
  return /^(?:en|eng|english)$/i.test(String(track.language ?? "")) || /\benglish\b/i.test(String(track.title ?? ""));
}

export function hearMeOutAudioTrackName(track: HearMeOutWatchAudioTrackV1): string {
  const language = String(track.language ?? "").toLowerCase();
  const title = String(track.title ?? "").trim();
  const fallback = language || `track-${track.index + 1}`;
  return (title || fallback).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || `track-${track.index + 1}`;
}

export function hearMeOutDefaultAudioTrackIndex(tracks: readonly HearMeOutWatchAudioTrackV1[]): number {
  return Math.max(0, tracks.findIndex(isHearMeOutEnglishAudioTrack));
}

export function buildHearMeOutXtreamVariantMap(media: HearMeOutWatchMediaProbeV1): string {
  const tracks = media.audio ?? [];
  const defaultIndex = hearMeOutDefaultAudioTrackIndex(tracks);
  return [
    ...(media.hasVideo ? [tracks.length ? "v:0,agroup:audio,name:video" : "v:0,name:video"] : []),
    ...tracks.map((track, index) => [
      `a:${index}`,
      "agroup:audio",
      `name:${hearMeOutAudioTrackName(track)}`,
      track.language ? `language:${String(track.language).replace(/[^a-z0-9-]/gi, "").toLowerCase()}` : "",
      index === defaultIndex ? "default:yes" : "",
    ].filter(Boolean).join(",")),
  ].join(" ");
}

export function buildHearMeOutXtreamHlsFfmpegArgs(
  sourceUrl: string,
  media: HearMeOutWatchMediaProbeV1,
  outputDir: string,
  options: HearMeOutWatchHlsFfmpegOptionsV1 = {},
): string[] {
  const segmentSeconds = boundedPositive(options.segmentSeconds ?? HEARMEOUT_WATCH_HLS_SEGMENT_SECONDS, "segmentSeconds");
  const listSize = boundedNonNegative(options.listSize ?? HEARMEOUT_WATCH_HLS_LIST_SIZE, "listSize");
  const deleteThreshold = boundedPositive(options.deleteThreshold ?? HEARMEOUT_WATCH_HLS_DELETE_THRESHOLD, "deleteThreshold");
  const tracks = media.audio ?? [];
  const mapArgs = [
    ...(media.hasVideo ? ["-map", "0:v:0?"] : []),
    ...tracks.flatMap((track) => ["-map", `0:${track.sourceSpecifier || track.sourceIndex}?`]),
  ];
  const streamMap = buildHearMeOutXtreamVariantMap(media);
  return [
    "-hide_banner", "-loglevel", "warning", "-threads", "2", "-y",
    "-user_agent", "DiscordStreamHub/1.0",
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_at_eof", "1", "-reconnect_delay_max", "5",
    "-i", sourceUrl,
    ...mapArgs,
    "-c:v", "copy", "-c:a", "aac", "-ac", "2",
    "-f", "hls", "-hls_time", String(segmentSeconds), "-hls_list_size", String(listSize),
    ...(listSize > 0 ? ["-hls_delete_threshold", String(deleteThreshold)] : []),
    "-hls_flags", listSize > 0 ? "delete_segments+independent_segments" : "independent_segments",
    ...(streamMap ? ["-var_stream_map", streamMap, "-master_pl_name", "index.m3u8"] : []),
    "-hls_segment_filename", join(outputDir, "stream_%v_seg_%05d.ts"),
    streamMap ? join(outputDir, "stream_%v.m3u8") : join(outputDir, "index.m3u8"),
  ];
}

export function planHearMeOutWatchHlsPrune(
  entries: readonly { streamId: string; bytes: number; mtimeMs: number; active?: boolean }[],
  targetBytes = HEARMEOUT_WATCH_HLS_BUDGET_BYTES,
): HearMeOutWatchHlsPruneResultV1 {
  if (!Number.isFinite(targetBytes) || targetBytes < 0) return { bytes: 0, removed: [] };
  const inactive = entries.filter((entry) => !entry.active).map((entry) => ({ ...entry, bytes: Math.max(0, Number(entry.bytes) || 0), mtimeMs: Number(entry.mtimeMs) || 0 }));
  const activeBytes = entries.filter((entry) => entry.active).reduce((sum, entry) => sum + Math.max(0, Number(entry.bytes) || 0), 0);
  let total = activeBytes + inactive.reduce((sum, entry) => sum + entry.bytes, 0);
  const removed: Array<{ streamId: string; bytes: number }> = [];
  for (const entry of inactive.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (total <= targetBytes) break;
    total -= entry.bytes;
    removed.push({ streamId: entry.streamId, bytes: entry.bytes });
  }
  return { bytes: total, removed };
}

export class HearMeOutWatchHlsCache {
  private readonly failures = new Map<string, { at: number; message: string }>();
  constructor(
    private readonly root: string,
    private readonly activeJobs: ReadonlySet<string> = new Set(),
    private readonly budgetBytes = HEARMEOUT_WATCH_HLS_BUDGET_BYTES,
    private readonly nowMs: () => number = Date.now,
  ) {
    if (!root) throw new Error("HearMeOut HLS cache root is required");
  }

  paths(streamId: unknown) {
    const clean = cleanHearMeOutWatchStreamId(streamId);
    const dir = join(this.root, clean);
    return { clean, dir, indexPath: join(dir, "index.m3u8") };
  }

  hasUsableIndex(streamId: unknown): boolean {
    const { dir, indexPath } = this.paths(streamId);
    if (!existsSync(indexPath)) return false;
    const indexStats = statSync(indexPath);
    if (!indexStats.isFile() || indexStats.size <= 0) return false;
    const manifest = readFileSync(indexPath, "utf8");
    if (isLegacyHearMeOutEventPlaylist(manifest)) {
      try { unlinkSync(indexPath); } catch {}
      return false;
    }
    const firstSegment = firstHearMeOutHlsMediaReference(manifest);
    if (!firstSegment) return false;
    const referenced = join(dir, cleanHearMeOutHlsFileName(firstSegment));
    if (!existsSync(referenced)) return false;
    const referencedStats = statSync(referenced);
    return referencedStats.isFile() && referencedStats.size > 0;
  }

  touch(streamId: unknown): void {
    const { indexPath } = this.paths(streamId);
    if (!existsSync(indexPath)) return;
    const now = new Date(this.nowMs());
    try { utimesSync(indexPath, now, now); } catch {}
  }

  recordFailure(streamId: unknown, error: unknown): void {
    const clean = cleanHearMeOutWatchStreamId(streamId);
    this.failures.set(clean, { at: this.nowMs(), message: safeError(error) });
  }

  clearFailure(streamId: unknown): void {
    this.failures.delete(cleanHearMeOutWatchStreamId(streamId));
  }

  recentFailure(streamId: unknown): { at: number; message: string } | null {
    const clean = cleanHearMeOutWatchStreamId(streamId);
    const failure = this.failures.get(clean);
    if (!failure) return null;
    if (this.nowMs() - failure.at > HEARMEOUT_WATCH_HLS_FAILURE_TTL_MS) {
      this.failures.delete(clean);
      return null;
    }
    return { ...failure };
  }

  snapshot(): HearMeOutWatchHlsSnapshotV1 {
    mkdirSync(this.root, { recursive: true });
    const entries: HearMeOutWatchHlsEntryV1[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.root, entry.name);
      let bytes = 0;
      let files = 0;
      let updatedAt = 0;
      for (const name of readdirSync(dir)) {
        try {
          const stats = statSync(join(dir, name));
          if (!stats.isFile()) continue;
          bytes += stats.size;
          files += 1;
          updatedAt = Math.max(updatedAt, stats.mtimeMs);
        } catch {}
      }
      entries.push({ streamId: entry.name, bytes, files, ready: this.hasUsableIndex(entry.name), active: this.activeJobs.has(entry.name), updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null });
    }
    entries.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
    return {
      root: "worker-managed",
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      budgetBytes: this.budgetBytes,
      segmentSeconds: HEARMEOUT_WATCH_HLS_SEGMENT_SECONDS,
      playlistWindow: HEARMEOUT_WATCH_HLS_LIST_SIZE === 0 ? "full" : `${HEARMEOUT_WATCH_HLS_LIST_SIZE} segments`,
      entries,
    };
  }

  prune(targetBytes = this.budgetBytes): HearMeOutWatchHlsPruneResultV1 {
    mkdirSync(this.root, { recursive: true });
    const candidates: Array<{ streamId: string; bytes: number; mtimeMs: number; active: boolean }> = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.root, entry.name);
      let bytes = 0;
      let mtimeMs = 0;
      for (const name of readdirSync(dir)) {
        try {
          const stats = statSync(join(dir, name));
          if (!stats.isFile()) continue;
          bytes += stats.size;
          mtimeMs = Math.max(mtimeMs, stats.mtimeMs);
        } catch {}
      }
      candidates.push({ streamId: entry.name, bytes, mtimeMs, active: this.activeJobs.has(entry.name) });
    }
    const planned = planHearMeOutWatchHlsPrune(candidates, targetBytes);
    for (const item of planned.removed) {
      try { rmSync(join(this.root, item.streamId), { recursive: true, force: true }); } catch {}
    }
    return planned;
  }
}

function boundedPositive(value: number, name: string) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000) throw new Error(`${name} is invalid`);
  return parsed;
}
function boundedNonNegative(value: number, name: string) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100_000) throw new Error(`${name} is invalid`);
  return parsed;
}
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "HLS conversion failed");
  return message.replace(/((?:token|authorization|secret|password))\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/[\r\n\0]/g, " ").slice(0, 300);
}
