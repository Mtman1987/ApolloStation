import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const DEFAULT_COMPANION_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
export const MIN_COMPANION_CACHE_BYTES = 512 * 1024 * 1024;
export const MAX_COMPANION_DOWNLOAD_BYTES = 12 * 1024 * 1024 * 1024;

const MEDIA_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac", ".mp4", ".m4v", ".webm", ".mov", ".mkv", ".ts", ".m3u8", ".gif", ".png", ".jpg", ".jpeg", ".webp"]);

export const COMPANION_MEDIA_PRESETS = {
  "mp4-web": ["-c:v", "libx264", "-preset", "medium", "-crf", "22", "-c:a", "aac", "-movflags", "+faststart"],
  "audio-mp3": ["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
  gif: ["-vf", "fps=15,scale=960:-1:flags=lanczos"],
} as const;

export type CompanionMediaPreset = keyof typeof COMPANION_MEDIA_PRESETS;
export type CompanionTranscodeEngine = "auto" | "cpu" | "nvidia" | "intel" | "amd";

export interface CompanionMediaHardwareV1 {
  cpu: string;
  logicalCores: number;
  memoryBytes: number;
  encoders: { nvidia: boolean; intel: boolean; amd: boolean };
  configuredEngine: CompanionTranscodeEngine;
  selectedEngine: Exclude<CompanionTranscodeEngine, "auto">;
}

export interface CompanionMediaFileV1 {
  name: string;
  bytes: number;
  updatedAt: string;
  cached: boolean;
}

export interface CompanionMediaCacheEntryV1 {
  name: string;
  bytes: number;
  url?: string;
  completedAt?: string;
  lastAccessedAt?: string;
}

export interface CompanionMediaJobV1 {
  id: string | null;
  type: "download" | "transcode";
  status: "running" | "completed" | "failed" | "cancelled";
  outputName: string;
  startedAt?: string;
  finishedAt?: string;
  inputName?: string;
  preset?: CompanionMediaPreset;
  engine?: string;
  urlHost?: string;
  bytes?: number;
  totalBytes?: number | null;
  resumed?: boolean;
  cached?: boolean;
  detail?: string | undefined;
  error?: string;
}

export interface CompanionMediaCacheStatusV1 {
  enabled: boolean;
  bytes: number;
  budgetBytes: number;
  entries: CompanionMediaCacheEntryV1[];
  jobs: CompanionMediaJobV1[];
  hardware: CompanionMediaHardwareV1;
}

export interface CompanionMediaJobsOptionsV1 {
  libraryPath: string;
  ffmpegPath?: string;
  maxCacheBytes?: number;
  downloadsEnabled?: boolean;
  transcodeEngine?: CompanionTranscodeEngine;
  onUpdate?: (job: CompanionMediaJobV1) => void;
  now?: () => string;
  idFactory?: () => string;
  fetchFn?: typeof fetch;
}

type HardwareProbe = Omit<CompanionMediaHardwareV1, "configuredEngine" | "selectedEngine">;

export function safeCompanionMediaName(value: unknown): string {
  return path.basename(String(value ?? "")).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "download";
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function clampBytes(value: unknown, fallback = DEFAULT_COMPANION_CACHE_BYTES): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_COMPANION_CACHE_BYTES, Math.min(parsed, 100 * 1024 * 1024 * 1024));
}

export function mediaFileNameFromUrl(rawUrl: string, requestedName?: string): string {
  const parsed = new URL(rawUrl);
  const requested = safeCompanionMediaName(requestedName ?? "");
  const urlName = safeCompanionMediaName(decodeURIComponent(path.basename(parsed.pathname) || ""));
  let fileName = requested !== "download" ? requested : urlName;
  let extension = path.extname(fileName).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(extension)) {
    const urlExtension = path.extname(urlName).toLowerCase();
    extension = MEDIA_EXTENSIONS.has(urlExtension) ? urlExtension : ".mp4";
    fileName = `${path.parse(fileName).name || "download"}${extension}`;
  }
  const urlHash = createHash("sha256").update(parsed.toString()).digest("hex").slice(0, 12);
  return `${urlHash}-${safeCompanionMediaName(fileName)}`;
}

