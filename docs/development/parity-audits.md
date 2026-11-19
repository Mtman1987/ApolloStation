# Donor parity and source-audit tooling

This guide covers the repository's donor/source inventory and parity evidence tools. These tools help identify what was ported and where functional verification is missing. They do not automatically import donor code and do not certify production behavior.

## 1. Tool inventory

| Script | Responsibility | Output/use |
|---|---|---|
| scripts/parity-donor-inventory.mjs | Inventory a source repository's tracked files and metadata | Donor inventory artifact |
| scripts/parity-compare-inventories.mjs | Compare source/destination inventories | Path/count/hash differences |
| scripts/parity-rea.mjs | Build REA-style evidence from source inventory and code references | Structured parity evidence |
| scripts/parity-audit.mjs | Run the repository parity audit over declared app/source scope | Audit report |
| scripts/parity-prepare-port.mjs | Prepare a proposed port package from selected evidence | Reviewable port bundle; not an automatic merge |
| scripts/audit-live-slices.mjs | Compare declared remote-main source slices with the running Apollo tree and validate capability wiring | Cutover/source-slice report |
| scripts/audit-production-rollout.mjs | Validate production rollout gates and cohort policy | Static release policy result |

Root npm commands include:

    npm run cutover:audit
    npm run release:audit

The parity scripts may be invoked directly for focused inventory work; inspect the script's current CLI and output options before running. Do not assume every script shares the same arguments.

## 2. Evidence inputs

The source of comparison is the declared remote-main commit for each live-source slice plus the Apollo commit being audited. The current configuration lives in:

- config/live-source-slices.v1.json
- config/app-code-parity.v1.json
- config/capability-wiring.v1.json
- config/production-rollout.v1.json

The former captured donor documentation tree is preserved under mt-delete-me-archive/legacy-docs/docs/archive/evidence/. It is historical provenance. The active product and developer guides are in the root README, docs index, and app/tool READMEs.

## 3. What the reports prove

A file inventory can prove that paths, sizes, hashes or declared source files differ. It cannot prove that a feature is missing or complete.

A parity report can show:

- source commit and destination commit;
- files/paths included in the declared comparison;
- matching/different/missing path counts;
- evidence references and source ownership;
- explicit capability mappings and known implementation boundaries.

It cannot prove:

- UI behavior in a live browser;
- provider OAuth or live socket connectivity;
- audio/media playback;
- correct tenant/channel behavior;
- persistence after restart;
- migration/restore correctness;
- deployed node revision;
- owner acceptance.

Do not use file-count ratios as a feature-completeness percentage.

## 4. Functional parity workflow

For each application:

1. Identify the donor/source capability and the current Apollo owning package.
2. Map the source behavior to a stable Apollo app ID and shared contract.
3. Trace the route, worker, provider, database, job, UI and configuration path.
4. Record which pieces are already implemented and which are intentionally not ported.
5. Add focused tests for the owning API/worker/UI behavior.
6. Verify data ownership, migration and restore.
7. Exercise the real provider/browser path where required.
8. Record exact commit, test, runtime and deployment evidence.
9. Only then mark the capability accepted.

A donor file with no Apollo equivalent is not automatically a gap. It may be obsolete, a framework artifact, a duplicate, or an implementation that belongs in a shared package.

## 5. Capability wiring

config/capability-wiring.v1.json maps capability ownership, execution owner/target and implementation entrypoint. It is a security-sensitive operational contract.

Before changing it:

- verify the owning app and worker;
- check that the capability ID exists in the versioned contract;
- confirm the execution owner matches the worker's claim filters;
- confirm the execution target matches the actual Hostless worker placement;
- verify scopes and tenant restrictions;
- update audit tests and release configuration together.

The file still contains legacy Fly/Sprite execution target identifiers and donor-era owner labels. These are migration debt. Do not use them to launch retired infrastructure; replace them through a coordinated contract/config/test migration.

## 6. Safe port preparation

A prepared port bundle is a proposal for review. Before applying it:

- inspect every added file and dependency;
- reject donor-specific credentials, deploy config and host assumptions;
- preserve required licenses and attribution;
- map database ownership and schema;
- remove unused build/test artifacts;
- replace provider URLs with Apollo-owned internal services;
- use shared SPMT contracts instead of copying identity/auth;
- add regression tests;
- benchmark bundle/runtime size;
- verify the exact diff before merging.

Do not blindly copy whole donor repositories into the monorepo. Port the smallest cohesive behavior that satisfies a real acceptance requirement.

## 7. Known current migration debt

- HearMeOut Lounge still has an active donor Fly origin fallback.
- Nebula Mosaic generation still defaults to the old StreamWeaver Fly origin.
- Companion/MountainView download routes still point to donor release assets.
- Some worker defaults still select the legacy Sprite execution target.
- HearMeOut still imports a bounded legacy voice worker adapter.
- Capability wiring still contains old execution owner/target labels.

These are active paths or configuration contracts, not harmless documentation strings. They need Apollo-owned replacements and live acceptance before removal. See the app READMEs and docs/CURRENT_STATE.md.

## 8. Performance and cleanup guidance

- Exclude archived evidence, test fixtures and build output from runtime bundle metrics.
- Do not retain local donor mirrors solely to satisfy an audit; use remote main and the running Apollo source slice.
- Keep inventory output bounded and reproducible by commit SHA.
- Avoid repeated full repository scans when a focused file/route test is sufficient.
- Use one parity report per meaningful app migration milestone, not one report for every small issue.
- Archive superseded reports in mt-delete-me-archive with a manifest; do not leave old reports in the active docs index.
