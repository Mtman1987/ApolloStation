import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const HEARMEOUT_MUSIC_CATALOG_LIMIT = 1000;
export const HEARMEOUT_MUSIC_QUERY_HISTORY_LIMIT = 20;

export interface HearMeOutMusicCatalogTrackV1 {
  id: string;
  title: string;
  artist: string;
  url: string;
  thumbnail: string;
  duration: number;
  queries: string[];
  savedAt: string;
  updatedAt: string;
}

export interface HearMeOutMusicCatalogOptionsV1 {
  catalogFile: string;
  now?: () => string;
}

/** Persistent DJ-worker search memory, not canonical room or playback state. */
export class HearMeOutWorkerMusicCatalog {
  private readonly catalogFile: string;
  private readonly now: () => string;

  constructor(options: HearMeOutMusicCatalogOptionsV1) {
    this.catalogFile = resolve(requiredText(options.catalogFile, "catalogFile"));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  read(): HearMeOutMusicCatalogTrackV1[] {
    try {
      const parsed = JSON.parse(readFileSync(this.catalogFile, "utf8")) as { items?: unknown };
      if (!Array.isArray(parsed?.items)) return [];
      return parsed.items.map(normalizeStoredTrack).filter((track): track is HearMeOutMusicCatalogTrackV1 => Boolean(track)).slice(0, HEARMEOUT_MUSIC_CATALOG_LIMIT);
    } catch {
      return [];
    }
  }

  search(queryInput = "", limitInput = 25) {
    const query = String(queryInput ?? "");
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(limitInput) || 25)));
    return this.read()
      .map((item) => ({ item, score: scoreHearMeOutCatalogTrack(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
      .slice(0, limit)
      .map(({ item }) => item);
  }

  save(input: { track: Partial<HearMeOutMusicCatalogTrackV1> & { id: string; url: string }; query?: string }) {
    const id = requiredText(input.track.id, "track.id").slice(0, 200);
    const url = normalizeHttpUrl(input.track.url);
    const query = String(input.query ?? "").trim().slice(0, 300);
    const now = validTimestamp(this.now(), "now");
    const items = this.read();
    const existingIndex = items.findIndex((item) => item.id === id);
    const existing = existingIndex >= 0 ? items[existingIndex] : undefined;
    const queries = new Set(existing?.queries ?? []);
    if (query) queries.add(query);

    const next: HearMeOutMusicCatalogTrackV1 = {
      id,
      title: String(input.track.title ?? existing?.title ?? id).trim().slice(0, 300) || id,
      artist: String(input.track.artist ?? existing?.artist ?? "Unknown Artist").trim().slice(0, 300) || "Unknown Artist",
      url,
      thumbnail: normalizeOptionalHttpUrl(input.track.thumbnail ?? existing?.thumbnail ?? ""),
      duration: normalizeDuration(input.track.duration ?? existing?.duration ?? 180000),
      queries: [...queries].slice(-HEARMEOUT_MUSIC_QUERY_HISTORY_LIMIT),
      savedAt: existing?.savedAt ?? now,
      updatedAt: now,
    };
    if (existingIndex >= 0) items.splice(existingIndex, 1);
    items.unshift(next);
    this.write(items.slice(0, HEARMEOUT_MUSIC_CATALOG_LIMIT));
    return { item: structuredClone(next), count: Math.min(items.length, HEARMEOUT_MUSIC_CATALOG_LIMIT) };
  }

  remove(idInput: string) {
    const id = requiredText(idInput, "id");
    const items = this.read();
    const next = items.filter((item) => item.id !== id);
    this.write(next);
    return { removed: items.length - next.length, count: next.length };
  }

  private write(items: HearMeOutMusicCatalogTrackV1[]) {
    mkdirSync(dirname(this.catalogFile), { recursive: true });
    const tmp = `${this.catalogFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ updatedAt: this.now(), items }, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.catalogFile);
  }
}

export function scoreHearMeOutCatalogTrack(track: Pick<HearMeOutMusicCatalogTrackV1, "title" | "artist" | "url" | "queries">, queryInput: string) {
  const needle = String(queryInput ?? "").trim().toLowerCase();
  if (!needle) return 1;
  const haystack = [track.title, track.artist, track.url, ...(Array.isArray(track.queries) ? track.queries : [])].join(" ").toLowerCase();
  if (haystack === needle) return 100;
  if (haystack.includes(needle)) return 80;
  return needle.split(/\s+/).filter(Boolean).reduce((score, word) => score + (haystack.includes(word) ? 10 : 0), 0);
}

function normalizeStoredTrack(value: unknown): HearMeOutMusicCatalogTrackV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const track = value as Record<string, unknown>;
  try {
    return {
      id: requiredText(String(track.id ?? ""), "id").slice(0, 200),
      title: requiredText(String(track.title ?? track.id ?? ""), "title").slice(0, 300),
      artist: String(track.artist ?? "Unknown Artist").trim().slice(0, 300) || "Unknown Artist",
      url: normalizeHttpUrl(String(track.url ?? "")),
      thumbnail: normalizeOptionalHttpUrl(String(track.thumbnail ?? "")),
      duration: normalizeDuration(Number(track.duration ?? 180000)),
      queries: Array.isArray(track.queries) ? track.queries.map((query) => String(query).trim().slice(0, 300)).filter(Boolean).slice(-HEARMEOUT_MUSIC_QUERY_HISTORY_LIMIT) : [],
      savedAt: validTimestamp(String(track.savedAt ?? track.updatedAt ?? new Date(0).toISOString()), "savedAt"),
      updatedAt: validTimestamp(String(track.updatedAt ?? track.savedAt ?? new Date(0).toISOString()), "updatedAt"),
    };
  } catch { return undefined; }
}
function normalizeHttpUrl(value: string) {
  const parsed = new URL(requiredText(value, "url"));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("url must be HTTP(S)");
  return parsed.toString();
}
function normalizeOptionalHttpUrl(value: string) { const clean = String(value ?? "").trim(); return clean ? normalizeHttpUrl(clean) : ""; }
function normalizeDuration(value: number) { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0 || parsed > 7 * 24 * 60 * 60 * 1000) throw new Error("duration is invalid"); return parsed; }
function validTimestamp(value: string, name: string) { if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp`); return new Date(Date.parse(value)).toISOString(); }
function requiredText(value: string, name: string) { const clean = String(value ?? "").trim(); if (!clean || /[\r\n\0]/.test(clean)) throw new Error(`${name} is invalid`); return clean; }
