# Recovered data reconciliation audit

Status: read-only source audit, 2026-11-04. No recovered records were written to Turso or Apollo. Both source ZIPs and nested archives remain unchanged. This report contains aggregate counts and hashes only; it does not include player records, credentials, webhook URLs, or token values.

## Immutable source evidence

| Source | Bytes | SHA-256 |
|---|---:|---|
| `recovered-user-data-verified-bundle.zip` | 117,173,406 | `1d993d62c5af9f74756fc1bfe91eb5a2e40b69884f13c8e7a5f0fa2e8c6f5dc7` |
| Chat Tag nested archive | 851,619 | `53b682602f2f531c8dcdd91d9a9a3d5073e97299382063f60429c0a0d7fa92a3` |
| StreamWeaver nested archive | 17,900,497 | `a27e278303b76553b5c71082a4e33454b5c61eb43510d8d53d0279f1480b07d2` |
| `recovered-user-data-run-40072383161-supplement.zip` | 132,750,871 | `3782e9bd9884a198599673d4d310106e61a28375d99e97b5157651dc32667a7f` |

Both nested application archives passed a fresh gzip integrity check. The outer ZIPs and nested archives were read from Library into a separate working copy; originals were not modified.

## Chat Tag / Nebula findings

The recovered `data/app-state.json` parses successfully and contains:

| Dataset | Records |
|---|---:|
| `tagPlayers` | 155 |
| `tagHistory` | 682 |
| `chatTags` | 4,453 |
| `users` | 39 |
| `adminHistory` | 551 |
| `modLog` | 500 |
| `botChannels` | 154 |

Additional independent state files are present for game settings, Quackverse, Quackverse pack-open history, Quackverse rooms (17 room keys), Discord messages, and overlay messages. These must be imported as distinct source domains rather than discarded or folded into player rows.

Ownership evidence is insufficient for an automatic tenant split:

- The primary `tagPlayers` collection is a shared/global snapshot; it has no authoritative tenant owner on each player record.
- 12 of 155 player records have no `lastSeenChannel`; the populated values are historical activity hints, not ownership proofs.
- `tagHistory` has 33 distinct `streamerId` values. 16 happen to match a StreamWeaver tenant-directory name (331 of 682 events); the remainder include administrative/system values and names without a matching directory.
- `chatTags` has 75 distinct `streamerId` values. 20 match a tenant-directory name (2,383 of 4,453 events); the rest include system/provider values and streamers absent from this archive.
- Therefore, neither last-seen channel nor event streamer ID is a safe rule for assigning the shared player/game snapshot to a tenant.

Preserve the original global snapshot as an immutable legacy source. Normalize tenant-owned projections only after explicit SPMT tenant/player identity reconciliation. Keep historical events and their original `streamerId` values intact.

## StreamWeaver findings

The nested archive has 5,909 tar entries (5,908 regular files). Of those, 5,070 files are under `data/runtime/tenants`, which contains 57 distinct tenant-directory IDs; a separate legacy tree under `data/tenants/94371378` contains another 36 files.

Direct path-based counting in this archive found:

- 695 JSON files directly under tenant `data/` trees.
- 490 JSON files directly under tenant `config/` trees.
- 124 tenant token-related JSON files; their contents were not printed or copied into this report.
- Some tenant trees contain nested historical/compatibility paths. The importer must preserve relative paths and must not flatten the tree.

Five broadcaster usernames occur in two different tenant-directory IDs each. In all five pairs, the overlapping files have differing contents; these are not byte-identical duplicate folders. They must remain separate source identities until SPMT tenant ownership and archive-generation authority are established. The archive also contains special/synthetic tenant-like directory names; these must not be silently promoted into production tenants.

The prior high-level inventory recorded larger `data/` and `config/` counts (942 and 539). The counts above use a stricter direct-path definition against the exact nested archive hash in this report. The discrepancy is recorded rather than silently reconciled; importer manifests should enumerate every file with its exact source path and hash so no path class is omitted.

