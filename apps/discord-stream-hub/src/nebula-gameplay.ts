import { DatabaseSync } from "node:sqlite";
import {
  NEBULA_GAMEPLAY_CAPTURE_SECONDS,
  NEBULA_GAMEPLAY_FPS,
  NEBULA_GAMEPLAY_HEIGHT,
  NEBULA_GAMEPLAY_ROTATION_SECONDS,
  NEBULA_GAMEPLAY_WIDTH,
  type NebulaGameplayManifestGameV1,
  type NebulaGameplayManifestV1,
} from "@spmt/nebula-arcade";

export const DSH_NEBULA_GAMEPLAY_BATCH_SIZE = 2;
export const DSH_NEBULA_GAMEPLAY_MAX_BYTES = 96 * 1_024 * 1_024;

export interface DshNebulaGameplayItemV1 extends NebulaGameplayManifestGameV1 {
  schemaVersion: 1;
  capturedAt: string;
  gif: Uint8Array;
}

export interface DshNebulaGameplayCaptureRequestV1 extends NebulaGameplayManifestGameV1 {
  width: number;
  height: number;
  fps: number;
  outputWidth: 480;
  palette: { maxColors: 128; statsMode: "diff"; dither: "bayer"; bayerScale: 4; diffMode: "rectangle" };
}

export interface DshNebulaGameplayRendererV1 { capture(request: DshNebulaGameplayCaptureRequestV1): Promise<Uint8Array>; }

export class SqliteDshNebulaGameplayStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("DSH Nebula gameplay database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dsh_nebula_gameplay(game_id TEXT PRIMARY KEY,game_order INTEGER NOT NULL,revision TEXT NOT NULL,captured_at TEXT NOT NULL,metadata TEXT NOT NULL,gif BLOB NOT NULL) STRICT;");
  }
  close() { this.db.close(); }
  put(value: DshNebulaGameplayItemV1): DshNebulaGameplayItemV1 {
    const checked = validateItem(value);
    const metadata = JSON.stringify({ ...checked, gif: undefined });
    this.db.prepare("INSERT INTO dsh_nebula_gameplay(game_id,game_order,revision,captured_at,metadata,gif) VALUES(?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET game_order=excluded.game_order,revision=excluded.revision,captured_at=excluded.captured_at,metadata=excluded.metadata,gif=excluded.gif").run(checked.id, checked.order, checked.revision, checked.capturedAt, metadata, checked.gif);
    return checked;
  }
  list(): DshNebulaGameplayItemV1[] {
    return (this.db.prepare("SELECT metadata,gif FROM dsh_nebula_gameplay ORDER BY game_order,game_id").all() as Array<{ metadata: string; gif: Uint8Array }>).map((row) => ({ ...JSON.parse(row.metadata), gif: Uint8Array.from(row.gif) }) as DshNebulaGameplayItemV1);
  }
  needed(manifest: NebulaGameplayManifestV1, limit = DSH_NEBULA_GAMEPLAY_BATCH_SIZE): NebulaGameplayManifestGameV1[] {
    const checked = validateManifest(manifest);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > DSH_NEBULA_GAMEPLAY_BATCH_SIZE) throw new Error("Nebula gameplay batch limit is invalid");
    const current = new Map(this.list().map((item) => [item.id, item.revision]));
    return checked.games.filter((game) => current.get(game.id) !== game.revision).slice(0, limit);
  }
  select(now = Date.now()): DshNebulaGameplayItemV1 | undefined {
    const items = this.list();
    return items.length ? items[Math.floor(now / (NEBULA_GAMEPLAY_ROTATION_SECONDS * 1_000)) % items.length] : undefined;
  }
}

export class DshNebulaGameplayCaptureService {
  constructor(private readonly store: SqliteDshNebulaGameplayStore, private readonly renderer: DshNebulaGameplayRendererV1, private readonly now: () => string = () => new Date().toISOString()) {}
  async reconcile(manifestValue: NebulaGameplayManifestV1) {
    const manifest = validateManifest(manifestValue);
    const needed = this.store.needed(manifest);
    const completed: string[] = [], failed: Array<{ id: string; error: string }> = [];
    for (const game of needed) {
      try {
        const gif = await this.renderer.capture(captureRequest(game));
        this.store.put({ schemaVersion: 1, ...game, capturedAt: this.now(), gif });
        completed.push(game.id);
      } catch (error) { failed.push({ id: game.id, error: safeError(error) }); }
    }
    return { schemaVersion: 1 as const, totalGames: manifest.games.length, readyGames: this.store.list().length, attempted: needed.length, completed, failed };
  }
}

export class DshNebulaGameplayHttpAdapter {
  constructor(private readonly store: SqliteDshNebulaGameplayStore, private readonly fallbackImageUrl: string, private readonly now: () => number = () => Date.now()) { credentialFreeHttps(fallbackImageUrl, "fallbackImageUrl"); }
  handle(input: { method: string; path: string; slot?: string | null }): { status: number; headers: Record<string, string>; body?: Uint8Array | string } {
    if (input.method !== "GET") return { status: 405, headers: { allow: "GET", "cache-control": "no-store" } };
    const at = slotTime(input.slot, this.now());
    const active = this.store.select(at);
    if (input.path.endsWith("/current.gif")) {
      if (!active) return { status: 307, headers: { location: this.fallbackImageUrl, "cache-control": "no-store, max-age=0" } };
      return { status: 200, headers: { "content-type": "image/gif", "content-length": String(active.gif.byteLength), "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" }, body: active.gif };
    }
    if (input.path.endsWith("/gameplay")) {
      const slot = Math.floor(at / (NEBULA_GAMEPLAY_ROTATION_SECONDS * 1_000));
      return { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify({ schemaVersion: 1, slot, rotationSeconds: NEBULA_GAMEPLAY_ROTATION_SECONDS, active: active ? withoutGif(active) : null, availableGames: this.store.list().length, fallbackImageUrl: this.fallbackImageUrl, nextChangeAt: new Date((slot + 1) * NEBULA_GAMEPLAY_ROTATION_SECONDS * 1_000).toISOString() }) };
    }
    return { status: 404, headers: { "cache-control": "no-store" } };
  }
}

