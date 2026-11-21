export function resolveCronToken(env = process.env) {
  return env.APOLLO_BULLETIN_CRON_TOKEN ||
    env.APOLLO_BROWSER_CONTROL_PASSWORD ||
    env.APOLLO_PREVIEW_PASSWORD ||
    "";
}