## Required import behavior

1. Keep both ZIP archives and nested tarballs immutable as rollback evidence.
2. Generate a complete per-file manifest (relative path, SHA-256, byte size, source category, and detected schema/version) from a separate extraction copy.
3. Treat StreamWeaver directory IDs as separate source namespaces. Do not merge the five same-username pairs based on username alone.
4. Exclude token/secret/webhook material from logs and reports. Preserve it only through an approved secure-secret migration path, never in ordinary JSON record imports.
5. Stage Chat Tag's shared/global collections without tenant assignment. Require an explicit identity crosswalk for player ownership before tenant writes.
6. Make every importer dry-run by default, idempotent, and refuse writes into non-empty destination namespaces unless a separate, reviewed migration plan authorizes them.
7. Verify source counts and keyed digests, tenant isolation, transaction rollback, and fresh-process read-back before enabling application writes.

## Current release boundary

PR #413 provides the SQLite-to-Turso transfer primitive. PR #417 adds the Nebula Mosaic-only Turso runtime integration. Neither imports these recovered JSON archives, migrates the Chat Tag player/economy stores, or moves StreamWeaver's domain stores to Turso. No Hostless live smoke test or recovered-data import is claimed by this audit.

## Offline staging-manifest preflight

A second extraction pass kept the Chat Tag and StreamWeaver archives in separate working directories and applied the staging utility's source-path and sensitive-key rules without opening a Turso connection:

| Source | Candidate JSON documents | Invalid JSON | Documents with redacted fields | Destination scopes |
|---|---:|---:|---:|---:|
| Chat Tag legacy-global | 16 | 0 | 4 | 1 |
| StreamWeaver | 5,731 | 0 | 251 | 58 (57 tenant IDs plus `__global__`) |

The StreamWeaver candidate set includes the archived global actions/commands/configuration JSON as well as tenant documents; the 124 token-path JSON files are excluded. The 251 redacted-document count is broader than path exclusions because some otherwise importable JSON documents contain embedded credential fields.

This is a local offline preflight using the same recursive JSON traversal, tenant-path classification, and normalized sensitive-key matching as the staging utility. It is not a Turso write or a live deployment test. The new regression work in PR #419 adds direct Node.js coverage for nested Twitch/Discord credential fields and verifies that CLI dry-run does not instantiate a Turso client or require credentials.

## Partial legacy identity crosswalk

A separate comparison of the Chat Tag `users` map against StreamWeaver's tenant directory names and Twitch configuration found:

- 13 of the 39 legacy Chat Tag user IDs exactly match a StreamWeaver runtime tenant-directory ID.
- For all 13 matches, the legacy Chat Tag Twitch username also agrees with that directory's `config/twitch.json` broadcaster username.
- 33 of the 155 Chat Tag player usernames overlap a username in the legacy `users` map.
- None of the 155 `tagPlayers.id` values equals one of the 39 legacy `users` map IDs.

These are useful source-to-source identity hints, not Apollo tenant ownership. The 13 exact matches still need to be joined to canonical SPMT tenant/account records before assigning any player, score, immunity, pass, Quackverse, or historical event data. The other 26 legacy user IDs and 122 non-overlapping player usernames remain unresolved by this evidence.

The manifest metadata pass detected a top-level `schemaVersion` or `version` marker in 0 of the 16 Chat Tag JSON documents and 17 of the 5,731 StreamWeaver candidate documents. Files without an explicit marker retain a null schema-version field; shallow top-level array/object-map counts are still recorded so the original collection sizes can be compared during staging and restore verification.

The same offline preflight measured 92,827,375 bytes of candidate source JSON before redaction and 73,902,229 bytes of serialized redacted payloads (Chat Tag: 8,711,520 raw / 7,614,341 redacted; StreamWeaver: 84,115,855 raw / 66,287,888 redacted). This is the raw staging payload estimate, not the eventual normalized database size; indexes, metadata, and application tables will add overhead.
