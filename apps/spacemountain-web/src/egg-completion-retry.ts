export const ECOSYSTEM_EGG_PENDING_KEY = "spmt:ecosystem-egg-pending:v1";

export type EcosystemEggV1 = "blackHole" | "rocket" | "signal";
export interface EcosystemEggPendingV1 { tenantId: string; userId: string; egg: EcosystemEggV1; }
export type EcosystemEggAccountV1 = Pick<EcosystemEggPendingV1, "tenantId" | "userId">;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const EGGS = new Set<EcosystemEggV1>(["blackHole", "rocket", "signal"]);

/**
 * Keeps only unconfirmed receipts. Canonical SPMT events remain authoritative;
 * browser state can request a retry but can never prove or transfer completion.
 */
export class EcosystemEggCompletionQueue {
  private pending: EcosystemEggPendingV1[] = [];

  constructor(private readonly storage?: StorageLike) {
    try {
      const value: unknown = JSON.parse(storage?.getItem(ECOSYSTEM_EGG_PENDING_KEY) ?? "[]");
      if (Array.isArray(value)) this.pending = value.map(parsePending).filter((item): item is EcosystemEggPendingV1 => Boolean(item)).slice(-12);
    } catch { /* Disabled or corrupt browser storage starts with an empty retry queue. */ }
  }

  enqueue(input: EcosystemEggPendingV1): EcosystemEggPendingV1 {
    const value = requirePending(input);
    this.pending = [...this.pending.filter((item) => key(item) !== key(value)), value].slice(-12);
    this.save();
    return value;
  }

  forAccount(tenantId: string, userId: string): EcosystemEggPendingV1[] {
    const tenant = cleanId(tenantId);
    const user = cleanId(userId);
    return this.pending.filter((item) => item.tenantId === tenant && item.userId === user).map((item) => ({ ...item }));
  }

  confirm(input: EcosystemEggPendingV1): void {
    const value = requirePending(input);
    this.pending = this.pending.filter((item) => key(item) !== key(value));
    this.save();
  }

  private save(): void {
    try {
      if (this.pending.length) this.storage?.setItem(ECOSYSTEM_EGG_PENDING_KEY, JSON.stringify(this.pending));
      else this.storage?.removeItem(ECOSYSTEM_EGG_PENDING_KEY);
    } catch { /* Keep the current page's in-memory receipts available for retry. */ }
  }
}

export function createBrowserEcosystemEggCompletionQueue(): EcosystemEggCompletionQueue {
  try { return new EcosystemEggCompletionQueue(window.sessionStorage); }
  catch { return new EcosystemEggCompletionQueue(); }
}

/** Coalesce recovery events, but run another pass when a discovery arrives mid-request. */
export class EcosystemEggRetryCoordinator {
  private inFlight: Promise<void> | undefined;
  private requested = false;

  constructor(private readonly reconcile: () => Promise<void>) {}

  retry(): Promise<void> {
    this.requested = true;
    if (!this.inFlight) {
      this.inFlight = Promise.resolve().then(async () => {
        while (this.requested) {
          this.requested = false;
          await this.reconcile();
        }
      }).finally(() => { this.inFlight = undefined; });
    }
    return this.inFlight;
  }
}

interface EggApi {
  publishEvent(tenantId: string, type: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>>;
  listEvents(tenantId: string, options: { type: string; sourceAppId: string; limit: number }): Promise<Array<Record<string, unknown>>>;
  createNotification(tenantId: string, userId: string, category: "achievement", title: string, body: string): Promise<unknown>;
}

export function eggCompletionType(egg: EcosystemEggV1) { return `ecosystem.easter-egg.${egg}.completed.v1`; }

/** Confirm against server receipts or an exact account/type query, never a shared recent-event window. */
export async function reconcileEcosystemEggCompletions(options: {
  queue: EcosystemEggCompletionQueue;
  account: EcosystemEggAccountV1;
  isCurrent: () => boolean;
  api: EggApi;
}) {
  const { queue, account, isCurrent, api } = options;
  const pending = queue.forAccount(account.tenantId, account.userId);
  const found = new Set<EcosystemEggV1>();
  for (const item of pending) {
    if (!isCurrent()) return;
    try {
      const receipt = await api.publishEvent(account.tenantId, eggCompletionType(item.egg), { schemaVersion: 1, userId: account.userId, egg: item.egg, completed: true }, `egg:${account.userId}:${item.egg}`);
      if (!isCurrent()) return;
      if (isCompletion(receipt.event, item)) { found.add(item.egg); }
    } catch { /* A lost response is reconciled through the canonical query below. */ }
  }
  for (const egg of EGGS) {
    if (!isCurrent()) return;
    const item = { ...account, egg };
    const events = await api.listEvents(account.tenantId, { type: eggCompletionType(egg), sourceAppId: account.userId, limit: 200 });
    if (!isCurrent()) return;
    if (events.some((event) => isCompletion(event, item))) { found.add(egg); }
  }
  const all = found.size === EGGS.size;
  if (all) {
    if (!isCurrent()) return;
    const receipt = await api.publishEvent(account.tenantId, "ecosystem.easter-eggs.completed.v1", { schemaVersion: 1, userId: account.userId, reward: "lord-puzzler", assistant: "count-puzzle" }, `egg:${account.userId}:complete`);
    if (!isCurrent()) return;
    const event = receipt.event as Record<string, unknown> | undefined;
    if (event?.tenantId !== account.tenantId || event.sourceAppId !== account.userId || event.type !== "ecosystem.easter-eggs.completed.v1" || (event.payload as Record<string, unknown> | undefined)?.userId !== account.userId) throw new Error("Achievement receipt was not confirmed");
    if (receipt.duplicate === false) await api.createNotification(account.tenantId, account.userId, "achievement", "Lord Puzzler unlocked", "Count Puzzle has joined your ecosystem collection.");
  }
  if (!isCurrent()) return;
  for (const item of pending) if (found.has(item.egg)) queue.confirm(item);
  return { all, pending: queue.forAccount(account.tenantId, account.userId).length, eggs: pending.map((item) => item.egg) };
}

function isCompletion(value: unknown, item: EcosystemEggPendingV1): boolean {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const payload = event.payload as Record<string, unknown> | undefined;
  return event.tenantId === item.tenantId && event.sourceAppId === item.userId && event.type === eggCompletionType(item.egg) && payload?.userId === item.userId && payload?.egg === item.egg && payload?.completed === true;
}

function parsePending(value: unknown): EcosystemEggPendingV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.tenantId !== "string" || typeof input.userId !== "string" || typeof input.egg !== "string" || !EGGS.has(input.egg as EcosystemEggV1)) return undefined;
  try { return { tenantId: cleanId(input.tenantId), userId: cleanId(input.userId), egg: input.egg as EcosystemEggV1 }; }
  catch { return undefined; }
}
function requirePending(value: EcosystemEggPendingV1): EcosystemEggPendingV1 {
  if (!EGGS.has(value.egg)) throw new Error("Unknown ecosystem egg");
  return { tenantId: cleanId(value.tenantId), userId: cleanId(value.userId), egg: value.egg };
}
function cleanId(value: string): string { const result = String(value ?? "").trim(); if (!result || result.length > 200) throw new Error("Invalid account identity"); return result; }
function key(value: EcosystemEggPendingV1): string { return `${value.tenantId}\u0000${value.userId}\u0000${value.egg}`; }
