# Production readiness cleanup — 6 September 2026

## Scope and baseline

Consolidate retained ApolloStation development work into one new commit on main, organize development documentation, remove redundant implementation scaffolding and retire branches after preserving their changes. Baseline main: `28a8b1bac3e28c2059ede01ff10cdf2e3c495160`.

Both available ApolloStation checkouts were clean, with no stashes or additional worktrees. Their heads (`6771b43`, `087d1d9`) are ancestors of baseline main. No uncommitted ApolloStation files were found to rescue.

## Branch consolidation

23 non-main remote branches were inspected. 22 were already represented on main, verified by ancestry or exact whole-branch patch equivalence to a squash commit. The remaining branch, `parity/dsh-community-workflows-20260906` at `b44b309779f8d23169df16289c9200da7b41b030` (PR #80), is incorporated in this cleanup commit with integration repairs.

[The preservation inventory](branch-consolidation-2026-09-06.json) records each reviewed branch head and its retained main commit. The main-only `Consolidate reviewed branches` workflow compares these heads before an atomic, lease-protected deletion. It fails if any reviewed branch has advanced and ignores unlisted branches; newly advanced work must be reviewed separately.

## Retained code and repairs

- DSH private Crew advisory voting, owner decisions, durable decision notification state, per-role message templates, agreement offers, authenticated acceptance and downloadable receipts.
- DSH proposal composer, tenant-scoped channel/shadow-room selection, delivery history and retries.
- One DSH web server using the existing shared app server's request handling and browser bundle. Removed the temporary legacy-server copy, environment-variable import workaround, response rewriting, duplicate review renderer and duplicate decision handler.
- Application publishing continues to its existing controller; the new application controller handles only its own actions.
- Agreement identity accepts the canonical SPMT provider-list envelope. Receipt downloads require the matching applicant identity or tenant owner in addition to the offer token.
- Proposal destinations are checked against the tenant's configured Discord guilds and its own shadow rooms. Retrying a failed reaction reuses the already-created Discord message.
- Nebula's release check now matches the existing owner-approved Sprite deployment policy: main-only release, explicit repository opt-in and the protected release environment. Live Fly cutover remains separately blocked.

The proposal audience is a presentation label; Discord channel permissions control who can read and react. These changes do not certify complete live DSH parity or add an Apollo-native proposal vote ledger.

## Documentation and repository hygiene

- Moved all eight root development/architecture documents into `docs/`.
- Moved the Nebula widget provenance guide into `docs/NEBULA_GAME_WIDGETS.md`; bundled third-party licenses remain with the assets.
- Moved the 295-file evidence tree into `docs/archive/evidence/`, preserving all captured snapshot contents.
- Added [one documentation index](../README.md), updated references and corrected the stale Nebula manual-only deployment description.
- Removed the branch's temporary DSH diagnostic workflow; the normal contract workflow still runs the complete suite.
- Ignored local environment, log, database, patch-conflict and browser-report artifacts. Runtime code, tests, build scripts, configuration templates and required notices stay in their functional locations.

The only Markdown file outside `docs/` is the standard root repository README.

## Validation

- `npm run test:offline`: **840 passed; 0 failed, cancelled or skipped**. Includes a fresh TypeScript/browser build.
- The new HTTP regressions exercise application publishing, Crew-only blind votes, owner-only decisions, identity-linked acceptance, receipt access, proposal destination scoping and retry without duplicate messages.
- Local RTC Chromium run could not start because this environment lacks the required browser; its download timed out. The unchanged GitHub RTC workflow installs Chromium and runs the real-audio/fallback test.
- `npm run nebula:check`: **5/5 checks passed** (runtime, ffmpeg, 20 games/101 cards, artwork and deployment policy).
- `npm run cutover:audit`: **zero structural errors**, seven live-source references; production cutover remains blocked by the five prerequisites below.
- `git diff --check`: passed. Changed/new text files had no matches for the checked private-key, GitHub-token, AWS-access-key or OpenAI-key patterns.

## Remaining live cutover prerequisites

The existing cutover manifest still reports:

1. Production reconciliation is incomplete.
2. External integration rehearsal is incomplete.
3. Backup, restart and rollback proof is incomplete.
4. Live runtime inventory is incomplete.
5. Owner acceptance is not recorded.

The cleanup prepares a consolidated and tested repository. It does not establish that production data/provider migration or replacement of the existing live apps has been completed. Main push may promote this revision to the configured Release Sprite through the existing workflow; no live Fly app retirement or DNS/provider authority change is part of this cleanup.
