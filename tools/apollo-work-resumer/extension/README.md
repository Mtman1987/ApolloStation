# Apollo Bulletin local Chrome extension proof

This prototype uses the user's existing signed-in desktop Chrome/Chromium profile. It does not launch a new browser, copy cookies, request a password, or deploy a headless browser.

## One-time setup

1. Open `chrome://extensions` in desktop Chrome/Chromium and enable **Developer mode**.
2. Choose **Load unpacked** and select `tools/apollo-work-resumer/extension` from the ApolloStation checkout.
3. The extension opens a background tab for the private ApolloStation PR #553 command inbox. Sign in to GitHub in that tab if prompted.
4. Open the exact live ChatGPT conversation you intend to target and leave that conversation tab active.

## Run a harmless manual proof

1. Open the repository's **Actions** tab.
2. Select **Apollo local Chrome proof** and choose **Run workflow**.
3. Paste the exact conversation URL, such as `https://chatgpt.com/c/<conversation-id>` (not a `/share/` URL), and a harmless test prompt.
4. The workflow validates the URL and posts a one-time command comment to PR #553.
5. The extension polls that signed-in GitHub page, accepts only the GitHub Actions bot's command from that exact inbox page, and sends it only when one exact matching ChatGPT tab is active.
6. Confirm the prompt appears in the target conversation. Open the Apollo Bulletin extension popup to inspect queue status and the activity log.

## Queue behavior and safeguards

- Manual queue entries require an exact `https://chatgpt.com/c/<id>` URL. A unique matching tab must be the active tab; duplicate matches, inactive tabs, and URL mismatches are skipped.
- The composer must be empty before the extension fills it. A visible Send control must exist before filling and must become enabled afterward. Existing drafts are never overwritten.
- Each task receives a unique completion marker. The extension checks only the latest assistant message after the UI is idle; the marker must appear on its own line.
- The task queue is serialized. An uncertain send blocks later queue items until the owner explicitly marks it complete or confirms a manual retry. Uncertain sends are never automatically retried.
- A confirmed click changes the task to active, but a click is not independent proof that ChatGPT accepted or completed the message.
- Hourly alarms run only while enabled and unpaused. Pause, resume, stop, run-now, max cycles, manual completion, explicit retry, and cycle-limit resume are available in the popup.
- Resuming a cycle-limited task starts a new cycle window. A manually confirmed retry takes priority over ordinary pending work.
- Selector changes, ambiguous UI state, missing content scripts, and missing/inactive tabs fail closed.

## Safety boundaries

- The workflow runs on GitHub-hosted infrastructure; the local extension is the bridge to the user's already-authenticated Chrome session. No self-hosted runner, remote-debugging port, personal access token, or ChatGPT auth bypass is used.
- The extension host permissions are limited to ChatGPT and the single fixed private PR inbox page.
- The prompt and conversation URL appear in the PR comment. Keep the repository private and use harmless test text; do not send secrets or sensitive content through this proof.
- This is a private development proof, not a multi-user-secure production feature. No production deployment is part of installation or testing.
