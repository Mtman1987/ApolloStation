import { mkdir, writeFile } from "node:fs/promises";

const expected = {
  spmtUserId: "d696355b-e13a-408b-b21a-bcfa8dec15e0",
  discordUserId: "767875979561009173",
  twitchUserId: "94371378",
  username: "mtman1987",
};
const report = { checkedAt: new Date().toISOString(), mode: "read-only; no database writes; no deployments", checks: [] };

async function probe(name, url, token, headers = {}) {
  if (!token) {
    report.checks.push({ provider: name, status: "not_configured" });
    return null;
  }
  try {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json", ...headers }, signal: AbortSignal.timeout(12000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      report.checks.push({ provider: name, status: "rejected", httpStatus: response.status });
      return null;
    }
    const user = body.user && typeof body.user === "object" ? body.user : body;
    const id = String(user.id ?? user.sub ?? "");
    const username = String(user.username ?? user.login ?? user.name ?? "");
    const match = id === expected[ name === "SPMT" ? "spmtUserId" : name === "Discord" ? "discordUserId" : name === "Twitch" ? "twitchUserId" : "" ] || username.toLowerCase() === expected.username;
    report.checks.push({ provider: name, status: "validated", returnedId: id || null, returnedUsername: username || null, matchesSuppliedIdentity: Boolean(match) });
    return { id, username };
  } catch (error) {
    report.checks.push({ provider: name, status: "error", message: String(error?.name ?? "request_error") });
    return null;
  }
}

let spmtToken = "";
try {
  const bridge = JSON.parse(process.env.SPMT_SESSION_BRIDGE_JSON || "{}");
  spmtToken = typeof bridge.token === "string" ? bridge.token : "";
} catch {}
await probe("SPMT", "https://spmt.live/api/auth/me", spmtToken);
await probe("Discord", "https://discord.com/api/users/@me", process.env.DISCORD_USER_ACCESS_TOKEN);
await probe("Discord bot (bot identity only)", "https://discord.com/api/users/@me", process.env.DISCORD_BOT_TOKEN, { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN || ""}` });
if (process.env.TWITCH_ACCESS_TOKEN) {
  try {
    const r = await fetch("https://id.twitch.tv/oauth2/validate", { headers: { authorization: `OAuth ${process.env.TWITCH_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(12000) });
    const b = await r.json().catch(() => ({}));
    report.checks.push({ provider: "Twitch", status: r.ok ? "validated" : "rejected", httpStatus: r.status, returnedUserId: b.user_id ?? null, returnedLogin: b.login ?? null, matchesSuppliedIdentity: String(b.user_id ?? "") === expected.twitchUserId || String(b.login ?? "").toLowerCase() === expected.username });
  } catch (e) { report.checks.push({ provider: "Twitch", status: "error", message: String(e?.name ?? "request_error") }); }
} else report.checks.push({ provider: "Twitch", status: "not_configured" });
await probe("Kick", "https://api.kick.com/public/v1/users", process.env.KICK_ACCESS_TOKEN);
await probe("YouTube/Google", "https://www.googleapis.com/oauth2/v3/userinfo", process.env.YOUTUBE_ACCESS_TOKEN || process.env.GOOGLE_ACCESS_TOKEN);

try {
  const r = await fetch(new URL("/api/health", process.env.APOLLO_NODE1_URL), { signal: AbortSignal.timeout(10000) });
  report.checks.push({ provider: "Apollo Node 1 health", status: r.ok ? "reachable" : "http_error", httpStatus: r.status });
} catch (e) { report.checks.push({ provider: "Apollo Node 1 health", status: "unreachable", message: String(e?.name ?? "request_error") }); }

report.note = "This probes only provider credentials supplied to this workflow and Node 1 health. It does not read Apollo's private SQLite/Turso records. A provider identity match proves the credential maps to the supplied account, not that an Apollo profile row exists.";
await mkdir("identity-diagnostics", { recursive: true });
await writeFile("identity-diagnostics/report.json", JSON.stringify(report, null, 2) + "\n");
for (const item of report.checks) console.log(`${item.provider}: ${item.status}${item.returnedId ? ` (id ${item.returnedId})` : ""}`);
console.log(report.note);
