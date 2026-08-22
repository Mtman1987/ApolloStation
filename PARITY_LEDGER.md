# Donor → Green Parity Ledger

Updated: 2026-08-21

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

## Platform and shared authority

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| SpaceMountain command bridge / suite shell | SpaceMountain | SpaceMountain | PRESERVE | Keep public navigation model during Green | shell/direct-app smoke |
| Shipyard/app launcher | SpaceMountain + SPMT registry | SpaceMountain UI + SPMT registry | IMPROVE | Preserve installed-app/launch intent | registry + launch contract test |
| Commlink Mail | SPMT | SPMT + SpaceMountain UI | PRESERVE | migrate conversations/messages | two-account message test |
| Commlink Live Chat | SPMT UI + StreamWeaver feed | StreamWeaver feed + SpaceMountain UI | PRESERVE | signed/scoped feed contract | simultaneous source test |
| Commlink Notifications | SPMT | SPMT + SpaceMountain UI | PRESERVE | migrate notification records if needed | read/unread/action test |
| Commlink App Events | SPMT | SPMT event projections | PRESERVE | version event schemas | event idempotency/replay test |
| Generic context/capability panel | SpaceMountain/SPMT | SpaceMountain Stellar Core UI + SPMT jobs | IMPROVE | reserve Athena for the bot persona; remove fake-success behavior | available/unavailable plus queued/running/succeeded/failed tests |
| SPMT identity/users/tenants | SPMT | SPMT | PRESERVE | idempotent migration by immutable IDs | two-user/provider matrix |
| Browser sessions / OAuth | SPMT + app compatibility | SPMT | IMPROVE | legacy sessions instrumented then retired | direct/embed/login/logout/refresh test |
| Linked Twitch/Discord/Xbox providers | SPMT/apps | SPMT grants | PRESERVE | never merge by display name | disconnect/relink/isolation test |
| Service authentication | mixed keys/provider tokens | SPMT scoped service identities | REPLACE | zero-use window for legacy headers | allowed/denied scope matrix |
| App registry / installs / permissions | SPMT | SPMT | PRESERVE | migrate canonical records | install/revoke/launch test |
| WorkspaceProfile/theme/backgrounds | SPMT | SPMT | PRESERVE | migrate one authoritative profile | device A→B round trip |
| Three dock slots | SPMT/SpaceMountain | SPMT + SpaceMountain | PRESERVE | migrate URLs/state, no secrets | collapse/volume/mute/device test |
| Personal overlay / Overlay Bay | SpaceMountain/SPMT | SpaceMountain renderer + SPMT scene metadata | IMPROVE | stable read-only output grants | OBS renderer + revoke test |
| Canonical XP/level | SPMT plus legacy producers | SPMT append-only ledger | IMPROVE | reconcile provenance; never sum/max | cross-surface exact balance test |
| Cards/collection ownership | StreamWeaver/shared use | SPMT shared catalog/ownership | IMPROVE | preserve collection, trade/deck semantics | ownership/migration sample tests |
| Developer APIs / SDK / webhooks | SPMT | SPMT | IMPROVE | version contracts and scopes | conformance suite |
| Plugins/app submissions | SPMT | SPMT | VERIFY | retain only real supported lifecycle | app-install canary |
| Device pairing/revocation/commands | SPMT + Companion | SPMT device gateway | PRESERVE | migrate/re-pair as contract requires | pair/revoke/replay/expiry test |
| Legacy overlay workspace/builder blobs | SPMT/SpaceMountain | versioned scene/workflow contracts | REPLACE | import as disabled/validated records | import/rollback test |
| Rocket arena/easter-egg surfaces | SpaceMountain | TBD product module | VERIFY | no removal until code/usage audit | owner keep/remove decision |
| Retired `space-mountain-dashboard` | archived repo | none | REMOVE | no Green deploy | assert no launch target depends on it |

