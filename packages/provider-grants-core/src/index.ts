import { randomBytes } from "node:crypto";
import { PROVIDER_GRANT_PROVIDERS, type IssuedProviderGrantV1, type ProviderGrantProviderV1, type ProviderGrantRequestV1 } from "@spmt/contracts";

export interface ProviderCredentialV1 {
  provider: ProviderGrantProviderV1;
  providerUserId: string;
  accessToken: string;
  metadata: Record<string, string>;
  scopes: string[];
  expiresAt: string;
  allowedAppIds: string[];
  allowedCapabilities: string[];
}

export interface ProviderCredentialSourceV1 {
  resolve(input: { tenantId: string; provider: ProviderGrantProviderV1; providerUserId: string }): Promise<ProviderCredentialV1 | undefined>;
}

export interface ProviderGrantReceiptV1 extends Omit<IssuedProviderGrantV1, "credential"> {}
export interface ProviderGrantAuditSinkV1 { record(receipt: ProviderGrantReceiptV1): void | Promise<void>; }
export interface ProviderGrantIssuerV1 { issue(request: ProviderGrantRequestV1): Promise<IssuedProviderGrantV1>; }

export class ProviderGrantError extends Error {
  constructor(readonly code: "invalid" | "unavailable" | "denied", message: string) { super(message); this.name = "ProviderGrantError"; }
}

export class ProviderGrantBroker implements ProviderGrantIssuerV1 {
  private readonly now: () => string;
  private readonly idFactory: () => string;
  constructor(private readonly source: ProviderCredentialSourceV1, private readonly audit?: ProviderGrantAuditSinkV1, options: { now?: () => string; idFactory?: () => string; maximumTtlSeconds?: number } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `pgrant_${randomBytes(12).toString("hex")}`);
    this.maximumTtlSeconds = Math.max(30, Math.min(900, options.maximumTtlSeconds ?? 300));
  }
  private readonly maximumTtlSeconds: number;

  async issue(request: ProviderGrantRequestV1): Promise<IssuedProviderGrantV1> {
    const normalized = normalizeRequest(request, this.maximumTtlSeconds), now = iso(this.now(), "broker clock");
    const credential = await this.source.resolve({ tenantId: normalized.tenantId, provider: normalized.provider, providerUserId: normalized.providerUserId });
    if (!credential) throw new ProviderGrantError("unavailable", "The linked provider credential is unavailable or requires reauthorization");
    validateCredential(credential, normalized, now);
    const grantedScopes = normalized.requiredScopes.filter((scope) => credential.scopes.includes(scope));
    if (grantedScopes.length !== normalized.requiredScopes.length) throw new ProviderGrantError("denied", "The linked provider credential does not grant every required scope");
    const requestedExpiry = Date.parse(now) + (normalized.ttlSeconds ?? this.maximumTtlSeconds) * 1000;
    const expiresAt = new Date(Math.min(requestedExpiry, Date.parse(credential.expiresAt))).toISOString();
    if (Date.parse(expiresAt) <= Date.parse(now)) throw new ProviderGrantError("unavailable", "The linked provider credential expired");
    const grant: IssuedProviderGrantV1 = {
      schemaVersion: 1,
      grantId: id(this.idFactory(), "grantId"),
      tenantId: normalized.tenantId,
      requesterAppId: normalized.requesterAppId,
      provider: normalized.provider,
      providerUserId: normalized.providerUserId,
      capabilityId: normalized.capabilityId,
      grantedScopes,
      credential: { accessToken: secret(credential.accessToken), metadata: metadata(credential.metadata) },
      issuedAt: now,
      expiresAt,
    };
    const { credential: _credential, ...receipt } = grant;
    await this.audit?.record(receipt);
    return structuredClone(grant);
  }
}

