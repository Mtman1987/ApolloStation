# SPMT Ecosystem Rebuild Blueprint

Status: **foundation approved for Green implementation; Blue production remains authoritative until cutover gates pass**

This repository is the clean-room architecture and migration contract for rebuilding the SpaceMountain ecosystem beside the current production system.

Owner approval recorded 2026-08-21 closes the foundation decision pack in `DECISIONS.md`. Measurement-dependent decisions remain open and are resolved only when their implementation phase has real benchmark or workload evidence. Approval here authorizes work on the isolated Green/Sprites rebuild only; it does not authorize changing production DNS, production data authority, or shutting down a live app.

## What this package does

- freezes donor documentation from the current live repositories as read-only evidence;
- separates observed facts from old plans and unverified claims;
- defines one coherent identity, data, runtime, worker, AI, and Fly.io model for Green;
- records the accepted architecture decisions and keeps measured configuration changes inside their approved boundaries;
- tracks donor-to-Green feature parity so a clean rebuild cannot silently become feature loss;
- lists every material removal or rewrite with a defense and counterargument;
- defines a reversible, cost-bounded parallel cutover;
- keeps Firebase and other retired architecture out of the new design.

## Read in this order

1. `CURRENT_STATE.md` — what is known, inconsistent, and still unverified in the donor/live system.
2. `DECISIONS.md` — accepted foundation decisions plus the small deferred decision set.
3. `BLUEPRINT.md` — target architecture governed by the accepted decisions.
4. `PARITY_LEDGER.md` — donor capability/state ownership mapped to Green disposition and proof.
5. `APP_CONTRACTS.md` — rules every rebuilt app and worker must follow.
6. `OPERATIONS.md` — implementation batches, build order, cost clock, gates, migration, and rollback.
7. `DOCUMENT_REVIEW.md` — what should be kept, merged, archived, or removed.

The `evidence/raw/` directory preserves 294 document-like source files copied from:

- `Mtman1987/spacemountain-live` at `1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43`
- `Mtman1987/spmt-live` at `5d8aa7b2c3ac34538691bb8035b1cfe98b3b0acc`

The copied evidence is read-only historical input. Nothing inside it is automatically a current requirement.

## Governing rules

1. Accepted decisions are the Green architecture contract.
2. Live production is donor evidence and the rollback system, not the place to build Green.
3. No donor capability is silently dropped. If it has not been classified in `PARITY_LEDGER.md`, it defaults to `VERIFY`, never `REMOVE`.
4. Build one shared contract or bounded product slice at a time, with tests proving parity or an explicit approved removal.
5. Blue stays available until Green passes identity, data, reliability, load, recovery, observation, and rollback gates.
6. If implementation proves an accepted contract wrong, record the evidence and change the decision before changing the architecture.

## Green Sprite sandbox checkpoint

The first browser-open Green sandbox slice now runs SPMT on loopback and exposes SpaceMountain through one private Sprite HTTPS surface. Sandbox startup rejects provider credentials, blocks outbound webhook delivery, keeps access tokens in an HttpOnly cookie, and uses an inert `Orbit Beacon` registry fixture to prove dynamic discovery and launch.

No Sprite, service, Fly App, Machine, provider identity, or production data source is created by the repository scripts. Follow [`docs/SPRITES_SANDBOX_HANDOFF.md`](docs/SPRITES_SANDBOX_HANDOFF.md) and stop at every owner/manual gate.
