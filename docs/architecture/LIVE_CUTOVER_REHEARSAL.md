# Live-slice comparison and cutover rehearsal

`config/live-source-slices.v1.json` records each counterpart repository's current remote `main`, newest two commits, and high-level non-mutating release gates. Frozen local source mirrors are no longer part of the workflow.

Run the structural audit with:

```sh
npm run cutover:audit
```

Add `--check-remote` to ask GitHub for every current `main` without cloning a repository. If a source advanced, the audit fails with the recorded and observed SHAs. Runtime behavior comparisons should use the running Fly slice; fixes then land in ApolloStation with Apollo's architecture and visuals.

The audit never authorizes writes, shutdowns, DNS changes, credential activation, or retirement of a running Fly app. The old local mirrors can be removed independently because GitHub and the live deployments remain the comparison sources.

## Required production proof

Production replacement remains blocked until reconciliation, external integration rehearsal, live runtime inventory, restart/restore, rollback, and owner acceptance are complete. Detailed operational evidence belongs in the protected deployment process rather than this public source repository.

## Changed-source intake

Audit a committed range while still checking the complete repository:

```sh
node scripts/audit-live-slices.mjs --changed-since <base-sha>
```

The report lists affected Apollo capability owners. Runtime, service, app, and capability identity remains Nebula Arcade; the historical repository name is allowed only in comparison records outside current app/package source.
