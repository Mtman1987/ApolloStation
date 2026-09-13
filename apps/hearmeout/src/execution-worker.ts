import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExecutionJobV1, ExecutionTargetV1 } from "@spmt/contracts";
import { SpmtApiError, SpmtClient } from "@spmt/sdk";
import { HearMeOutWorkerMediaCache } from "./worker-media-cache.js";
import { HearMeOutWorkerMusicCatalog, type HearMeOutMusicCatalogTrackV1 } from "./worker-music-catalog.js";
import { HearMeOutYoutubeResolverCoordinator, type HearMeOutResolvedYoutubeV1, type HearMeOutYoutubeResolverAdapterV1 } from "./youtube-resolver.js";

export const HEARMEOUT_EXECUTION_CAPABILITIES = ["hearmeout.music.search", "hearmeout.youtube.resolve", "hearmeout.music.remember"] as const;
export type HearMeOutExecutionCapabilityV1 = (typeof HEARMEOUT_EXECUTION_CAPABILITIES)[number];

export interface HearMeOutExecutionClientV1 {
  claimAnyExecutionJob(workerId: string, executionTarget: ExecutionTargetV1, options: { executionOwner: string; capabilityIds: string[]; tenantIds?: string[]; leaseMs: number }): Promise<ExecutionJobV1 | null>;
  heartbeatExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, progress: { percent: number; message: string }, leaseMs: number): Promise<unknown>;
  succeedExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, result: Record<string, unknown>): Promise<unknown>;
  failExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, code: string, message: string, retryable: boolean): Promise<unknown>;
  reportExecutionWorker(input: Record<string, unknown>): Promise<unknown>;
}

export interface HearMeOutRuntimeConfigV1 {
  schemaVersion: 1;
  revision: string;
  pollMs: number;
  capabilities: HearMeOutExecutionCapabilityV1[];
  tenants: Array<{ tenantId: string }>;
}

export interface HearMeOutWorkerEnvironmentV1 {
  runtimeMode: "production" | "sandbox";
  spmtOrigin: string;
  databasePath: string;
  cacheDir: string;
  configPath: string;
  credential: string;
  workerId: string;
  executionTarget: "fly" | "sprite";
  ytDlpBinary?: string;
  config: HearMeOutRuntimeConfigV1;
}

export function loadHearMeOutRuntimeConfig(path: string): HearMeOutRuntimeConfigV1 {
  if (!isAbsolute(path)) throw new Error("HEARMEOUT_RUNTIME_CONFIG_PATH must be absolute");
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("HearMeOut runtime config must be readable JSON"); }
  return validateHearMeOutRuntimeConfig(parsed);
}

