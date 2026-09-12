export const ECOSYSTEM_EGG_PENDING_KEY = "spmt:ecosystem-egg-pending:v1";

export type EcosystemEggV1 = "blackHole" | "rocket" | "signal";
export interface EcosystemEggPendingV1 { tenantId: string; userId: string; egg: EcosystemEggV1; }
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
