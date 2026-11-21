# Apollo Bulletin work resumer checkpoint

- The desktop Chrome extension remains in the repository as an optional desktop-only tool. It is not the owner workflow and is not required on Android.
- Apollo-native Bulletin is integrated into SpaceMountain Overlay Bay with Task Queue, Active Task, Review Requests, Activity Log, Scheduler, and Task History widgets. Node 1 serves the API and dedicated Chromium console through the existing integrated-server proxy.
- Hosted implementation branch: `fix/apollo-bulletin-hosted-resumer`; PR #590 is open pending exact-head validation.
- Implemented on this branch:
  - Real task targets are restricted to exact `https://chatgpt.com/c/<conversation-id>` URLs; shared links, query strings, fragments, other origins, and missing targets are rejected.
  - The dedicated hosted Chromium worker uses the visible signed-in ChatGPT UI. It preserves an existing composer draft, requires a visible enabled Send control after filling an empty composer, clicks at most once, and waits for an assistant response. Ambiguous outcomes are marked uncertain and never retried automatically.
  - Bulletin tasks carry a unique completion marker and configurable 1–100 cycle limit (default 8). Incomplete responses queue a continuation after 60 seconds. A completion marker ends the task; a cycle limit or explicit owner-review request pauses it for review.
  - The task form exposes the exact conversation URL and maximum cycle count. The simulator remains a separate non-AI test target.
  - Queue state, activity history, and Playwright storage state (cookies, local storage, IndexedDB) use the existing shared Turso database through `SHARED_TURSO_DATABASE_URL` and `NODE1_TURSO_AUTH_TOKEN`. The temporary Chromium working directory is disposable; browser storage state is restored from Turso at startup and saved after owner browser interactions and task sends. No Hostless persistent volume is required.
  - Node 1 sets `APOLLO_BULLETIN_REQUIRE_TURSO=1`, so the hosted service fails closed if the shared Turso URL or Node 1 read/write token is missing.
- Added `tests/apollo-bulletin-hosted-worker.test.mjs` for exact target validation, required target input, persisted bounded continuation, Turso queue/session storage, and server-to-store wiring. The existing Overlay Bay test explicitly uses the simulator destination.
- Previous PR validation exposed an escaped regular-expression syntax error in the URL validator; that was corrected. A later inspection also caught and corrected an incomplete persistence wiring change before the final PR head.
- No production deployment has been performed by this branch.
- Next: wait for PR #590 checks on the latest head, inspect/fix any failures, merge only when green, then deploy Node 1 and complete the owner sign-in and one-cycle smoke test from the phone.
