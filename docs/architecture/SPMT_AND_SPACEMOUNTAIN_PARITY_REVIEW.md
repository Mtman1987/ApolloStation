# SPMT.live + SpaceMountain.live — Apollo parity review

Status: source review and acceptance checklist; not a claim that either app is fully ported or production-accepted.
Donors:
- `Mtman1987/spmt-live` — shared identity/platform backend.
- `Mtman1987/spacemountain-live` — user-facing Command Bridge and workspace shell.
Destination: `Mtman1987/ApolloStation`.
Production runtime target: Hostless Node 1 and Node 2 only. No Fly.io production dependency. Node 3 is excluded.

## Executive decision

Treat these as the first two foundations of Apollo, not as two more standalone apps to recreate.

- **SPMT is the shared platform contract owner.** Preserve identity, sessions, linked provider grants, app/service registration, scoped service authorization, workspace profiles, Commlink, notifications/events, XP ledger, and durable account state. In Apollo these belong in the existing SPMT/platform services and database ownership boundaries.
- **SpaceMountain is the Command Bridge.** Preserve the user-facing shell, app launcher/Shipyard, workspace, shared header, app frames, personal overlay/Overlay Bay entry points, and owner controls. In Apollo these belong in the existing shell/Overlay Bay, not in a second dashboard.
- **Do not copy the old Fly deployment architecture.** Port behavior and contracts into Apollo's Node 1/2 services, Hostless deployment model, existing authentication and data adapters.
- **Do not declare parity from a green build or a rendered page.** The user must be able to sign in, see the right apps, open them, persist workspace state, and use the real connected services without the shell blanking or silently falling back.

The immediate objective is to make these two foundations boring and dependable, then remove them from the active parity queue while StreamWeaver, HearMeOut, Discord Stream Hub, and Nebula Arcade remain the focused app work.

## Ownership map

| Capability | Canonical owner | Apollo placement / rule |
|---|---|---|
| User identity, account lifecycle, roles, sessions | SPMT | Existing Apollo identity/session authority. One canonical user ID; never create a parallel SpaceMountain identity. |
| Twitch/Discord linked identities and OAuth grants | SPMT | Store grants server-side; provider identity is linked evidence, not a second account system. Never put provider tokens in workspace profiles or browser storage. |
| App registry, app installs, launch metadata, health/capability metadata | SPMT | Shipyard reads canonical registry data; app-owned services remain responsible for their own runtime behavior. |
| Service clients, app-bound scopes, token exchange | SPMT | Preserve per-app/per-environment credentials and least-privilege scopes. No shared universal app key. |
| WorkspaceProfileV1 (appearance, exactly three dock slots, active scene ID, TTS subscription IDs, app theme mappings) | SPMT | Versioned, user-owned, revisioned account state; Apollo shell is a consumer/cache, not authority. |
| Overlay scenes, executable workflows, app-specific settings | Their existing owning services | Keep separate from WorkspaceProfileV1. Do not stuff scene definitions or executable workflows into the portable appearance profile. |
| Commlink messages, conversations, notifications, platform events | SPMT | One canonical messaging/event surface. StreamWeaver may provide chat transport/ingest but does not own Commlink UI or shared identity. |
| XP ledger and cross-app awards | SPMT | Append-only, app-bound, idempotent event writes; displays read canonical balances. |
| Athena memory/catalog/capability descriptions | SPMT/platform services | Report configured vs available vs executing truthfully. Do not present catalog entries as live agents or actions. |
| Command Bridge shell, shared header, navigation, dashboard, Shipyard UI | SpaceMountain | Apollo shell / Stella Core navigation; do not create another global launcher. |
| Workspace slots, dock, app-frame lifecycle, pop-out behavior | SpaceMountain / Overlay Bay | Reuse existing frame and scene model; maintain the three-slot workspace contract where applicable. |
| Personal overlay / Companion transparent renderer | SpaceMountain host + Companion | Keep click-through behavior, visibility/opacity and appearance semantics; route to Apollo-owned overlay surface. |
| App-specific bots, workers, media, game mechanics | StreamWeaver / HearMeOut / DSH / Nebula Arcade | Preserve app ownership; SPMT supplies identity, events, scopes and shared account contracts only. |

## SPMT.live review

### Existing capabilities to preserve

1. **Identity and account core**
   - Canonical user/account records, sessions, account recovery and linked Twitch/Discord identities.
   - Immutable provider IDs are identity evidence; usernames are mutable display values only.
   - Existing-user grandfathering: a verified existing app session may be exchanged server-to-server for an SPMT identity without forcing re-registration. Do not merge accounts by matching usernames.
   - Imported/provider-owned identities may later claim credentials through a verified session; never invent or transmit passwords.

