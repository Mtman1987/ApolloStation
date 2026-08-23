# Donor → Green Parity Ledger

Updated: 2026-08-23

Purpose: prevent the clean-room rebuild from silently dropping useful production behavior while still allowing deliberate removal of legacy architecture, duplicate authority, and bloat.

This ledger is **not yet a claim that every donor route has been audited**. It is the top-level contract and discovery queue. Every donor route, API, command, overlay, worker, event, auth path, state dataset, scheduled job, and user-facing control must eventually map to a row or child row before Blue can be retired.

## Status vocabulary

- `PRESERVE` — same user capability and owner unless a better implementation is required.
- `IMPROVE` — preserve user capability but replace internals/ownership or close a known defect.
- `REPLACE` — old implementation/path disappears because another Green contract provides the capability.
- `REMOVE` — capability/architecture intentionally does not exist in Green; reason must be explicit.
- `ADD` — new Green capability required for reliability/scaling/cutover, not donor parity.
- `VERIFY` — donor behavior exists or may exist, but deep route/code audit is still required before disposition.

**Safety default:** anything discovered in donor source that is not classified here is `VERIFY`, never `REMOVE`.

**Completion rule:** a registered Apollo module, manifest, mock route, or one working vertical is not app parity. A donor app remains incomplete until every discovered retained capability has working Green code and its required standalone, embedded, bot, worker, overlay, state, migration, restart, tenant-isolation, and cross-app proofs. The full Green suite enters the integrated Sprite/Fly sandbox only after all app rows meet that rule.

