import type { SpmtClient } from "@spmt/sdk";

export const STREAMWEAVER_REDEEM_INVOKED = "streamweaver.redeem.invoked.v1";
export const STREAMWEAVER_REDEEM_EFFECT_REQUESTED = "streamweaver.redeem.effect.requested.v1";

export type StreamWeaverCanonicalRedeemV1 =
  | "ban-in-game"
  | "blerps"
  | "dance-party"
  | "new-dance-party"
  | "woop-dance-party"
  | "drop-it"
  | "first"
  | "hydrate"
  | "no-cursing"
  | "smoke"
  | "stretch"
  | "partner-check-ins"
  | "partner-message"
  | "start-fight"
  | "sample";

export interface StreamWeaverDonorRedeemActionV1 {
  id: string;
  name: string;
  canonical: StreamWeaverCanonicalRedeemV1;
  freezeTier: "official_library" | "internal_only";
  visibility: "advanced" | "hidden";
  requiresSetup: boolean;
  migrationAlias: boolean;
}

/** Frozen StreamWeaver redeem-pack action identities from donor commit 387acf70552f9a6a557a83e8804c328245932961. */
export const STREAMWEAVER_DONOR_REDEEM_ACTIONS = [
  { id:"ed6b21b2-2b4b-481b-9b96-56787dcdeeba", name:"ban in game action", canonical:"ban-in-game", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"9b4052e1-117b-4faa-abd1-f5acac25f28f", name:"Currency System • ban in game item", canonical:"ban-in-game", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"da2d0114-06f8-47ab-8a82-3770e7c4d434", name:"Currency System • ban in game item (Copy)", canonical:"ban-in-game", freezeTier:"internal_only", visibility:"hidden", requiresSetup:false, migrationAlias:true },
  { id:"a799c214-5e95-4f5d-bd2f-5fc85e5ad995", name:"Currency System • blerps", canonical:"blerps", freezeTier:"official_library", visibility:"advanced", requiresSetup:true, migrationAlias:false },
  { id:"97ef2856-ba34-433c-abd8-519c0f97091e", name:"Currency System • dance party", canonical:"dance-party", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"3d2f6845-f888-4042-9dd5-25c1f6e92bfa", name:"Currency System • drop it", canonical:"drop-it", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"1f502613-a573-4ce7-ae9d-f14deb18cfe2", name:"Currency System • first", canonical:"first", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"cae578b8-652e-4c0d-949b-1767f9e07d16", name:"Currency System • hydrate", canonical:"hydrate", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"4ec62407-e4b1-412a-a365-e3bb55e375e0", name:"Currency System •no cursing", canonical:"no-cursing", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"2772f073-af91-4925-94cc-4a33050c35da", name:"Currency System •sample", canonical:"sample", freezeTier:"internal_only", visibility:"hidden", requiresSetup:false, migrationAlias:true },
  { id:"beee5882-43e6-4797-91c0-bd5d6ed0f8c9", name:"Currency System •smoke", canonical:"smoke", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"6eb1c49d-eee7-417e-96a6-4e7837ef3751", name:"Currency System • stretch", canonical:"stretch", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"1a1f3af0-7159-46ab-8eac-9af9d9b59d2d", name:"Dance Party", canonical:"dance-party", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"28485b3a-8633-4feb-8097-97e6946e9166", name:"drop it", canonical:"drop-it", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"1672ea4b-4808-4a2e-93cf-75aee40a4b0c", name:"first", canonical:"first", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"ae49f42c-11fd-4419-b204-587811d2f17a", name:"!hydrate", canonical:"hydrate", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"3f7f62c2-44dd-4a9e-b084-024ccc777861", name:"New Dance Parrty", canonical:"new-dance-party", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"d2b8172e-1759-41a0-bff3-d04d68cceb57", name:"no cursing", canonical:"no-cursing", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"5c0cb407-46b0-4ff4-b3c7-54dbe56b3a85", name:"Partner Check Ins", canonical:"partner-check-ins", freezeTier:"official_library", visibility:"advanced", requiresSetup:true, migrationAlias:false },
  { id:"4b46ab5e-2238-46f0-9183-bf0902c5bc73", name:"PartnerMessage", canonical:"partner-message", freezeTier:"official_library", visibility:"advanced", requiresSetup:true, migrationAlias:false },
  { id:"01a4936a-1821-45c0-8530-372397d69dbb", name:"Play Blerps (Copy)", canonical:"blerps", freezeTier:"internal_only", visibility:"hidden", requiresSetup:true, migrationAlias:true },
  { id:"f96e499a-4d84-4c4c-81a0-58ea3a56730e", name:"Play Blerps", canonical:"blerps", freezeTier:"official_library", visibility:"advanced", requiresSetup:true, migrationAlias:false },
  { id:"97104442-4b39-4320-a6ec-875d12024591", name:"smoke", canonical:"smoke", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"845499c7-f692-4525-b694-aad96ea19409", name:"StartFight", canonical:"start-fight", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"7cf5c38d-2707-48e0-a230-675e8dbebd4f", name:"!stretch", canonical:"stretch", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
  { id:"a12ba66a-f330-4b40-86e2-d7a7e7f1d128", name:"woop dance party", canonical:"woop-dance-party", freezeTier:"official_library", visibility:"advanced", requiresSetup:false, migrationAlias:false },
] as const satisfies readonly StreamWeaverDonorRedeemActionV1[];

export type StreamWeaverRedeemFundingV1 =
  | { kind: "xp" }
  | { kind: "provider"; provider: "twitch" | "kick" | "other"; redemptionId: string }
  | { kind: "system"; sourceEventId: string };

export interface StreamWeaverRedeemInvocationV1 {
  tenantId: string;
  invocationId: string;
  action: string;
  userId?: string;
  funding: StreamWeaverRedeemFundingV1;
  payload?: Record<string, unknown>;
}

export interface StreamWeaverRedeemPriceV1 {
  amount: number;
  eventType: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface StreamWeaverRedeemPricingPolicyV1 {
  resolve(input: { tenantId: string; userId: string; redeem: StreamWeaverDonorRedeemActionV1; payload: Record<string, unknown> }): Promise<StreamWeaverRedeemPriceV1 | undefined> | StreamWeaverRedeemPriceV1 | undefined;
}

export interface StreamWeaverRedeemRuntimeOptionsV1 {
  client: Pick<SpmtClient, "publishEvent" | "spendXp">;
  pricing?: StreamWeaverRedeemPricingPolicyV1;
}

export interface StreamWeaverRedeemExecutionV1 {
  invocationId: string;
  donorActionId: string;
  canonical: StreamWeaverCanonicalRedeemV1;
  funding: StreamWeaverRedeemFundingV1["kind"];
  spentXp: number;
  duplicateSpend: boolean;
}

export function resolveStreamWeaverDonorRedeemAction(value: string): StreamWeaverDonorRedeemActionV1 | undefined {
  const query = normalize(value);
  const byId = STREAMWEAVER_DONOR_REDEEM_ACTIONS.find((item) => item.id === value);
  if (byId) return byId;
  const byName = STREAMWEAVER_DONOR_REDEEM_ACTIONS.find((item) => normalize(item.name) === query && !item.migrationAlias);
  if (byName) return byName;
  return STREAMWEAVER_DONOR_REDEEM_ACTIONS.find((item) => item.canonical === query && !item.migrationAlias);
}

export class StreamWeaverRedeemRuntime {
  constructor(private readonly options: StreamWeaverRedeemRuntimeOptionsV1) {}

  async invoke(input: StreamWeaverRedeemInvocationV1): Promise<StreamWeaverRedeemExecutionV1> {
    const tenantId = safeId(input.tenantId, "tenantId");
    const invocationId = safeId(input.invocationId, "invocationId");
    const redeem = resolveStreamWeaverDonorRedeemAction(input.action);
    if (!redeem) throw new Error("Unknown StreamWeaver donor redeem action");
    if (redeem.canonical === "sample") throw new Error("The donor Currency sample is migration-only and cannot execute");
    const payload = sanitizePayload(input.payload ?? {});
    let spentXp = 0;
    let duplicateSpend = false;

    if (input.funding.kind === "xp") {
      const userId = safeId(input.userId, "userId");
      const price = await this.options.pricing?.resolve({ tenantId, userId, redeem, payload });
      if (!price) throw new Error(`XP price is not configured for ${redeem.canonical}`);
      if (!Number.isSafeInteger(price.amount) || price.amount <= 0) throw new Error("Redeem XP price must be a positive integer");
      const spend = await this.options.client.spendXp(
        tenantId,
        userId,
        price.amount,
        safeEventType(price.eventType),
        `streamweaver-redeem-spend:${invocationId}`,
        { canonicalRedeem: redeem.canonical, donorActionId: redeem.id, invocationId, ...(sanitizePayload(price.metadata ?? {})) },
      );
      if (!spend.spent && !spend.duplicate) throw new Error("SPMT did not authorize the XP spend");
      spentXp = spend.amount;
      duplicateSpend = spend.duplicate;
    } else if (input.userId) {
      safeId(input.userId, "userId");
    }

    const funding = sanitizeFunding(input.funding);
    await this.options.client.publishEvent(tenantId, STREAMWEAVER_REDEEM_INVOKED, {
      schemaVersion: 1,
      invocationId,
      donorActionId: redeem.id,
      donorActionName: redeem.name,
      canonicalRedeem: redeem.canonical,
      requiresSetup: redeem.requiresSetup,
      funding,
      ...(input.userId ? { userId: safeId(input.userId, "userId") } : {}),
      payload,
    }, `streamweaver-redeem-invoked:${invocationId}`);

    await this.options.client.publishEvent(tenantId, STREAMWEAVER_REDEEM_EFFECT_REQUESTED, {
      schemaVersion: 1,
      invocationId,
      donorActionId: redeem.id,
      canonicalRedeem: redeem.canonical,
      funding,
      ...(input.userId ? { userId: safeId(input.userId, "userId") } : {}),
      payload,
    }, `streamweaver-redeem-effect:${invocationId}`);

    return { invocationId, donorActionId: redeem.id, canonical: redeem.canonical, funding: input.funding.kind, spentXp, duplicateSpend };
  }
}

function sanitizeFunding(input: StreamWeaverRedeemFundingV1): Record<string, unknown> {
  if (input.kind === "xp") return { kind: "xp" };
  if (input.kind === "provider") return { kind: "provider", provider: input.provider, redemptionId: safeId(input.redemptionId, "redemptionId") };
  return { kind: "system", sourceEventId: safeId(input.sourceEventId, "sourceEventId") };
}
function sanitizePayload(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 60)) {
    if (/token|secret|password|authorization|cookie|api.?key/i.test(key)) continue;
    const safeKey = key.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 80);
    if (!safeKey) continue;
    if (typeof value === "string") output[safeKey] = value.slice(0, 2_000);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) output[safeKey] = value;
  }
  return output;
}
function safeId(value: unknown, field: string): string { const result = String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 200); if (!result) throw new Error(`${field} is required`); return result; }
function safeEventType(value: unknown): string { const result = String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 160); if (!result) throw new Error("Redeem eventType is required"); return result; }
function normalize(value: unknown): string { return String(value ?? "").trim().toLowerCase().replace(/^!/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
