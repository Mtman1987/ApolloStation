import type { SpmtClient } from "@spmt/sdk";
import { grandfatherProviderIdentity, resolveProviderIdentity, type SpmtProviderIdentityKindV1 } from "@spmt/sdk/provider-identity";

/**
 * CLI subcommand family:
 *   provider-identity resolve <tenantId> <discord|twitch> <providerUserId>
 *   provider-identity grandfather <tenantId> <discord|twitch> <providerUserId> [providerUsername] [username] [displayName]
 */
export async function runProviderIdentityCli(argv: string[], client: SpmtClient) {
  const [action, tenantId, providerRaw, providerUserId, providerUsername, username, displayName] = argv;
  const provider = providerKind(providerRaw);
  if (action === "resolve") return resolveProviderIdentity(client, required(tenantId, "tenantId"), provider, required(providerUserId, "providerUserId"));
  if (action === "grandfather") {
    return grandfatherProviderIdentity(client, required(tenantId, "tenantId"), {
      provider,
      providerUserId: required(providerUserId, "providerUserId"),
      ...(providerUsername ? { providerUsername } : {}),
      ...(username ? { username } : {}),
      ...(displayName ? { displayName } : {}),
    });
  }
  throw new Error("Unsupported provider-identity command; use resolve or grandfather");
}

function providerKind(value: string | undefined): SpmtProviderIdentityKindV1 {
  if (value !== "discord" && value !== "twitch") throw new Error("provider must be discord or twitch");
  return value;
}
function required(value: string | undefined, name: string) { if (!value) throw new Error(`${name} is required`); return value; }