## Platform and shared authority

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| SpaceMountain command bridge / suite shell | SpaceMountain | SpaceMountain | PRESERVE | Keep public navigation model during Green | shell/direct-app smoke |
| Shipyard/app launcher | SpaceMountain + SPMT registry | SpaceMountain UI + SPMT registry | IMPROVE | Preserve installed-app/launch intent | Green browser host proves hot-added registry visibility, install persistence, and inert launch; provider-connected launch still requires later sandbox proof |
| Commlink Mail | SPMT | SPMT + SpaceMountain UI | PRESERVE | Green SpaceMountain lists conversations, opens stored messages, searches canonical history, and replies to existing participants through the public SPMT contract; compose/recipient discovery, sent/read state and donor migration remain | two-account compose/reply/search/read-state migration test |
| Commlink Live Chat | SPMT UI + StreamWeaver feed | SPMT shared history + provider-neutral Chat Gateway + SpaceMountain UI | IMPROVE | preserve provider connections/history behind public chat SDK/API/events; StreamWeaver becomes a consumer, not the private contract owner | simultaneous provider, reconnect, dedupe, and external-client tests |
| Commlink Notifications | SPMT | SPMT + SpaceMountain UI | PRESERVE | migrate notification records if needed | read/unread/action test |
| Commlink App Events | SPMT | SPMT event projections | PRESERVE | version event schemas | event idempotency/replay test |
| Forums / Discord bridge | SPMT + DSH/Discord | SPMT forum authority + DSH bridge + SpaceMountain source-labeled view | IMPROVE | migrate canonical threads/replies and preserve immutable origin/provider IDs | web↔Discord edit/delete/reply, permission, and loop-deduplication tests |
| Generic context/capability panel | SpaceMountain/SPMT | SpaceMountain Stellar Core UI + SPMT jobs | IMPROVE | keep execution persona-neutral and remove fake-success behavior | available/unavailable plus queued/running/succeeded/failed tests |
| Default ecosystem AI assistant | global Athena/public AI scaffolds | Stella presentation + SPMT developer contracts + Stellar Core execution | IMPROVE | stable role `spmt.community-assistant`; no StreamWeaver or SpaceMountain session dependency; do not migrate any tenant's Athena identity into the default | SDK/API/CLI/MCP/event-job/Commlink parity, unavailable-state, two-tenant memory, and standalone-app tests |
| SPMT identity/users/tenants | SPMT | SPMT | PRESERVE | idempotent migration by immutable IDs | two-user/provider matrix |
| Browser sessions / OAuth | SPMT + app compatibility | SPMT | IMPROVE | legacy sessions instrumented then retired | direct/embed/login/logout/refresh test |
| Linked Twitch/Discord/Xbox providers | SPMT/apps | SPMT grants | PRESERVE | human-only active-link list/unlink now shares one API/SDK/CLI/MCP contract and records revocation tombstones; verified provider claim/relink and donor migration remain; never merge by display name | disconnect/relink/isolation test |
| Service authentication | mixed keys/provider tokens | SPMT scoped service identities | REPLACE | zero-use window for legacy headers | allowed/denied scope matrix |
| App registry / installs / permissions | SPMT | SPMT | PRESERVE | migrate canonical records | install/revoke/launch test |
| WorkspaceProfile/theme/backgrounds | SPMT | SPMT | PRESERVE | Green SpaceMountain now reads, renders and revision-safely edits theme/accent/background and writes only the canonical SPMT profile; migrate the complete donor profile and connect every app as a reader | device A→B exact round trip plus cross-app rendering |
| Three dock slots | SPMT/SpaceMountain | SPMT + SpaceMountain | PRESERVE | Green SpaceMountain now edits exactly three canonical slots, retains unknown legacy slot values during transition, and offers installed registry apps; migrate URLs/state, no secrets | collapse/volume/mute/device test |
| Personal overlay / Overlay Bay | SpaceMountain/SPMT | SpaceMountain renderer + SPMT scene metadata | IMPROVE | Owner-managed opaque output grants now return the browser URL once, persist only a token hash, resolve internally without redirect/query identity, and fail closed on expiry, revocation, disabled installs, or missing widgets. Scene/source composition and deployed output-gateway wiring remain | grant/revoke/restart/Chat-Tag mount tests pass; scene editor + live OBS proof remain |
| Web/image/text/camera/screen/Xbox overlay sources | SPMT/SpaceMountain/app renderers | capability-specific browser/Companion/isolated Xbox renderers behind public scene contracts | IMPROVE | sandbox HTTPS web sources; block credentials/private networks; local permissioned camera/screen by default; preserve independent visibility/interaction/opacity/layer/revoke controls | source-by-source consent, isolation, OBS, revoke, and private-network tests |
| Canonical XP/level | SPMT plus legacy producers | SPMT append-only ledger | IMPROVE | reconcile provenance; never sum/max | cross-surface exact balance test |
| Cards/collection ownership | StreamWeaver/shared use | SPMT shared catalog/ownership | IMPROVE | preserve collection, trade/deck semantics | ownership/migration sample tests |
| Developer APIs / SDK / webhooks | SPMT | SPMT | IMPROVE | Version contracts and scopes. Overlay-widget registration, owner-only output issue/list/revoke, and runtime-health reporting now have one durable tenant/app-scoped API/SDK/CLI/MCP authority with audit and recovery inventory. Output bearer URLs are disclosed once and never returned by inventory; remaining developer families still require donor audit and implementation | output opacity/revoke/restart/owner/service/tenant tests pass; full external-client conformance remains |
| Plugins/app submissions | SPMT | SPMT reviewed developer marketplace | IMPROVE | first-party conformance, one external canary, automated validation, manual publishing/high-risk-scope review, signed versions, and immediate suspension/revocation | submit→test tenant→review→publish→update→revoke canary |
| Device pairing/revocation/commands | SPMT + Companion | SPMT device gateway | PRESERVE | migrate/re-pair as contract requires | pair/revoke/replay/expiry test |
| Legacy overlay workspace blobs | SPMT/SpaceMountain | versioned scene contracts | REPLACE | import as disabled/validated scene records | import/rollback test |
| Nonfunctional block-style Builder/page/QR/flow claims | SpaceMountain | none; developers build registered apps using SDK/API/CLI/MCP/events/webhooks/jobs | REMOVE | no workflow/page data is treated as authoritative; a future third-party builder must use public contracts and normal review | assert no real caller/data dependency and remove fake-success UI/routes |
| Rocket Arena/easter-egg surfaces | SpaceMountain | Nebula Arcade Arena module | IMPROVE | preserve match-local kill score and settle capped completion/win/milestone XP, badges, or cosmetics once per verified match; no per-kill canonical XP | match/reward/idempotency/cap/leaderboard tests |
| Shop/catalog surface | SpaceMountain | SpaceMountain registry surface + verified external storefront | IMPROVE | preserve product discovery; remove fabricated order/capture behavior; accept only authenticated idempotent provider events | catalog→provider checkout→signed event→entitlement test |
| Retired `space-mountain-dashboard` | archived repo | none | REMOVE | no Green deploy | assert no launch target depends on it |

