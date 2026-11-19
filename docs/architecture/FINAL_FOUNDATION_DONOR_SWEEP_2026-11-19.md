# Final donor-to-Apollo parity sweep: Rotator, SPMT.live, SpaceMountain.live

Audit date: 2026-11-19
Branch: `audit/foundation-donor-final-sweep`
Base: `main` after PR #519 merge
Purpose: final capability sweep of the three foundation donors. This document is a code/repository review, not runtime certification.

## Executive result

**The foundations have substantial Apollo equivalents. They are not yet fully parity-accepted.** Credit existing Apollo contracts and implementations; do not rebuild these foundations. Remaining work is primarily proving the implementations work end-to-end on Hostless Node 1/2, closing specific execution/production gaps, and replacing donor infrastructure assumptions.

Evidence inspected includes the merged Rotator and SPMT/SpaceMountain reviews, Apollo `authority-core`, `platform-ops`, `api-adapter`, `mcp`, the parity ledger, prior SPMT/DSH donor audits, workspace surface test documentation, and the Rotator donor README. Search index results may lag main; paths fetched from the default branch were checked where available. Tests/deployments were not run by this audit.

## Final disposition

| Donor | Apollo equivalent | Code-level status | Runtime acceptance |
|---|---|---|---|
| Rotator operator/log/coder capability | SPMT platform operations, MCP, diagnostics, Stella/Coder | Partial equivalent present; coder worker/runtime ownership gap remains | Not accepted |
| SPMT identity/provider links | Authority core + Auth/platform ops | Equivalent contract/core present | End-to-end identity/session proof still needed |
| SPMT workspace profile | WorkspaceProfileV1 in authority core + API ops | Contract and update path present | Cross-device/account isolation and complete profile round-trip still need proof |
| SPMT XP, events, audit/outbox | Authority core + platform ops + MCP | Broad platform equivalents present | Durable production store, restart, migration and cross-app acceptance not certified |
| SPMT Commlink | Platform operations/API/MCP + shell UI | Backend operations exist | Full live provider/message UX and data isolation need acceptance |
| SpaceMountain shell/header/Shipyard | Apollo SpaceMountain shell and app registry | Existing implementation | Critical Node1 bootstrap/login blank-screen acceptance remains open |
| Workspace/dock/universal appearance | WorkspaceProfileV1 + shared shell/settings | Contract/code exists | Full settings propagation and three-slot persisted behavior require real smoke |
| Overlay Bay/scenes/Companion | Apollo overlay scenes, output grants, workspace surfaces | Equivalents exist | Desktop Companion packaging, click-through, transparency and device acceptance not certified |
| MountainView companion command/memory | Commlink/Companion/Stellar/platform surfaces | Partial replacement map; not every donor capability individually verified | Not accepted |
| Fly machine rotation | Hostless Node 1/2 operational diagnostics/recovery | Fly rotation intentionally not ported; replacement policy incomplete | Not accepted until Hostless-safe recovery contract/evidence exists |

## 1. Rotator final sweep

### Replaced/credited in Apollo
- Typed, authenticated SPMT platform operations are the intended owner for operator controls.
- Apollo MCP already exposes operations/log and coder-job tools; the tool list includes `operations.logs.publish/list`, `operations.coder.get`, `operations.coder.jobs.list/create`.
- API adapter has corresponding logs and coder-job routes.
- Hostless diagnostics workflows exist, with sanitized runtime/browser evidence and Node 1/2 targeting documented.
- The merged lifeboat architecture explicitly rejects standalone Rotator UI/MCP and Fly machine control.

### Intentional removals
- Fly Machines REST API clients and active/standby rotation.
- Fly leases and Machine IDs as production authority.
- Fly deployment, Fly secrets, Fly NATS log access and Fly-specific status/health.
- Separate Rotator MCP registry and standalone operator app.

### Remaining gap
- **Coder execution ownership is not fully rescued yet.** Apollo has job APIs and records, but an API that creates/reads jobs is not proof that an Apollo-owned worker can execute a repair, isolate it, produce a patch, run checks, publish a draft PR, and report completion.
- Hostless Node 1/2 health, bounded sanitized logs, incident classification, restart/repair lifecycle and rollback need real evidence.
- Do not port the old active/standby rotation algorithm literally. Define a Hostless-safe recovery policy with duplicate-worker protection, idempotency, fencing, health-before-action, audit and rollback. No automatic restart/traffic cutover until that policy and authorized action are implemented.

**Disposition:** Rotator is retired as a standalone app architecture; its useful operator capabilities are only partially equivalent in Apollo. Keep this capability gap open.

