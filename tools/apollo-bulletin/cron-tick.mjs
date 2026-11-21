import { resolveCronToken } from "./cron-auth.mjs";
const token = resolveCronToken(process.env);
if (!token) throw new Error("Set APOLLO_BULLETIN_CRON_TOKEN, APOLLO_BROWSER_CONTROL_PASSWORD, or APOLLO_PREVIEW_PASSWORD for the Hostless cron dispatcher");

const origin = new URL(process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app");
const endpoint = new URL("/bulletin/api/cron/tick", origin);
const response = await fetch(endpoint, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  signal: AbortSignal.timeout(30_000),
});
const body = await response.text();
let result;
try { result = body ? JSON.parse(body) : {}; } catch { result = { raw: body.slice(0, 500) }; }
if (!response.ok) throw new Error(`Apollo Bulletin cron tick failed with HTTP ${response.status}: ${JSON.stringify(result)}`);
console.log(JSON.stringify({ endpoint: endpoint.toString(), ...result }));
