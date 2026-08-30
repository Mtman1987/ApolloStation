import { DatabaseSync } from "node:sqlite";

export const DSH_CLIP_GIF_LIMIT = 10;
export const DSH_CLIP_CAPTURE_SECONDS = 60;
export const DSH_CLIP_ROTATION_MS = 10 * 60 * 1_000;
export const DSH_CLIP_GIF_MAX_BYTES = 96 * 1_024 * 1_024;

export interface DshClipGifV1 {
  schemaVersion: 1;
  tenantId: string;
  streamerLogin: string;
  clipId: string;
  capturedAt: string;
  durationSeconds: number;
  sourceUrl?: string;
  gif: Uint8Array;
}

export interface DshClipCaptureRequestV1 {
  tenantId: string;
  streamerLogin: string;
  clipId: string;
  sourceUrl: string;
  durationSeconds: number;
  width: 480;
  fps: 10;
  loop: true;
}

export class SqliteDshClipGifStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("DSH clip GIF database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dsh_clip_gifs(tenant_id TEXT NOT NULL,streamer_login TEXT NOT NULL,clip_id TEXT NOT NULL,captured_at TEXT NOT NULL,duration_seconds INTEGER NOT NULL,metadata TEXT NOT NULL,gif BLOB NOT NULL,PRIMARY KEY(tenant_id,streamer_login,clip_id)) STRICT; CREATE INDEX IF NOT EXISTS dsh_clip_gifs_rotation ON dsh_clip_gifs(tenant_id,streamer_login,captured_at,clip_id);");
  }
  close() { this.db.close(); }
  put(value: DshClipGifV1): DshClipGifV1 {
    const checked = validateClip(value);
    const metadata = JSON.stringify({ schemaVersion: 1, tenantId: checked.tenantId, streamerLogin: checked.streamerLogin, clipId: checked.clipId, capturedAt: checked.capturedAt, durationSeconds: checked.durationSeconds, ...(checked.sourceUrl ? { sourceUrl: checked.sourceUrl } : {}) });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO dsh_clip_gifs(tenant_id,streamer_login,clip_id,captured_at,duration_seconds,metadata,gif) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,streamer_login,clip_id) DO UPDATE SET captured_at=excluded.captured_at,duration_seconds=excluded.duration_seconds,metadata=excluded.metadata,gif=excluded.gif").run(checked.tenantId, checked.streamerLogin, checked.clipId, checked.capturedAt, checked.durationSeconds, metadata, checked.gif);
      const overflow = this.db.prepare("SELECT clip_id AS clipId FROM dsh_clip_gifs WHERE tenant_id=? AND streamer_login=? ORDER BY captured_at DESC,clip_id DESC LIMIT -1 OFFSET ?").all(checked.tenantId, checked.streamerLogin, DSH_CLIP_GIF_LIMIT) as Array<{ clipId: string }>;
      const remove = this.db.prepare("DELETE FROM dsh_clip_gifs WHERE tenant_id=? AND streamer_login=? AND clip_id=?");
      for (const row of overflow) remove.run(checked.tenantId, checked.streamerLogin, row.clipId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return checked;
  }
  list(tenantId: string, streamerLogin: string): DshClipGifV1[] {
    const tenant = id(tenantId, "tenantId"), login = handle(streamerLogin);
    return (this.db.prepare("SELECT metadata,gif FROM dsh_clip_gifs WHERE tenant_id=? AND streamer_login=? ORDER BY captured_at,clip_id").all(tenant, login) as Array<{ metadata: string; gif: Uint8Array }>).map((row) => ({ ...JSON.parse(row.metadata), gif: Uint8Array.from(row.gif) }) as DshClipGifV1);
  }
  select(tenantId: string, streamerLogin: string, now = Date.now()): DshClipGifV1 | undefined {
    const items = this.list(tenantId, streamerLogin);
    return items.length ? items[Math.floor(now / DSH_CLIP_ROTATION_MS) % items.length] : undefined;
  }
}

export function buildDshClipCaptureRequest(input: { tenantId: string; streamerLogin: string; clipId: string; sourceUrl: string }): DshClipCaptureRequestV1 {
  return { tenantId: id(input.tenantId, "tenantId"), streamerLogin: handle(input.streamerLogin), clipId: id(input.clipId, "clipId"), sourceUrl: https(input.sourceUrl), durationSeconds: DSH_CLIP_CAPTURE_SECONDS, width: 480, fps: 10, loop: true };
}

function validateClip(value: DshClipGifV1): DshClipGifV1 {
  if (value.schemaVersion !== 1) throw new Error("DSH clip GIF schemaVersion is invalid");
  const gif = Uint8Array.from(value.gif);
  if (gif.byteLength < 6 || gif.byteLength > DSH_CLIP_GIF_MAX_BYTES || new TextDecoder().decode(gif.subarray(0, 6)) !== "GIF89a") throw new Error("DSH clip GIF bytes are invalid");
  if (!Number.isSafeInteger(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > DSH_CLIP_CAPTURE_SECONDS) throw new Error("DSH clip duration is invalid");
  return { schemaVersion: 1, tenantId: id(value.tenantId, "tenantId"), streamerLogin: handle(value.streamerLogin), clipId: id(value.clipId, "clipId"), capturedAt: iso(value.capturedAt), durationSeconds: value.durationSeconds, ...(value.sourceUrl ? { sourceUrl: https(value.sourceUrl) } : {}), gif };
}
function id(value: string, name: string) { const result = String(value ?? "").trim(); if (!result || result.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(result)) throw new Error(`${name} is invalid`); return result; }
function handle(value: string) { const result = String(value ?? "").trim().toLowerCase().replace(/^@/, ""); if (!result || result.length > 100 || !/^[a-z0-9_]+$/.test(result)) throw new Error("streamerLogin is invalid"); return result; }
function iso(value: string) { if (!Number.isFinite(Date.parse(value))) throw new Error("capturedAt is invalid"); return new Date(value).toISOString(); }
function https(value: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new Error("DSH clip source must be credential-free HTTPS"); return url.toString(); }