## 2. SPMT.live final sweep

### Equivalent platform capabilities found
- `authority-core` contains user/provider-link/workspace authority types and services.
- Provider linking enforces ownership conflict rules and revoked-link handling.
- `WorkspaceProfileV1` is represented with appearance, exactly three dock slots, overlay-scene references, personal overlay state, TTS IDs, app theme mappings and Commlink workspace state.
- XP events/wallet/leaderboard types and canonical award/spend/transfer/settlement operations exist in platform contracts/ops.
- Platform event, audit, outbox and authority journal models exist.
- `platform-ops` and API adapter expose workspace, identity/provider, XP, event, Commlink, notification, jobs and operator operations.
- Apollo MCP maps canonical SPMT tool names to platform operations instead of creating a separate authority.

### Remaining parity acceptance
- Prove all remaining app clients use canonical SPMT identity/session and provider grants; code presence is not a migration result.
- Prove refresh/logout/account-switch/recovery and immutable user IDs on both normal and clean browser state.
- Prove full WorkspaceProfileV1 round-trip, revisions/conflicts, export/import/reset, three slots, appearance propagation and account isolation.
- Prove Commlink direct/group/live chat/history/search/reply, notifications, event replay and provider reconnect/deduplication.
- Prove XP producers are app-attributed and idempotent, ledger/wallet/leaderboard read canonical state, and restart does not duplicate settlement.
- Confirm production authority is backed by a durable store on Hostless and not an in-memory/test adapter. Backups, restore, rollback and migration rehearsal must be evidenced.
- Confirm app registry, installed state, entitlements, health/capabilities and launch links match real Apollo apps and routes.

**Disposition:** SPMT has broad code-level parity. Mark it **implemented, acceptance pending**, not finished, until persistence/migration, provider, cross-app and account-isolation proofs are green.

## 3. SpaceMountain.live final sweep

### Equivalent capabilities found
- Apollo SpaceMountain shell UI classes and app surface routing exist.
- Canonical workspace/profile contract supports three slots and shared appearance.
- Shared overlay scene and output grant contracts exist; workspace surface documentation describes scene switching, personal overlay toggling, pop-out and authenticated device overlay checks.
- Shipyard/app registry, shell navigation and app surfaces are present in Apollo.
- Commlink and settings are surfaced through Apollo's shared platform boundaries.

### Remaining parity acceptance
- **Critical: shell/bootstrap sign-in.** PR #526 is merged and now explicitly returns a missing/rejected session to the SPMT bridge gate instead of leaving a blank auth view. This improves the recovery path, but normal-browser and incognito end-to-end sign-in, reload, and sign-out still require production browser proof; do not mark the shell accepted yet.
- Confirm sign-in token/JSON handoff applies immutable identity, persists the session, advances the UI, and restores on reload.
- Verify global header/home navigation on every shell page and app-frame return path.
- Verify Shipyard registry entries, launch targets, installation/disabled state and health truth; remove stale sandbox-install text and duplicate auth/refresh chrome.
- Verify OAuth Connect actions are real and truthful.
- Verify universal settings propagate to Stella Core and intended apps without altering established glass-card styling.
- Verify workspace slots save/load, conflicts, offline feedback and account/device isolation.
- Verify Overlay Bay frame controls, scenes, transparent personal output, click-through and Companion interaction mode. Personal Bulletin remains a saved scene; the owner diagnostic terminal is proposed in draft PR #528 and must remain bound to the existing Apollo session, read-only, and free of shell execution.
- Verify Rocket/Arena discovery and canonical editor/Commlink routes.
- Verify desktop packaged Companion behavior; code/docs alone are not proof.

**Disposition:** SpaceMountain's major product contracts and shell equivalents exist, but production acceptance remains **blocked by shell/bootstrap and pending real browser/desktop proof**.

## 4. MountainView / Rotator companion capabilities

The Rotator README documents MountainView commands, mobile/glasses voice routing, image relay, encrypted per-service tokens, tagged/timeline memory, command logs, media uploads and admin-editable service integrations.

Apollo has related Commlink, Companion, Stellar Core, device relay, suite actions and jobs. These are the correct replacement owners. However, this sweep did not prove a one-to-one runtime for every MountainView endpoint or glasses/media workflow.

- [ ] Inventory each MountainView command and route against Apollo Commlink, Companion, device relay, suite-actions and owning app APIs.
- [ ] Preserve provider/service-token vault ownership; no token plaintext in logs, jobs, memory or URL.
- [ ] Preserve memory tags/search/timeline only where the canonical Stellar/Commlink memory owner supports the same semantics.
- [ ] Confirm voice/glasses command execution routes through real adapters, reports unavailable truthfully, and records bounded audit receipts.
- [ ] Confirm StreamWeaver image/media relay and upload receipts are owned by the app that actually handles media.
- [ ] Keep direct glasses camera/flash research or unsupported device features explicitly unavailable; do not create pretend controls.

