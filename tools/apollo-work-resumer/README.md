# Apollo Bulletin Work Resumer (prototype)

Fail-closed infrastructure for a browser-assisted work queue. This is not yet a packaged extension or a live ChatGPT integration.

## Modules
- `guard.mjs`: conservative conversation/idle/composer guard.
- `state-store.mjs`: atomic local checkpoint writes and capped activity log.
- `queue.mjs`: queue item validation, hashing, enqueue, and explicit completion.
- `scheduler.mjs`: hourly default scheduler, manual tick, pause/resume/stop, serialized ticks, persisted send intent, and adapter boundary.

## Safe operation
- Configure an exact `https://chatgpt.com/c/<conversation>` target per queue item.
- Adapter snapshot must positively confirm idle state, composer ready, and send control visible.
- Unknown UI state, busy state, wrong conversation, duplicate queue item attempt, cooldown, or cycle limit never sends.
- Submission intent is saved before the adapter action; an unconfirmed send is not automatically retried, avoiding accidental duplicate messages.
- Queue completion is explicit. Submitted items remain submitted until marked complete; silence or an empty pending queue is not completion.

## Adapter boundary
The scheduler requires an injected `snapshot()` and `submit()` adapter. The current prototype does not yet package a browser extension, implement a browser UI, or connect to the user's live browser. Adapter work must use the visible signed-in UI, not private endpoints or authentication bypasses.

## Validation
Node tests are included. CI is required before merge; no deployment is part of this prototype.
