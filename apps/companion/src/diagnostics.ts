import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SECRET_KEY = /(?:authorization|password|secret|token|api[_-]?key|cookie)/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const QUERY_SECRET_PATTERN = /([?&](?:access_token|refresh_token|id_token|token|api_key|apikey|key|signature|jwt)=)[^&\s"'<>]+/gi;
const BEARER_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi;
const HEADER_SECRET_PATTERN = /(\b(?:authorization|x-api-key|api-key)\s*[:=]\s*)([^\s,;}\]]{8,})/gi;
const JSON_SECRET_PATTERN = /(["']?(?:access_token|refresh_token|id_token|api_key|apikey|client_secret|password|authorization)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi;
const PLAIN_SECRET_PATTERN = /(\b(?:access_token|refresh_token|id_token|api[_-]?key|apikey|client_secret|password|token|secret|authorization)\b\s*[:=]\s*)([^\s,;}\]]{4,})/gi;

export interface CompanionFlySnapshotV1 {
  schemaVersion: 1;
  snapshotId: string;
  source: "fly-machine-rotator";
  mode: "debug" | "verbose";
  capturedAt: string;
  states: Record<string, unknown>;
  logs: unknown[];
}

export function redactCompanionText(value: unknown): string {
  return String(value ?? "")
    .replace(QUERY_SECRET_PATTERN, "$1[REDACTED]")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(HEADER_SECRET_PATTERN, "$1[REDACTED]")
    .replace(JSON_SECRET_PATTERN, "$1[REDACTED]$3")
    .replace(PLAIN_SECRET_PATTERN, "$1[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]");
}

export function sanitizeCompanionValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[TRUNCATED]";
  if (typeof value === "string") return redactCompanionText(value).slice(0, 8_000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(-500).map((item) => sanitizeCompanionValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 500).map(([key, item]) => [
      key.slice(0, 120),
      SECRET_KEY.test(key) ? "[REDACTED]" : sanitizeCompanionValue(item, depth + 1),
    ]));
  }
  return redactCompanionText(value);
}

export class CompanionDiagnosticsStore {
  readonly directory: string;
  constructor(private readonly options: { rootPath: string; maxSnapshots?: number; maxLogDays?: number; maxSnapshotBytes?: number; now?: () => string }) {
    this.directory = join(options.rootPath, "diagnostics");
    mkdirSync(this.directory, { recursive: true });
  }

  log(message: string, error?: unknown) {
    const now = this.now();
    const detail = error instanceof Error ? error.stack || error.message : error == null ? "" : String(error);
    const line = `[${now}] ${redactCompanionText(message)}${detail ? `: ${redactCompanionText(detail)}` : ""}\n`;
    appendFileSync(join(this.directory, `companion-${now.slice(0, 10)}.log`), line, "utf8");
    this.prune("companion-", ".log", this.options.maxLogDays ?? 30);
  }

  writeSnapshot(input: Partial<CompanionFlySnapshotV1> & { states?: Record<string, unknown>; logs?: unknown[] }) {
    const capturedAt = normalizeTimestamp(input.capturedAt, this.now());
    const snapshot = sanitizeCompanionValue({
      schemaVersion: 1,
      snapshotId: String(input.snapshotId ?? "").slice(0, 120),
      source: "fly-machine-rotator",
      mode: input.mode === "debug" ? "debug" : "verbose",
      capturedAt,
      states: input.states && typeof input.states === "object" ? input.states : {},
      logs: Array.isArray(input.logs) ? input.logs.slice(-500) : [],
    }) as CompanionFlySnapshotV1;

    let serialized = JSON.stringify(snapshot, null, 2);
    const maxBytes = this.options.maxSnapshotBytes ?? 400_000;
    while (Buffer.byteLength(serialized, "utf8") > maxBytes && snapshot.logs.length > 1) {
      snapshot.logs = snapshot.logs.slice(Math.ceil(snapshot.logs.length / 4));
      serialized = JSON.stringify(snapshot, null, 2);
    }
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw new Error("Sanitized diagnostics snapshot is too large");

    const suffix = String(snapshot.snapshotId || safeTimestamp(snapshot.capturedAt)).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "snapshot";
    const filename = `fly-snapshot-${safeTimestamp(snapshot.capturedAt)}-${suffix}.json`;
    const destination = join(this.directory, filename);
    const temporary = `${destination}.tmp`;
    writeFileSync(temporary, `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, destination);
    writeFileSync(join(this.directory, "latest-fly-snapshot.json"), `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
    this.prune("fly-snapshot-", ".json", this.options.maxSnapshots ?? 30);
    return { filename, path: destination, bytes: Buffer.byteLength(serialized, "utf8"), logCount: snapshot.logs.length, capturedAt: snapshot.capturedAt };
  }

  snapshot() {
    const latestPath = join(this.directory, "latest-fly-snapshot.json");
    if (!existsSync(latestPath)) return { directory: this.directory, latest: null as null | { capturedAt: string | null; logCount: number } };
    try {
      const parsed = JSON.parse(readFileSync(latestPath, "utf8")) as Partial<CompanionFlySnapshotV1>;
      return { directory: this.directory, latest: { capturedAt: parsed.capturedAt ?? null, logCount: Array.isArray(parsed.logs) ? parsed.logs.length : 0 } };
    } catch {
      return { directory: this.directory, latest: null };
    }
  }

  private now() { return normalizeTimestamp(this.options.now?.(), new Date().toISOString()); }
  private prune(prefix: string, suffix: string, keep: number) {
    try {
      const files = readdirSync(this.directory)
        .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
        .map((name) => ({ name, mtime: statSync(join(this.directory, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const file of files.slice(Math.max(0, keep))) unlinkSync(join(this.directory, file.name));
    } catch { /* diagnostics cleanup must never interrupt Companion */ }
  }
}

function normalizeTimestamp(value: string | undefined, fallback: string) { const parsed = Date.parse(String(value ?? "")); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(Date.parse(fallback)).toISOString(); }
function safeTimestamp(value: string) { return new Date(value).toISOString().replace(/[:.]/g, "-"); }