## StreamWeaver / tenant-configured bot persona runtime

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| Twitch tenant connections/listening | StreamWeaver | provider-neutral Chat Gateway | IMPROVE | migrate tenant grants/cursors without making StreamWeaver the private connection owner | concurrent-tenant socket, reconnect, and external-client tests |
| Discord bot/chat bridge behavior | StreamWeaver | Chat Gateway provider I/O + StreamWeaver command/persona consumer | IMPROVE | The provider-neutral consumer now rejects bot-authored messages, applies explicit mention and channel scope rules, and emits unavailable replies only through gateway egress. Live Discord/Twitch input/output drivers still remain | Discord/Twitch cross-path, reconnect, loop, and scope tests |
| Tenant bot dispatch | StreamWeaver | StreamWeaver | PRESERVE | A tenant-selected persona config now controls owner identity, aliases, home channels, and the durable external summon window. Dispatch uses canonical identity when linked, a provider-scoped fallback otherwise, stable delivery-derived job identity, and no fake reply on accepted work | implemented routing/restart cases pass; two-tenant invoke isolation and live result delivery remain |
| Tenant persona/personality/model requests (Athena for the owner) | StreamWeaver | StreamWeaver persona runtime + shared Stellar Core execution | IMPROVE | Configured persona routing preserves the owner's casual summon, requires explicit mentions from other users, allows the home channel without a summon, and persists the exact ten-minute external summon scope across restart. Athena remains this owner's configured persona rather than a global default. Persona configuration migration, Stellar job/result streaming, voice, memory policy, and full capability routing remain | routing, bot-loop, expiry, persistence, accepted/unavailable, stable-job tests pass; two-tenant distinct-persona, memory-isolation, routing-entitlement, and ordered-conversation tests remain |
| TTS generation/playback | StreamWeaver | StreamWeaver persona UX/playback + Stellar Core TTS jobs/adapters | IMPROVE | preserve subscriptions/voice choices while removing generic provider/model execution from StreamWeaver | queue/replay/provider-fallback/local-Companion test |
| Commands/actions/redeems | StreamWeaver | StreamWeaver | PRESERVE | route-by-route inventory required | command regression matrix |
| Points commands/display | StreamWeaver | SPMT XP read + StreamWeaver producer where appropriate | REPLACE | migrate display semantics | same balance everywhere |
| Shared normalized chat feed | StreamWeaver | provider-neutral Chat Gateway | IMPROVE | A bounded Chat Gateway now normalizes Twitch/Discord/Kick messages, preserves canonical or provider-scoped actor identity, durably dedupes provider messages, queues per-consumer delivery, retries failures, isolates tenants, and feeds both Chat Tag and the StreamWeaver persona router. A deterministic multi-worker supervisor leases provider configs, obtains ephemeral SPMT grants, resumes durable cursors, pauses reauthorization failures, and applies donor-aligned reconnect backoff. Concrete Twitch/Discord/Kick protocol drivers, Commlink consumption, and sandbox proof remain | dedupe/replay/consumer/lease/cursor/backoff/reauthorization tests pass; live-provider and external-client conformance remain |
| Pin/queue/feature/featured-message output | StreamWeaver/Commlink | StreamWeaver runtime + SpaceMountain UI | PRESERVE | maintain stable OBS output | timed clear/queue advance test |
| Public overlays/browser sources | StreamWeaver | StreamWeaver/SpaceMountain renderer by ownership | VERIFY | route inventory before consolidation | transparent/OBS smoke per route |
| Pokémon commands/decks/trades/battles | StreamWeaver | StreamWeaver rules + SPMT ownership | IMPROVE | keep game rules, centralize shared ownership | collection/deck/trade fixture |
| Voice Commander | StreamWeaver | StreamWeaver + device/voice adapters | VERIFY | preserve only real supported actions | voice intent/action test |
| Research Mode / knowledge packs | StreamWeaver | StreamWeaver persona UX + Stellar Core research jobs | IMPROVE | migrate tenant policy/config and execute through public scoped job contracts | tenant isolation/source/citation/job-state test |
| Companion source currently inside repo | StreamWeaver | ApolloStation Companion package | IMPROVE | preserve capabilities, separate deploy/runtime boundary | desktop/device suite |
| Persona AI elastic helper tier | none | Stellar Core bounded worker pool; StreamWeaver remains the persona/request consumer | ADD | no donor compatibility required; provider/model execution stays persona-neutral | queue/load/routing-entitlement/duplicate-reply test |
| Direct worker writes to tenant volume | n/a/legacy risk | none | REMOVE | workers return results through job contract | failure/retry idempotency test |