export function validateHearMeOutWorkerEnvironment(environment: NodeJS.ProcessEnv): HearMeOutWorkerEnvironmentV1 {
  const runtimeMode = environment.SPMT_RUNTIME_MODE === "sandbox" ? "sandbox" : "production";
  const spmtOrigin = loopbackOrigin(environment.SPMT_ORIGIN ?? "");
  const databasePath = absolute(environment.HEARMEOUT_DATABASE_PATH, "HEARMEOUT_DATABASE_PATH");
  const cacheDir = absolute(environment.HEARMEOUT_CACHE_DIR, "HEARMEOUT_CACHE_DIR");
  const configPath = absolute(environment.HEARMEOUT_RUNTIME_CONFIG_PATH, "HEARMEOUT_RUNTIME_CONFIG_PATH");
  const credential = environment.HEARMEOUT_WORKER_CREDENTIAL ?? "";
  if (credential.length < 32) throw new Error("A 32+ character HEARMEOUT_WORKER_CREDENTIAL is required");
  const workerId = identifier(environment.HEARMEOUT_WORKER_ID ?? `hearmeout-${process.pid}`, "HEARMEOUT_WORKER_ID");
  const executionTarget = environment.HEARMEOUT_EXECUTION_TARGET === "sprite" ? "sprite" : "fly";
  const ytDlpBinary = environment.HEARMEOUT_YT_DLP_BINARY ? absolute(environment.HEARMEOUT_YT_DLP_BINARY, "HEARMEOUT_YT_DLP_BINARY") : undefined;
  const config = loadHearMeOutRuntimeConfig(configPath);
  if (config.capabilities.includes("hearmeout.youtube.resolve") && !ytDlpBinary) throw new Error("hearmeout.youtube.resolve requires HEARMEOUT_YT_DLP_BINARY");
  if (runtimeMode === "sandbox") {
    if (environment.SPMT_OUTBOUND_MODE !== "disabled") throw new Error("Sandbox HearMeOut requires SPMT_OUTBOUND_MODE=disabled");
    for (const path of [databasePath, cacheDir, configPath]) if (!basename(path).toLowerCase().includes("sandbox")) throw new Error("Sandbox HearMeOut requires sandbox-named storage and config paths");
    if (config.tenants.length) throw new Error("Sandbox HearMeOut rejects live tenants");
    if (ytDlpBinary) throw new Error("Sandbox HearMeOut rejects external media resolution");
  }
  return { runtimeMode, spmtOrigin, databasePath, cacheDir, configPath, credential, workerId, executionTarget, ...(ytDlpBinary ? { ytDlpBinary } : {}), config };
}

