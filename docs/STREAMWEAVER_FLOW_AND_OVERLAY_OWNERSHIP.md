# StreamWeaver flow and overlay ownership

Status: accepted implementation boundary, 2026-09-05.

This boundary preserves the user-facing promises proven by the live applications without copying obsolete private authority, Firebase state, or app-to-app source patching into ApolloStation.

## Evidence used

- The pinned donor baselines in [`config/live-source-slices.v1.json`](../config/live-source-slices.v1.json) and [`docs/donor-audits/PRODUCTION_REPO_BASELINES_2026-08-23.md`](donor-audits/PRODUCTION_REPO_BASELINES_2026-08-23.md).
- Live StreamWeaver at [`Mtman1987/streamweaver@a29dd7e`](https://github.com/Mtman1987/streamweaver/tree/a29dd7e5260c673b7260bec7ad70de2040e077be), used as behavioral evidence for individual flow packages, community sharing, import/export, Streamer.bot compatibility, and AI-assisted construction.
- Live SpaceMountain at [`Mtman1987/spacemountain-live@3dcb653`](https://github.com/Mtman1987/spacemountain-live/tree/3dcb653cd99cc10d1f7d791c8584f869797577cf), used as behavioral evidence for the shared workspace tray and Overlay Bay composition experience.
- Live SPMT at [`Mtman1987/spmt-live@df18ae6`](https://github.com/Mtman1987/spmt-live/tree/df18ae6bd7becd784fa5d614d9119d73b59e5b0e), used as behavioral evidence for canonical tenant-scoped Public and Personal output identity.
- ApolloStation's consolidation rule in [`docs/donor-audits/SPMT_DEEP_AUDIT_2026-08-23.md`](donor-audits/SPMT_DEEP_AUDIT_2026-08-23.md): preserve user capability while replacing duplicate authority and private forwarding with typed public contracts.

## Command-flow boundary

A StreamWeaver package is one independently useful flow. It is never an author's command-library bundle.

Hard invariants:

1. A new tenant has zero installed flows. The original commands are not inserted as disabled tenant records.
2. The community library begins with 73 individually addressable packages: 70 preserved donor definitions plus 3 native economy flows not represented by those definitions.
3. Every original package is authored by `mtman1987`, has `installUnit: "flow"`, and is downloaded, imported, installed, removed, or shared independently.
4. A `command_flow` JSON contains exactly one command trigger. It may contain multiple ordered action steps belonging to that one flow. Aliases do not create additional commands.
5. Installing `mtman1987.coinflip` installs only `mtman1987.coinflip`. It does not copy the rest of the Original StreamWeaver collection into the tenant.
6. Tenant package IDs cannot overwrite a built-in package or another tenant's package.
7. Native StreamWeaver JSON and Streamer.bot-shaped JSON are separate exports of the same single flow.

Collections, tags, authors, and search are browsing metadata. They never change the install unit.

## AI and community behavior

StreamWeaver owns the flow package, private drafts, tenant installs, runtime matching, and community publication. A user describes one command or automation in plain language. StreamWeaver invokes the shared SPMT assistant/job pipeline and asks it for one reviewable `streamweaver.flow-package` JSON.

The generated draft is private and inert until its owner approves it. Approval enables and installs only that draft. Publishing is a separate owner action and makes only that flow visible in the community library.

Cross-app steps use registered `run-action` capability identifiers and the shared SPMT execution pipeline. The app that registered a capability still owns execution. Provider roles are checked before write or broadcast actions run.

Read-only operation accepts live inbound platform/provider data. It blocks provider egress, external assistant invocation, and write/broadcast suite actions. Local browsing and selection of flow packages do not require a made-up feature token.

## Overlay boundary

Overlay Bay is ecosystem-wide. It is not a StreamWeaver composite feature.

| Concern | Owner |
| --- | --- |
| Tenant workspace record, scene persistence, Public/Personal selected scene IDs | SPMT authority |
| Visual scene editor, source layout, preview, composition | SpaceMountain / Overlay Bay |
| Stable Public browser-source route | SPMT output gateway |
| Signed-in Personal workspace route | SPMT output gateway |
| Personal overlay shown across app workspaces and footer visibility toggle | Shared app foundation / SpaceMountain shell |
| StreamWeaver alerts, widgets, cues, and automation that can feed a scene | StreamWeaver |

The stable output contract is:

- `GET /v1/overlay/tenant-outputs` for authenticated discovery.
- `GET /t/:tenant/public` for the canonical OBS/browser-source composition.
- `GET /t/:tenant/personal` for the authenticated Personal workspace composition.

Public and Personal may point to the same scene or different scenes. The shared workspace footer consumes these canonical URLs. StreamWeaver may guide a user to Overlay Bay and may contribute registered widgets, but it must not store or render a competing composite.

## First-run experience

When a blank tenant opens StreamWeaver, Setup Guide appears first and walks through:

1. choosing any desired individual community flows, including choosing none;
2. linking personal provider accounts;
3. connecting bot channels;
4. configuring the bot/persona;
5. learning Voice Commander;
6. opening ecosystem-wide Overlay Bay and copying Public/Personal output URLs; and
7. asking AI to build one custom flow, then optionally publishing that one flow.

The Bot Functions page displays only installed flows for that tenant. The Community Flows page displays available packages that remain outside the account until individually selected.
