import type { ProviderGrantProviderV1 } from "@spmt/contracts";
import { ProviderGrantError } from "./index.js";
import type { ProviderCredentialProjectionV1, ProviderCredentialWriteV1, SqliteProviderCredentialAuthority } from "./credential-authority.js";

export interface PinnedProviderIdentityPolicyV1 {
  schemaVersion: 1;
  roleId: string;
  tenantId: string;
  provider: ProviderGrantProviderV1;
  expectedProviderUserId: string;
  expectedLogin: string;
  ownerUserId: string;
  allowedAppIds: string[];
  allowedCapabilities: string[];
  allowedScopes: string[];
}
export interface PinnedProviderAuthorizationV1 {
  actorUserId: string;
  providerUserId: string;
  providerLogin: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: string;
  expectedRevision?: number;
}

/**
 * Pins privileged character/bot OAuth to its immutable provider identity and
 * owner. Tokens remain in the encrypted provider authority and downstream apps
 * receive only short-lived capability grants.
 */
export function storePinnedProviderAuthorization(authority: Pick<SqliteProviderCredentialAuthority, "put">, policy: PinnedProviderIdentityPolicyV1, authorization: PinnedProviderAuthorizationV1): ProviderCredentialProjectionV1 {
  validatePolicy(policy);
  if (authorization.actorUserId !== policy.ownerUserId) throw new ProviderGrantError("denied", `${policy.roleId} authorization requires its owner`);
  if (authorization.providerUserId !== policy.expectedProviderUserId || authorization.providerLogin.toLowerCase() !== policy.expectedLogin.toLowerCase()) throw new ProviderGrantError("denied", `${policy.roleId} must be authorized as ${policy.expectedLogin}`);
  const scopes = [...new Set(authorization.scopes)];
  if (scopes.some((scope) => !policy.allowedScopes.includes(scope))) throw new ProviderGrantError("denied", `${policy.roleId} authorization requested a scope outside its pinned policy`);
  const write: ProviderCredentialWriteV1 = { schemaVersion: 1, tenantId: policy.tenantId, provider: policy.provider, providerUserId: policy.expectedProviderUserId, accessToken: authorization.accessToken, refreshToken: authorization.refreshToken, refreshMode: "oauth", metadata: { login: policy.expectedLogin, roleId: policy.roleId, identityPinned: "true" }, scopes, expiresAt: authorization.expiresAt, allowedAppIds: policy.allowedAppIds, allowedCapabilities: policy.allowedCapabilities, ...(authorization.expectedRevision === undefined ? {} : { expectedRevision: authorization.expectedRevision }) };
  return authority.put(write);
}

export function theCountTwitchPolicy(input: { tenantId: string; ownerUserId: string; providerUserId: string }): PinnedProviderIdentityPolicyV1 {
  return { schemaVersion: 1, roleId: "the-count", tenantId: valid(input.tenantId), provider: "twitch", expectedProviderUserId: valid(input.providerUserId), expectedLogin: "TheCountSPMT", ownerUserId: valid(input.ownerUserId), allowedAppIds: ["streamweaver", "chat-gateway"], allowedCapabilities: ["chat:write"], allowedScopes: ["chat:read", "chat:edit", "user:read:chat", "user:write:chat", "user:bot"] };
}

function validatePolicy(value: PinnedProviderIdentityPolicyV1): void { if (value.schemaVersion !== 1) throw new ProviderGrantError("invalid", "Pinned provider policy version is invalid"); for (const item of [value.roleId, value.tenantId, value.expectedProviderUserId, value.expectedLogin, value.ownerUserId]) valid(item); if (!value.allowedAppIds.length || !value.allowedCapabilities.length || !value.allowedScopes.length) throw new ProviderGrantError("invalid", "Pinned provider policy grants are empty"); }
function valid(value: string): string { if (!value || value.trim() !== value || value.length > 200 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new ProviderGrantError("invalid", "Pinned provider identity is invalid"); return value; }
