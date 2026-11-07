# Recovery import input

Do **not** commit the recovery data into Git history.

Create a private GitHub Release in this repository with tag:

`apollo-recovery-2026-11-07`

Upload the generated file as the release asset:

`recovered-json-manifest.jsonl.gz`

Expected SHA-256:

`7bcc2ae2688d77b6bdddcc2c5e84274fc02ecb7330a44970c18390e3bf95a8a2`

Expected source counts:

- `nebula-legacy-global`: 16 documents
- `streamweaver`: 5,732 documents
- Total: 5,748 documents

The manifest contains redacted JSON payloads and source/payload hash receipts. It excludes sensitive directory paths and redacts credential-shaped keys. It still contains player/application data, so keep the release private.

After the release asset is uploaded, run **Actions → Import recovered JSON manifest to shared Turso** on `main`. Use `apply=false` first; only use `apply=true` after the dry-run reports all expected counts. The workflow downloads the private release asset, verifies its SHA-256, and writes only to `apollo_recovered_json_stage_v1`; it does not activate player accounts or write application domain tables. Keep the release asset until Turso read-back confirms all 5,748 rows, then delete the asset if you no longer need the recovery copy.
