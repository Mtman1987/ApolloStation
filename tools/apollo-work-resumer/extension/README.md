# Apollo Bulletin local extension prototype

Load this folder using **Load unpacked** in the Chrome/Chromium extensions page.

## Controls and behavior
- Add a task using its exact ChatGPT conversation URL.
- Run now (only when the target conversation is the active tab).
- Hourly alarm; runs only when the queued conversation is the active tab.
- Pause, resume, stop, max cycles (1–100), and activity log.
- Queue and checkpoint state are stored in Chrome local storage.
- Fail-closed checks: exact conversation URL, idle indicators, visible enabled send control, composer, cooldown.
- Before sending, the queue item is marked attempted; if the click is uncertain it is not automatically retried.
- A confirmed click moves the item to active. Later idle checks inspect the latest assistant response for its unique task completion marker. If absent, the resumer sends a short continuation prompt; the task instructions and checkpoint should be maintained in the conversation.
- Each queued task receives a unique completion token. The assistant must output that token to signal completion. The user can also manually mark an active/attempted/limited item complete.
- Browser notification alerts are shown when a task completes or reaches its cycle limit. The resumer stops its alarm when all queued tasks are completed.
- Uncertain submissions are never automatically retried; the popup offers an explicit “Retry (check first)” action with a duplicate-risk confirmation.
- Max cycles are per task. After the limit, no further sends occur; completion can still be detected on an idle check or manually marked.

## Limitations and safeguards
- Requires Chrome/Chromium desktop and user installation. It cannot control the ChatGPT Android app or this current ChatGPT conversation.
- The target tab must be active when a scheduled tick occurs; otherwise the task is skipped and logged.
- A send click is not proof that ChatGPT accepted or completed the task.
- DOM selectors may change. Unknown UI state blocks sending.
- Prototype only; no deployment or auth bypass.
