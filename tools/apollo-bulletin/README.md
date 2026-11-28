# Apollo Bulletin — Personal Overlay Bay preset

Apollo Bulletin is a preset inside the existing SpaceMountain Overlay Bay editor. It is not a second workspace or a standalone task dashboard.

## Use it

1. Open Apollo Workspace → Overlay Bay.
2. Select **Personal** output.
3. Choose **Personal Bulletin** in the editor header. This creates a saved Personal Bulletin scene and selects it for the Personal output.
4. The initial scene stays mostly open: it places small frames for installed Mission Control, StreamWeaver, and Discord Stream Hub apps when those apps are available, plus a Task Queue component.
5. Add other sources from the existing app-frame list or the **Bulletin components** list, then move, resize, layer, lock, hide, duplicate, remove, and save them using the normal Overlay Bay editor.

The preset uses the existing revision-aware workspace scene persistence and Personal overlay output.

## Reusable Bulletin components

The editor exposes these widget sources under **Bulletin components**:

- Task Queue — create tasks and inspect/pause/resume/complete them.
- Active Task — current dispatching, dispatched, and review-waiting work.
- Review Requests — work waiting for explicit owner review.
- Activity Log — recent task lifecycle events.
- Scheduler — scheduled tasks and next run times.
- Task History — completed and uncertain/failed dispatches.

Each component is a normal Overlay Bay widget source with its own renderer URL and saved geometry. The task data remains in the Bulletin service; the scene stores only component configuration and layout.

Installed app frames are populated from the existing SpaceMountain app registry and use each app's registered launch URL. The task component renderer URLs are served from /bulletin/widgets/<component> and use the existing /bulletin/api/tasks service routes. /bulletin itself is only a small handoff page, not the primary dashboard.

## Hostless

Node 1 starts the Bulletin API/renderer on loopback port 3210. SpaceMountain's existing integrated server proxies /bulletin/* to that service. The Personal Overlay output embeds the widget renderers through the existing SPMT output gateway.

The Node 1 app uses one embedded Hostless cron job, `apollo-bulletin-resumer`, configured in the root `hostless.yaml`. It wakes once per minute and asks the existing Bulletin service to process at most one due task. Hostless owns the schedule and run history; task schedules, continuation state, and activity remain in Turso. Do not create a separate Hostless cron job per task. The cron endpoint uses the first nonblank value from `APOLLO_BULLETIN_CRON_TOKEN`, `APOLLO_BROWSER_CONTROL_PASSWORD`, or `APOLLO_PREVIEW_PASSWORD`. The only other session exception is a GET to an exact UUID review-capability URL; the child service validates the key and returns a minimal review page. The retired `BOSS_KEY` is never used.

Set `APOLLO_BULLETIN_PUBLIC_URL` to the public Node 1 origin if it differs from the current default. Queue and browser session persistence use the existing shared Turso database, not a Hostless volume. Node 1 accepts `TURSO_DATABASE_URL` or `SHARED_TURSO_DATABASE_URL`, paired with the existing shared runtime `TURSO_AUTH_TOKEN` (preferred) or `NODE1_TURSO_AUTH_TOKEN` (fallback). The shared runtime token is selected first because the node-scoped GitHub tokens are verified read-only by the current live write probe. The Node 1 process disables its own polling loop when Hostless cron is enabled.

## Deliberate prototype boundary

- The scheduler persists dispatch intent before invoking its adapter and never automatically resends an uncertain dispatch.
- ChatGPT tasks use the dedicated hosted Chromium browser and the visible signed-in ChatGPT UI. The owner signs in through the phone-accessible `/bulletin/browser` console; the worker accepts only exact `https://chatgpt.com/c/<id>` targets, never overwrites a draft, requires a visible enabled Send control, and waits for an assistant response.
- ChatGPT tasks use a unique completion marker and a configurable 1–100 cycle limit (default 8). Incomplete responses schedule a continuation after 60 seconds. A completion marker ends the task; a cycle limit or explicit owner-review request pauses it for review. Uncertain sends are never retried automatically.
- The simulator remains a separate safe test destination and does not exercise real ChatGPT delivery.
- The existing repo documents the Apollo-native terminal backend as unfinished. No fake terminal frame or second terminal backend is introduced; the existing Mission Control/operations app frame is reusable, but a real terminal panel still needs the missing backend.
- Ordinary task and browser APIs require the canonical SPMT platform-owner session. A review URL is a random UUID capability, GET-only, and exposes only the task name and review instructions; opening it writes a separate one-shot Turso review signal that the active dispatcher consumes without overwriting the queue row. Treat the URL as a secret and do not publish it.
- AI response monitoring is limited to visible assistant-response completion and the unique task completion marker; no private ChatGPT endpoints are used.


## Dedicated ChatGPT browser console

Node 1 exposes the isolated Chromium browser at `/bulletin/browser`. The browser opens `https://chatgpt.com/` and provides a live screenshot, restricted navigation to ChatGPT/OpenAI sign-in domains, click, and text-entry controls. Its Chromium profile is separate from Lounge and all other application browsers.

Node 1 uses the existing shared Turso database for the queue, activity log, and Playwright browser storage state (cookies, local storage, and IndexedDB). The Chromium working directory is temporary; the authenticated browser storage state is restored from Turso on startup and saved after owner browser interactions and task sends. Node 1 requires `SHARED_TURSO_DATABASE_URL` and `NODE1_TURSO_AUTH_TOKEN`; it fails closed at startup if those are missing. No Hostless persistent volume is required.


The integrated gateway requires a canonical SPMT session with `platformOwner: true` for every ordinary Bulletin route; an optional `APOLLO_BULLETIN_OWNER_ACTOR_ID` pin can narrow access further. Exact UUID review-capability GETs are the sole non-cron exception and are validated again by the Bulletin service. The browser console additionally uses the existing owner HTTP Basic credential (`APOLLO_BROWSER_CONTROL_PASSWORD`); it is designed for mobile use and streams a screenshot with tap/text controls, so no desktop browser extension is required. Use username `owner` and the password configured as `APOLLO_BROWSER_CONTROL_PASSWORD`; if that is not set, the service falls back to `APOLLO_PREVIEW_PASSWORD`. If neither existing credential exists, the console fails closed rather than exposing a logged-in browser publicly. The cron dispatcher reuses the existing credential fallback order (`APOLLO_BULLETIN_CRON_TOKEN`, `APOLLO_BROWSER_CONTROL_PASSWORD`, `APOLLO_PREVIEW_PASSWORD`), skips blank values, and never uses the retired `BOSS_KEY`. Pause/stop requests are stored as separate one-shot Turso control signals so a second Hostless instance can request a control without overwriting the active dispatcher queue. The scheduler defaults wall-clock schedules to `America/Chicago`, persists the IANA timezone, and readiness requires a recent completed cron tick rather than an accepted or still-running request. Unknown task destinations are rejected instead of silently defaulting to live ChatGPT.
