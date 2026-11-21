# Apollo Bulletin work resumer checkpoint

- Foundation PR #552 is merged after GitHub Actions validation.
- PR #553 is the desktop Chrome/Chromium extension prototype; it is not merged or deployed.
- The latest pre-fix head was `8e8e4b89f6603d4b6ef9bfc58fc73a56e5156d9d`. Its PR validation run #807 and Hostless release-gate run #582 completed successfully. The Hostless deployment matrix was empty and both deployment jobs were skipped; no production deployment was performed by this work.
- Manual diff review found genuine safety/flow defects despite green CI: target lookup did not require the tab to be active; DOM checks did not verify visibility; an uncertain continuation retry could revert to the initial prompt; resuming a cycle-limited task did not reset its cycle budget; and an uncertain attempt could be bypassed by a later pending item.
- Fixes in progress: require one exact matching tab and that it is active in the last-focused window; require a visible page, visible enabled Send button, and visible composer; treat missing positive idle evidence as ambiguous; re-check focus before send; persist attempt phase and restore it only after explicit retry; reset the cycle budget only on explicit cycle-limit resume; block the queue behind an unresolved uncertain attempt.
- Queue dispatch remains local to the user's desktop browser profile and uses only the visible signed-in ChatGPT UI. There is no auth bypass, private endpoint, API key, cloud browser, or production deployment.
- A Send click is not delivery confirmation. Uncertain sends are never retried automatically.
- Automated validation and a real desktop browser smoke test are separate: CI can test logic, DOM visibility decisions, exact URL/focus guards, and script syntax; the owner still needs to perform the documented manual browser test after merge.
- Next: validate the corrected PR head, fix any failing checks, merge only when the exact latest head is green, then leave the owner installation/manual-test steps ready. No production deployment.
