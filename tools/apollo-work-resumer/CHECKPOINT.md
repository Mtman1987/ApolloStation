# Apollo Bulletin work resumer checkpoint

- Foundation PR #552 is merged after GitHub Actions validation.
- PR #553 is the desktop Chrome/Chromium extension prototype; it is open, not merged, and not deployed.
- Corrected implementation is committed on the current PR branch. It now requires one exact matching ChatGPT tab that is active in the last-focused window; checks page visibility, visible/enabled Send and composer controls, and positive idle evidence; and rechecks the active tab immediately before the send.
- Queue state is persisted as attempted before clicking. An uncertain attempt blocks later queued work. Explicit retry restores the prior phase (initial prompt or continuation) and is never automatic. Explicit resume after a cycle limit starts a fresh cycle budget while preserving prior-cycle count.
- Tests now cover exact URL and active-tab matching, duplicate tabs, uncertain queue blocking/retry phase, cycle-budget reset, visible/hidden DOM controls, ambiguous idle state, exact-URL mismatch, one-click behavior, manifest permissions, and script syntax.
- Previous pre-fix head `8e8e4b89f6603d4b6ef9bfc58fc73a56e5156d9d` had PR validation run #807 and Hostless release-gate run #582 complete successfully. In that release run the deployment matrix was empty and both deploy jobs were skipped.
- Corrected head `1c4f6c39bb1f35402088a8d3764730a656d63033` started PR validation run #895. Its Hostless release run #729 passed typecheck and skipped both deployment jobs; the target-detection job failed because the force-updated branch's previous SHA was no longer fetchable. This was a force-push history issue, not a deployment attempt. A follow-up commit on top of the corrected head will trigger a fresh run with a reachable parent SHA.
- Queue dispatch remains local to the user's desktop browser profile and uses only the visible signed-in ChatGPT UI. There is no auth bypass, private endpoint, API key, cloud browser, or production deployment.
- A Send click is not delivery confirmation. Uncertain sends are never retried automatically.
- The owner must still perform the documented manual desktop-browser smoke test after merge; CI cannot prove live ChatGPT DOM compatibility or delivery.
- Next: validate the new exact PR head, resolve any actual test failures, merge only when its required GitHub Actions checks are green, and retain the installation/manual-test instructions. No production deployment.
