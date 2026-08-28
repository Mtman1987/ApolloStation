# SPMT Ecosystem Core

Status: **the shared Green base is approved for main promotion; Blue production remains authoritative until cutover gates pass**

This repository is the clean-room implementation monorepo, architecture, and migration contract for rebuilding the SpaceMountain ecosystem beside the current production system.

**Naming boundary:** SPMT Ecosystem Core is the complete shared foundation in this repository. SPMT is its identity, data, policy, and developer authority; SpaceMountain is its front door and shared workspace; Stellar Core is its persona-neutral AI subsystem; and the Mtman Machine Rotator is its private fleet and operations controller. `ApolloStation` remains the repository/codename. Commlink, Stellar Core's Stella surface, Mission Control, and Nebula Arcade are registered first-party applications discovered through the same catalog contract used by every other app. Product-specific workers stay behind their owning app rather than becoming separate user-facing products.

Owner approval recorded 2026-08-21 closes the foundation decision pack in `DECISIONS.md`. The reviewed shared UI/app baseline was approved for main promotion on 2026-08-24. Blue production still remains the donor and rollback authority until identity, data, provider, output, load, recovery, observation, and rollback gates pass.

## Current Green baseline

The reusable base now includes:

- one SpaceMountain shell viewport shared by Home, Shipyard, Workspace, Settings, the private header-opened Account, and every opened app;
- a fixed shared header/sidebar with all long-page scrolling contained inside the content rectangle below the header;
- one theme/background/star system with app-owned scene art and depth-aware translucent surfaces;
- registry-driven first-party apps rather than hardcoded special cases;
- canonical SPMT identity, workspace, XP, events, app registration, overlay grants, runtime health, CLI, MCP, and SDK contracts;
- Commlink as the shared communication app, Stellar Core as the persona-neutral AI app, and owner-only Mission Control for operations;
- Nebula Arcade as the cosmic Games Hub with twenty equal game entries, full game detail pages, saved multi-game overlay scenes, and one command-collision router;
- Chat Tag retained as a bounded Nebula Arcade game module and compatibility/runtime implementation, not as a separate public-facing ecosystem app;
- isolated Review and Release Sprite promotion paths with checkpoint, test, atomic switch, and rollback behavior.

The next implementation phase is deliberately repetitive: plug the remaining donor apps into these established contracts, then run logs -> fix -> logs, click every control, exercise every command/output, and only then promote the verified Green system toward production.

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
6. `ROTATOR_FLEET_CONTRACT.md` — private fleet reconciliation, scaling, restart, access, logging, and safety boundaries.
7. `OPERATIONS.md` — implementation batches, build order, cost clock, gates, migration, and rollback.
8. `DOCUMENT_REVIEW.md` — what should be kept, merged, archived, or removed.
9. `docs/PRODUCT_UI.md` — shared viewport, depth/translucency, theme, scene, navigation, and app UI rules.
10. `docs/SPRITES_SANDBOX_HANDOFF.md` — review/release Sprite promotion and verification contract.

The `evidence/raw/` directory preserves historical source documents copied from the live donor repositories. That evidence is read-only historical input; nothing inside it is automatically a current requirement.

## Governing rules

1. Accepted decisions are the Green architecture contract.
2. Live production is donor evidence and the rollback system, not the place to build Green.
3. No donor capability is silently dropped. If it has not been classified in `PARITY_LEDGER.md`, it defaults to `VERIFY`, never `REMOVE`.
4. Build one shared contract or bounded product slice at a time, with tests proving parity or an explicit approved removal.
5. Use the fewest visual layers necessary; deeper surfaces become more translucent, never more opaque.
6. Every app occupies the same SpaceMountain content viewport. Home screens fit without scrolling; longer screens scroll only inside that rectangle and never behind the shared header.
7. Blue stays available until Green passes identity, data, reliability, load, recovery, observation, and rollback gates.
8. If implementation proves an accepted contract wrong, record the evidence and change the decision before changing the architecture.
