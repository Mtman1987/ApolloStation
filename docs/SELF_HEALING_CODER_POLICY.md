# Self-healing coder policy

## Objective

Resolve routine engineering failures autonomously, reduce time spent waiting on serial test queues, and make each proven repair reusable. The agent is responsible for investigation, bounded repair attempts, validation, and documenting what it learned. Human involvement is for genuine blockers or decisions—not the default response to a failed test.

## Required issue-navigation flow

For each failure:

1. **Capture evidence.** Save the workflow/run URL, failing job and test names, relevant logs, commit SHA, environment, and whether the failure is reproducible. Distinguish assertion failures from setup failures, timeouts, flaky behavior, and infrastructure failures.
2. **Search before solving.** Search this playbook, repository documentation, blame/history, related tests, recent commits, and matching issues/PRs. Reuse a prior fix only when its preconditions match the current failure.
3. **Reproduce and diagnose.** Run the smallest relevant test or diagnostic first. Identify a root-cause hypothesis and what evidence would confirm or reject it.
4. **Repair in bounded attempts.** Prefer a minimal, reversible change. After each meaningful attempt, run the focused test. If it fails, inspect the new evidence and revise the hypothesis rather than repeating the same action. Default to at most three materially different repair attempts per failure before escalating; stop earlier if evidence shows the next action is unsafe or requires a human decision.
5. **Check for wider regressions.** Run relevant neighboring tests, then the full parallel Oracle suite after a batch of fixes. Read the consolidated report and shard logs; unrelated failures may expose pre-existing defects that deserve their own diagnosis.
6. **Learn from success.** Add or update a playbook entry only after the fix is supported by passing validation. Record the symptom/signature, root cause, exact change or commands, passing test(s), commit/PR/run evidence, limitations, and conditions under which the fix is safe to reuse. If the repair is not yet proven, record it as an unresolved investigation, not a proven fix.
7. **Close the loop.** Summarize what changed, what passed/failed, what remains, and the next action. Never say “fixed” when required checks are still red or unrun.

## Parallel testing policy

- Use targeted tests for rapid feedback while debugging.
- Use the four-shard Oracle release-validation workflow for full-suite regression discovery; shards should run concurrently, with fail-fast disabled so one shard's assertion failures do not hide results from the others.
- Each shard must retain complete test output and a machine-readable or parseable summary. The aggregate report must include totals and actionable failure details.
- The Oracle diagnostic workflow reports PASS when every assigned test file in all four shards completed and the consolidated artifact captured the results, even when assertions failed. Assertion failures must be counted and shown in failure triage; they do not make a diagnostic run incomplete. A diagnostic PASS means execution completed, not that all assertions passed. Release approval must separately inspect the reported test failures and use the dedicated quality gate.
- A missing report, incomplete shard, runner crash, timeout, cancellation, build/setup failure, or absent test summary is a validation failure, not a pass.
- Batch related fixes to avoid rerunning a long full suite after every tiny edit, but do not postpone focused feedback so long that failures become hard to attribute.
- Never remove, skip, quarantine, or weaken a failing test solely to obtain a green result. Change a test only when its expectation is demonstrably wrong and the change is explained and independently validated.

## Escalation rules

Ask the owner for help only when one or more of these is true:

- The bounded, evidence-based repair attempts are exhausted and the issue remains unresolved.
- Required credentials, permissions, external access, or owner-only approval are missing.
- Evidence supports multiple plausible product behaviors and choosing one would change user-facing behavior.
- The next action could destroy data, cause an irreversible migration, affect unrelated tenants, expose secrets, or create a significant production risk.
- Tests cannot establish correctness and a human judgment is genuinely required.

An escalation must be concise and actionable: include the failure, relevant run/log links, what was investigated, the attempts already made, why each failed, current best hypothesis, and the exact decision/access needed. Do not ask the owner to repeat work the agent can safely perform itself.

## Deployment safety

- Do not deploy while required release checks are failing, incomplete, or unavailable unless an explicit emergency override is authorized. State the residual risk.
- Keep production deployment and release approval distinct from test-report generation.
- After deployment, run the appropriate smoke checks and inspect fresh production logs. Roll back or follow the established recovery procedure when evidence shows a regression.
- Do not automatically repeat an uncertain or potentially non-idempotent production action. First verify whether the earlier action completed.
- Never print secrets, copy them into logs, or place private runtime credentials in the playbook.

## Reusable-fix entry format

Add entries under a suitable issue/topic heading with:

- **Failure signature:** exact error/test name and observable conditions.
- **Root cause:** evidence-backed explanation.
- **Proven resolution:** minimal code/config change or diagnostic procedure.
- **Validation:** test names, pass result, commit/PR, and workflow run.
- **Reuse conditions:** when this method applies and when it does not.
- **Follow-up:** known limitations or monitoring needed.

The durable memory should be versioned, searchable, and reviewed like code. Do not store secrets, personal data, or unverified guesses as facts.
