# SPMT Ecosystem Rebuild Blueprint

Status: **proposal for owner debate — not approved for implementation**

This repository is the clean-room architecture contract for rebuilding the SpaceMountain ecosystem beside the current production system. It does not replace production documentation or authorize a deployment until the decisions in `DECISIONS.md` are accepted.

## What this package does

- freezes the source documentation from the two current live repositories;
- separates observed facts from old plans and unverified claims;
- proposes one coherent identity, data, runtime, AI, and Fly.io model;
- lists every material removal or rewrite with a defense and counterargument;
- defines a reversible, cost-bounded parallel cutover;
- keeps Firebase and other retired architecture out of the new design.

## Read in this order

1. `CURRENT_STATE.md` — what is known, inconsistent, and still unverified.
2. `BLUEPRINT.md` — the proposed target architecture.
3. `DECISIONS.md` — the debate ledger. This is where approval happens.
4. `APP_CONTRACTS.md` — rules every rebuilt app must follow.
5. `OPERATIONS.md` — build order, cost clock, gates, migration, and rollback.
6. `DOCUMENT_REVIEW.md` — what should be kept, merged, archived, or removed.
7. `BASE_MODELS.md` — frozen application source commits, cleanup results, verification gates, and quarantine status.

The `evidence/raw/` directory preserves 294 document-like source files copied from:

- `Mtman1987/spacemountain-live` at `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43`
- `Mtman1987/spmt-live` at `5d8aa7b2c3ac34538691bb8035b1cfe98b3b0acc`

The copied evidence is read-only historical input. Nothing inside it is automatically a current requirement.

## Governing rule

Write the contract first. Build the new system to satisfy the contract. If implementation teaches us that the contract is wrong, record and approve a decision before changing the architecture.