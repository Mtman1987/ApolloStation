# ApolloStation repo-first continuation — 2026-11-03

Read after [the follow-up handoff](APOLLO_PARITY_HANDOFF_2026-11-03_FOLLOWUP.md).
Baseline: main at `a0f18f94ba0e774cff18d01b4cf64f26cdfddc98`.

## Durable repair and permission blocker

The GitHub connector is now connected. Attempting to commit the workflow/test
repair returned `403 after trying upscoping`; the branch remained at baseline.
Connection does not establish workflow-write permission.

The tested companion changes are preserved in the repository at
[patches/parity-artifact-upload-20261103.patch](patches/parity-artifact-upload-20261103.patch).
This is reviewable source, not an active workflow change. It uses
`parity-evidence-${{ inputs.donor }}-${{ github.run_id }}` and adds regression
coverage for names, uniqueness and preserved app/commit provenance. All seven
upload paths, JSON validation and donor read-only boundaries remain unchanged.

Local validation of the applied pair: `node --test tests/apollo-parity-automation.test.mjs tests/parity-rea-cli.test.mjs` — **7 passed, 0 failed**; `git diff --check` passed.
Apply the workflow and test together with authorized workflow-write access:

```sh
git apply --check docs/production/patches/parity-artifact-upload-20261103.patch
git apply docs/production/patches/parity-artifact-upload-20261103.patch
node --test tests/apollo-parity-automation.test.mjs tests/parity-rea-cli.test.mjs
```

Do not merge the regression alone or rerun the old broken manual workflow.
Fresh sweeps remain blocked until the active workflow is repaired.
No new Oracle evidence, full build or live-provider acceptance is claimed here.

## Continuation

Continue the bounded HearMeOut room/tenant media authorization review without
changing workflow permissions. Inspect mounted routes and membership/revocation
tests, commit each tested batch to GitHub, and record exact evidence here.
No donor execution, production secrets, deployment or DNS changes. Apps remain offline.

The older `3580544` work was not recovered: its remote branch was absent and no
source bundle was available. Do not describe it as merged.
