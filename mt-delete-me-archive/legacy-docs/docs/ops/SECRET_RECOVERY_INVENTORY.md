# Secret Recovery Inventory (No Values)

Last reviewed: 2026-10-23

## Safety rules

- Never commit, issue-comment, or log secret values.
- Treat repository code as a map of required variable names, not a credential backup.
- Treat Fly secret lists and GitHub Actions secret lists as metadata-only: they can establish names/status, not recover plaintext values.
- Keep the canonical credential inventory in a private password manager or encrypted secret vault. Store recovery notes here only if they contain names, owners, scopes, rotation status, and verification status—never values.
- Do not rotate all credentials at once. Identify each dependency, restore/rotate one credential, verify its consumer, and record the result before proceeding.

## Private recovery-source review

Potential recovery files and backups must be inventoried privately. Do not record their paths, contents, or existence in this public repository. Treat any plaintext credential file as temporary recovery material: move values into a dedicated password manager/secret vault and remove plaintext copies only after verifying the new copies and necessary recovery backups.

## Names observed in ApolloStation code

- `SPMT_WEBHOOK_KEY` — required by `apps/spmt-service/src/provider-identity-start.ts`.
- `STREAMWEAVER_MESHY_API_KEY` — consumed by the StreamWeaver avatar provider path.
- `STREAMWEAVER_KEENTOOLS_API_KEY` — paired with the StreamWeaver Meshy credential in the avatar provider path.
- `STREAMWEAVER_WORKER_CREDENTIAL` — service-to-service worker authentication.
- `CHAT_GATEWAY_WORKER_CREDENTIAL` — Chat Gateway worker authentication.
- `NEBULA_ARCADE_WORKER_CREDENTIAL` — Nebula Arcade worker authentication.
- `FLY_API_TOKEN` — used by some operational workflows/tools; do not assume it is equivalent to a saved `FLY_TOKEN` until its origin, scope, and validity are verified.
- `MESHY_API_KEY` — separate one-off credential expected by the standalone Meshy Avatar Build workflow.

The repository's existing avatar promotion workflow reads `STREAMWEAVER_MESHY_API_KEY` and `STREAMWEAVER_KEENTOOLS_API_KEY`; the standalone avatar build workflow instead reads `MESHY_API_KEY`. These are different secret names and scopes. Do not rename or overwrite existing production secrets to satisfy the standalone workflow.

## Existing encrypted recovery code is not a credential vault

The repository's `packages/recovery-core` `FileRecoveryVault` encrypts application-consistent SQLite recovery snapshots with AES-256-GCM and verifies integrity before restore. It is designed for database recovery points, not for storing, retrieving, rotating, or distributing individual provider/API credentials. Do not repurpose it as a general secret manager or place raw credentials in recovery manifests/logs.

## Current operational status

- A code-level inventory has identified consumers and distinct secret names; this does not establish that the corresponding GitHub Actions or Fly secrets are present or valid.
- Plaintext recovery material was found in private user-provided files during the review. Values were not copied into this repository or the audit. Keep those files intact until each needed value is copied into a proper private password manager/secret vault and verified.
- No connected credential-vault integration or authenticated Fly secret-metadata access was available in this review. Therefore no credential has yet been migrated, validated against a live consumer, or safely retired.
- Do not create or overwrite GitHub Actions secrets with guessed values. In particular, `FLY_TOKEN` and `FLY_API_TOKEN` are not assumed interchangeable, and `MESHY_API_KEY` is separate from the existing `STREAMWEAVER_MESHY_API_KEY` / `STREAMWEAVER_KEENTOOLS_API_KEY` pair.

## Recovery workflow

1. Inventory secret names and consumers from source code and workflow files; never dump values.
2. In each hosting/provider console, record whether a credential is present, last updated, and which service consumes it. For Fly, `fly secrets list` shows names/digests/status, not plaintext.
3. Search approved private recovery sources (password manager, local encrypted backups, the Library files identified above, provider consoles, and authorized machine runtime) without printing values to logs.
4. For each credential that cannot be recovered, reissue/rotate it at its provider, then update only the intended secret store and dependent service.
5. Verify the service using a non-secret health/auth check. Never test by printing an environment variable.
6. Store the new credential in the canonical vault, note the rotation date and consumer, and make an encrypted backup with a separately stored recovery key.
7. Remove obsolete plaintext copies after confirming the vault and backup can be read back.

## Current blockers / not yet verified

- No authenticated Fly secret metadata query was performed during this review.
- No GitHub Actions secret values are readable through the available GitHub connector; presence and names still need checking in repository Settings.
- The Meshy API key has not been created or added to GitHub.
- No production credentials were changed, rotated, deployed, or exposed in this document.