**Disposition:** Partial equivalent mapping; route-by-route acceptance remains open.

## 5. Cross-foundation risks

- One identity/session authority. No parallel SpaceMountain, Rotator, app or provider accounts.
- One owner per state type: SPMT shared state, SpaceMountain shell/presentation, Overlay Bay scenes, specialist apps' domain data.
- Never infer runtime health from manifest or UI presence.
- No secrets in source, PR, logs, browser storage, Athena memory or diagnostic artifacts.
- App and provider operations must be scoped, idempotent and attributable.
- No Fly production dependency and no Node 3 target.
- Keep owner-first recovery and disabled outbound/provider activity until explicitly approved.
- Migrations require backup, isolated restore, idempotent execution, count/checksum reconciliation and rollback.
- Automated green is necessary, not sufficient; production smoke evidence must include Node 1/2.

## 6. Foundation exit checklist

### Rotator
- [ ] Apollo-owned coder worker executes isolated jobs through checks and review artifact; no Rotator worker dependency.
- [ ] Node 1/2 status and bounded sanitized logs can be retrieved automatically.
- [ ] Hostless recovery/repair policy has fencing, duplicate prevention, health gates, audit and rollback.
- [ ] No Fly-only active dependency remains.

### SPMT
- [ ] Identity/session/provider-link flows pass end-to-end.
- [ ] WorkspaceProfileV1 complete round-trip and isolation pass.
- [ ] Commlink, notifications, events and XP pass restart/replay/idempotency and cross-app tests.
- [ ] Durable Hostless data ownership, backups, restore and rollback demonstrated.
- [ ] App registry, scopes and capability/health truth reconciled.

### SpaceMountain
- [ ] Blank-screen/sign-in bootstrap resolved and diagnostics available.
- [ ] Header, Shipyard, workspace, direct routes and app launch survive refresh and sign-in/out.
- [ ] Universal appearance and three slots persist cross-device/account-isolated.
- [ ] Overlay Bay and Companion transparent/click-through interaction proof complete.
- [ ] Desktop/mobile smoke pass.

### MountainView/Companion
- [ ] Each retained command and route mapped to a working Apollo endpoint/adapter.
- [ ] Voice, mobile, device and media flows proven; unsupported features are clearly marked.

## 7. Audit limitations

- This sweep did not run repository tests, builds, Hostless API calls, deployments or interactive browser/device tests.
- GitHub code search results can be stale relative to `main`; exact files fetched from the default branch are stronger evidence than search snippets.
- Donor docs are historical evidence and may describe old Fly behavior or status.
- “Equivalent code exists” means the contract/implementation was located; it does not mean the user-facing path or production persistence is proven.
- The Parity Ledger itself says it is a discovery queue and that unclassified donor behavior should remain VERIFY.

## Bottom line

Do not rebuild Rotator, SPMT or SpaceMountain. Their main Apollo equivalents exist and the donor architectures can be retired as separate production apps. **The remaining foundation work is an acceptance-and-gap closure pass**, with the biggest blockers being the Apollo-owned coder execution adapter, Node 1 shell/login reliability, durable Hostless authority proof, Companion/MountainView route coverage and real cross-app/workspace tests.

Once those gates pass, remove these three from the active parity party bus and focus the app parity backlog on StreamWeaver, HearMeOut, Discord Stream Hub and Nebula Arcade.


## Update after PR #525 and #526 (2026-11-19)

- PR #525 is merged to main. The current main sanitizer preserves safe query parameters, redacts PEM and PGP private-key blocks, and gates artifact upload on successful sanitization. Its tests cover these behaviors. The older sanitizer implementation in PR #518 is superseded; PR #518 was closed rather than merging duplicate code.
- PR #526 is merged to main. The signed-out/rejected-session path now selects the SPMT bridge form and emits a browser diagnostic event. This is a code-level correction, not proof of live sign-in success.
- PR #528 is still a draft. Its current browser request sends `x-spmt-tenant` as a tenant selector; the API adapter currently reads that selector to scope operations. It is not a credential, but the requested architecture is to derive tenant context from the validated Apollo session/shell. Do not simply delete the header client-side until the server-side contract is changed and tested.
- The recovery import is already verified at 5,748 records. Do not replay it as part of this foundation audit.
