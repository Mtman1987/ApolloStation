# Apollo Bulletin work resumer checkpoint

- The original desktop extension remains in the repository as an optional desktop-only tool. It is not the owner workflow and is not required on Android.
- The phone-accessible Apollo-native Bulletin already exists inside SpaceMountain Overlay Bay, with Task Queue, Active Task, Review Requests, Activity Log, Scheduler, and Task History widgets. Node 1 serves its API and dedicated Chromium console through the existing integrated-server proxy.
- Hosted implementation branch: `fix/apollo-bulletin-hosted-resumer`.
- Implemented on this branch:
  - Real task targets are restricted to exact `https://chatgpt.com/c/<conversation-id>` URLs; shared links, query strings, fragments, other origins, and missing targets are rejected.
  - The dedicated hosted Chromium worker uses the visible signed-in ChatGPT UI. It preserves an existing composer draft, requires a visible enabled Send button after filling an empty composer, clicks at most once, and waits for an assistant response. Ambiguous outcomes are marked uncertain and never retried automatically.
  - Bulletin tasks now carry a unique completion marker and configurable 1–100 cycle limit (default 8). Incomplete responses queue a continuation after 60 seconds. A completion marker ends the task; a cycle limit or explicit owner-review request pauses it for review.
  - The task form exposes the exact conversation URL and maximum cycle count. The simulator remains available as a separate non-AI test target.
  - Node 1 queue state and browser profile default to `/data/apollo-bulletin/state.json` and `/data/apollo-browser/profile`.
  - Documentation now describes phone-based sign-in through `/bulletin/browser`; no desktop extension is required.
- Added `tests/apollo-bulletin-hosted-worker.test.mjs` for exact target validation, required target input, and persisted bounded continuation.
- Important hosting prerequisite: Node 1 must have a persistent Hostless volume mounted at `/data`. Without that volume, browser login and queue state can be lost on container replacement. This must be verified before a production deployment is called durable.
- No production deployment has been performed by this branch yet.
- Next: run PR validation on the complete branch, fix any failures, merge only after green, verify Node 1 volume availability, then deploy Node 1 and complete the owner sign-in / one-cycle manual smoke test from the phone.
