# Donor Cutover and Chunk Intake Rehearsal

`config/donor-cutover-rehearsal.v1.json` is the canonical non-mutating checklist between application-code parity and production replacement. It never authorizes donor writes, shutdown, DNS changes, credential activation, or retirement.

Run the structural rehearsal with:

```sh
npm run cutover:audit
```

The command exits successfully when the manifests and evidence references are structurally sound, while still reporting `BLOCKED` until every production proof is recorded. Use `--require-ready` only during the final owner-approved cutover gate.

## Required dataset proof

A dataset can move from `blocked` to `verified` only when its evidence contains:

- the immutable source snapshot SHA-256;
- source and target row counts;
- matching canonical source and target SHA-256 values after identity normalization;
- a two-tenant isolation result;
- restart and encrypted restore evidence;
- a retained rollback checkpoint.

The auditor fails if a dataset claims verification while any proof is missing or counts/checksums differ. XP and wallet balances must be reconstructed from reconciled events; taking a maximum or summing competing projections is explicitly forbidden.

## Chunk 10 intake

After new work is committed locally, audit only the new range while still checking the complete repository:

```sh
node scripts/audit-donor-cutover.mjs --changed-since <chunks-6-9-main-sha>
```

The report lists affected current capability owners and all pinned donor repositories. It rejects unknown app owners and scans changed current app/package source for the historical donor identity. `Mtman1987/chat-tag` remains valid only as a frozen donor reference; current runtime, service, app, and capability identities are Nebula Arcade.

## Recovery boundary

The SPMT encrypted recovery vault snapshots the complete SQLite database. Verification now inventories the new execution, device, Commlink read/replay, operations, session, outbox, and provider-credential tables so a copied-but-missing table cannot hide behind a successful integrity check. App-private databases remain separate recovery targets and must supply their own checkpoint, integrity, restore, and rollback evidence before live cutover.