export function nebulaGameplayEmbedImageUrl(publicOrigin: string, now = Date.now()): string {
  const origin = credentialFreeOrigin(publicOrigin, "Nebula gameplay origin");
  const url = new URL("/v1/discord-stream-hub/nebula-gameplay/current.gif", origin);
  url.searchParams.set("slot", String(Math.floor(now / (NEBULA_GAMEPLAY_ROTATION_SECONDS * 1_000))));
  return url.toString();
}

function captureRequest(game: NebulaGameplayManifestGameV1): DshNebulaGameplayCaptureRequestV1 {
  return { ...game, width: NEBULA_GAMEPLAY_WIDTH, height: NEBULA_GAMEPLAY_HEIGHT, fps: NEBULA_GAMEPLAY_FPS, outputWidth: 480, palette: { maxColors: 128, statsMode: "diff", dither: "bayer", bayerScale: 4, diffMode: "rectangle" } };
}
function validateManifest(value: NebulaGameplayManifestV1): NebulaGameplayManifestV1 {
  if (value.schemaVersion !== 1 || value.captureSeconds !== NEBULA_GAMEPLAY_CAPTURE_SECONDS || value.rotationSeconds !== NEBULA_GAMEPLAY_ROTATION_SECONDS || value.width !== NEBULA_GAMEPLAY_WIDTH || value.height !== NEBULA_GAMEPLAY_HEIGHT || value.fps !== NEBULA_GAMEPLAY_FPS || value.games.length !== 20) throw new Error("Nebula gameplay manifest contract is invalid");
  const origin = credentialFreeOrigin(value.publicOrigin, "manifest publicOrigin"); credentialFreeHttps(value.fallbackImageUrl, "fallbackImageUrl");
  const ids = new Set<string>();
  for (const game of value.games) { const checked = validateGame(game); if (ids.has(checked.id)) throw new Error("Nebula gameplay manifest has a duplicate game"); ids.add(checked.id); if (new URL(checked.captureUrl).origin !== origin.origin) throw new Error("Nebula gameplay capture URL must stay on the manifest origin"); }
  return value;
}
function validateItem(value: DshNebulaGameplayItemV1): DshNebulaGameplayItemV1 { if (value.schemaVersion !== 1) throw new Error("Nebula gameplay item schemaVersion is invalid"); const game = validateGame(value), gif = Uint8Array.from(value.gif); if (gif.byteLength < 6 || gif.byteLength > DSH_NEBULA_GAMEPLAY_MAX_BYTES || new TextDecoder().decode(gif.subarray(0, 6)) !== "GIF89a") throw new Error("Nebula gameplay GIF bytes are invalid"); return { schemaVersion: 1, ...game, capturedAt: iso(value.capturedAt), gif }; }
function validateGame(value: NebulaGameplayManifestGameV1): NebulaGameplayManifestGameV1 { const id = String(value.id ?? "").trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error("Nebula gameplay id is invalid"); const name = label(value.name, "name", 100), revision = label(value.revision, "revision", 100); if (!Number.isSafeInteger(value.order) || value.order < 0 || value.order > 100 || value.captureSeconds !== NEBULA_GAMEPLAY_CAPTURE_SECONDS) throw new Error("Nebula gameplay ordering or duration is invalid"); return { id, name, order: value.order, revision, captureSeconds: value.captureSeconds, captureUrl: credentialFreeHttps(value.captureUrl, "captureUrl") }; }
function withoutGif(value: DshNebulaGameplayItemV1) { const { gif: _gif, ...metadata } = value; return metadata; }
function slotTime(value: string | null | undefined, fallback: number) { if (value === null || value === undefined || value.trim() === "") return fallback; const slot = Number(value); return Number.isSafeInteger(slot) && slot >= 0 ? slot * NEBULA_GAMEPLAY_ROTATION_SECONDS * 1_000 : fallback; }
function safeError(value: unknown) { return (value instanceof Error ? value.message : String(value)).replace(/\b(?:Bearer|token|secret|password)\s*[:=]?\s*\S+/gi, "[REDACTED]").slice(0, 300); }
function iso(value: string) { if (!Number.isFinite(Date.parse(value))) throw new Error("Nebula gameplay timestamp is invalid"); return new Date(value).toISOString(); }
function label(value: string, name: string, max: number) { const result = String(value ?? "").trim(); if (!result || result.length > max || /[\r\n\0]/.test(result)) throw new Error(`Nebula gameplay ${name} is invalid`); return result; }
function credentialFreeHttps(value: string, name: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${name} must be credential-free HTTPS`); return url.toString(); }
function credentialFreeOrigin(value: string, name: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} must be a credential-free HTTPS origin`); return url; }
