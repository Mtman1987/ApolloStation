import type { SpmtClient } from "./index.js";

export type SpmtProviderIdentityKindV1 = "discord" | "twitch";
export interface SpmtProviderIdentityProfileV1 {
  userId: string;
  username: string;
  displayName: string;
  tenantIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface SpmtProviderIdentityResultV1 {
  provider: SpmtProviderIdentityKindV1;
  providerUserId: string;
  userId: string;
  profile: SpmtProviderIdentityProfileV1;
  credentialState: "setup-required" | "password-set";
  createdUser: boolean;
  linkedProvider: boolean;
  recoveredRevokedLink: boolean;
}

export function resolveProviderIdentity(client: SpmtClient, tenantId: string, provider: SpmtProviderIdentityKindV1, providerUserId: string) {
  const params = new URLSearchParams({ provider, providerUserId });
  return client.request<SpmtProviderIdentityResultV1>(`/v1/identity/provider?${params}`, { tenantId });
}

export function grandfatherProviderIdentity(client: SpmtClient, tenantId: string, input: {
  provider: SpmtProviderIdentityKindV1;
  providerUserId: string;
  providerUsername?: string;
  username?: string;
  displayName?: string;
}) {
  return client.request<SpmtProviderIdentityResultV1>("/v1/identity/provider/grandfather", {
    method: "POST",
    tenantId,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
