# ApolloStation contributor and AI-agent workflow

## Merge first; diagnose from the main-branch run

**Owner's explicit workflow instruction — takes precedence over older test-gating guidance in this repository:**

- When a repair or change is complete and the PR is ready, merge it to `main` immediately. Do not run, wait for, or require PR test checks before merging.
- Automated test failures, stale tests, flaky tests, red CI statuses, and out-of-date validation must not prevent a completed PR from reaching `main`. Do not mistake a green test suite for proof that code was merged.
- Main-branch workflows run after the merge and deployment proceeds according to the existing automation. Use that post-merge run to collect test output and errors, then fix the actual causes and merge the next repair promptly.
- After each merge, confirm the merge commit is on `main`; inspect the post-merge workflow output and verify the deployed/live behavior. Report clearly if deployment or recovery fails.
- Do not disable or remove the post-merge test/diagnostic workflows. PR-triggered validation workflows should not run automatically; keep `workflow_dispatch` when useful for intentional manual diagnostics.
- Never claim a test passed if it did not run or failed. Tests are diagnostic feedback after merge, not a gate that blocks merge.
- If GitHub repository rules, permissions, or required status checks still prevent merging, identify that specific external restriction instead of silently waiting or claiming success.

## Repair quality

- Make the smallest evidence-based change that addresses the root cause.
- Review test output and logs after merge; fix root causes rather than suppressing errors or weakening tests merely to turn them green.
- Keep deployment, rollback/recovery, live health checks, and production verification available. If a deployment breaks the live app, prioritize diagnosis and recovery, then merge the fix.
- Do not claim deployment or production verification is complete until the available evidence confirms it.

## Runtime constraints

There is no local Qwen model for this deployment. Do not provision or launch Qwen or wait for it. Stella uses the existing OpenAI integration when its private credential is configured; AI availability must not block the rest of Apollo.

## Secrets and credential approval (owner-mandated)

- Reuse the existing GitHub Actions secrets and credentials already provisioned for ApolloStation. Do not invent, create, rename, duplicate, or proliferate secret names or credentials to solve a mapping or configuration problem.
- Runtime-secret synchronization may copy existing, explicitly mapped GitHub Actions secret values to Hostless Node 1 and Node 2. It must not create GitHub secrets or generate replacement credentials. Updating an existing GitHub secret is picked up by the next deployment that synchronizes it.
- Before adding any new secret name, external credential, API key, token, or secret-generation step, stop and ask the owner. Explain the exact external requirement and why none of the existing credentials can be reused. Proceed only if the owner explicitly approves that specific request; approval or denial applies only to that request.
- If approval is denied or not yet given, do not add the secret or build an alternate credential path. Reuse an existing credential where technically valid, or leave the integration unconfigured and report the concrete dependency.
- Never expose secret values in chat, commits, logs, workflow output, or verification reports. Verify presence using names/status only.
- Do not mistake adding a workflow mapping for creating a secret: mappings must reference already-existing repository secrets, and missing values must be reported rather than silently replaced or fabricated.
