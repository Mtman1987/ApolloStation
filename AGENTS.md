# ApolloStation release workflow

## Default repair loop

Act as a self-healing coding agent: diagnose, attempt a bounded repair, verify it, and preserve reusable learning before asking the owner to intervene. Read [the self-healing coder policy](docs/SELF_HEALING_CODER_POLICY.md) and the nearest `AGENTS.md` before editing.

- Search the repository, recent commits, issues/PRs, test history, and the proven-fix playbook for a matching failure before inventing a new approach.
- Reproduce the failure and identify its likely root cause. Prefer the smallest fix supported by evidence.
- Attempt fixes autonomously within the policy's retry and safety limits. After each meaningful repair, run focused tests; use the full parallel validation suite to detect unrelated regressions.
- When a fix works, record the symptom, root cause, exact resolution, validation evidence, and safe reuse conditions in the playbook so future runs can navigate the issue without asking again.
- Escalate only when the bounded repair loop is exhausted, evidence is contradictory, required access/secrets are missing, a product decision is ambiguous, or the next action is destructive/high-impact. Escalation must include attempts, logs, hypotheses, and the precise decision needed.
- Never hide a failure, weaken a test merely to make it green, claim unrun checks passed, or deploy a failing release.

## Validation strategy

Prefer the GitHub Actions **Oracle release validation** workflow for broad regression discovery. It runs four test shards concurrently and aggregates all shard logs. Start it from [the workflow page](https://github.com/Mtman1987/ApolloStation/actions/workflows/oracle-release-validation.yml). Do not wait for one long serialized full suite after each small repair when targeted tests and parallel shards are available.

1. Run the smallest relevant test set after a repair for quick feedback.
2. Run the full parallel Oracle suite after a batch of related fixes and before release.
3. Inspect the consolidated report and every shard log, including failures outside the files just changed.
4. Fix assertion failures in evidence-based batches; rerun affected tests, then repeat full parallel validation.
5. A shard reporting job may finish successfully when it has captured a complete test summary, even if assertions failed. The aggregate release quality gate must remain NO-GO unless all required tests pass.
6. Missing summaries/logs, runner crashes, timeouts, cancelled tests, build/setup failures, or incomplete shards are not passes.

Run `npm run validate:local` when the parallel workflow is unavailable, when local-only checks are needed, or when the change requires that exact local validation. Use Node 24, `npm ci --ignore-scripts`, FFmpeg, and Playwright Chromium (`npm run setup:browser` prepares a cached Linux browser without the Playwright CDN; other platforms may use `npx playwright install --with-deps chromium`). Fix failures before merging. User instructions can narrow validation for an urgent repair, but report the remaining risk explicitly.

## Deployment and production verification

GitHub Actions deploys main directly. Do not reintroduce automatic test jobs or make deployment depend on another workflow completing. Keep deployment build, rollback, and live build/health verification.

Do not call a change complete until its GitHub workflow and production smoke test pass. Deploy only when the required release gate passes; after deployment, check live health and relevant logs for regressions. If production verification fails, follow the documented rollback/recovery process and report the evidence.

## Runtime constraints

There is no local Qwen model for this deployment. Do not provision or launch Qwen or wait for it. Stella uses the existing OpenAI integration when its private credential is configured; AI availability must not block the rest of Apollo.
