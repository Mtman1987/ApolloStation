import { DatabaseSync } from "node:sqlite";
import type { ExecutionJobV1 } from "@spmt/contracts";

export const DSH_LOUNGE_AVATAR_RENDER_CAPABILITY = "dsh.lounge-avatar.render.v1";
export const DSH_STELLA_AVATAR_FPS = 30;
export const DSH_STELLA_AVATAR_CELL = Object.freeze({ width: 192, height: 208 });

export const DSH_STELLA_ROBOT_ATLAS = Object.freeze({
  columns: 8,
  rows: 11,
  width: 1536,
  height: 2288,
  canonical: { row: 0, column: 0 },
  states: {
    idle: { row: 0, frames: 6, mode: "persistent" },
    "running-right": { row: 1, frames: 8, mode: "gesture" },
    "running-left": { row: 2, frames: 8, mode: "gesture" },
    wave: { row: 3, frames: 4, mode: "gesture" },
    jump: { row: 4, frames: 5, mode: "gesture" },
    failed: { row: 5, frames: 8, mode: "gesture" },
    waiting: { row: 6, frames: 6, mode: "gesture" },
    working: { row: 7, frames: 6, mode: "gesture" },
    talking: { row: 8, frames: 6, mode: "persistent" },
    "look-a": { row: 9, frames: 8, mode: "gesture" },
    "look-b": { row: 10, frames: 8, mode: "gesture" },
  },
} as const);

export type DshStellaAvatarStateV1 = keyof typeof DSH_STELLA_ROBOT_ATLAS.states;
export type DshStellaAvatarPersistentStateV1 = "idle" | "talking";
export type DshStellaAvatarGestureV1 = Exclude<DshStellaAvatarStateV1, DshStellaAvatarPersistentStateV1>;

export interface DshLoungeAvatarFrameRefV1 { row: number; column: number; }
export interface DshLoungeAvatarRenderPlanV1 {
  schemaVersion: 1;
  state: DshStellaAvatarStateV1;
  fps: 30;
  loop: boolean;
  sourceFrameRate: number;
  interpolate: boolean;
  frames: DshLoungeAvatarFrameRefV1[];
}
export interface DshLoungeAvatarManifestV1 {
  schemaVersion: 1;
  tenantId: string;
  source: "athena-robot-pet";
  fps: 30;
  animations: Partial<Record<DshStellaAvatarStateV1, { url: string; durationMs: number; loop: boolean }>>;
  renderedAt: string;
}

/**
 * Converts the small pet atlas into the canonical frame-1 animation contract used by the Lounge.
 * Idle/talking are ping-pong loops. Every gesture is wrapped by the exact neutral frame and plays once.
 * The renderer may interpolate between sparse source poses, but the logical transition boundary is always canonical frame 1.
 */
export function buildDshStellaAvatarRenderPlan(state: DshStellaAvatarStateV1, sourceFrameRate = 9, interpolate = true): DshLoungeAvatarRenderPlanV1 {
  if (!Number.isFinite(sourceFrameRate) || sourceFrameRate < 1 || sourceFrameRate > 30) throw new Error("Stella source frame rate is invalid");
  const definition = DSH_STELLA_ROBOT_ATLAS.states[state];
  const canonical = { ...DSH_STELLA_ROBOT_ATLAS.canonical };
  const source = Array.from({ length: definition.frames }, (_, column) => ({ row: definition.row, column }));
  const persistent = definition.mode === "persistent";
  let frames: DshLoungeAvatarFrameRefV1[];
  if (state === "idle") {
    frames = [...source, ...source.slice(1, -1).reverse(), canonical];
  } else if (persistent) {
    frames = [canonical, ...source, ...source.slice(0, -1).reverse(), canonical];
  } else {
    frames = [canonical, ...source, canonical];
  }
  return { schemaVersion: 1, state, fps: DSH_STELLA_AVATAR_FPS, loop: persistent, sourceFrameRate, interpolate, frames };
}

export function dshStellaAvatarRenderPlans() {
  return (Object.keys(DSH_STELLA_ROBOT_ATLAS.states) as DshStellaAvatarStateV1[]).map(state => buildDshStellaAvatarRenderPlan(state));
}

