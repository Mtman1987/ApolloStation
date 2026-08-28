import { DatabaseSync } from "node:sqlite";
import { NEBULA_ARCADE_GAMES } from "./game-hub.js";
import { canonicalNebulaGameId, migrateLegacyNebulaArcadeStorage } from "./legacy-nebula-migration.js";
import type { NebulaOverlayLayerV1 } from "./overlay-scenes.js";

export type NebulaGameMixModeV1 = "simultaneous" | "activity" | "rotate" | "manual";
export type NebulaGameMixStyleV1 = "full" | "compact" | "minimal";

export interface NebulaGameMixLayerV1 {
  gameId: string;
  enabled: boolean;
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  style: NebulaGameMixStyleV1;
}

export interface NebulaGameMixV1 {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  name: string;
  mode: NebulaGameMixModeV1;
  rotationSeconds: number;
  activeGameId?: string;
  layers: NebulaGameMixLayerV1[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveNebulaGameMixV1 {
  id: string;
  name: string;
  mode?: NebulaGameMixModeV1;
  rotationSeconds?: number;
  activeGameId?: string;
  layers: Array<Partial<Omit<NebulaGameMixLayerV1, "gameId">> & Pick<NebulaGameMixLayerV1, "gameId">>;
}

const GAME_IDS = new Set(NEBULA_ARCADE_GAMES.map((game) => game.id));
const MODES = new Set<NebulaGameMixModeV1>(["simultaneous", "activity", "rotate", "manual"]);
const STYLES = new Set<NebulaGameMixStyleV1>(["full", "compact", "minimal"]);

/**
 * A Nebula Game Mix is an app-owned source configuration edited from SpaceMountain Overlay Bay.
 * OBS/browser-source identity is deliberately based only on the mix id, so changing games,
 * layout, style, or switching behavior never requires replacing the browser-source URL.
 */
export function nebulaGameMixSourceWidgetId(mixId: string): string {
  requireId(mixId, "mixId");
  return `game-mix:${mixId}`;
}

export function parseNebulaGameMixSourceWidgetId(widgetId: string): string | undefined {
  if (!widgetId.startsWith("game-mix:")) return undefined;
  const mixId = widgetId.slice("game-mix:".length);
  try { requireId(mixId, "mixId"); return mixId; } catch { return undefined; }
}

export function nebulaGameMixToLegacyScene(input: NebulaGameMixV1): { id: string; name: string; layers: NebulaOverlayLayerV1[] } {
  return {
    id: input.id,
    name: input.name,
    layers: input.layers.map((layer) => ({ gameId: layer.gameId, enabled: layer.enabled, zIndex: layer.zIndex })),
  };
}

export class SqliteNebulaGameMixStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (!path) throw new Error("Nebula game mix database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    migrateLegacyNebulaArcadeStorage(this.db);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nebula_game_mixes (
        tenant_id TEXT NOT NULL,
        mix_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        rotation_seconds INTEGER NOT NULL,
        active_game_id TEXT,
        layers TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, mix_id)
      );
    `);
  }

  close(): void { this.db.close(); }

  list(tenantId: string): NebulaGameMixV1[] {
    requireId(tenantId, "tenantId");
    const rows = this.db.prepare(`
      SELECT tenant_id, mix_id, name, mode, rotation_seconds, active_game_id, layers, created_at, updated_at
      FROM nebula_game_mixes
      WHERE tenant_id=?
      ORDER BY updated_at DESC, mix_id
    `).all(tenantId) as unknown as GameMixRow[];
    return rows.map(fromRow);
  }

  get(tenantId: string, mixId: string): NebulaGameMixV1 | undefined {
    requireId(tenantId, "tenantId");
    requireId(mixId, "mixId");
    const row = this.db.prepare(`
      SELECT tenant_id, mix_id, name, mode, rotation_seconds, active_game_id, layers, created_at, updated_at
      FROM nebula_game_mixes
      WHERE tenant_id=? AND mix_id=?
    `).get(tenantId, mixId) as unknown as GameMixRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  save(tenantId: string, input: SaveNebulaGameMixV1, now = new Date().toISOString()): NebulaGameMixV1 {
    requireId(tenantId, "tenantId");
    requireId(input.id, "mixId");
    const name = input.name.trim();
    if (!name || name.length > 100) throw new Error("Nebula game mix name is invalid");
    if (!Number.isFinite(Date.parse(now))) throw new Error("Nebula game mix timestamp is invalid");

    const mode = input.mode ?? "simultaneous";
    if (!MODES.has(mode)) throw new Error("Nebula game mix mode is invalid");
    const rotationSeconds = normalizeInteger(input.rotationSeconds ?? 20, 5, 300, "rotationSeconds");
    const layers = normalizeLayers(input.layers, false);
    const activeGameId = input.activeGameId?.trim() || undefined;
    if (activeGameId && !GAME_IDS.has(activeGameId)) throw new Error("Nebula game mix active game is invalid");
    if (mode === "manual" && activeGameId && !layers.some((layer) => layer.gameId === activeGameId && layer.enabled)) throw new Error("Nebula manual active game must be enabled in the mix");

    const prior = this.db.prepare("SELECT created_at FROM nebula_game_mixes WHERE tenant_id=? AND mix_id=?").get(tenantId, input.id) as unknown as { created_at: string } | undefined;
    const createdAt = prior?.created_at ?? now;
    this.db.prepare(`
      INSERT INTO nebula_game_mixes(tenant_id, mix_id, name, mode, rotation_seconds, active_game_id, layers, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id, mix_id) DO UPDATE SET
        name=excluded.name,
        mode=excluded.mode,
        rotation_seconds=excluded.rotation_seconds,
        active_game_id=excluded.active_game_id,
        layers=excluded.layers,
        updated_at=excluded.updated_at
    `).run(tenantId, input.id, name, mode, rotationSeconds, activeGameId ?? null, JSON.stringify(layers), createdAt, now);

    return { schemaVersion: 1, id: input.id, tenantId, name, mode, rotationSeconds, ...(activeGameId ? { activeGameId } : {}), layers, createdAt, updatedAt: now };
  }

  delete(tenantId: string, mixId: string): boolean {
    requireId(tenantId, "tenantId");
    requireId(mixId, "mixId");
    return Number(this.db.prepare("DELETE FROM nebula_game_mixes WHERE tenant_id=? AND mix_id=?").run(tenantId, mixId).changes) > 0;
  }
}

interface GameMixRow {
  tenant_id: string;
  mix_id: string;
  name: string;
  mode: string;
  rotation_seconds: number;
  active_game_id: string | null;
  layers: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: GameMixRow): NebulaGameMixV1 {
  const mode = row.mode as NebulaGameMixModeV1;
  if (!MODES.has(mode)) throw new Error("Stored Nebula game mix mode is invalid");
  const layers = normalizeLayers(JSON.parse(row.layers) as SaveNebulaGameMixV1["layers"], true);
  const activeGameId = row.active_game_id ? canonicalNebulaGameId(row.active_game_id) : undefined;
  if (activeGameId && !GAME_IDS.has(activeGameId)) throw new Error("Stored Nebula active game is invalid");
  return {
    schemaVersion: 1,
    id: row.mix_id,
    tenantId: row.tenant_id,
    name: row.name,
    mode,
    rotationSeconds: normalizeInteger(row.rotation_seconds, 5, 300, "rotationSeconds"),
    ...(activeGameId ? { activeGameId } : {}),
    layers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLayers(value: SaveNebulaGameMixV1["layers"], stored: boolean): NebulaGameMixLayerV1[] {
  if (!Array.isArray(value) || value.length > NEBULA_ARCADE_GAMES.length) throw new Error("Nebula game mix layers are invalid");
  const seen = new Set<string>();
  return value.map((layer, index) => {
    const gameId = stored ? canonicalNebulaGameId(layer?.gameId) : String(layer?.gameId ?? "").trim().toLowerCase();
    if (!layer || typeof layer !== "object" || !GAME_IDS.has(gameId) || seen.has(gameId)) throw new Error("Nebula game mix contains an invalid game layer");
    seen.add(gameId);
    const style = layer.style ?? "full";
    if (!STYLES.has(style)) throw new Error("Nebula game mix layer style is invalid");
    return {
      gameId,
      enabled: layer.enabled !== false,
      zIndex: Number.isSafeInteger(layer.zIndex) ? Number(layer.zIndex) : index,
      x: normalizeNumber(layer.x ?? 0, 0, 100, "x"),
      y: normalizeNumber(layer.y ?? 0, 0, 100, "y"),
      width: normalizeNumber(layer.width ?? 100, 1, 100, "width"),
      height: normalizeNumber(layer.height ?? 100, 1, 100, "height"),
      opacity: normalizeNumber(layer.opacity ?? 1, 0, 1, "opacity"),
      style,
    };
  }).sort((left, right) => left.zIndex - right.zIndex).map((layer, index) => ({ ...layer, zIndex: index }));
}

function normalizeNumber(value: number, min: number, max: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Nebula game mix ${name} is invalid`);
  return value;
}

function normalizeInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Nebula game mix ${name} is invalid`);
  return value;
}

function requireId(value: string, name: string): void {
  if (!value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`);
}
