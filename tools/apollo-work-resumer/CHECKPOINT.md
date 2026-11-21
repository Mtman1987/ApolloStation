# Apollo Bulletin work resumer checkpoint

- Foundation PR #552 merged after GitHub Actions validation passed.
- Extension PR #553: prototype/apollo-bulletin-extension; open for validation/review.
- Current prototype files: local Chrome/Chromium MV3 extension, popup queue controls, hourly alarms, pause/resume/stop, max cycles, exact conversation URL checks, active-task continuation prompts, unique completion marker detection, notifications, local state/activity log.
- Task sends are limited to the exact active ChatGPT conversation tab. UI must positively show idle, composer ready, and enabled Send control.
- Queue item is marked attempted before the Send click; uncertain clicks are not retried automatically. Confirmed click changes task to active; subsequent idle cycles send continuation prompts. Completion marker or manual completion ends item. When all items are complete, scheduler stops.
- Donor review: existing Apollo Restream-control code uses persistent browser profiles and strict visible-button allowlists. Its security principles were adapted (visible controls, strict matching, fail-closed) but its server-side Puppeteer controller was not reused because ChatGPT needs the user's own logged-in browser session. Searches did not locate a separate clicker implementation in the checked donor repositories.
- Limitations: requires user-installed desktop Chrome/Chromium extension; cannot operate the ChatGPT Android app or current ChatGPT conversation; completion marker depends on DOM selector; a send click is not independent proof of delivery.
- Latest code validation: PR CI pending as of this checkpoint. Do not merge PR #553 until the latest-head checks are green.
- Next steps: inspect latest CI; fix failures; merge if all required checks pass; prepare install/test instructions and run owner manual test. No production deployment.
