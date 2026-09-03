import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const DSH_CARD_PACK_RENDER_LEASE_MS = 5 * 60 * 1_000;
export const DSH_CARD_PACK_GIF_MAX_BYTES = 50 * 1_024 * 1_024;
export const DSH_CARD_PACK_RENDER_PROFILE = Object.freeze({
  width: 960,
  height: 540,
  fps: 10,
  durationSeconds: 14,
  outputWidth: 640,
  palette: { maxColors: 160, statsMode: "diff", dither: "bayer", bayerScale: 4, diffMode: "rectangle" },
  loop: true,
});

export type DshCardPackRenderStatusV1 = "pending" | "rendering" | "ready" | "failed";
export interface DshCardPackRenderJobV1 {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  source: "pokemon" | "quackverse";
  renderUrl: string;
  status: DshCardPackRenderStatusV1;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  leaseExpiresAt?: string;
  gif?: Uint8Array;
  error?: string;
}

export interface DshCardPackRendererV1 {
  render(input: { job: DshCardPackRenderJobV1; profile: typeof DSH_CARD_PACK_RENDER_PROFILE }): Promise<Uint8Array>;
}

export class SqliteDshCardPackRenderStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    if (!path) throw new Error("DSH card-pack database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dsh_card_pack_renders(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,body TEXT NOT NULL,gif BLOB) STRICT; CREATE INDEX IF NOT EXISTS dsh_card_pack_render_queue ON dsh_card_pack_renders(status,updated_at,id);");
  }
  close() { this.db.close(); }
  create(input: { id?: string; tenantId: string; source: "pokemon" | "quackverse"; renderUrl: string }): DshCardPackRenderJobV1 {
    const id = clean(input.id ?? randomUUID(), "id"), existing = this.get(id);
    if (existing) return existing;
    const at = iso(this.now()), job: DshCardPackRenderJobV1 = { schemaVersion: 1, id, tenantId: clean(input.tenantId, "tenantId"), source: source(input.source), renderUrl: rendererUrl(input.renderUrl), status: "pending", attempts: 0, createdAt: at, updatedAt: at };
    this.save(job);
    return clone(job);
  }
  get(id: string): DshCardPackRenderJobV1 | undefined {
    const row = this.db.prepare("SELECT body,gif FROM dsh_card_pack_renders WHERE id=?").get(clean(id, "id")) as { body: string; gif?: Uint8Array } | undefined;
    return row ? hydrate(row) : undefined;
  }
  claim(id?: string): DshCardPackRenderJobV1 | undefined {
    const at = iso(this.now()), nowMs = Date.parse(at);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = (id
        ? this.db.prepare("SELECT body,gif FROM dsh_card_pack_renders WHERE id=? AND status IN ('pending','rendering') ORDER BY updated_at,id").all(clean(id, "id"))
        : this.db.prepare("SELECT body,gif FROM dsh_card_pack_renders WHERE status IN ('pending','rendering') ORDER BY updated_at,id").all()) as Array<{ body: string; gif?: Uint8Array }>;
      const job = rows.map(hydrate).find((item) => item.status === "pending" || !item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= nowMs);
      if (!job) { this.db.exec("COMMIT"); return undefined; }
      const { error: _error, ...claimable } = job;
      const next: DshCardPackRenderJobV1 = { ...claimable, status: "rendering", attempts: job.attempts + 1, updatedAt: at, leaseExpiresAt: new Date(nowMs + DSH_CARD_PACK_RENDER_LEASE_MS).toISOString() };
      this.save(next);
      this.db.exec("COMMIT");
      return clone(next);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  complete(id: string, gifValue: Uint8Array): DshCardPackRenderJobV1 {
    const job = this.requiredRendering(id), gif = validGif(gifValue);
    const { leaseExpiresAt: _lease, error: _error, ...completed } = job;
    const next: DshCardPackRenderJobV1 = { ...completed, status: "ready", gif, updatedAt: iso(this.now()) };
    this.save(next, gif);
    return clone(next);
  }
  fail(id: string, error: unknown): DshCardPackRenderJobV1 {
    const job = this.requiredRendering(id);
    const { leaseExpiresAt: _lease, ...failed } = job;
    const next: DshCardPackRenderJobV1 = { ...failed, status: "failed", updatedAt: iso(this.now()), error: safeError(error) };
    this.save(next);
    return clone(next);
  }
  retry(id: string): DshCardPackRenderJobV1 {
    const job = this.get(id);
    if (!job || job.status !== "failed") throw new Error("Only a failed card-pack render can be retried");
    const { error: _error, leaseExpiresAt: _lease, ...retryable } = job;
    const next: DshCardPackRenderJobV1 = { ...retryable, status: "pending", updatedAt: iso(this.now()) };
    this.save(next);
    return clone(next);
  }
  private requiredRendering(id: string) { const job = this.get(id); if (!job || job.status !== "rendering") throw new Error("Card-pack render is not leased by a worker"); return job; }
  private save(job: DshCardPackRenderJobV1, gif?: Uint8Array) {
    const body = { ...job, gif: undefined };
    this.db.prepare("INSERT INTO dsh_card_pack_renders(id,tenant_id,status,updated_at,body,gif) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,body=excluded.body,gif=COALESCE(excluded.gif,dsh_card_pack_renders.gif)").run(job.id, job.tenantId, job.status, job.updatedAt, JSON.stringify(body), gif ? Buffer.from(gif) : null);
  }
}

