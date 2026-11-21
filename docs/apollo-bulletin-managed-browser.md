# Apollo Bulletin hosted ChatGPT browser

Apollo Bulletin uses its existing Node 1 Playwright/Chromium worker. It never attaches to, shares, or takes control of the Lounge browser. The owner uses the Apollo console from a phone; no desktop extension is required.

## Persistence

No Hostless volume is used. The queue, activity log, and Playwright browser storage state (cookies, local storage, and IndexedDB) are stored in the existing shared Turso database. A single embedded Hostless cron job, configured in `hostless.yaml`, wakes every minute and processes at most one due task. The Hostless app's in-process polling loop is disabled in production; Hostless owns the schedule and run history. This is one dispatcher for the queue, not one cron job per task.

Node 1 requires:
- `TURSO_DATABASE_URL` or `SHARED_TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN` or `NODE1_TURSO_AUTH_TOKEN`

Node 1 sets `APOLLO_BULLETIN_REQUIRE_TURSO=1` and fails closed if those settings are missing. The cron command calls the owner-protected `/bulletin/api/cron/tick` endpoint using `APOLLO_BULLETIN_CRON_TOKEN` or `APOLLO_BROWSER_CONTROL_PASSWORD`. The temporary Chromium working directory can be recreated after a restart because the browser storage state is restored from Turso. The pinned Chromium runtime is provisioned by `scripts/setup-local-browser.mjs`.

## Owner sign-in from a phone

1. Sign in to Apollo in the phone browser.
2. Open `/bulletin/browser` on the Apollo Node 1 origin.
3. Authenticate with the existing owner-protected browser console.
4. Use the live screenshot, tap controls, and text field to sign in to ChatGPT in the isolated Apollo browser.
5. Open the conversation for the assistant/custom GPT you want the resumer to use (for example, your SPMT helper conversation), then copy that conversation's exact URL into the Bulletin task.
6. Wait for the browser status to show the signed-in ChatGPT page. Browser interactions persist the updated storage state to Turso.

The ChatGPT browser session is separate from the ChatGPT app session on the phone. The console lets the owner operate that dedicated hosted browser from the phone; it does not take control of the ChatGPT Android app or this current conversation.

The worker does not choose or switch custom GPTs, models, or connected apps. It continues only the exact conversation URL supplied with the task, so select the intended helper conversation first.

## Dispatch behavior

- Only exact `https://chatgpt.com/c/<conversation-id>` conversation URLs are accepted; shared links, query strings, fragments, and other origins are rejected.
- The worker uses only the visible signed-in ChatGPT UI. It does not use private endpoints, bypass sign-in, or call an unofficial ChatGPT API.
- Existing unsent composer drafts are never overwritten.
- A visible Send control must become enabled after the worker fills an empty composer. It clicks at most once per cycle.
- It waits for a new assistant response and idle composer state before recording a receipt.
- A timeout or ambiguous send is marked uncertain and is never automatically retried.
- Browser controls remain owner-protected and are routed through the existing Apollo Bulletin proxy.
- The worker does not access or control Lounge's browser.

## Bounced work

Each ChatGPT task receives a unique completion marker and a configurable 1–100 cycle limit (default 8). If the response does not contain the marker on its own line, the next continuation is queued for 60 seconds later. A genuine completion marker ends the task. An explicit owner-review request or exhausted cycle budget pauses it for review. Uncertain sends are never automatically continued or retried.