function readJson(filePath: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function detectHardware(ffmpegPath: string): HardwareProbe {
  const result = spawnSync(ffmpegPath, ["-hide_banner", "-encoders"], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return {
    cpu: os.cpus()?.[0]?.model ?? "Unknown CPU",
    logicalCores: os.cpus()?.length ?? 1,
    memoryBytes: os.totalmem(),
    encoders: {
      nvidia: /\bh264_nvenc\b/.test(output),
      intel: /\bh264_qsv\b/.test(output),
      amd: /\bh264_amf\b/.test(output),
    },
  };
}

export function normalizeTranscodeEngine(value: unknown): CompanionTranscodeEngine {
  const engine = String(value ?? "").trim().toLowerCase();
  return (["auto", "cpu", "nvidia", "intel", "amd"] as const).includes(engine as CompanionTranscodeEngine)
    ? engine as CompanionTranscodeEngine
    : "auto";
}

function chooseEngine(requested: CompanionTranscodeEngine, hardware: HardwareProbe): Exclude<CompanionTranscodeEngine, "auto"> {
  if (requested !== "auto") return requested === "cpu" || hardware.encoders[requested] ? requested : "cpu";
  if (hardware.encoders.nvidia) return "nvidia";
  if (hardware.encoders.intel) return "intel";
  if (hardware.encoders.amd) return "amd";
  return "cpu";
}

function presetArgs(preset: CompanionMediaPreset, engine: Exclude<CompanionTranscodeEngine, "auto">): readonly string[] {
  if (preset !== "mp4-web" || engine === "cpu") return COMPANION_MEDIA_PRESETS[preset];
  if (engine === "nvidia") return ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "22", "-c:a", "aac", "-movflags", "+faststart"];
  if (engine === "intel") return ["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", "22", "-c:a", "aac", "-movflags", "+faststart"];
  return ["-c:v", "h264_amf", "-quality", "balanced", "-qp_i", "22", "-qp_p", "22", "-c:a", "aac", "-movflags", "+faststart"];
}

function waitForWritable(writer: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.once("drain", resolve);
    writer.once("error", reject);
  });
}

function waitForFinish(writer: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.once("finish", resolve);
    writer.once("error", reject);
  });
}

export class CompanionMediaJobs {
  readonly libraryPath: string;
  readonly ffmpegPath: string;
  private maxCacheBytes: number;
  private downloadsEnabled: boolean;
  private transcodeEngine: CompanionTranscodeEngine;
  private readonly onUpdate: (job: CompanionMediaJobV1) => void;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly fetchFn: typeof fetch;
  private readonly jobs = new Map<string, CompanionMediaJobV1>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly hardwareInfo: HardwareProbe;

  constructor(options: CompanionMediaJobsOptionsV1) {
    if (!options.libraryPath) throw new Error("Companion media library path is required");
    this.libraryPath = path.resolve(options.libraryPath);
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.maxCacheBytes = clampBytes(options.maxCacheBytes);
    this.downloadsEnabled = options.downloadsEnabled === true;
    this.transcodeEngine = normalizeTranscodeEngine(options.transcodeEngine);
    this.onUpdate = options.onUpdate ?? (() => undefined);
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.fetchFn = options.fetchFn ?? fetch;
    this.hardwareInfo = detectHardware(this.ffmpegPath);
    fs.mkdirSync(this.libraryPath, { recursive: true });
  }

