import type { HearMeOutMediaItemV1 } from "./room-media-core.js";

export type HearMeOutXtreamKindV1 = "vod" | "live" | "series";

export interface HearMeOutXtreamCatalogItemV1 {
  schemaVersion: 1;
  itemId: string;
  provider: "xtream";
  kind: HearMeOutXtreamKindV1;
  providerId: string;
  title: string;
  year?: number;
  categoryId?: string;
  posterUrl?: string;
  plot?: string;
  rating?: number;
  extension?: string;
}

export interface HearMeOutXtreamCredentialsV1 {
  baseUrl: string;
  username: string;
  password: string;
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;
const ALLOWED_VOD_EXTENSIONS = new Set(["mp4", "m4v", "mov", "mkv", "ts", "m3u8"]);

/**
 * Direct, credential-private Xtream catalog adapter migrated from the live
 * HearMeOut Lounge worker. Catalog items exposed to the UI never contain
 * provider usernames/passwords or credential-bearing upstream URLs.
 */
export class HearMeOutXtreamWatchCatalog {
  private cachedAt = 0;
  private cachedItems: HearMeOutXtreamCatalogItemV1[] = [];
  private inflight?: Promise<HearMeOutXtreamCatalogItemV1[]>;

  constructor(
    private readonly credentials: HearMeOutXtreamCredentialsV1,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    const base = new URL(credentials.baseUrl);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error("Xtream base URL must be an HTTP(S) origin or path without embedded credentials");
    }
    if (!credentials.username.trim() || !credentials.password) throw new Error("Xtream credentials are required");
    if (credentials.username.length > 256 || credentials.password.length > 512) throw new Error("Xtream credentials are invalid");
    this.credentials = { ...credentials, baseUrl: base.href.replace(/\/$/, "") };
  }

  async catalog(options: { forceRefresh?: boolean; includeSeries?: boolean } = {}): Promise<HearMeOutXtreamCatalogItemV1[]> {
    if (!options.forceRefresh && this.cachedItems.length && this.now() - this.cachedAt < CACHE_TTL_MS) return structuredClone(this.cachedItems);
    if (this.inflight) return structuredClone(await this.inflight);
    this.inflight = this.load(options.includeSeries !== false);
    try {
      const items = await this.inflight;
      this.cachedItems = items;
      this.cachedAt = this.now();
      return structuredClone(items);
    } finally {
      this.inflight = undefined;
    }
  }

