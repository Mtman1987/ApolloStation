# Apollo Bulletin — open-URL proof

This is the deliberately minimal owner-development prototype. It is not production-secure: the review URL is an unguessable task-specific capability, but there is no login gate, signature, expiry, or authorization layer. Keep this service on the private development deployment only.

## Hostless preview

Node 1 launches the Bulletin service on loopback port 3210 and SpaceMountain exposes it at:

`/bulletin`

Set `APOLLO_BULLETIN_PUBLIC_URL` to the actual public node-1 origin if it differs from the default. Set `APOLLO_BULLETIN_STATE_PATH` to a persistent Hostless volume path; the current fallback is `/tmp/apollo-bulletin/state.json` and is not durable across container replacement.

## First proof behavior

- Create a named task with a prompt, ChatGPT URL, and hourly/daily/manual schedule.
- The scheduler persists dispatch intent before invoking its adapter.
- A dispatch is attempted once. An uncertain result is recorded and never automatically retried.
- The prompt includes a task-specific open review URL and tells the AI to maintain a TODO/checkpoint/handoff, report validation evidence and blockers, and stop after requesting review.
- Opening `/bulletin/review/<task-key>` marks the task `awaiting_review` and clears its next run. Reopening is idempotent.
- Owner controls can pause, resume, run once, or mark complete.

## Current limitation

The browser adapter is intentionally a stub that reports `browser-adapter-not-connected`. The queue, UI, scheduling, open review signal, pause state, and activity history are the first proof; Puppeteer/Chromium session reuse and actual ChatGPT dispatch are the next integration step. No AI response monitoring or parsing is implemented. The prototype is not production-ready and must not be exposed publicly.