## StreamWeaver / Athena bot persona runtime

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| Twitch tenant connections/listening | StreamWeaver | StreamWeaver coordinator | PRESERVE | migrate tenant grants/config | concurrent-tenant socket test |
| Discord bot/chat bridge behavior | StreamWeaver | StreamWeaver coordinator | PRESERVE | preserve proven sender paths | Discord/Twitch cross-path test |
| Tenant bot dispatch | StreamWeaver | StreamWeaver | PRESERVE | explicit tenant context | two-tenant invoke isolation |
| Athena/personality/model routing | StreamWeaver | StreamWeaver runtime | IMPROVE | separate job execution from sender | ordered conversation test |
| TTS generation/playback | StreamWeaver | StreamWeaver + elastic worker | IMPROVE | preserve subscriptions/voice choices | queue/replay/fallback test |
| Commands/actions/redeems | StreamWeaver | StreamWeaver | PRESERVE | route-by-route inventory required | command regression matrix |
| Points commands/display | StreamWeaver | SPMT XP read + StreamWeaver producer where appropriate | REPLACE | migrate display semantics | same balance everywhere |
| Shared normalized chat feed | StreamWeaver | StreamWeaver | PRESERVE | version event contract | dedupe/reconnect/replay test |
| Pin/queue/feature/featured-message output | StreamWeaver/Commlink | StreamWeaver runtime + SpaceMountain UI | PRESERVE | maintain stable OBS output | timed clear/queue advance test |
| Public overlays/browser sources | StreamWeaver | StreamWeaver/SpaceMountain renderer by ownership | VERIFY | route inventory before consolidation | transparent/OBS smoke per route |
| Pokémon commands/decks/trades/battles | StreamWeaver | StreamWeaver rules + SPMT ownership | IMPROVE | keep game rules, centralize shared ownership | collection/deck/trade fixture |
| Voice Commander | StreamWeaver | StreamWeaver + device/voice adapters | VERIFY | preserve only real supported actions | voice intent/action test |
| Research Mode / knowledge packs | StreamWeaver | StreamWeaver inference/runtime | PRESERVE | migrate tenant policy/config | tenant isolation/source test |
| Companion source currently inside repo | StreamWeaver | ApolloStation Companion package | IMPROVE | preserve capabilities, separate deploy/runtime boundary | desktop/device suite |
| StreamWeaver elastic helper tier | none | StreamWeaver worker pool | ADD | no donor compatibility required | queue/load/duplicate-reply test |
| Direct worker writes to tenant volume | n/a/legacy risk | none | REMOVE | workers return results through job contract | failure/retry idempotency test |

## Discord Stream Hub

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| Live stream monitoring | DSH | DSH module | PRESERVE | migrate community config | live/offline transition test |
| Shoutouts and routing groups | DSH | DSH module | PRESERVE | migrate group/routing rules | representative guild test |
| Spotlight rotation | DSH | DSH module | PRESERVE | migrate state/settings | rotation/recovery test |
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
| Rooms | HearMeOut | HearMeOut module | PRESERVE | migrate room/user config as appropriate | multi-user room test |
| LiveKit voice/media sessions | HearMeOut | HearMeOut | PRESERVE | preserve room/token rules | publish/subscribe/permission test |
| Discord Activity integration | HearMeOut | HearMeOut + SPMT session grant | IMPROVE | remove anonymous authority inheritance | Activity auth matrix |
| Twitch/Discord integration | HearMeOut | HearMeOut adapters | PRESERVE | linked provider grants | route/auth tests |
| DJ/music requests/queue | HearMeOut + HMO worker | HearMeOut + elastic DJ/media worker | PRESERVE | one canonical media contract | request→queue→play test |
| Watch parties | HearMeOut | HearMeOut | PRESERVE | consolidate duplicate truth paths | synchronized playback test |
| Search/playback/control | HearMeOut | HearMeOut | IMPROVE | result selection + authoritative session state | source/control matrix |
| OBS/now-playing output | HearMeOut | HearMeOut renderer | PRESERVE | stable output URL | OBS smoke |
| Media caches/HLS | HMO DJ worker | worker cache/private media store | IMPROVE | generated cache remains rebuildable | cache rebuild test |
| Legacy duplicate media routes | HearMeOut | canonical media/session routes | REPLACE | telemetry/compat window before removal | zero-use evidence |
| Voice device volume/noise/PTT preferences | browser/device | local client/Companion | PRESERVE | never centralize hardware-only choice | device-local isolation test |