  async search(query: string, options: { limit?: number; kinds?: HearMeOutXtreamKindV1[]; includeSeries?: boolean } = {}) {
    const normalized = normalizeWords(query);
    if (!normalized.length) throw new Error("Enter a title to search the Watch catalog");
    if (query.length > 300) throw new Error("Watch search is too long");
    const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)));
    const kinds = new Set(options.kinds ?? ["vod", "live", "series"]);
    const items = await this.catalog({ includeSeries: options.includeSeries });
    return items.filter(item => kinds.has(item.kind)).map(item => {
      const title = normalizeWords(item.title);
      const matched = normalized.filter(word => title.includes(word)).length;
      const score = matched === normalized.length ? matched + (title.join(" ") === normalized.join(" ") ? 10 : 0) : 0;
      return { item, score };
    }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length)
      .slice(0, limit).map(({ item }) => item);
  }

  async seriesEpisodes(seriesId: string) {
    const id = numericId(seriesId, "seriesId");
    const value = await this.request("get_series_info", { series_id: id });
    const root = asRecord(value, "series details");
    const episodes = root.episodes && typeof root.episodes === "object" ? root.episodes as Record<string, unknown> : {};
    return Object.entries(episodes).flatMap(([season, rawEpisodes]) => {
      const rows = Array.isArray(rawEpisodes) ? rawEpisodes : [];
      return rows.flatMap((raw, index) => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as Record<string, unknown>;
        const episodeId = numericIdOrUndefined(row.id ?? row.stream_id);
        const title = textOrUndefined(row.title ?? row.name);
        if (!episodeId || !title) return [];
        const extension = safeExtension(row.container_extension);
        return [{
          schemaVersion: 1 as const,
          itemId: "xtream-episode-" + episodeId,
          provider: "xtream" as const,
          kind: "series" as const,
          providerId: episodeId,
          title,
          categoryId: String(season).slice(0, 64),
          ...(extension ? { extension } : {}),
          plot: typeof row.info === "object" && row.info && typeof (row.info as Record<string, unknown>).plot === "string" ? String((row.info as Record<string, unknown>).plot).slice(0, 1000) : undefined,
          episodeNumber: Number.isSafeInteger(Number(row.episode_num)) ? Number(row.episode_num) : index + 1,
        }];
      });
    });
  }

  /** Resolve an upstream stream URL for server-side proxying only; never return this URL to the browser. */
  upstreamPlaybackUrl(kind: "vod" | "live" | "episode", providerId: string, extension: string) {
    const id = numericId(providerId, "providerId");
    const safeExt = safeExtension(extension);
    if (!safeExt || !new Set(["mp4", "m4v", "mov", "mkv", "ts"]).has(safeExt)) {
      throw new Error("This Watch format is not supported by the direct playback proxy yet");
    }
    const pathKind = kind === "vod" ? "movie" : kind === "live" ? "live" : "series";
    return new URL("/" + pathKind + "/" + encodeURIComponent(this.credentials.username) + "/" + encodeURIComponent(this.credentials.password) + "/" + id + "." + safeExt, this.credentials.baseUrl);
  }

  /** Convert a selected catalog item into a safe, local HMO route, not an upstream URL. */
  playbackPath(item: Pick<HearMeOutXtreamCatalogItemV1, "kind" | "providerId" | "extension">) {
    const id = numericId(item.providerId, "providerId");
    const kind = item.kind;
    const extension = safeExtension(item.extension) ?? (kind === "live" ? "m3u8" : "mp4");
    return "/api/hearmeout/watch/xtream/" + kind + "/" + id + "." + extension;
  }

  toMediaItem(item: HearMeOutXtreamCatalogItemV1): HearMeOutMediaItemV1 {
    return {
      itemId: item.itemId,
      type: item.kind === "live" ? "live" : "movie",
      title: item.title,
      source: "xtream",
      playbackUrl: this.playbackPath(item),
      ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
      ...(item.plot ? { metadata: { plot: item.plot, provider: "xtream", kind: item.kind, providerId: item.providerId } } : { metadata: { provider: "xtream", kind: item.kind, providerId: item.providerId } }),
    };
  }

  private async load(includeSeries: boolean) {
    const requests: Promise<unknown>[] = [
      this.request("get_vod_streams"),
      this.request("get_live_streams"),
    ];
    if (includeSeries) requests.push(this.request("get_series").catch(() => []));
    const [vodRaw, liveRaw, seriesRaw = []] = await Promise.all(requests);
    return [
      ...rows(vodRaw).map(row => this.normalize(row, "vod")).filter(isItem),
      ...rows(liveRaw).map(row => this.normalize(row, "live")).filter(isItem),
      ...rows(seriesRaw).map(row => this.normalize(row, "series")).filter(isItem),
    ];
  }

  private normalize(raw: Record<string, unknown>, kind: HearMeOutXtreamKindV1): HearMeOutXtreamCatalogItemV1 | undefined {
    const id = numericIdOrUndefined(kind === "series" ? raw.series_id : raw.stream_id ?? raw.id);
    const title = textOrUndefined(raw.name ?? raw.title);
    if (!id || !title) return undefined;
    const extension = safeExtension(raw.container_extension);
    if (kind === "vod" && extension && !ALLOWED_VOD_EXTENSIONS.has(extension)) return undefined;
    const rating = Number(raw.rating);
    return {
      schemaVersion: 1, itemId: "xtream-" + kind + "-" + id, provider: "xtream", kind, providerId: id, title,
      ...(Number.isSafeInteger(Number(raw.year)) && Number(raw.year) > 1800 && Number(raw.year) < 2200 ? { year: Number(raw.year) } : {}),
      ...(numericIdOrUndefined(raw.category_id) ? { categoryId: String(raw.category_id) } : {}),
      ...(safeImageUrl(raw.stream_icon ?? raw.cover) ? { posterUrl: safeImageUrl(raw.stream_icon ?? raw.cover) } : {}),
      ...(textOrUndefined(raw.plot) ? { plot: String(raw.plot).slice(0, 1000) } : {}),
      ...(Number.isFinite(rating) && rating >= 0 && rating <= 10 ? { rating } : {}),
      ...(extension ? { extension } : {}),
    };
  }

  private async request(action: string, extra: Record<string, string> = {}): Promise<unknown> {
    const url = new URL("/player_api.php", this.credentials.baseUrl);
    url.searchParams.set("username", this.credentials.username);
    url.searchParams.set("password", this.credentials.password);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    const response = await this.fetchImpl(url, { method: "GET", redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error("Xtream catalog request failed with HTTP " + response.status);
    if (!response.body) throw new Error("Xtream catalog returned an empty response");
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Xtream catalog response exceeded the size limit");
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new Error("Xtream catalog returned invalid JSON"); }
  }
}

function rows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function asRecord(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Xtream " + name + " is invalid"); return value as Record<string, unknown>; }
function numericId(value: string, name: string) { const id = numericIdOrUndefined(value); if (!id) throw new Error("Xtream " + name + " is invalid"); return id; }
function numericIdOrUndefined(value: unknown): string | undefined { const id = String(value ?? ""); return /^\d{1,20}$/.test(id) ? id : undefined; }
function textOrUndefined(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : undefined; }
function safeExtension(value: unknown): string | undefined { const extension = String(value ?? "").toLowerCase().replace(/^\./, ""); return /^[a-z0-9]{2,5}$/.test(extension) ? extension : undefined; }
function safeImageUrl(value: unknown): string | undefined { if (typeof value !== "string" || value.length > 2000) return undefined; try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } }
function normalizeWords(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? []; }