export class MemoryProviderCredentialSource implements ProviderCredentialSourceV1 {
  private readonly credentials = new Map<string, ProviderCredentialV1>();
  put(tenantId: string, value: ProviderCredentialV1) { this.credentials.set(key(id(tenantId, "tenantId"), provider(value.provider), id(value.providerUserId, "providerUserId")), structuredClone(value)); }
  revoke(tenantId: string, providerValue: ProviderGrantProviderV1, providerUserId: string) { return this.credentials.delete(key(tenantId, providerValue, providerUserId)); }
  async resolve(input: { tenantId: string; provider: ProviderGrantProviderV1; providerUserId: string }) { const value = this.credentials.get(key(input.tenantId, input.provider, input.providerUserId)); return value ? structuredClone(value) : undefined; }
}

function normalizeRequest(value: ProviderGrantRequestV1, maximumTtlSeconds: number): ProviderGrantRequestV1 { if (value.schemaVersion !== 1) throw new ProviderGrantError("invalid", "Unsupported provider-grant request version"); const scopes = unique(value.requiredScopes, "requiredScopes", 100); return { schemaVersion: 1, tenantId: id(value.tenantId, "tenantId"), requesterAppId: id(value.requesterAppId, "requesterAppId"), provider: provider(value.provider), providerUserId: id(value.providerUserId, "providerUserId"), capabilityId: id(value.capabilityId, "capabilityId"), requiredScopes: scopes, ...(value.ttlSeconds === undefined ? {} : { ttlSeconds: integer(value.ttlSeconds, "ttlSeconds", 30, maximumTtlSeconds) }) }; }
function validateCredential(value: ProviderCredentialV1, request: ProviderGrantRequestV1, now: string) { if (provider(value.provider) !== request.provider || id(value.providerUserId, "credential.providerUserId") !== request.providerUserId) throw new ProviderGrantError("invalid", "Provider credential identity does not match the request"); if (!value.allowedAppIds.includes(request.requesterAppId) && !value.allowedAppIds.includes("*")) throw new ProviderGrantError("denied", "This app is not allowed to receive the provider credential"); if (!value.allowedCapabilities.includes(request.capabilityId) && !value.allowedCapabilities.includes("*")) throw new ProviderGrantError("denied", "This app capability is not allowed to receive the provider credential"); unique(value.scopes, "credential.scopes", 200); iso(value.expiresAt, "credential.expiresAt"); if (Date.parse(value.expiresAt) <= Date.parse(now)) throw new ProviderGrantError("unavailable", "The linked provider credential expired"); secret(value.accessToken); metadata(value.metadata); }
function provider(value: unknown): ProviderGrantProviderV1 { if (typeof value !== "string" || !(PROVIDER_GRANT_PROVIDERS as readonly string[]).includes(value)) throw new ProviderGrantError("invalid", "provider is invalid"); return value as ProviderGrantProviderV1; }
function id(value: unknown, name: string) { if (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,200}$/.test(value)) throw new ProviderGrantError("invalid", `${name} is invalid`); return value; }
function integer(value: unknown, name: string, minimum: number, maximum: number) { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new ProviderGrantError("invalid", `${name} is invalid`); return value as number; }
function unique(value: unknown, name: string, maximum: number) { if (!Array.isArray(value) || value.length > maximum) throw new ProviderGrantError("invalid", `${name} is invalid`); const result = [...new Set(value.map((item) => id(item, name)))].sort(); if (!result.length) throw new ProviderGrantError("invalid", `${name} is empty`); return result; }
function secret(value: unknown) { if (typeof value !== "string" || value.length < 8 || value.length > 8192) throw new ProviderGrantError("invalid", "Provider access token is invalid"); return value; }
function metadata(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderGrantError("invalid", "Provider grant metadata is invalid"); const output: Record<string, string> = {}; for (const [name, item] of Object.entries(value as Record<string, unknown>)) { id(name, "metadata key"); if (typeof item !== "string" || item.length > 1000) throw new ProviderGrantError("invalid", "Provider grant metadata is invalid"); output[name] = item; } return output; }
function iso(value: unknown, name: string) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new ProviderGrantError("invalid", `${name} is invalid`); return new Date(value).toISOString(); }
function key(tenantId: string, providerValue: ProviderGrantProviderV1, providerUserId: string) { return `${tenantId}\0${providerValue}\0${providerUserId}`; }

export * from "./credential-authority.js";
export * from "./pinned-identity-policy.js";