export function createHearMeOutWorkerTokenProvider(options: { spmtOrigin: string; credential: string; fetchImpl?: typeof fetch }) {
  const origin = loopbackOrigin(options.spmtOrigin);
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    const response = await (options.fetchImpl ?? fetch)(`${origin}/v1/auth/service-token`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ serviceId: "hearmeout", credential: options.credential }), redirect: "manual", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HearMeOut authentication failed (${response.status})`);
    const value = await response.json() as { accessToken?: unknown; accessExpiresAt?: unknown };
    if (typeof value.accessToken !== "string" || typeof value.accessExpiresAt !== "string" || !Number.isFinite(Date.parse(value.accessExpiresAt))) throw new Error("HearMeOut authentication returned an invalid token");
    cached = { token: value.accessToken, expiresAt: Date.parse(value.accessExpiresAt) };
    return cached.token;
  };
}

export class HearMeOutExecutionWorker {
  private completedJobs = 0;
  private failedJobs = 0;
  constructor(private readonly client: HearMeOutExecutionClientV1, private readonly options: { workerId: string; executionTarget: "fly" | "sprite"; capabilities: HearMeOutExecutionCapabilityV1[]; tenantIds?: string[]; catalog: HearMeOutWorkerMusicCatalog; cache: HearMeOutWorkerMediaCache; catalogForTenant?: (tenantId: string) => HearMeOutWorkerMusicCatalog; cacheForTenant?: (tenantId: string) => HearMeOutWorkerMediaCache; search?: (query: string, limit: number) => Promise<HearMeOutMusicCatalogTrackV1[]>; resolver?: HearMeOutYoutubeResolverCoordinator }) {}
  async runOnce() {
    if (this.options.tenantIds?.length === 0) return undefined;
    const job = await this.client.claimAnyExecutionJob(this.options.workerId, this.options.executionTarget, { executionOwner: "hearmeout", capabilityIds: this.options.capabilities, ...(this.options.tenantIds ? { tenantIds: this.options.tenantIds } : {}), leaseMs: 300_000 });
    if (!job) return undefined;
    await this.execute(job);
    return job.id;
  }
  async run(signal: AbortSignal, pollMs = 1_000) { while (!signal.aborted) { if (!await this.runOnce()) await pause(pollMs, signal); } }
  async report(startedAt: string) { return this.client.reportExecutionWorker({ executionOwner: "hearmeout", workerId: this.options.workerId, executionTarget: this.options.executionTarget, state: "ready", capabilityIds: this.options.capabilities, ...(this.options.tenantIds ? { tenantIds: this.options.tenantIds } : {}), providerHealthy: true, startedAt, metrics: { completedJobs: this.completedJobs, failedJobs: this.failedJobs }, leaseMs: 30_000 }); }
  private async execute(job: ExecutionJobV1) {
    if (!job.leaseId) throw new Error("Claimed HearMeOut job has no lease");
    const lease = [job.tenantId, job.id, this.options.workerId, job.leaseId, job.fencingEpoch] as const;
    try {
      if (this.options.tenantIds && !this.options.tenantIds.includes(job.tenantId)) throw new Error("This tenant is not assigned to the HearMeOut worker");
      await this.client.heartbeatExecutionJob(...lease, { percent: 20, message: "Preparing HearMeOut media operation" }, 300_000);
      const result = await this.handle(job.capabilityId as HearMeOutExecutionCapabilityV1, job.input, job.tenantId);
      await this.client.succeedExecutionJob(...lease, result);
      this.completedJobs += 1;
    } catch (error) {
      this.failedJobs += 1;
      const unavailable = error instanceof HearMeOutWorkerError && error.retryable;
      await this.client.failExecutionJob(...lease, unavailable ? "media-unavailable" : "invalid-request", safeError(error), unavailable);
    }
  }
  private async handle(capability: HearMeOutExecutionCapabilityV1, input: Record<string, unknown>, tenantId: string): Promise<Record<string, unknown>> {
    const catalog = this.options.catalogForTenant?.(tenantId) ?? this.options.catalog;
    const cache = this.options.cacheForTenant?.(tenantId) ?? this.options.cache;
    if (capability === "hearmeout.music.search") {
      const query = text(input.query, "query", 300), limit = optionalInteger(input.limit, 1, 100) ?? 25;
      const remembered = catalog.search(query, limit);
      let found: HearMeOutMusicCatalogTrackV1[] = [], providerError = false;
      if (this.options.search) try { found = await this.options.search(query, limit); } catch { providerError = true; }
      if (!remembered.length && providerError) throw new HearMeOutWorkerError("Online search is unavailable. Retry or use a direct media link.", true);
      const items = [...new Map([...remembered, ...found].map(item => [item.id, item])).values()].slice(0, limit);
      return { schemaVersion: 1, kind: "hearmeout.music.search.result", items, providerAvailable: Boolean(this.options.search) && !providerError };
    }
    if (capability === "hearmeout.music.remember") {
      const userId = text(input.userId, "userId", 200), videoId = text(input.videoId, "videoId", 20);
      const title = optionalText(input.title, 300), artist = optionalText(input.artist, 300), thumbnail = optionalText(input.thumbnail, 2_000), duration = optionalInteger(input.duration, 0, 86_400_000), query = optionalText(input.query, 300);
      const saved = catalog.save({ track: { id: videoId, url: text(input.url, "url", 2_000), ...(title ? { title } : {}), ...(artist ? { artist } : {}), ...(thumbnail ? { thumbnail } : {}), ...(duration === undefined ? {} : { duration }) }, ...(query ? { query } : {}) });
      return { schemaVersion: 1, kind: "hearmeout.music.remember.result", saved, recent: cache.recordUserMusicPlay(userId, videoId).entries };
    }
    if (capability === "hearmeout.youtube.resolve") {
      if (!this.options.resolver) throw new HearMeOutWorkerError("YouTube resolution is not configured on this worker", true);
      const resolution = await this.options.resolver.resolve(text(input.videoId, "videoId", 20));
      if (!resolution.result) throw new HearMeOutWorkerError("No safe media source could be resolved", true);
      return { schemaVersion: 1, kind: "hearmeout.youtube.resolve.result", media: resolution.result, attempts: resolution.attempts };
    }
    throw new Error("Unsupported HearMeOut capability");
  }
}

export class YtDlpHearMeOutResolverAdapter implements HearMeOutYoutubeResolverAdapterV1 {
  private readonly run = promisify(execFile);
  constructor(private readonly binary: string) { if (!isAbsolute(binary)) throw new Error("yt-dlp binary must be absolute"); }
  async search(query: string, limit: number): Promise<HearMeOutMusicCatalogTrackV1[]> {
    const count = Math.max(1, Math.min(25, limit));
    const { stdout } = await this.run(this.binary, ["--ignore-config", "--dump-single-json", "--flat-playlist", "--skip-download", "--no-warnings", "--", `ytsearch${count}:${text(query, "query", 300)}`], { timeout: 45_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const body = JSON.parse(stdout) as { entries?: Array<Record<string, unknown>> }, now = new Date().toISOString();
    return (body.entries ?? []).filter(item => /^[A-Za-z0-9_-]{11}$/.test(String(item.id))).slice(0, count).map(item => ({ id: String(item.id), title: String(item.title || item.id).slice(0, 300), artist: String(item.channel || item.uploader || "Unknown Artist").slice(0, 300), url: `https://www.youtube.com/watch?v=${item.id}`, thumbnail: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`, duration: Number.isFinite(Number(item.duration)) ? Math.max(0, Math.round(Number(item.duration) * 1000)) : 0, queries: [query], savedAt: now, updatedAt: now }));
  }
  async ytDlp(videoId: string): Promise<HearMeOutResolvedYoutubeV1 | null> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Invalid YouTube video id");
    const { stdout } = await this.run(this.binary, ["--ignore-config", "--dump-single-json", "--no-playlist", "--no-warnings", "--", `https://www.youtube.com/watch?v=${videoId}`], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const body = JSON.parse(stdout) as { title?: unknown; duration?: unknown; url?: unknown; formats?: Array<{ url?: unknown; vcodec?: unknown; acodec?: unknown }> };
    const formats = Array.isArray(body.formats) ? body.formats : [];
    const video = [...formats].reverse().find((item) => typeof item.url === "string" && item.vcodec && item.vcodec !== "none" && item.acodec && item.acodec !== "none")?.url;
    const audio = [...formats].reverse().find((item) => typeof item.url === "string" && item.acodec && item.acodec !== "none" && item.vcodec === "none")?.url ?? video;
    if (typeof video !== "string" || typeof audio !== "string") return null;
    return { videoId, videoUrl: video, audioUrl: audio, ...(typeof body.title === "string" ? { title: body.title } : {}), ...(typeof body.duration === "number" ? { durationMs: Math.trunc(body.duration * 1_000) } : {}), stage: "yt-dlp", resolvedAt: new Date().toISOString() };
  }
}

