# Recovery import input

Place the generated redacted manifest at:

`recovery-input/recovered-json-manifest.jsonl.gz`

Expected SHA-256:

`7bcc2ae2688d77b6bdddcc2c5e84274fc02ecb7330a44970c18390e3bf95a8a2`

Expected source counts:

- `nebula-legacy-global`: 16 documents
- `streamweaver`: 5,732 documents
- Total: 5,748 documents

The manifest contains redacted JSON payloads and source/payload hash receipts. It excludes sensitive directory paths and redacts credential-shaped keys. It contains player/application data, so keep it inside this private repository and remove it from the working tree after the Turso stage is verified.

Import is manual only through **Actions → Import recovered JSON manifest to shared Turso**. Run with `apply=false` first; only use `apply=true` after the dry-run reports all expected counts. This writes only to `apollo_recovered_json_stage_v1`; it does not activate player accounts or write application domain tables.
