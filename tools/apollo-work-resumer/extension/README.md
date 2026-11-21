# Apollo Bulletin local Chrome extension proof

This prototype uses the user's existing signed-in desktop Chrome/Chromium profile. It does not launch a new browser, copy cookies, request a password, or deploy a headless browser.

## One-time setup

1. Open `chrome://extensions` in desktop Chrome/Chromium and enable Developer mode.
2. Choose **Load unpacked** and select this extension folder.
3. The extension opens a background tab for the private ApolloStation PR #553 command inbox. Sign in to GitHub in that tab if prompted.
4. Keep the GitHub inbox tab and the target ChatGPT conversation tab open in Chrome.

## Trigger the proof from GitHub Actions

1. Open the repository's **Actions** tab.
2. Select **Apollo local Chrome proof** and choose **Run workflow**.
3. Paste the exact live conversation URL (for example, `https://chatgpt.com/c/<conversation-id>`; never a `/share/` URL) and a harmless test prompt.
4. The workflow validates the URL and posts a one-time command comment to PR #553.
5. The extension polls that GitHub page, accepts commands only from `github-actions[bot]`, validates the target URL again, and submits the prompt to the matching ChatGPT tab.
6. Check the ChatGPT tab and the extension popup activity log. The popup distinguishes a click being issued from confirmed delivery; a click alone is not proof that ChatGPT accepted the message.

## Safety boundaries

- The workflow runs on GitHub-hosted infrastructure; the local extension is the bridge to the user's already-authenticated Chrome session. No self-hosted runner or Chrome remote-debugging port is required.
- The extension has host access only to ChatGPT and the single fixed private PR inbox page. It does not have broad GitHub API access or a personal access token.
- Commands are accepted only from the GitHub Actions bot comment on PR #553, are deduplicated by workflow run ID, and require an exact `chatgpt.com/c/` conversation URL.
- The prompt and conversation URL are visible in the PR comment. Keep the repository private and use a harmless test prompt; do not send secrets or sensitive content through this proof.
- The local queue must be empty before a workflow command is accepted. Uncertain sends are not automatically retried.
- This is a private development proof, not a multi-user-secure production feature. Complete the privacy/security review before exposing it to other users.
