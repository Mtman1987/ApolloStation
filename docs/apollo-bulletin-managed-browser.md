# Apollo Bulletin dedicated ChatGPT browser

Apollo Bulletin now has a separate Playwright/Chromium worker. It never attaches to, shares, or takes control of the Lounge browser.

## Hostless setup required before enabling

Hostless deletes `/tmp`, `/root`, and `/app/.cache` when a process starts. The ChatGPT browser profile must therefore be stored on a Hostless volume.

1. In the `apollo-node-1` Hostless app, open **Storage → Volumes**.
2. Create or attach a volume and mount it at `/data`. Keep the app at one replica.
3. In the app's environment, set `APOLLO_BROWSER_PROFILE_PATH=/data/apollo-browser/profile`.
4. Deploy Node 1 again.

Do not point this setting at `/tmp`, `/root`, or `/app/.cache`. Do not store the profile in GitHub or commit browser cookies.

The existing `scripts/setup-local-browser.mjs` provisions the pinned Chromium 153 runtime from the checked-in `scripts/local-browser/package-lock.json`. The worker starts only when the persistent profile path is configured; otherwise the ChatGPT destination fails closed with `persistent-browser-profile-not-configured`. The simulator remains available.

## Owner sign-in

After the volume is attached and the worker starts, sign in to Apollo and open:

`/bulletin/browser`

This page is behind the Apollo SPMT session check. Select **Open ChatGPT sign-in**, then use the private browser preview to sign in. The profile stays on the mounted volume across Hostless restarts and deployments. Do not share the profile directory or browser screenshots.

## Dispatch behavior

- Only `https://chatgpt.com` URLs are accepted.
- The worker uses its own persistent Chromium profile.
- It checks for a signed-in ChatGPT session before submitting.
- It records a receipt only after an assistant response appears.
- A timeout or ambiguous send is marked uncertain and is not automatically retried.
- Browser controls are available only through the Apollo owner-session-gated Bulletin proxy.
- The worker does not access or control Lounge's browser.

## Current boundary

The browser is a user-operated ChatGPT session, not an official ChatGPT API integration. The owner can sign in from a phone through the Apollo browser console; no desktop extension is required. ChatGPT tasks must use an exact `https://chatgpt.com/c/<conversation-id>` URL. The worker refuses shared links, non-ChatGPT URLs, existing drafts, hidden/disabled Send controls, and redirects away from the target conversation. It clicks Send at most once per cycle and marks uncertain outcomes for owner review without automatic retry.

The Bulletin task queue adds a unique completion marker and bounded continuation loop. Each response is checked for the marker on its own line. If absent, the task continues after 60 seconds until the configured 1–100 cycle limit; then it pauses for owner review. An explicit review request also pauses the task. The task queue, cycle count, activity history, and browser profile are stored beneath `/data`; attach a persistent Hostless volume at that mount before using real tasks.