2. **OAuth and service authorization**
   - OAuth clients for SpaceMountain, DSH, StreamWeaver, ChatTag and HearMeOut.
   - App-bound service credentials and explicit scopes; authorization checks must bind client, app, environment, user/tenant and requested capability.
   - Keep Twitch/Discord provider grants separate from SPMT login/session.
   - Preserve token refresh/revocation and account-switch behavior; browser-facing sessions remain HttpOnly.

3. **Platform registry and Shipyard contract**
   - Registry owns app identity, launch URL, health URL, version/build metadata, capabilities, surfaces, integration state and enabled/disabled/install state.
   - SpaceMountain/Shipyard consumes registry metadata rather than hardcoding every app route.
   - Health and capability badges must describe real states; no fabricated “healthy” or “installed” state.

4. **WorkspaceProfileV1**
   - Exactly three dock slots.
   - Shared appearance: theme, glow, stars, glass opacity, blur, nebula, parallax, borders, radius, density, navigation layout, chat appearance, motion, particles, shooting-star accent and push-to-talk preference.
   - Active overlay-scene ID, TTS subscription IDs and app theme mappings.
   - Schema version, monotonically increasing revision, timestamps, account foreign key and optimistic concurrency.
   - Authenticated GET/PATCH/PUT/export/import/reset; stale revision returns conflict/current profile; invalid payloads rejected.
   - HTTPS-only dock URLs; reject credential-like query parameters.
   - Browser cache is per-user and only for startup/offline visibility. Clear rendered state on account switch; never write account A's state into account B.
   - Do not put overlay scene records or executable workflows in this profile.

5. **Commlink, notifications and events**
   - Direct/group/app/bot messages, conversations, notifications, forums/activity and platform events.
   - Event payloads are scoped, attributable and redacted; private dock URLs and credentials never enter notifications, events or Athena memory.
   - Commlink is SPMT-owned; StreamWeaver is an upstream provider/chat adapter, not the canonical messaging owner.

6. **XP and shared progression**
   - SPMT canonical XP ledger with app-bound `xp:write`, idempotency keys, immutable event attribution and derived levels.
   - DSH, ChatTag, SpaceMountain/Arena producers map to canonical event types; displays read canonical balances.
   - Historical balance repair must be monotonic and provenance-recorded; never silently reduce a player's balance.

7. **Athena/platform capability truth**
   - Memory/catalog surfaces may exist without a live execution adapter.
   - Every capability must report ready/configured/degraded/unavailable accurately.
   - A command is not accepted merely because it was stored or displayed; accepted/routed status must come from a real adapter/job.

### Known open work / parity risks

The SPMT production inventory and roadmap in the donor repo contain dated Fly-era evidence (July/August 2026); they are architectural evidence, not current Apollo production status. Revalidate all runtime values against Apollo/Hostless before relying on them.

- [ ] Port/confirm canonical SPMT identity and session APIs in Apollo, including refresh, logout, account switch, recovery and provider linking.
- [ ] Confirm all four remaining apps (StreamWeaver, HearMeOut, DSH, Nebula Arcade) use the same canonical identity without parallel account stores or forced re-registration.
- [ ] Reconcile app registry entries with the actual Apollo app routes and Node 1/2 service destinations.
- [ ] Port app-bound OAuth/service scopes and forbidden-scope tests; rotate/reissue credentials in Apollo secret stores without exposing values.
- [ ] Preserve WorkspaceProfileV1 exactly, including revision conflict, export/import/reset, three slots and user isolation.
- [ ] Verify Commlink message, notification and event persistence across reloads and account switches.
- [ ] Verify XP ledger idempotency, producer attribution and read-after-write for the remaining apps.
- [ ] Give owner recovery, login, token, webhook and platform-trigger routes bounded rate limits and durable audit evidence.
- [ ] Establish sanitized retained logs and a real operator-visible incident trail; do not infer zero errors from an empty log buffer.
- [ ] Prove database backup, isolated restore, rollback and measured RPO/RTO for the Apollo-owned SPMT store.
- [ ] Remove or explicitly quarantine stale Fly URLs, Fly secrets, machine identifiers and deployment assumptions from active Apollo runtime/config/docs.
- [ ] Run a two-account identity/session/scope matrix before enabling general users. Until then, preserve the owner-only recovery/test constraint: only the owner and their linked Twitch/Discord identities may connect; no other users/bots, chat, jobs, notifications, joins or outbound activity until explicitly approved.

### SPMT exit criteria

SPMT can leave the parity backlog when:
- Apollo has one canonical identity/session authority and all required APIs are reachable from Node 1/2.
- Owner sign-in, refresh, logout, recovery and linked-provider identity work end-to-end without exposing tokens.
- App registry and app-bound scopes are correct for all four remaining apps.
- WorkspaceProfileV1 and Commlink data survive reload/redeploy and account switching with isolation.
- XP and platform events are idempotent and attributable.
- Backup/restore, logs, audit and rollback are proven on Apollo infrastructure.
- All capabilities shown in UI reflect actual execution state.