## Discord Stream Hub

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| Live stream monitoring | DSH | DSH module | PRESERVE | DSH now has a durable tenant-isolated live projection that converts complete member/stream polls into idempotent routed create/update/remove actions with a retryable output outbox. The Twitch Helix boundary uses ephemeral SPMT grants, batches up to 100 logins/request, classifies 401 reauthorization, refuses incomplete-poll mass-offline reconciliation, and handles authoritative directory removals. Discord renderer/delivery, member/config migration, scheduler wiring, and live sandbox proof remain | live/offline, restart/retry, Helix batching, incomplete-poll, token-header, and reauthorization tests pass; Discord/live-provider sandbox remains |
| Shoutouts and routing groups | DSH | DSH module | PRESERVE | migrate group/routing rules | representative guild test |
| Spotlight rotation | DSH | DSH module | PRESERVE | The donor's ten-minute alphabetical all-group rotation, one-live-member behavior, current-member invalidation, offline clearing, durable cursor, poll replay, and tenant isolation are implemented. GIF/clip selection, pinned Discord embed replacement, and live Discord proof remain | core rotation/recovery tests pass; media/embed/live-provider matrix remains |
| Discord/community moderation flows | DSH | DSH module | PRESERVE | scoped Discord grants | allowed/denied action test |
| Calendar | DSH | DSH module | PRESERVE | migrate entries/config | CRUD/display test |
| Points producer | DSH | DSH → SPMT XP events | IMPROVE | no local canonical balance | duplicate-event test |
| Leaderboard | DSH | SPMT projection + DSH view | IMPROVE | rebuild projection | parity with canonical XP |
| Member linking/onboarding | DSH + SPMT | SPMT identity with DSH provider UX | IMPROVE | immutable provider IDs | existing-user grandfather test |
| `!mtfixit` / support ingress | DSH | SPMT support/job intake or explicit compatibility adapter | VERIFY | keep until replacement proves intake | privacy/audit/idempotency test |
| Clip/media conversion | `dsh-clip-worker` | DSH elastic media worker | PRESERVE | worker remains non-authoritative | restore + process test |
| DSH persistent media/cache | DSH volume | DSH private store/object storage | IMPROVE | classify durable vs regenerable | inventory/restore test |

