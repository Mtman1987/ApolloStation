import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";
import { MOSAIC_CELL_COUNT, MOSAIC_COLORS, createMosaicQueueState, validateMosaicTemplate, type MosaicArtwork, type MosaicQueueRequest, type MosaicQueueState } from "./mosaic-core.js";

function cleanKey(value: unknown, name: string): string {
  const key = String(value ?? "").trim().replace(/^#/, "").toLowerCase();
  if (!key || key.length > 180 || /[\u0000-\u001f]/.test(key)) throw new Error(`Mosaic ${name} is invalid`);
  return key;
}
function normalizeArtwork(value: unknown): MosaicArtwork | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.target) || item.target.length !== MOSAIC_CELL_COUNT || !item.target.every((code) => typeof code === "string" && Object.hasOwn(MOSAIC_COLORS, code))) return undefined;
  const painted = Array.isArray(item.painted) ? item.painted.slice(0, MOSAIC_CELL_COUNT).map((cell) => String(cell || "")) : [];
  const paintedBy = Array.isArray(item.paintedBy) ? item.paintedBy.slice(0, MOSAIC_CELL_COUNT).map((id) => String(id || "")) : [];
  while (painted.length < MOSAIC_CELL_COUNT) painted.push("");
  while (paintedBy.length < MOSAIC_CELL_COUNT) paintedBy.push("");
  const status = ["active", "suspended", "completed", "archived"].includes(String(item.status)) ? item.status as MosaicArtwork["status"] : "suspended";
  const activeBoard = [1, 2, 3, 4].includes(Number(item.activeBoard)) ? Number(item.activeBoard) as MosaicArtwork["activeBoard"] : 1;
  const viewMode = item.viewMode === "all" ? "all" : "board";
  return {
    id: String(item.id || "mosaic:recovered"), theme: String(item.theme || "Recovered Mosaic"), requestedBy: String(item.requestedBy || "unknown"),
    requestedByPlayerId: String(item.requestedByPlayerId || ""), createdAt: String(item.createdAt || new Date(0).toISOString()),
    updatedAt: String(item.updatedAt || new Date(0).toISOString()), lastInteractionAt: String(item.lastInteractionAt || item.updatedAt || new Date(0).toISOString()),
    status, target: item.target as MosaicArtwork["target"], painted, paintedBy, activeBoard, viewMode,
    awardedMilestones: Array.isArray(item.awardedMilestones) ? item.awardedMilestones.map(String) : [],
    ...(typeof item.provider === "string" ? { provider: item.provider } : {}),
    ...(typeof item.sourceImageUrl === "string" ? { sourceImageUrl: item.sourceImageUrl } : {}),
    ...(typeof item.revealUntil === "string" ? { revealUntil: item.revealUntil } : {}),
    ...(typeof item.viewUntil === "string" ? { viewUntil: item.viewUntil } : {}),
    ...(typeof item.paletteId === "string" ? { paletteId: item.paletteId as MosaicArtwork["paletteId"] } : {}),
  };
}
export function normalizeMosaicQueueState(value: unknown): MosaicQueueState {
  const state = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const queue = Array.isArray(state.queue) ? state.queue.filter((item): item is MosaicQueueRequest => Boolean(item && typeof item === "object" && typeof (item as MosaicQueueRequest).id === "string" && typeof (item as MosaicQueueRequest).theme === "string" && ["pending", "generating", "failed", "cancelled"].includes((item as MosaicQueueRequest).status)).slice(-20) : [];
  const saves = Array.isArray(state.saves) ? state.saves.map(normalizeArtwork).filter((art): art is MosaicArtwork => Boolean(art)).slice(0, 20) : [];
  const current = normalizeArtwork(state.current);
  const sharedProjects = Array.isArray(state.sharedProjects) ? state.sharedProjects.filter((item) => item && typeof item === "object").flatMap((item) => {
    const project = item as Record<string, unknown>;
    try {
      const template = validateMosaicTemplate(project.template);
      if (typeof project.id !== "string" || typeof project.artworkId !== "string") return [];
      return [{ id: project.id, artworkId: project.artworkId, publishedAt: String(project.publishedAt || new Date(0).toISOString()), template: { format: "nebula-mosaic" as const, version: 1 as const, width: 40 as const, height: 50 as const, ...template } }];
    } catch { return []; }
  }).slice(0, 20) : [];
  return { ...(current ? { current } : {}), queue, saves, sharedProjects };
}

/** SQLite-backed Mosaic state, keyed by tenant and canonical chat channel. */
export class SqliteNebulaMosaicStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path || !isAbsolute(path)) throw new Error("Nebula Mosaic database path must be absolute");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS nebula_mosaic_state (
        tenant_id TEXT NOT NULL, channel TEXT NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, channel)
      ) STRICT;`);
  }
  close() { this.db.close(); }
  get(tenantValue: unknown, channelValue: unknown): MosaicQueueState {
    const tenantId = cleanKey(tenantValue, "tenant id");
    const channel = cleanKey(channelValue, "channel");
    const row = this.db.prepare("SELECT state_json FROM nebula_mosaic_state WHERE tenant_id=? AND channel=?").get(tenantId, channel) as { state_json?: string } | undefined;
    if (!row?.state_json) return createMosaicQueueState();
    try { return normalizeMosaicQueueState(JSON.parse(row.state_json)); }
    catch { return createMosaicQueueState(); }
  }
  update<T>(tenantValue: unknown, channelValue: unknown, mutate: (state: MosaicQueueState) => T, now = Date.now()): { state: MosaicQueueState; result: T } {
    const tenantId = cleanKey(tenantValue, "tenant id");
    const channel = cleanKey(channelValue, "channel");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT state_json FROM nebula_mosaic_state WHERE tenant_id=? AND channel=?").get(tenantId, channel) as { state_json?: string } | undefined;
      let state = createMosaicQueueState();
      if (row?.state_json) { try { state = normalizeMosaicQueueState(JSON.parse(row.state_json)); } catch { state = createMosaicQueueState(); } }
      const result = mutate(state);
      state = normalizeMosaicQueueState(state);
      this.db.prepare(`INSERT INTO nebula_mosaic_state(tenant_id,channel,state_json,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(tenant_id,channel) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`)
        .run(tenantId, channel, JSON.stringify(state), new Date(now).toISOString());
      this.db.exec("COMMIT");
      return { state, result };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