/** Weighted no-starvation RNG: everything stays eligible, unseen gestures grow more likely until all have played. */
export class DshStellaGestureBag {
  private readonly seen = new Set<DshStellaAvatarGestureV1>();
  constructor(private readonly random: () => number = Math.random) {}
  next(pool: DshStellaAvatarGestureV1[] = ["wave", "jump", "waiting", "working", "look-a", "look-b"]) {
    const unique = [...new Set(pool)];
    if (!unique.length) throw new Error("Stella gesture pool is empty");
    if (unique.every(item => this.seen.has(item))) this.seen.clear();
    const weighted = unique.map(item => ({ item, weight: this.seen.has(item) ? 1 : 4 }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let pick = Math.max(0, Math.min(0.999999999, this.random())) * total;
    for (const entry of weighted) {
      pick -= entry.weight;
      if (pick < 0) { this.seen.add(entry.item); return entry.item; }
    }
    const last = weighted.at(-1)!.item; this.seen.add(last); return last;
  }
  reset() { this.seen.clear(); }
}

export class SqliteDshLoungeAvatarStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS dsh_lounge_avatar(tenant_id TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;");
  }
  close() { this.db.close(); }
  get(tenantId: string): DshLoungeAvatarManifestV1 | undefined {
    const row = this.db.prepare("SELECT body FROM dsh_lounge_avatar WHERE tenant_id=?").get(clean(tenantId, "tenantId")) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as DshLoungeAvatarManifestV1 : undefined;
  }
  put(value: DshLoungeAvatarManifestV1) {
    const checked = validateManifest(value);
    this.db.prepare("INSERT INTO dsh_lounge_avatar(tenant_id,body,updated_at) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at").run(checked.tenantId, JSON.stringify(checked), checked.renderedAt);
    return checked;
  }
}

export interface DshLoungeAvatarRendererV1 {
  render(input: { source: Uint8Array; plans: DshLoungeAvatarRenderPlanV1[] }): Promise<Record<DshStellaAvatarStateV1, { gif: Uint8Array; durationMs: number; loop: boolean }>>;
}
export interface DshLoungeAvatarSourceV1 { load(url: string): Promise<Uint8Array>; }
export interface DshLoungeAvatarPublisherV1 {
  publish(input: { tenantId: string; state: DshStellaAvatarStateV1; gif: Uint8Array }): Promise<{ url: string }>;
}
export interface DshLoungeAvatarExecutionClientV1 {
  claimAnyExecutionJob(workerId: string, target: "sprite", options: { executionOwner: string; capabilityIds: string[]; leaseMs: number }): Promise<ExecutionJobV1 | null>;
  heartbeatExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, progress: { percent: number; message: string }, leaseMs: number): Promise<unknown>;
  succeedExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, result: Record<string, unknown>): Promise<unknown>;
  failExecutionJob(tenantId: string, jobId: string, workerId: string, leaseId: string, fencingEpoch: number, code: string, message: string, retryable: boolean): Promise<unknown>;
}

export class DshLoungeAvatarExecutionWorker {
  constructor(private readonly client: DshLoungeAvatarExecutionClientV1, private readonly source: DshLoungeAvatarSourceV1, private readonly renderer: DshLoungeAvatarRendererV1, private readonly publisher: DshLoungeAvatarPublisherV1, private readonly store: SqliteDshLoungeAvatarStore, private readonly workerId: string, private readonly now: () => string = () => new Date().toISOString()) {}
  async runOnce() {
    const job = await this.client.claimAnyExecutionJob(this.workerId, "sprite", { executionOwner: "discord-stream-hub", capabilityIds: [DSH_LOUNGE_AVATAR_RENDER_CAPABILITY], leaseMs: 20 * 60_000 });
    if (!job) return undefined;
    await this.execute(job); return job.id;
  }
  private async execute(job: ExecutionJobV1) {
    if (!job.leaseId) throw new Error("Claimed Lounge avatar job has no lease");
    const lease = [job.tenantId, job.id, this.workerId, job.leaseId, job.fencingEpoch] as const;
    try {
      const sourceImageUrl = safeUrl(job.input.sourceImageUrl);
      await this.client.heartbeatExecutionJob(...lease, { percent: 10, message: "Loading Stella robot atlas" }, 20 * 60_000);
      const bytes = await this.source.load(sourceImageUrl);
      await this.client.heartbeatExecutionJob(...lease, { percent: 25, message: "Rendering canonical 30 fps Stella animations" }, 20 * 60_000);
      const rendered = await this.renderer.render({ source: bytes, plans: dshStellaAvatarRenderPlans() });
      const animations: DshLoungeAvatarManifestV1["animations"] = {};
      const entries = Object.entries(rendered) as Array<[DshStellaAvatarStateV1, { gif: Uint8Array; durationMs: number; loop: boolean }]>;
      let completed = 0;
      for (const [state, value] of entries) {
        validateGif(value.gif);
        const published = await this.publisher.publish({ tenantId: job.tenantId, state, gif: value.gif });
        animations[state] = { url: safeUrl(published.url), durationMs: Math.max(1, Math.round(value.durationMs)), loop: value.loop };
        completed += 1;
        await this.client.heartbeatExecutionJob(...lease, { percent: 25 + Math.floor(65 * completed / entries.length), message: `Published Stella ${state}` }, 20 * 60_000);
      }
      const manifest = this.store.put({ schemaVersion: 1, tenantId: job.tenantId, source: "athena-robot-pet", fps: 30, animations, renderedAt: new Date(this.now()).toISOString() });
      await this.client.succeedExecutionJob(...lease, { schemaVersion: 1, source: manifest.source, fps: manifest.fps, animations: manifest.animations, renderedAt: manifest.renderedAt });
    } catch (error) {
      const message = safeError(error), retryable = /temporar|timeout|unavailable|network|load|publish/i.test(message);
      await this.client.failExecutionJob(...lease, retryable ? "lounge-avatar-unavailable" : "lounge-avatar-invalid", message, retryable);
    }
  }
}