export function createSupervisedHearMeOutWorker(options: HearMeOutWorkerEnvironmentV1, fetchImpl?: typeof fetch) {
  const getAccessToken = createHearMeOutWorkerTokenProvider({ spmtOrigin: options.spmtOrigin, credential: options.credential, ...(fetchImpl ? { fetchImpl } : {}) });
  const client = new SpmtClient({ baseUrl: options.spmtOrigin, appId: "hearmeout", getAccessToken, ...(fetchImpl ? { fetchImpl } : {}) });
  const catalog = new HearMeOutWorkerMusicCatalog({ catalogFile: resolve(options.cacheDir, "music-catalog.json") });
  const cache = new HearMeOutWorkerMediaCache({ cacheDir: options.cacheDir });
  const adapter = options.ytDlpBinary ? new YtDlpHearMeOutResolverAdapter(options.ytDlpBinary) : undefined;
  const resolver = adapter ? new HearMeOutYoutubeResolverCoordinator(adapter) : undefined;
  const tenantPath = (tenantId: string) => resolve(options.cacheDir, "tenants", createHash("sha256").update(tenantId).digest("hex"));
  return { getAccessToken, worker: new HearMeOutExecutionWorker(client, { workerId: options.workerId, executionTarget: options.executionTarget, capabilities: options.config.capabilities, tenantIds: options.config.tenants.map(tenant => tenant.tenantId), catalog, cache, catalogForTenant: tenantId => new HearMeOutWorkerMusicCatalog({ catalogFile: resolve(tenantPath(tenantId), "music-catalog.json") }), cacheForTenant: tenantId => new HearMeOutWorkerMediaCache({ cacheDir: tenantPath(tenantId) }), ...(adapter ? { search: (query, limit) => adapter.search(query, limit) } : {}), ...(resolver ? { resolver } : {}) }) };
}

