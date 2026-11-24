export function resolveCronToken(env = process.env) {
  for (const candidate of [env.APOLLO_BULLETIN_CRON_TOKEN, env.APOLLO_BROWSER_CONTROL_PASSWORD, env.APOLLO_PREVIEW_PASSWORD, env.BOSS_KEY]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

export function assertCronTickResponse(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.accepted === true && value.busy !== true) return { accepted: true };
    if (value.accepted === false && value.busy === true) return { accepted: false, busy: true };
  }
  throw new Error("Apollo Bulletin cron endpoint did not confirm an accepted or busy tick");
}
