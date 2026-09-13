import type { SpmtClient } from "./index.js";

export type SpmtProviderIdentityKindV1 = "discord" | "twitch" | "youtube";
export interface SpmtCommunityIdentityV1 { userId: string; username: string; displayName: string; providers: Array<{provider: "discord" | "twitch"; providerUserId: string}>; }
export function listCommunityIdentities(client: SpmtClient, tenantId: string, afterUserId = "") {
  return client.request<{schemaVersion: 1; tenantId: string; members: SpmtCommunityIdentityV1[]; nextAfterUserId: string | null}>(`/v1/identity/community-members?${new URLSearchParams({afterUserId, limit: "200"})}`, {tenantId});
}
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
  tenantRole?: "owner" | "member" | null;
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
  provider: Exclude<SpmtProviderIdentityKindV1,"youtube">;
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