class HearMeOutWorkerError extends Error { constructor(message: string, readonly retryable: boolean) { super(message); } }
function validateHearMeOutRuntimeConfig(value: unknown): HearMeOutRuntimeConfigV1 { const root = record(value, "config"); exactKeys(root, ["schemaVersion", "revision", "pollMs", "capabilities", "tenants"]); if (root.schemaVersion !== 1) throw new Error("Unsupported HearMeOut runtime config version"); const revision = identifier(root.revision, "revision"); if (!Number.isSafeInteger(root.pollMs) || Number(root.pollMs) < 250 || Number(root.pollMs) > 60_000) throw new Error("HearMeOut pollMs is invalid"); if (!Array.isArray(root.capabilities) || !root.capabilities.length || root.capabilities.some((item) => !(HEARMEOUT_EXECUTION_CAPABILITIES as readonly unknown[]).includes(item)) || new Set(root.capabilities).size !== root.capabilities.length) throw new Error("HearMeOut capabilities are invalid"); if (!Array.isArray(root.tenants) || root.tenants.length > 500) throw new Error("HearMeOut tenants are invalid"); const tenants = root.tenants.map((item) => { const entry = record(item, "tenant"); exactKeys(entry, ["tenantId"]); return { tenantId: identifier(entry.tenantId, "tenantId") }; }); if (new Set(tenants.map((item) => item.tenantId)).size !== tenants.length) throw new Error("HearMeOut tenants contain a duplicate"); return { schemaVersion: 1, revision, pollMs: Number(root.pollMs), capabilities: root.capabilities as HearMeOutExecutionCapabilityV1[], tenants }; }
function loopbackOrigin(value: string) { const url = new URL(value); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_ORIGIN must be a credential-free loopback HTTP origin"); return url.origin; }
function absolute(value: unknown, name: string) { if (typeof value !== "string" || !isAbsolute(value)) throw new Error(`${name} must be absolute`); return resolve(value); }
function identifier(value: unknown, name: string) { if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,200}$/.test(value)) throw new Error(`${name} is invalid`); return value; }
function record(value: unknown, name: string) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`HearMeOut ${name} must be an object`); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, allowed: string[]) { const extras = Object.keys(value).filter((key) => !allowed.includes(key)); if (extras.length) throw new Error(`HearMeOut config contains unsupported fields: ${extras.join(", ")}`); }
function text(value: unknown, name: string, max: number) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} is invalid`); return value.trim(); }
function optionalText(value: unknown, max: number) { return value === undefined ? undefined : text(value, "value", max); }
function optionalInteger(value: unknown, min: number, max: number) { if (value === undefined) return undefined; const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error("integer input is invalid"); return number; }
function safeError(error: unknown) { const value = error instanceof SpmtApiError ? `${error.message}: ${error.responseBody}` : error instanceof Error ? error.message : "HearMeOut worker failed"; return value.replace(/((?:token|authorization|secret|password|cookie))\s*[:=]\s*\S+/gi, "$1=[redacted]").replace(/[\r\n]+/g, " ").slice(0, 900); }
function pause(ms: number, signal: AbortSignal) { return new Promise<void>((done) => { if (signal.aborted) return done(); const timer = setTimeout(done, ms); signal.addEventListener("abort", () => { clearTimeout(timer); done(); }, { once: true }); }); }
