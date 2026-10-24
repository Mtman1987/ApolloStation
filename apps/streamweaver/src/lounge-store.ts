import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Small atomic JSON file store for Lounge state (replaces the donor's tenant storage helper). */
export function loungeDataPath(tenantId: string, file: string) { return join(process.env.STREAMWEAVER_DATA_DIR || "data", tenantId.replace(/[^a-z0-9_-]/gi, "_"), file); }
export function readLoungeJson<T>(path: string, fallback: T): T { try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : fallback; } catch { return fallback; } }
export function writeLoungeJson(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, path); }
