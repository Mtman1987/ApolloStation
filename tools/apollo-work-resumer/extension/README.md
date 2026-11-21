# Apollo Bulletin local extension

This is a desktop Chrome/Chromium helper for the work-resumer queue. It uses the user's existing, visible ChatGPT session in that browser profile. It is not a cloud worker, an Apollo-hosted browser, or an Apollo overlay UI.

## Install

1. Download the repository source from the [ApolloStation main branch](https://github.com/Mtman1987/ApolloStation/archive/refs/heads/main.zip) and extract the ZIP.
2. Open `chrome://extensions` in desktop Chrome or Chromium.
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted `tools/apollo-work-resumer/extension` folder.
6. Pin **Apollo Bulletin Work Resumer** to the browser toolbar.
7. Sign in to `https://chatgpt.com` in this same browser profile.

## First manual test

1. Open the exact ChatGPT conversation you want to use. Keep that conversation as the active tab in the last-focused browser window.
2. Open the extension popup and set **Max cycles** to `1`.
3. Add a harmless test prompt, for example: `For this test, do not take any external action. Reply with APOLLO_BULLETIN_TEST_DONE.`
4. Copy the conversation's exact URL from the address bar into the URL field, then select **Add to queue**.
5. Select **Run now**. The extension checks that exactly one tab matches the URL, that it is the active tab, and that the visible ChatGPT page shows an idle composer and enabled Send control before it clicks.
6. Confirm the prompt appears in that conversation. A recorded click means only that the visible Send control was clicked; it is not proof of delivery or task completion.
7. After the response finishes, select **Run now** once more. If the task-specific completion marker is present, the item is marked complete. Otherwise the one-cycle limit stops further sends; inspect the conversation before choosing **Resume task** or **Mark complete**.

## Controls and behavior

- **Add to queue** stores the prompt, exact conversation URL, and a unique completion marker in this browser profile's Chrome local storage.
- **Run now** performs one guarded tick. Scheduled ticks run hourly and only when the exact target conversation is the unique matching tab and is active in the last-focused window.
- **Pause**, **Resume**, and **Stop** control scheduled ticks. **Max cycles** is configurable from 1 to 100 per task.
- Active tasks receive a short continuation prompt that asks ChatGPT to continue from its TODO/checkpoint and emit the unique completion marker only when genuinely finished.
- A queue item is persisted as attempted before the Send click. If the click result is uncertain, it is not retried automatically and it blocks later queue items until the user explicitly retries it or marks it complete.
- **Retry (check first)** requires confirmation because it can duplicate a send. An uncertain continuation retry resumes the continuation, not the original prompt.
- **Resume task** after a cycle limit starts a fresh cycle budget while retaining the prior-cycle count.
- Queue history and the last 200 activity events stay in this browser profile's local storage. No credentials or ChatGPT session data are read or exported by the extension.

## Safeguards and limitations

- Requires desktop Chrome/Chromium and the user's own signed-in ChatGPT UI. It cannot control ChatGPT Android or this current ChatGPT conversation.
- It never bypasses sign-in, calls private ChatGPT endpoints, or uses an API key.
- Exact URL mismatch, duplicate target tabs, a background target tab, hidden/disabled controls, an unknown busy state, or a hidden page all block sending.
- DOM changes may make the extension stop safely until its visible-control allowlist is updated.
- A Send click is not delivery confirmation. The user must inspect the conversation and explicitly resolve uncertain attempts.
- This is a local desktop prototype; no production deployment is part of this change.
