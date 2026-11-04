# SPMT donor deep audit

Captured: 2026-08-23  
Donor: `Mtman1987/spmt-live`  
Donor commit: `bbd335ce8083b540ba9c7f8468edbfbfa46fc5d5`  
Green destination: `apps/spmt-service` plus bounded Apollo packages

## Audit conclusion

SPMT is not yet at production parity in Green. The donor's actual `start.cjs` runtime combines the bundled `server.ts` with 17 bootstrap/patch modules and declares 200 Express route registrations representing 190 unique method/path pairs. Green currently exposes 60 unique method/path shapes across its service and API adapter. Raw route totals are not the parity target—many donor routes are aliases, patch-era duplicates, UI-serving endpoints, or capabilities moving to bounded product modules—but the gap proves that the present Green service is a foundation, not a complete SPMT port.

The clean rebuild must preserve tenant-visible behavior and supported developer behavior while replacing the donor's runtime source mutation, private app forwarding, universal-key compatibility, and duplicated ownership with versioned developer contracts.

## Production startup evidence

Fly starts `node start.cjs`. That startup path:

1. builds/loads the main server bundle;
2. mutates the generated server and public assets;
3. installs identity, Commlink, presence, OAuth recovery, account recovery, Xbox, Athena-command, entitlement, tenant-overlay, and diagnostic Express wrappers;
4. then launches the service.

The donor also runs source-patching scripts before development, typecheck, build, and start. These scripts are evidence of working fixes that must be understood, but the patch mechanism itself must not be ported.

## Capability disposition

| Donor domain | Donor evidence | Green disposition | Current Green state | Retirement proof |
|---|---:|---|---|---|
| Health/system status | 7 route shapes | PRESERVE/IMPROVE | liveness and dependency readiness implemented; compatibility/UI status remains | cold-start, dependency-failure, drain, build/version tests |
| Identity, login, recovery, sessions | 20+ routes plus bootstrap wrappers | PRESERVE/IMPROVE | registration, login/logout/refresh, first-time Discord→Twitch setup, DM reset, account provisioning, and human-only linked-provider list/unlink implemented through API/SDK/CLI/MCP; provider claim/relink UX, legacy import, recovery aliases, session bridge, and migration remain | existing-account migration; login/logout/refresh; direct/shell/embed; two-user/provider isolation |
| OAuth, embed launch, service identity | authorize/token/userinfo, embed exchange, provider grants, developer keys | IMPROVE/REPLACE | standards-oriented OAuth and scoped service-token foundation implemented; embedded launch, provider-grant UX, key lifecycle/revocation, and caller migration remain | PKCE, redirect validation, scope matrix, revoke, embed, and legacy zero-use proof |
| App registry, installs, submissions, plugins/components | public/private registry, install/disable, review, submission, plugin, component routes | PRESERVE/IMPROVE | registry, install/disable, entitlements implemented; developer submission/review/signing/plugin/component lifecycle incomplete | flagship plus external-canary submit→review→publish→install→update→revoke |
| Developer SDK/API/docs/MCP/webhooks | platform discovery/docs, MCP, API keys, webhooks, events | IMPROVE | versioned API adapter, SDK, CLI, MCP and webhook core exist; complete published surface, conformance, key UX and compatibility remain | same operation through SDK/API/CLI/MCP; webhook retry/signature; external client |
| Workspace profile/theme/background | six profile routes | PRESERVE | canonical versioned profile read/patch exists | current profile migration and device A→B exact round trip |
| App-private state/discoveries/settings | app-state, discovery, settings routes | PRESERVE or MOVE | no complete compatibility/migration surface yet | dataset owner classification; app migration; restart/restore |
| XP/levels/leaderboard | balance, award/spend, transfer, gamble settlement, leaderboard, migration | IMPROVE | append-only award and balance foundation exists; spend, transfer, settlement, leaderboard/projection and reconciliation incomplete | source-ledger reconciliation; duplicate events; same balance across all apps |
| Mail/conversations/notifications | messages, conversations, notification routes | PRESERVE/IMPROVE | conversation/message/search and notification core exist; inbox/sent/read-all/compatibility and complete migration remain | two-account history/read-state/action migration tests |
| Commlink live feed/dispatch | feed, operator, group dispatch/retry, private StreamWeaver forward | IMPROVE/REPLACE | shared history exists; provider-neutral Chat Gateway and live dispatch/replay are not complete | simultaneous providers, reconnect, loop prevention, dedupe, retry, external client |
| Presence/live community | heartbeat, presence, live-community | PRESERVE/IMPROVE | missing | authenticated lease/TTL, reconnect, stale cleanup, multi-app aggregation |
| Overlay workspace/scenes/tenant outputs | workspace, scenes, alerts, public/personal launch, tenant routes | IMPROVE | shared contracts specified; complete scene storage/editor/render grants and migration missing | source-by-source OBS, revoke, scene import, alert replay, two-tenant isolation |
| Cloud Xbox | eight control/session routes, tenant frame/status routes, isolated `xbox` process | PRESERVE/IMPROVE | contract/policy documented; real controller/session worker pool missing | one session per lease, N users→N workers, prewarm, drain, expiry, no cross-session input |
| Companion device gateway | capability/bootstrap/exchange/device/diagnostic/command routes | PRESERVE/IMPROVE | account/device package groundwork only; full pairing, command relay and Companion parity missing | one-time bootstrap, pair/revoke, offline retry, replay/expiry, desktop real-device proof |
| Stella/Athena context and jobs | context, memory, catalog, command, code-job routes | IMPROVE | persona-neutral context/capability and operations job contracts exist; inference/coder workers and durable result flow incomplete | queued→running→terminal states, unavailable truth, memory isolation, provider fallback |
| Forums/Discord bridge | thread/reply/list/channel/forward routes | PRESERVE/IMPROVE | missing | web↔Discord create/edit/delete/reply, provenance, permissions, loop dedupe |
| Search | cross-domain search route | PRESERVE/IMPROVE | Commlink-only search exists; suite search incomplete | permission-filtered indexed results across retained authorities |
| Arena/easter eggs | arena routes and entitlement/transmission bootstraps | MOVE/IMPROVE | moved to Nebula Arcade blueprint; not fully ported | game-state, reward idempotency/caps, leaderboard and overlay tests |
| Generic AI and voice messages | AI conversation/message and voice-message routes | MOVE/IMPROVE | contracts exist; full Stellar Core/TTS execution and UX incomplete | job queue, result delivery, entitlement, local Companion and paid fallback tests |
| Static shell/download/embed renderers | catch-all, download, embed routes | PRESERVE or REPLACE | SpaceMountain/Companion surfaces only partially implemented | route-level browser/installer/OBS smoke and redirect compatibility plan |

