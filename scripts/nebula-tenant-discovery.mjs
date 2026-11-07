/**
 * Discover the active Twitch workspace from SPMT's service-only authority API.
 * This deliberately uses Chat Gateway's existing worker credential and never
 * reads a deployment-time CHAT_GATEWAY_CONNECTIONS secret.
 */
export async function discoverNebulaTenantFromSpmt({ spmtOrigin, workerCredential, fetchImpl = fetch }) {
  const originUrl = new URL(String(spmtOrigin ?? ""));
  if (originUrl.protocol !== "https:" || originUrl.username || originUrl.password ||
      originUrl.pathname !== "/" || originUrl.search || originUrl.hash) {
    throw new Error("SPMT_ORIGIN must be a credential-free HTTPS origin");
  }
  const credential = String(workerCredential ?? "");
  if (credential.length < 32) throw new Error("CHAT_GATEWAY_WORKER_CREDENTIAL must be at least 32 characters");

  const tokenResponse = await fetchImpl(new URL("/v1/auth/service-token", originUrl), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ serviceId: "chat-gateway", credential }),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`SPMT Chat Gateway service authentication failed (${tokenResponse.status})`);
  const tokenPayload = await tokenResponse.json();
  if (typeof tokenPayload?.accessToken !== "string" || !tokenPayload.accessToken) {
    throw new Error("SPMT returned an invalid Chat Gateway service token");
  }

  const discoveryResponse = await fetchImpl(new URL("/v1/chat/twitch-bot-connections", originUrl), {
    headers: {
      accept: "application/json",
      "x-spmt-app": "chat-gateway",
      authorization: `Bearer ${tokenPayload.accessToken}`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!discoveryResponse.ok) throw new Error(`SPMT Twitch connection discovery failed (${discoveryResponse.status})`);
  const payload = await discoveryResponse.json();
  if (!Array.isArray(payload?.connections)) {
    throw new Error("SPMT Twitch connection discovery returned an invalid connection list");
  }
  const tenantIds = [...new Set(payload.connections
    .filter((connection) => connection?.schemaVersion === 1 &&
      connection.desired === true && connection.provider === "twitch" &&
      typeof connection.tenantId === "string" && connection.tenantId.trim() &&
      typeof connection.channelId === "string" && connection.channelId.trim())
    .map((connection) => connection.tenantId.trim()))];
  if (tenantIds.length !== 1) {
    throw new Error(`SPMT must expose exactly one desired Twitch workspace tenant for the recovered global Tag import; found ${tenantIds.length}`);
  }
  return tenantIds[0];
}
