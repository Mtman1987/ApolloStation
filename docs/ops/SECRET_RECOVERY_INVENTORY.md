# Secret Recovery Inventory (No Values)

Last reviewed: 2026-10-23

## Safety rules

- Never commit, issue-comment, or log secret values.
- Treat repository code as a map of required variable names, not a credential backup.
- Treat Fly secret lists and GitHub Actions secret lists as metadata-only: they can establish names/status, not recover plaintext values.
- Keep the canonical credential inventory in a private password manager or encrypted secret vault. Store recovery notes here only if they contain names, owners, scopes, rotation status, and verification status—never values.
- Do not rotate all credentials at once. Identify each dependency, restore/rotate one credential, verify its consumer, and record the result before proceeding.

## Recovery material located in ChatGPT Library

The Library contains files named `env.txt` and `gemini-key.txt`. A metadata-only inspection found non-empty values in both; `env.txt` includes entries named `FLY_TOKEN` and `SPRITE_TOKEN`. The values are intentionally not copied here or printed. These are recovery leads, not a safe long-term vault. Move credentials to a dedicated password manager/secret vault and delete the plaintext Library copies only after verifying the new copies and any necessary recovery backups.

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