  list(): CompanionMediaFileV1[] {
    return fs.readdirSync(this.libraryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !/\.(?:part|download|cache)\.json$/.test(entry.name) && !entry.name.endsWith(".part"))
      .map((entry) => {
        const filePath = path.join(this.libraryPath, entry.name);
        const stat = fs.statSync(filePath);
        return { name: entry.name, bytes: stat.size, updatedAt: stat.mtime.toISOString(), cached: fs.existsSync(`${filePath}.cache.json`) };
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  has(inputName: string): boolean {
    const inputPath = path.resolve(this.libraryPath, safeCompanionMediaName(inputName));
    return within(this.libraryPath, inputPath) && fs.existsSync(inputPath);
  }

  resolve(inputName: string): string {
    const inputPath = path.resolve(this.libraryPath, safeCompanionMediaName(inputName));
    if (!within(this.libraryPath, inputPath) || !fs.existsSync(inputPath)) throw new Error("Media input is outside the library");
    return inputPath;
  }

  importFile(sourcePath: string): { name: string; bytes: number } {
    const source = path.resolve(sourcePath);
    const target = path.join(this.libraryPath, `${Date.now()}-${safeCompanionMediaName(source)}`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return { name: path.basename(target), bytes: fs.statSync(target).size };
  }

  writeJson(name: string, value: unknown): { name: string; bytes: number } {
    const fileName = safeCompanionMediaName(name);
    if (!fileName.endsWith(".json")) throw new Error("Manifest name must end in .json");
    const target = path.resolve(this.libraryPath, fileName);
    if (!within(this.libraryPath, target)) throw new Error("Manifest target is outside the library");
    writeJsonAtomic(target, value);
    return { name: fileName, bytes: fs.statSync(target).size };
  }

  hardware(): CompanionMediaHardwareV1 {
    return {
      ...this.hardwareInfo,
      configuredEngine: this.transcodeEngine,
      selectedEngine: chooseEngine(this.transcodeEngine, this.hardwareInfo),
    };
  }

  configure(input: { maxCacheBytes?: number; downloadsEnabled?: boolean; transcodeEngine?: CompanionTranscodeEngine } = {}): CompanionMediaCacheStatusV1 {
    if (input.maxCacheBytes !== undefined) this.maxCacheBytes = clampBytes(input.maxCacheBytes, this.maxCacheBytes);
    if (input.downloadsEnabled !== undefined) this.downloadsEnabled = input.downloadsEnabled;
    if (input.transcodeEngine !== undefined) this.transcodeEngine = normalizeTranscodeEngine(input.transcodeEngine);
    return this.cacheStatus();
  }

  cacheStatus(): CompanionMediaCacheStatusV1 {
    const entries: CompanionMediaCacheEntryV1[] = [];
    for (const name of fs.readdirSync(this.libraryPath)) {
      if (!name.endsWith(".cache.json")) continue;
      const metaPath = path.join(this.libraryPath, name);
      const meta = readJson(metaPath);
      const filePath = path.join(this.libraryPath, name.slice(0, -".cache.json".length));
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      const entry: CompanionMediaCacheEntryV1 = { name: path.basename(filePath), bytes: stat.size };
      if (typeof meta.url === "string") entry.url = meta.url;
      if (typeof meta.completedAt === "string") entry.completedAt = meta.completedAt;
      if (typeof meta.lastAccessedAt === "string") entry.lastAccessedAt = meta.lastAccessedAt;
      else if (entry.completedAt) entry.lastAccessedAt = entry.completedAt;
      entries.push(entry);
    }
    entries.sort((left, right) => String(right.lastAccessedAt ?? "").localeCompare(String(left.lastAccessedAt ?? "")));
    return {
      enabled: this.downloadsEnabled,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      budgetBytes: this.maxCacheBytes,
      entries,
      jobs: this.snapshot().filter((job) => job.type === "download"),
      hardware: this.hardware(),
    };
  }

  download(input: { url?: string; fileName?: string; expectedSha256?: string; maxBytes?: number } = {}): CompanionMediaJobV1 {
    if (!this.downloadsEnabled) throw new Error("Local relay downloads are disabled on this device");
    const parsed = new URL(String(input.url ?? ""));
    if (parsed.protocol !== "https:") throw new Error("Companion downloads require HTTPS");
    if (this.controllers.size >= 3) throw new Error("Companion download queue is full");

    const outputName = mediaFileNameFromUrl(parsed.toString(), input.fileName);
    const outputPath = path.join(this.libraryPath, outputName);
    const partPath = `${outputPath}.part`;
    const downloadMetaPath = `${outputPath}.download.json`;
    const cacheMetaPath = `${outputPath}.cache.json`;
    if (fs.existsSync(outputPath)) {
      if (!fs.existsSync(cacheMetaPath)) throw new Error("A non-cache media file already occupies the deterministic download target");
      const meta = readJson(cacheMetaPath);
      const lastAccessedAt = this.now();
      writeJsonAtomic(cacheMetaPath, { ...meta, url: parsed.toString(), lastAccessedAt });
      return { id: null, type: "download", outputName, status: "completed", cached: true, bytes: fs.statSync(outputPath).size };
    }

    const id = this.idFactory();
    const controller = new AbortController();
    const existingBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    const job: CompanionMediaJobV1 = {
      id,
      type: "download",
      outputName,
      status: "running",
      urlHost: parsed.hostname,
      startedAt: this.now(),
      bytes: existingBytes,
      resumed: existingBytes > 0,
    };
    this.jobs.set(id, job);
    this.controllers.set(id, controller);
    this.emit(job);
    const maxBytes = Math.max(1, Math.min(Number(input.maxBytes) || MAX_COMPANION_DOWNLOAD_BYTES, MAX_COMPANION_DOWNLOAD_BYTES, this.maxCacheBytes));
    void this.runDownload(job, {
      url: parsed.toString(),
      outputPath,
      partPath,
      downloadMetaPath,
      cacheMetaPath,
      expectedSha256: String(input.expectedSha256 ?? "").toLowerCase(),
      maxBytes,
      signal: controller.signal,
    });
    return structuredClone(job);
  }

  private async runDownload(job: CompanionMediaJobV1, options: { url: string; outputPath: string; partPath: string; downloadMetaPath: string; cacheMetaPath: string; expectedSha256: string; maxBytes: number; signal: AbortSignal }): Promise<void> {
    const existing = fs.existsSync(options.partPath) ? fs.statSync(options.partPath).size : 0;
    const headers = existing > 0 ? { Range: `bytes=${existing}-` } : undefined;
    let writer: fs.WriteStream | undefined;
    try {
      const requestInit: RequestInit = { redirect: "follow", signal: options.signal };
      if (headers) requestInit.headers = headers;
      const response = await this.fetchFn(options.url, requestInit);
      if (!response.ok || !response.body) throw new Error(`Download returned ${response.status}`);
      if (new URL(response.url || options.url).protocol !== "https:") throw new Error("Download redirected outside HTTPS");
      const append = existing > 0 && response.status === 206;
      const startingBytes = append ? existing : 0;
      const responseBytes = Number(response.headers.get("content-length") || 0);
      const totalBytes = response.status === 206 ? Number((response.headers.get("content-range") || "").split("/").at(-1) || 0) : responseBytes;
      if (totalBytes > options.maxBytes) throw new Error("Download exceeds the configured per-file limit");
      if (!append && fs.existsSync(options.partPath)) fs.truncateSync(options.partPath, 0);
      writeJsonAtomic(options.downloadMetaPath, { url: options.url, outputName: job.outputName, totalBytes, updatedAt: this.now() });
      writer = fs.createWriteStream(options.partPath, { flags: append ? "a" : "w" });
      job.bytes = startingBytes;
      job.totalBytes = totalBytes || null;
      let lastUpdateAt = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk);
        const currentBytes: number = job.bytes ?? 0;
        if (currentBytes + buffer.length > options.maxBytes) throw new Error("Download exceeded the configured per-file limit");
        if (!writer.write(buffer)) await waitForWritable(writer);
        job.bytes = currentBytes + buffer.length;
        if (Date.now() - lastUpdateAt >= 500) {
          lastUpdateAt = Date.now();
          this.emit(job);
        }
      }
      writer.end();
      await waitForFinish(writer);

      if (options.expectedSha256) {
        const digest = await sha256File(options.partPath);
        if (digest !== options.expectedSha256) throw new Error("Downloaded file checksum did not match");
      }
      fs.renameSync(options.partPath, options.outputPath);
      fs.rmSync(options.downloadMetaPath, { force: true });
      const completedAt = this.now();
      writeJsonAtomic(options.cacheMetaPath, { url: options.url, completedAt, lastAccessedAt: completedAt, bytes: job.bytes ?? 0 });
      job.status = "completed";
      job.finishedAt = completedAt;
      this.pruneDownloads(this.maxCacheBytes);
    } catch (error) {
      try { writer?.destroy(); } catch { /* no-op */ }
      const message = error instanceof Error ? error.message : String(error);
      if (/checksum did not match/i.test(message)) {
        fs.rmSync(options.partPath, { force: true });
        fs.rmSync(options.downloadMetaPath, { force: true });
      }
      job.status = options.signal.aborted ? "cancelled" : "failed";
      job.error = options.signal.aborted ? "Cancelled by local operator" : message;
      job.finishedAt = this.now();
    } finally {
      if (job.id) this.controllers.delete(job.id);
      this.emit(job);
    }
  }

  cancel(jobId: string): { id: string; cancelled: true } {
    const controller = this.controllers.get(String(jobId));
    if (!controller) throw new Error("Active media job was not found");
    controller.abort();
    return { id: String(jobId), cancelled: true };
  }

  pruneDownloads(targetBytes = Math.floor(this.maxCacheBytes * 0.8)): { bytes: number; removed: Array<{ name: string; bytes: number }>; budgetBytes: number } {
    const status = this.cacheStatus();
    const target = Math.max(0, Math.min(Number(targetBytes) || 0, this.maxCacheBytes));
    let bytes = status.bytes;
    const removed: Array<{ name: string; bytes: number }> = [];
    const oldest = [...status.entries].sort((left, right) => String(left.lastAccessedAt ?? "").localeCompare(String(right.lastAccessedAt ?? "")));
    for (const entry of oldest) {
      if (bytes <= target) break;
      const filePath = path.join(this.libraryPath, safeCompanionMediaName(entry.name));
      if (!within(this.libraryPath, filePath)) continue;
      fs.rmSync(filePath, { force: true });
      fs.rmSync(`${filePath}.cache.json`, { force: true });
      bytes -= entry.bytes;
      removed.push({ name: entry.name, bytes: entry.bytes });
    }
    return { bytes, removed, budgetBytes: this.maxCacheBytes };
  }

  transcode(inputName: string, preset: CompanionMediaPreset): CompanionMediaJobV1 {
    if (!(preset in COMPANION_MEDIA_PRESETS)) throw new Error("Unsupported media preset");
    const inputPath = this.resolve(inputName);
    const extension = preset === "audio-mp3" ? ".mp3" : preset === "gif" ? ".gif" : ".mp4";
    const outputName = `${path.parse(inputPath).name}-${preset}-${Date.now()}${extension}`;
    const outputPath = path.join(this.libraryPath, outputName);
    const id = this.idFactory();
    const engine = preset === "mp4-web" ? chooseEngine(this.transcodeEngine, this.hardwareInfo) : "cpu";
    const job: CompanionMediaJobV1 = { id, type: "transcode", inputName, outputName, preset, engine, status: "running", startedAt: this.now() };
    this.jobs.set(id, job);
    this.emit(job);
    this.spawnTranscode(job, inputPath, outputPath, engine, engine !== "cpu");
    return structuredClone(job);
  }

  private spawnTranscode(job: CompanionMediaJobV1, inputPath: string, outputPath: string, engine: Exclude<CompanionTranscodeEngine, "auto">, allowCpuFallback: boolean): void {
    if (!job.preset) throw new Error("Transcode preset is missing");
    const child = spawn(this.ffmpegPath, ["-y", "-i", inputPath, ...presetArgs(job.preset, engine), outputPath], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const detail = String(chunk).split(/\r?\n/).filter(Boolean).at(-1);
      if (detail) job.detail = detail;
      this.emit(job);
    });
    child.on("error", (error: Error) => {
      job.status = "failed";
      job.error = error.message;
      job.finishedAt = this.now();
      this.emit(job);
    });
    child.on("exit", (code: number | null) => {
      if (code !== 0 && allowCpuFallback) {
        job.detail = `${engine} encoder failed; retrying on CPU`;
        job.engine = "cpu-fallback";
        this.emit(job);
        this.spawnTranscode(job, inputPath, outputPath, "cpu", false);
        return;
      }
      job.status = code === 0 ? "completed" : "failed";
      if (code !== 0 && !job.error) job.error = `FFmpeg exited with ${String(code)}`;
      job.finishedAt = this.now();
      this.emit(job);
    });
  }

  snapshot(): CompanionMediaJobV1[] {
    return Array.from(this.jobs.values()).slice(-100).map((job) => structuredClone(job));
  }

  private emit(job: CompanionMediaJobV1): void {
    this.onUpdate(structuredClone(job));
  }
}