export interface DshLoungeAvatarJobClientV1 { createExecutionJob(tenantId: string, input: Record<string, unknown>, idempotencyKey: string, correlationId?: string): Promise<{ job: unknown; duplicate: boolean }>; }
export function requestDshLoungeAvatarRender(client: DshLoungeAvatarJobClientV1, input: { tenantId: string; billedUserId: string; sourceImageUrl: string; revision?: string }) {
  const tenantId = clean(input.tenantId, "tenantId"), billedUserId = clean(input.billedUserId, "billedUserId"), sourceImageUrl = safeUrl(input.sourceImageUrl), revision = clean(input.revision ?? "athena-robot-v3", "revision");
  return client.createExecutionJob(tenantId, { ownerAppId: "discord-stream-hub", executionOwner: "discord-stream-hub", capabilityId: DSH_LOUNGE_AVATAR_RENDER_CAPABILITY, billedUserId, meteredResource: "hosted-worker-minutes", usageQuantity: 1, executionTarget: "sprite", meteringTarget: "hosted", input: { schemaVersion: 1, sourceImageUrl, source: "athena-robot-pet", revision, fps: 30 } }, `dsh-lounge-avatar:${tenantId}:${revision}`, `lounge-avatar:${revision}`);
}

function validateManifest(value: DshLoungeAvatarManifestV1): DshLoungeAvatarManifestV1 {
  clean(value.tenantId, "tenantId"); if (value.schemaVersion !== 1 || value.source !== "athena-robot-pet" || value.fps !== 30 || !Number.isFinite(Date.parse(value.renderedAt))) throw new Error("Lounge avatar manifest is invalid");
  for (const [state, item] of Object.entries(value.animations)) { if (!(state in DSH_STELLA_ROBOT_ATLAS.states) || !item || !Number.isFinite(item.durationMs) || item.durationMs < 1) throw new Error("Lounge avatar animation is invalid"); safeUrl(item.url); }
  return structuredClone(value);
}
function validateGif(value: Uint8Array) { const bytes = Uint8Array.from(value); if (bytes.byteLength < 6 || bytes.byteLength > 25 * 1024 * 1024 || !["GIF87a", "GIF89a"].includes(new TextDecoder().decode(bytes.subarray(0, 6)))) throw new Error("Lounge avatar renderer returned an invalid GIF"); }
function safeUrl(value: unknown) { const url = new URL(String(value ?? "")); if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Lounge avatar URL is invalid"); return url.toString(); }
function clean(value: string, name: string) { const result = String(value ?? "").trim(); if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(result)) throw new Error(`Lounge avatar ${name} is invalid`); return result; }
function safeError(value: unknown) { return (value instanceof Error ? value.message : String(value)).replace(/(?:authorization|token|secret|password)\s*[:=]?\s*\S+/gi, "$1=[redacted]").slice(0, 500); }