## ChatTag donor / future Games Hub product

`ChatTag` remains the temporary donor/product label until this vertical's full inventory is available. The original Chat Tag game keeps its name; the broader product must receive a distinct owner-approved Games Hub name under D-32.

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| Original Chat Tag game | ChatTag | ChatTag core module | PRESERVE | route/command compatibility | two-player game test |
| Quackverse | ChatTag | ChatTag bounded game module | PRESERVE | preserve overlay/profile behavior | game/overlay test |
| Bingo | ChatTag | ChatTag bounded game module | PRESERVE | deep audit required | game regression test |
| Games Hub catalog | ChatTag | separate bounded game modules sharing game SDK | IMPROVE | do not make one giant runtime | per-game contract suite |
| Durable per-channel game runtime actions | ChatTag | ChatTag runtime | PRESERVE | migrate active state only when safe | action replay/dedupe test |
| Games Hub overlay profiles | ChatTag | ChatTag/SpaceMountain scene integration | PRESERVE | import profile references | OBS/profile test |
| Bot worker | `chat-tag-bot-new` | elastic/lease-aware ChatTag bot worker | IMPROVE | bot owns no canonical state | reconnect/duplicate command test |
| Game-specific state | ChatTag | ChatTag private authority | PRESERVE | classify retention/limits | restart/restore test |
| XP/rewards | ChatTag + SPMT | SPMT ledger; ChatTag emits outcomes | IMPROVE | migrate provenance/idempotency | one-award-only test |
| Leaderboards/shared profile stats | ChatTag/local + SPMT | SPMT projection | REPLACE | local copy becomes cache/view only | canonical match test |

## Operations / MountainView / Companion

| Donor surface/capability | Donor owner | Green owner | Disposition | Compatibility/migration | Proof required |
|---|---|---|---|---|---|
| 12-hour machine rotation | Rotator | Green scheduler/lease/reconciler | REPLACE | preserve useful health/cleanup intent, not forced restart pattern | lifecycle/load tests |
| Fleet health/log diagnostics | Rotator | operations module | PRESERVE | ingest Green health/job metadata | fault injection test |
| Error classification/repair audit | Rotator/Athena Coder | operations/Stellar Core capability used by the Athena persona | IMPROVE | no autonomous production write without approved policy | dry-run/audit/rollback test |
| GitHub bridge / operator controls | Rotator | operations module | VERIFY | preserve only needed owner workflows | auth/action audit |
| MCP/API/CLI operational surfaces | Rotator/SPMT | versioned SPMT/ops contracts | IMPROVE | eliminate duplicate authority | conformance test |
| MountainView device records | Rotator/MountainView | SPMT device authority + MountainView module | IMPROVE | migrate paired devices/tokens safely | pairing/revocation test |
| MountainView phone/BLE/media bridge | MountainView | local Companion/MountainView relay | PRESERVE | hardware remains local | real-device test |
| Companion local relay/compute | Companion | Companion | PRESERVE | pair to Green SPMT | relay reconnect test |
| Companion overlay/popouts | Companion + SpaceMountain | Companion + SpaceMountain | PRESERVE | keep local window state local | desktop/multi-monitor test |
| OBS WebSocket controls | Companion | Companion | PRESERVE | explicit capability/confirmation | approved-action test |
| Local media library + bounded FFmpeg jobs | Companion | Companion | PRESERVE | maintain local ownership and review | transcode/restart test |
| Signed installer/update path | Companion | Companion release pipeline | IMPROVE | no cutover dependency for web, required for desktop release | clean install/update/uninstall proof |
| `spmt-vault` independent recovery | none | recovery app | ADD | separate app/region/credentials | promotion/failback drill |

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
| `Mtman1987/spmt-live` | PENDING | yes |
| `Mtman1987/spacemountain-live` | PENDING | yes |
| `Mtman1987/streamweaver` | PENDING | yes |
| `Mtman1987/DiscordStreamHub` | PENDING | yes |
| `Mtman1987/hearmeout-main` | PENDING | yes |
| `Mtman1987/chat-tag` | PENDING | yes |
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