## HearMeOut

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| Rooms | HearMeOut | HearMeOut module | PRESERVE | A durable tenant-private room authority preserves the donor's six-hour ordinary-room lifetime, non-expiring admin-only system rooms, owner/member identity, join/leave replay protection, restart state, and expiration enforcement. Private-room passwords are now scrypt-hashed and enforced server-side; password or identity-bound invitation admission is durable, and the owner remains admitted without leaking a secret. Complete room migration and user-facing surfaces remain | lifecycle/replay/restart/two-tenant/password-opacity/invitation/reauthorization cases pass; donor migration and UI matrix remain |
| Room presence | HearMeOut | HearMeOut module | PRESERVE | A member-only tenant-scoped presence projection now preserves the donor's five-second heartbeat expectation and exact 45-second stale cutoff, supports explicit disconnect and pruning, and cannot create presence before admission | active/stale/prune/disconnect/membership/two-tenant tests pass; multi-client UI/transport proof remains |
| LiveKit voice/media sessions | HearMeOut | HearMeOut | PRESERVE | The authorization core now issues short-lived signing requests only for active same-tenant room members, distinguishes microphone-only participant and listen-only grants, restricts human media publishing to host/admin, permits scoped Companion/HearMeOut service publishers, and forbids service voice impersonation. The deployment JWT signer and real transport remain | membership/tenant/expiry/voice/listen/human/service permission tests pass; signed-token + multi-client LiveKit proof remains |
| Discord Activity integration | HearMeOut | HearMeOut + SPMT session grant | IMPROVE | remove anonymous authority inheritance | Activity auth matrix |
| Twitch/Discord integration | HearMeOut | HearMeOut adapters | PRESERVE | linked provider grants | route/auth tests |
| DJ/music requests/queue | HearMeOut + HMO worker | HearMeOut + elastic DJ/media worker | PRESERVE | The canonical room media authority now gives music its own durable lane, makes the first validated item current and playing, queues later requests, and dedupes requests by stable operation ID. Live search/resolution, TTS priority, auto-radio, worker cache, announcements, and provider playback still remain | implemented request→queue→play/replay/restart tests pass; worker/provider matrix remains |
| Watch parties | HearMeOut | HearMeOut | PRESERVE | The same authority now gives movie watch parties a separate per-room lane, durable current/queue state, synchronized effective playback position, restart recovery, and expected-current protection for duplicate completion/next signals. Live clients and media transport remain | implemented synchronized state/control/restart tests pass; multi-client transport test remains |
| Search/playback/control | HearMeOut | HearMeOut | IMPROVE | Host/admin play, pause, seek, mute, volume, jump, next, and clear now mutate one authoritative session; a room member may use the donor-compatible next/clear exception only when they own a request. Playable inputs are normalized and reject unsafe URL schemes. Provider selection, recommendation acceptance, next-episode, auto-radio, and public API/session-grant adapters remain | implemented permission/position/queue/idempotency cases pass; source/API/activity matrix remains |
| OBS/now-playing output | HearMeOut | HearMeOut renderer | PRESERVE | stable output URL | OBS smoke |
| Media caches/HLS | HMO DJ worker | worker cache/private media store | IMPROVE | generated cache remains rebuildable | cache rebuild test |
| Legacy duplicate media routes | HearMeOut | canonical media/session routes | REPLACE | telemetry/compat window before removal | zero-use evidence |
| Voice device volume/noise/PTT preferences | browser/device | local client/Companion | PRESERVE | never centralize hardware-only choice | device-local isolation test |

## ChatTag donor / Nebula Arcade