## SpaceMountain.live review

### Existing capabilities to preserve

1. **Command Bridge shell**
   - Canonical signed-in home and navigation shell for the ecosystem.
   - Shared header and navigation state; app launch and workspace controls should stay in the existing shell.
   - No duplicate dashboard/launcher and no parallel sign-in system.

2. **Shipyard and app launch**
   - App catalog from SPMT registry: app title, launch URL, health URL, capabilities, surfaces, integration state and version/provenance.
   - Launch app in the correct existing workspace slot or app route; do not open blank popups or substitute an embed URL when a direct app URL is intended.
   - Health badges are evidence-driven, not hardcoded.

3. **Workspace and dock**
   - Preserve three saved dock slots, workspace open/close/collapse behavior, pop-out behavior and app-frame lifecycle.
   - Workspace closed means no persistent bottom slab; shared header remains the entry point.
   - App launch from the header fills an existing/empty/current slot and opens that slot.
   - Keep the existing normal controls and avoid inventing a second workspace/dashboard model.

4. **Universal appearance**
   - Consume SPMT WorkspaceProfileV1.
   - Apps map semantic settings onto their own surfaces; do not copy SpaceMountain component markup into every app.
   - Apps may expose “follow SpaceMountain theme” or an equivalent local fallback.
   - OBS/public output remains isolated from shell opacity/theme choices so a personal UI preference cannot make a browser source opaque.

5. **Overlay Bay / Personal overlay / Companion**
   - Preserve the transparent `/?desktopOverlay=1` renderer: no page background, only enabled personal widgets and three saved dock-slot shells.
   - Personal widget visibility/opacity comes from saved overlay layout; dock show/hide from WorkspaceProfileV1; glass opacity/blur from shared appearance.
   - Commlink Live Chat uses the authenticated SPMT/StreamWeaver embed bridge.
   - Companion interaction mode has a visible focus frame, dock show/hide controls and Done; outside interaction mode the native window returns to click-through.
   - Overlay Bay remains the scene/editor owner. Personal Bulletin is a saved scene/preset, not a new application or custom dashboard.

6. **Athena and ecosystem panels**
   - Shell may expose Athena, docs, notifications, Commlink and app controls, but only advertise actions that have a working backend.
   - Keep user-facing controls in the shell and execution in the owning service.

7. **Existing distinctive product details**
   - Preserve the Rocket/Arena discovery flow and durable SPMT app-state record.
   - Preserve canonical shared editor resolution from SPMT platform surfaces instead of hardcoded editor URLs.
   - Preserve the canonical Commlink surface in SPMT; do not move Commlink ownership back to StreamWeaver.
   - Preserve Discord Stream Hub community-status backoff/cache behavior so an upstream timeout does not become a shell log storm.

### Known open work / parity risks

- [ ] **Critical: Apollo shell bootstrap.** Resolve the current Node 1 blank-screen/sign-in bootstrap failure before declaring SpaceMountain parity. Normal browser state and incognito must both reach a deterministic signed-in or signed-out shell; no silent blank page.
- [ ] Confirm early bootstrap/module errors, failed same-origin fetches, resource errors and unhandled rejections are captured by the sanitized client diagnostic path and retrievable from Apollo logs/artifacts.
- [ ] Confirm sign-in JSON/token handoff applies the actual immutable user ID, persists the HttpOnly session and visibly advances the UI; reopening a tab must restore the valid session without asking for unrelated Boss Key/legacy credentials.
- [ ] Confirm the global header/top-left home route and navigation remain present across every shell page, including Overlay Bay and app frames.
- [ ] Confirm Shipyard displays actual Apollo app entries and launches the correct app; remove residual “install these apps into the sandbox” language and any duplicate sandbox/login-refresh UI that conflicts with Apollo's canonical header.
- [ ] Confirm Twitch/Discord Connect controls either complete real OAuth or show a truthful unavailable/configuration state. No decorative buttons.
- [ ] Confirm universal settings propagate to all intended apps, including Stella Core, without changing the established glass-card visual language or creating new visual chrome.
- [ ] Confirm three-slot workspace state, account isolation, save/conflict/offline feedback and cross-device persistence.
- [ ] Confirm Overlay Bay frame controls and Personal Bulletin preset reuse existing frame/scene behavior. Add a terminal frame only when a real Apollo-authorized terminal surface exists; do not fake a terminal or create a second terminal backend.
- [ ] Confirm personal overlay transparency, click-through, mute/audio behavior and Companion focus mode on desktop/mobile where supported.
- [ ] Confirm all navigation/app surfaces survive direct URL entry, refresh, sign-out/sign-in and app-to-home return.
- [ ] Confirm Rocket/Arena discovery persistence and canonical editor/Commlink routes after migration.
- [ ] Remove old Fly-specific deployment assumptions from active SpaceMountain build/runtime configuration; use Node 1/2 health and release evidence only.
- [ ] Run mobile and desktop acceptance passes, including normal browser cache and clean/incognito state.

