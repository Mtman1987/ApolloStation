export function resolveCronToken(env = process.env) {
  for (const candidate of [env.APOLLO_BULLETIN_CRON_TOKEN, env.APOLLO_BROWSER_CONTROL_PASSWORD, env.APOLLO_PREVIEW_PASSWORD]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}