## Canonical donor datasets

The donor schema declares at least 34 durable tables covering users, OAuth clients/codes/tokens, messages/conversations, forums, settings, Arena, installs/permissions, notifications, overlay/workspace/app state, Commlink receipts, discoveries/workflows, XP ledger/migrations, recovery/provider tickets, Athena memory, developer keys/webhooks/components/submissions/plugins/events, provider grants, embed codes, and Companion devices/bootstrap/commands. Presence adds another runtime table.

Each table must receive one of four dataset outcomes before migration: migrate to SPMT authority, migrate to a bounded app authority, rebuild as a projection/cache, or remove with owner approval and zero-use evidence. Table creation in a new schema is not migration proof.

## Known implementation debt to leave behind

- prebuild/prestart scripts that rewrite source or generated bundles;
- Express monkey-patching bootstraps and route shadowing;
- private direct forwarding from SPMT to StreamWeaver;
- Arena balance reads using a DSH bot key;
- compatibility fallback from API keys to a broad Codex service secret;
- browser/localStorage authentication authority;
- Firebase/Firestore echoes;
- fake or preview success paths;
- duplicate overlay/profile/state authorities;
- unbounded catch-all compatibility routes without measured callers.

These are removals of implementation debt, not permission to remove the user capability that a patch currently repairs.

## Next implementation order

1. Finish current-account identity/provider/session migration and compatibility proof.
2. Finish canonical developer key/OAuth/embed/app-registry/submission contracts.
3. Finish workspace/profile and XP ledger operations plus reconciliation tooling.
4. Finish Mail/Notifications and introduce the provider-neutral Chat Gateway for Commlink live traffic.
5. Finish overlay scene/grant/renderer contracts.
6. Finish Companion device gateway and isolated Xbox session orchestration.
7. Move Arena and generic AI/TTS execution to their bounded product/worker modules.
8. Migrate every retained donor dataset, run restart/restore and two-tenant tests, then remove measured-unused compatibility routes.

SPMT is complete only after these capabilities work against migrated tenant fixtures and through the same public contracts available to first- and third-party developers.