### SpaceMountain exit criteria

SpaceMountain can leave the parity backlog when:
- Node 1 reliably renders the shell in normal and clean browser sessions.
- Owner sign-in and session restoration work end-to-end and do not strand the user on sign-in.
- Header, Shipyard, app launch, workspace and Overlay Bay work on direct entry and refresh.
- Universal settings and the three-slot workspace persist through SPMT and isolate accounts.
- OAuth connect buttons and all visible actions are real or honestly marked unavailable.
- Personal overlay/Companion behavior remains intact.
- No sandbox-only setup language, duplicate login chrome, dead controls or Fly-only assumptions remain.
- The Node 1/2 production smoke, diagnostics, backup/restore and rollback evidence are green.

## Shared Apollo migration rules

1. **Port contracts, not legacy deployment topology.** Replace Fly machines, volumes, secrets, checks and URLs with Hostless Node 1/2 equivalents.
2. **One owner per kind of state.** SPMT owns identity/workspace/shared messages/events/XP. SpaceMountain owns shell presentation and scene editing. Each specialist app owns its own domain data and workers.
3. **No silent destructive migrations.** Inventory, backup, isolated restore, migrate idempotently, compare counts/checksums, then cut over. Keep rollback path.
4. **No secret values in source, logs, PR text or docs.** Record names and readiness only.
5. **Owner-first recovery remains in force until the user explicitly opens onboarding.** Do not enable other users, bots or outbound activity merely because an integration is configured.
6. **No UI reinvention.** Reuse Apollo's universal appearance, shell header, app frames, Overlay Bay and existing controls.
7. **Green validation is necessary but not sufficient.** Require the same contract in automated tests and a real Node 1/2 smoke/owner acceptance pass.

## Suggested completion sequence

| Order | Slice | Exit proof |
|---|---|---|
| S0 | Freeze ownership map and current-state inventory | Every route, DB/table, secret name, worker, app registry record and UI surface has one owner and Apollo destination |
| S1 | Apollo SPMT identity/session and service scopes | Owner login/refresh/logout/recovery; linked Twitch/Discord; allowed/forbidden scope tests |
| S2 | App registry + Shipyard contract | Correct app metadata, health/capability truth, launch URLs, no dead/sandbox links |
| S3 | WorkspaceProfileV1 + universal appearance | Three slots, all appearance fields, revision conflicts, account isolation, export/reset |
| S4 | Commlink/events/notifications + XP | Persistence, event attribution, idempotency and canonical displays |
| S5 | SpaceMountain shell/bootstrap | Normal + incognito, direct entry, refresh, sign-in restoration, global header |
| S6 | Overlay Bay + Companion | Existing scenes/frames, transparent renderer, click-through and Personal Bulletin acceptance |
| S7 | Operational proof | Node 1/2 health, sanitized logs, backup/restore, rollback, mobile/desktop smoke |

## Explicit non-goals

- Do not redeploy either donor app to Fly.io.
- Do not recreate a second SPMT identity provider, second Shipyard, second Commlink, or second workspace.
- Do not move specialist app engines, bots, media workers or game logic into the SPMT shell.
- Do not make Athena appear more capable than its real adapters.
- Do not add a custom dashboard or redesign Stella Core/Overlay Bay to complete parity.
- Do not enable broad community traffic during the owner-only recovery phase.
- Do not mark either app complete solely because its old repository builds or its old Fly health endpoint once passed.

## Evidence and source notes

- SPMT donor: `README.md`, `docs/ecosystem/SPMT_PRODUCTION_INVENTORY.md`, `docs/ecosystem/PRODUCTION_ROADMAP.md`, `docs/ecosystem/WORKSPACE_PROFILE_V1.md`, `docs/ecosystem/production-manifest.json`, `server.ts`, `package.json`.
- SpaceMountain donor: `README.md`, `src/App.tsx`, `server.ts`, `package.json`, and the merged PR history for session resilience, canonical Commlink, canonical editor surfaces, workspace/header behavior, Shipyard launch, Rocket persistence and community-status resilience.
- Important freshness warning: donor roadmap/inventory snapshots are dated July/August 2026 and describe Fly-era deployments. Treat feature/contract descriptions as design evidence; re-check current Apollo runtime and deployment facts before closing any checklist item.
