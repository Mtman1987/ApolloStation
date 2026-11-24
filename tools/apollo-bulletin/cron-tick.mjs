import { resolveCronToken, assertCronTickResponse } from "./cron-auth.mjs";

const token = resolveCronToken(process.env);
if (!token) throw new Error("Set APOLLO_BULLETIN_CRON_TOKEN, APOLLO_BROWSER_CONTROL_PASSWORD, APOLLO_PREVIEW_PASSWORD, or BOSS_KEY for the Hostless cron dispatcher");

const origin = new URL(process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app");
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("APOLLO_BULLETIN_PUBLIC_URL must be a credential-free HTTPS origin");
}
const endpoint = new URL("/bulletin/api/cron/tick", origin);
const response = await fetch(endpoint, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Apollo Bulletin cron tick failed with HTTP ${response.status}`);
let payload;
try { payload = await response.json(); }
catch { throw new Error("Apollo Bulletin cron endpoint returned invalid JSON"); }
const result = assertCronTickResponse(payload);
console.log(JSON.stringify({ endpoint: endpoint.toString(), ...result }));