`ChatTag` remains the donor repository label. The original Chat Tag game keeps its name; the broader modular product is **Nebula Arcade** under D-32. No game capability is removed merely because ownership, package boundaries, or the suite name changes.

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| Original Chat Tag game | ChatTag | ChatTag core module | PRESERVE | **READY FOR PRIVATE SPRITE SANDBOX.** Donor commit `8170c51` is covered by persistent tenant game state; join/leave; it/FFA transfer; scoring; immunity; ordinary-chat activity wakeup; passes; moderator controls; fixed crowns; exact 40-minute/5-hour rotation and 60-minute FFA reminder; live/chatting player paging; Pin ranking; durable support, overlay-mode/message, and channel-opt-out state; normalized Twitch/Discord/Kick ingress; provider-neutral replies; visual OBS output; and one-time donor import. The standalone port-8080 sandbox exposes a same-origin test console, health/state/rotation endpoints, persistent SQLite, and the OBS route while rejecting provider credentials and egress. Historical donor scores never replay as new XP. Production cutover still requires Blue identity reconciliation, live provider-driver conformance, the deployed opaque output-gateway mount, private Sprite/OBS evidence, and owner acceptance | core/experience/gateway/grant/renderer/migration/replay/restart/outage and standalone sandbox suites pass; live-provider, deployed-gateway, Blue import, and OBS acceptance matrix remains |
| Quackverse | ChatTag | ChatTag bounded game module | PRESERVE | preserve overlay/profile behavior | game/overlay test |
| Bingo | ChatTag | ChatTag bounded game module | PRESERVE | deep audit required | game regression test |
| Nebula Arcade catalog | ChatTag | separate bounded game modules sharing the public game SDK | IMPROVE | do not make one giant runtime; publish modules through the canonical registry | per-game contract and dynamic-discovery suite |
| Durable per-channel game runtime actions | ChatTag | ChatTag runtime | PRESERVE | migrate active state only when safe | action replay/dedupe test |
| Nebula Arcade overlay profiles | ChatTag | game module/SpaceMountain scene integration | PRESERVE | import profile references | OBS/profile test |
| Bot worker | `chat-tag-bot-new` | elastic/lease-aware ChatTag bot worker | IMPROVE | bot owns no canonical state | reconnect/duplicate command test |
| Game-specific state | ChatTag | ChatTag private authority | PRESERVE | classify retention/limits | restart/restore test |
| XP/rewards | ChatTag + SPMT | SPMT ledger; ChatTag emits outcomes | IMPROVE | migrate provenance/idempotency | one-award-only test |
| Leaderboards/shared profile stats | ChatTag/local + SPMT | SPMT projection | REPLACE | local copy becomes cache/view only | canonical match test |

