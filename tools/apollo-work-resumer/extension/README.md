# Apollo Bulletin local extension prototype

This extension is a guarded local Chrome/Chromium prototype. Load it from `tools/apollo-work-resumer/extension` using **Load unpacked** in the browser's extensions page.

## Current controls
- Add a task with its exact ChatGPT conversation URL.
- Run now (only when that conversation is the active tab).
- Hourly alarm, pause, resume, and stop.
- State, queue, cycle count, and activity log stored in Chrome local storage.
- Fail-closed checks: exact URL, idle indicators, visible enabled send control, composer, cooldown, cycle cap.
- A queue item is marked attempted before clicking. Uncertain sends are not retried automatically to avoid duplicate messages.

## Limitations
- The extension requires Chrome/Chromium desktop and installation by the user; it cannot control ChatGPT's Android app or this ChatGPT session directly.
- The active target tab must be the exact queued conversation when a scheduled tick occurs. Otherwise it logs a skip.
- A click on Send is not proof that ChatGPT accepted or completed the task. Queue completion is a manual action/API step not yet exposed in the popup.
- UI selectors may change; unknown UI state blocks sending.
- Prototype only; no deployment or auth bypass.
