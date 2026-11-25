import { pathToFileURL } from "node:url";
import { resolveCronToken, assertCronTickResponse } from "./cron-auth.mjs";

export async function dispatchCronTick(environment = process.env, fetchImpl = fetch) {
  const token = resolveCronToken(environment);
  if (!token) throw new Error("Set APOLLO_BULLETIN_CRON_TOKEN, APOLLO_BROWSER_CONTROL_PASSWORD, or APOLLO_PREVIEW_PASSWORD for the Hostless cron dispatcher");
  const origin = new URL(environment.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("APOLLO_BULLETIN_PUBLIC_URL must be a credential-free HTTPS origin");
  }
  const endpoint = new URL("/bulletin/api/cron/tick", origin);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Apollo Bulletin cron tick failed with HTTP ${response.status}`);
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("Apollo Bulletin cron endpoint returned invalid JSON"); }
  return { endpoint: endpoint.toString(), ...assertCronTickResponse(payload) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await dispatchCronTick()));
}