## Operations / MountainView / Companion

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| 12-hour machine rotation | Rotator | Mtman Machine Rotator fleet reconciler | IMPROVE | preserve controlled periodic restart for always-on Machines; replace blind fleet-wide rotation with per-workload rolling, drain-aware, readiness-gated policy | rolling restart/minimum-capacity/duplicate-consumer tests |
| Fleet health/log diagnostics | Rotator | Mtman Machine Rotator operations module + bounded SPMT runtime projection | IMPROVE | observe Fly/workload truth and retain redacted decision/action evidence without creating a second registry or product-data authority | fault injection, stale-signal, audit-redaction and projection tests |
| Demand-aware Machine lifecycle | partial Fly autostart/app-local behavior | Mtman Machine Rotator fleet reconciler | ADD | enroll approved workloads with minimum/maximum/cooldown/cost policy and scale from traffic, queue, room/session, socket, lease and capacity signals | burst, drain, cooldown, quota, cost and orphan-repair tests |
| App lifecycle self-service | direct/private operational paths | versioned SPMT/Rotator SDK/API/CLI/MCP contracts | IMPROVE | apps publish their own signals and request only in-policy actions; owner retains cross-fleet/high-risk control; no Fly credentials leave the Rotator boundary | own-app allow, cross-app deny, high-risk approval and idempotency tests |
| Error classification/repair audit | Rotator/Athena Coder | operations/Stellar Core capability; Athena is the owner's configured presentation | IMPROVE | no autonomous production write without approved policy; other users/apps select Stella or their configured persona | dry-run/audit/rollback/identity-isolation test |
| GitHub bridge / operator controls | Rotator | operations module | VERIFY | preserve only needed owner workflows | auth/action audit |
| MCP/API/CLI operational surfaces | Rotator/SPMT | versioned SPMT/ops contracts | IMPROVE | eliminate duplicate authority | conformance test |
| MountainView device records | Rotator/MountainView | SPMT device authority + MountainView module | IMPROVE | The first device contract now makes SPMT the only pairing/revocation caller, persists tenant-private grants, and gives each Companion only explicit capabilities. Provider tokens and device-local preferences are not stored in shared records. Enrollment API/SDK surfaces and donor migration remain | implemented pairing/revocation/cross-tenant/capability tests pass; migration and public-contract conformance remain |
| MountainView voice-command routing | MountainView | MountainView planner + owning app public contracts | IMPROVE | The provider-neutral planner now keeps DSH community live state distinct from Chat Tag activity, sends music requests to HearMeOut, stream actions to StreamWeaver, and OBS only to a paired Companion. Unknown intent returns clarification rather than executing a guessed path. The complete donor command/profile/visual/QR inventory remains | implemented route-ownership and no-device cases pass; complete command/visual/device matrix remains |
| MountainView phone/BLE/media bridge | MountainView | local Companion/MountainView relay | PRESERVE | Hardware operations remain local. The Green relay contract carries only a scoped command, target device, actor, idempotency key, and confirmation state; BLE/audio/camera/RDGlass clients and real hardware proof remain | contract authorization/retry tests pass; real-device test remains |
| Companion local relay/compute | Companion | Companion | PRESERVE | A local-adapter boundary now accepts only paired, non-revoked, tenant-matching, capability-granted commands from the declared source app; completed commands dedupe and temporary failures remain retryable with redacted evidence. Desktop connection lifecycle and job claiming remain | implemented allow/deny/dedupe/retry cases pass; relay reconnect and local-job tests remain |
| Companion overlay/popouts | Companion + SpaceMountain | Companion + SpaceMountain | PRESERVE | keep local window state local | desktop/multi-monitor test |
| OBS WebSocket controls | Companion | Companion | PRESERVE | OBS scene commands now route only to a paired local Companion with the `obs.scene` grant; unknown shell/action strings never reach the adapter. Stream start/stop confirmation UX and a real OBS WebSocket adapter remain | command allowlist tests pass; approved-action/real-OBS test remains |
| Local media library + bounded FFmpeg jobs | Companion | Companion | PRESERVE | maintain local ownership and review | transcode/restart test |
| Signed installer/update path | Companion | Companion release pipeline | IMPROVE | no cutover dependency for web, required for desktop release | clean install/update/uninstall proof |
| `spmt-vault` independent recovery | none | recovery app | ADD | separate app/region/credentials; 15-minute primary RPO, 60-minute normal RTO, four-hour provider-boundary RTO, tiered 30-daily/12-weekly/12-monthly retention | quarterly restore, promotion, integrity, and failback drill |

## Explicit removals — no parity obligation

These are architecture debt, not user features. Green must not recreate them.

| Donor architecture | Green disposition | Reason |
|---|---|---|
| Firebase/Firestore runtime/migration/backup compatibility | REMOVE | retired; canonical docs must not send new work toward it |
| universal SPMT/system API key | REMOVE | replace with scoped service identities |
| provider token reused for internal auth | REMOVE | provider compromise must not confer ecosystem authority |
| separate canonical point balances | REMOVE | one append-only SPMT ledger |
| browser/localStorage authentication authority | REMOVE | SPMT secure session only |
| direct app mounts of shared authoritative volume | REMOVE | one storage authority behind versioned contracts |
| silent fallback to local production database | REMOVE | fail readiness and show recoverable degraded state |
| fake AI/job/shell success | REMOVE | real accepted-job and result states only |
| nonfunctional block-style Builder/page/QR/flow product | REMOVE | developers build real registered apps and integrations through the public SDK/API/CLI/MCP/events/webhooks/jobs |
| one ordinary Machine per AI persona | REMOVE | pooled inference by default; isolation only when justified |
| permanent compatibility routes with no callers | REMOVE after evidence | zero-use window + rollback checkpoint |
| tracked duplicate docs/spec mirrors in Green | REMOVE | one source, generated published output |