export class DshCardPackRenderWorker {
  constructor(private readonly store: SqliteDshCardPackRenderStore, private readonly renderer: DshCardPackRendererV1) {}
  async runOnce() {
    const job = this.store.claim();
    if (!job) return { processed: false as const };
    try {
      const gif = await this.renderer.render({ job, profile: DSH_CARD_PACK_RENDER_PROFILE });
      return { processed: true as const, job: this.store.complete(job.id, gif) };
    } catch (error) {
      return { processed: true as const, job: this.store.fail(job.id, error) };
    }
  }
}

export const DSH_CARD_PACK_RENDER_CAPABILITY = "dsh.card-pack.render.v1";
export interface DshCardPackExecutionClientV1 { claimAnyExecutionJob(workerId: string, target: "sprite", options: { executionOwner: string; capabilityIds: string[]; leaseMs: number }): Promise<import("@spmt/contracts").ExecutionJobV1 | null>; heartbeatExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, progress: { percent: number; message: string }, leaseMs: number): Promise<unknown>; succeedExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, result: Record<string, unknown>): Promise<unknown>; failExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, code: string, message: string, retryable: boolean): Promise<unknown>; }
export interface DshCardPackGifPublisherV1 { publish(input: { tenantId: string; eventId: string; source: "pokemon" | "quackverse"; gif: Uint8Array }): Promise<{ gifUrl: string }>; }
export class DshCardPackExecutionWorker {
  constructor(private readonly client: DshCardPackExecutionClientV1, private readonly store: SqliteDshCardPackRenderStore, private readonly renderer: DshCardPackRendererV1, private readonly publisher: DshCardPackGifPublisherV1, private readonly workerId: string) {}
  async runOnce() { const execution = await this.client.claimAnyExecutionJob(this.workerId, "sprite", { executionOwner: "discord-stream-hub", capabilityIds: [DSH_CARD_PACK_RENDER_CAPABILITY], leaseMs: 10 * 60_000 }); if (!execution) return undefined; await this.execute(execution); return execution.id; }
  private async execute(execution: import("@spmt/contracts").ExecutionJobV1) { if (!execution.leaseId) throw new Error("Claimed DSH card-pack job has no lease"); const lease = [execution.tenantId, execution.id, this.workerId, execution.leaseId, execution.fencingEpoch] as const; let renderJob: DshCardPackRenderJobV1 | undefined; try { const eventId = clean(String(execution.input.eventId ?? ""), "eventId"), sourceValue = source(String(execution.input.source ?? "")), renderUrl = rendererUrl(String(execution.input.renderUrl ?? "")); renderJob = this.store.create({ id: eventId, tenantId: execution.tenantId, source: sourceValue, renderUrl }); if (renderJob.tenantId !== execution.tenantId || renderJob.source !== sourceValue || renderJob.renderUrl !== renderUrl) throw new Error("Card-pack render idempotency conflict"); await this.client.heartbeatExecutionJob(...lease, { percent: 15, message: "Capturing the canonical card-pack overlay" }, 10 * 60_000); if (renderJob.status !== "ready") { renderJob = this.store.claim(eventId); if (!renderJob) throw new Error("Card-pack render is already leased"); const gif = await this.renderer.render({ job: renderJob, profile: DSH_CARD_PACK_RENDER_PROFILE }); renderJob = this.store.complete(eventId, gif); } if (!renderJob.gif) throw new Error("Card-pack render completed without a GIF"); await this.client.heartbeatExecutionJob(...lease, { percent: 90, message: "Publishing the rendered card-pack GIF" }, 10 * 60_000); const output = await this.publisher.publish({ tenantId: execution.tenantId, eventId, source: sourceValue, gif: renderJob.gif }); const gifUrl = rendererUrl(output.gifUrl); await this.client.succeedExecutionJob(...lease, { schemaVersion: 1, eventId, source: sourceValue, gifUrl, bytes: renderJob.gif.byteLength }); } catch (error) { if (renderJob?.status === "rendering") this.store.fail(renderJob.id, error); const message = safeError(error); await this.client.failExecutionJob(...lease, /lease|temporar|timeout|publish/i.test(message) ? "card-pack-render-unavailable" : "card-pack-render-invalid", message, /lease|temporar|timeout|publish/i.test(message)); } }
}

function hydrate(row: { body: string; gif?: Uint8Array }): DshCardPackRenderJobV1 { const body = JSON.parse(row.body) as DshCardPackRenderJobV1; return { ...body, ...(row.gif ? { gif: Uint8Array.from(row.gif) } : {}) }; }
function clone(job: DshCardPackRenderJobV1): DshCardPackRenderJobV1 { const { gif, ...body } = job; return { ...structuredClone(body), ...(gif ? { gif: Uint8Array.from(gif) } : {}) }; }
function validGif(value: Uint8Array) { const gif = Uint8Array.from(value); if (gif.byteLength < 6 || gif.byteLength > DSH_CARD_PACK_GIF_MAX_BYTES || new TextDecoder().decode(gif.subarray(0, 6)) !== "GIF89a") throw new Error("Card-pack renderer returned an invalid or oversized GIF"); return gif; }
function source(value: string) { if (value !== "pokemon" && value !== "quackverse") throw new Error("Card-pack source is invalid"); return value; }
function rendererUrl(value: string) { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("Card-pack renderer URL is invalid"); return url.toString(); }
function clean(value: string, name: string) { const result = String(value ?? "").trim(); if (!result || result.length > 300 || /[\r\n\0]/.test(result)) throw new Error(`Card-pack ${name} is invalid`); return result; }
function iso(value: string) { if (!Number.isFinite(Date.parse(value))) throw new Error("Card-pack timestamp is invalid"); return new Date(value).toISOString(); }
function safeError(value: unknown) { return (value instanceof Error ? value.message : String(value)).replace(/(?:token|secret|authorization|password)\s*[:=]?\s*\S+/gi, "$1=[redacted]").slice(0, 500); }
