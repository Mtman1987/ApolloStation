import { DatabaseSync } from "node:sqlite";
import { NEBULA_ARCADE_GAMES } from "./game-hub.js";

export interface NebulaOverlayLayerV1 {
  gameId: string;
  enabled: boolean;
  zIndex: number;
}

export interface NebulaOverlaySceneV1 {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  name: string;
  layers: NebulaOverlayLayerV1[];
  createdAt: string;
  updatedAt: string;
}

const GAME_IDS = new Set(NEBULA_ARCADE_GAMES.map((game) => game.id));

export class SqliteNebulaOverlaySceneStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (!path) throw new Error("Nebula overlay database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nebula_overlay_scenes (
        tenant_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        name TEXT NOT NULL,
        layers TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, scene_id)
      );
    `);
  }

  close(): void { this.db.close(); }

  list(tenantId: string): NebulaOverlaySceneV1[] {
    requireId(tenantId, "tenantId");
    const rows = this.db.prepare(`
      SELECT tenant_id, scene_id, name, layers, created_at, updated_at
      FROM nebula_overlay_scenes
      WHERE tenant_id=?
      ORDER BY updated_at DESC, scene_id
    `).all(tenantId) as SceneRow[];
    return rows.map(fromRow);
  }

  get(tenantId: string, sceneId: string): NebulaOverlaySceneV1 | undefined {
    requireId(tenantId, "tenantId");
    requireId(sceneId, "sceneId");
    const row = this.db.prepare(`
      SELECT tenant_id, scene_id, name, layers, created_at, updated_at
      FROM nebula_overlay_scenes
      WHERE tenant_id=? AND scene_id=?
    `).get(tenantId, sceneId) as SceneRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  save(tenantId: string, input: { id: string; name: string; layers: NebulaOverlayLayerV1[] }, now = new Date().toISOString()): NebulaOverlaySceneV1 {
    requireId(tenantId, "tenantId");
    requireId(input.id, "sceneId");
    const name = input.name.trim();
    if (!name || name.length > 100) throw new Error("Overlay scene name is invalid");
    if (!Number.isFinite(Date.parse(now))) throw new Error("Overlay scene timestamp is invalid");
    const layers = normalizeLayers(input.layers);
    const prior = this.db.prepare("SELECT created_at FROM nebula_overlay_scenes WHERE tenant_id=? AND scene_id=?").get(tenantId, input.id) as { created_at: string } | undefined;
    const createdAt = prior?.created_at ?? now;
    this.db.prepare(`
      INSERT INTO nebula_overlay_scenes(tenant_id, scene_id, name, layers, created_at, updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(tenant_id, scene_id) DO UPDATE SET
        name=excluded.name,
        layers=excluded.layers,
        updated_at=excluded.updated_at
    `).run(tenantId, input.id, name, JSON.stringify(layers), createdAt, now);
    return { schemaVersion: 1, id: input.id, tenantId, name, layers, createdAt, updatedAt: now };
  }

  delete(tenantId: string, sceneId: string): boolean {
    requireId(tenantId, "tenantId");
    requireId(sceneId, "sceneId");
    return Number(this.db.prepare("DELETE FROM nebula_overlay_scenes WHERE tenant_id=? AND scene_id=?").run(tenantId, sceneId).changes) > 0;
  }
}

interface SceneRow {
  tenant_id: string;
  scene_id: string;
  name: string;
  layers: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: SceneRow): NebulaOverlaySceneV1 {
  return {
    schemaVersion: 1,
    id: row.scene_id,
    tenantId: row.tenant_id,
    name: row.name,
    layers: normalizeLayers(JSON.parse(row.layers) as NebulaOverlayLayerV1[]),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLayers(value: NebulaOverlayLayerV1[]): NebulaOverlayLayerV1[] {
  if (!Array.isArray(value) || value.length > NEBULA_ARCADE_GAMES.length) throw new Error("Overlay scene layers are invalid");
  const seen = new Set<string>();
  return value.map((layer, index) => {
    if (!layer || typeof layer !== "object" || !GAME_IDS.has(layer.gameId) || seen.has(layer.gameId)) throw new Error("Overlay scene contains an invalid game layer");
    seen.add(layer.gameId);
    return { gameId: layer.gameId, enabled: layer.enabled !== false, zIndex: Number.isSafeInteger(layer.zIndex) ? layer.zIndex : index };
  }).sort((left, right) => left.zIndex - right.zIndex).map((layer, index) => ({ ...layer, zIndex: index }));
}

function requireId(value: string, name: string): void {
  if (!value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`);
}