## Deep-audit queue

Top-level parity is not enough. Before each product implementation batch, extract current donor source into a machine-checkable inventory covering:

1. pages/routes and redirects;
2. API endpoints and methods;
3. bot commands, aliases, permissions, and provider listeners;
4. WebSocket/SSE/event names and payload versions;
5. overlays/browser-source URLs and output behavior;
6. workers/process groups/scheduled jobs;
7. auth/OAuth callbacks, service headers, scopes, and compatibility sessions;
8. databases, volume paths, JSON stores, caches, media, and retention;
9. shared settings/theme/workspace reads and writes;
10. external provider/API dependencies;
11. health/readiness and operational controls;
12. recent merged fixes that supersede stale documentation.

Audit state:

| Donor repo | Deep audit | Retirement blocker |
|---|---|---|
| `Mtman1987/spmt-live` | IN PROGRESS — production startup chain, route domains, schema families, patch debt, and Green gap captured in `docs/donor-audits/SPMT_DEEP_AUDIT_2026-08-23.md`; route-by-route caller/migration proof and retained implementations remain | yes |
| `Mtman1987/spacemountain-live` | IN PROGRESS — production runtime, visible routes, local duplicate state, private cross-app calls, patch debt, capability dispositions, and Green gaps captured in `docs/donor-audits/SPACEMOUNTAIN_DEEP_AUDIT_2026-08-23.md`; linked-provider Settings is now on the public SPMT contract, while the remaining retained pages and migrations are incomplete | yes |
| `Mtman1987/streamweaver` | PENDING | yes |
| `Mtman1987/DiscordStreamHub` | IN PROGRESS — live monitoring, spotlight timing, Helix batching, and incomplete-poll behavior audited at `e35a1b0`; full route/worker/config/media inventory remains | yes |
| `Mtman1987/hearmeout-main` | IN PROGRESS — room lifetime, private-password gap, presence timing, media lanes/controls, and LiveKit authority audited at `686d237`; complete route/UI/worker/provider inventory remains | yes |
| `Mtman1987/chat-tag` | IN PROGRESS — original Chat Tag is ready for private Sprite sandbox at donor baseline `8170c51`; production live-provider/output-gateway/import evidence plus Quackverse, Bingo, Arena, and wider Game Hub slices remain | yes |
| `Mtman1987/fly-machine-rotator` | PENDING | yes for retained operational/device capabilities |
| Companion source/package | PENDING | yes for desktop/device cutover |

## Blue retirement gate

Blue cannot be turned off merely because Green looks complete. Retirement requires:

- every discovered donor capability classified as `PRESERVE`, `IMPROVE`, `REPLACE`, or approved `REMOVE`;
- all `PRESERVE`/`IMPROVE` rows implemented and tested;
- every `REPLACE` row proves the replacement path and compatibility/migration window;
- every `REMOVE` row has an explicit owner-approved reason;
- two-tenant isolation and account switching pass;
- canonical state reconciliation passes with no unexplained drift;
- worker concurrency/load tests pass without duplicate replies/events/awards;
- primary/recovery promotion, failover writes, rebuild, and failback are rehearsed;
- observation window passes within the approved error/latency/cost budget;
- DNS/route and data rollback are rehearsed;
- final Blue write freeze, backup, reconciliation, and read-only retention are complete.
