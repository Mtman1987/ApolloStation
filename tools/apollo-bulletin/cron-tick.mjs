const token = process.env.APOLLO_BULLETIN_CRON_TOKEN || process.env.APOLLO_BROWSER_CONTROL_PASSWORD;
if (!token) throw new Error("Set APOLLO_BULLETIN_CRON_TOKEN or APOLLO_BROWSER_CONTROL_PASSWORD for the Hostless cron dispatcher");

const origin = new URL(process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app");
const endpoint = new URL("/bulletin/api/cron/tick", origin);
const response = await fetch(endpoint, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  signal: AbortSignal.timeout(180_000),
});
const body = await response.text();
let result;
try { result = body ? JSON.parse(body) : {}; } catch { result = { raw: body.slice(0, 500) }; }
if (!response.ok) throw new Error(`Apollo Bulletin cron tick failed with HTTP ${response.status}: ${JSON.stringify(result)}`);
console.log(JSON.stringify({ endpoint: endpoint.toString(), ...result }));
