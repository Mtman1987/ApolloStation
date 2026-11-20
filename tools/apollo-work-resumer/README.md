# Apollo Bulletin Work Resumer (prototype)

This is a fail-closed prototype for a browser-assisted work queue. It is not a production scheduler or a ChatGPT integration.

## Supported boundary
A browser extension/content script can inspect the active ChatGPT tab and interact with its visible UI only while the user is signed in and the exact conversation URL is configured. It cannot guarantee ChatGPT's backend state or safely infer UI changes from button placement. DOM labels/selectors can change, so unknown states pause rather than send.

## Intended flow
1. User creates a queue entry with a prompt and a designated conversation URL.
2. Scheduler tick checks enabled/paused state and cycle limit.
3. Browser guard verifies exact conversation, composer, idle/send control, no stop/busy control, no recent submission, and pending prompt.
4. Only if every check passes, fill composer and activate the visible send control.
5. Persist submission id/time and cycle count; subsequent ticks cannot duplicate it.
6. User can pause/stop, manually tick, set max cycles, and inspect activity log.
7. Completion is explicit (queue item marked complete or configured completion phrase), never inferred from silence.

## Prototype
The current code provides pure safety decision logic and a DOM snapshot reader. A real persistent scheduler, extension permissions, UI, and end-to-end browser test remain follow-up work. The code deliberately requires an exact conversation URL and fails closed on ambiguous DOM state.
