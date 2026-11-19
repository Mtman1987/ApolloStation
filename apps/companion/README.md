# SpaceMountain Companion

**Workspace:** @spmt/companion  
**Location:** apps/companion  
**Role:** paired local-device runtime for OBS, local media, overlays/popouts, approved workflows, diagnostics, and local compute.

## 1. Product responsibility

Companion is the local execution boundary for a user's own computer and attached devices. Cloud Apollo defines identity, permissions, device pairing, typed commands and durable jobs. The local Companion runtime performs only explicitly granted actions on the paired machine.

The package includes:

- device pairing and relay command/receipt contracts;
- OBS WebSocket v5 integration;
- local overlay/popout and audio controls;
- bounded local media download/cache/transcode jobs;
- reviewed workflow jobs;
- sanitized diagnostics;
- local update manager contracts;
- optional offline Athena wake phrase routing into the canonical SPMT suite-action job pipeline.

Companion must never pretend a desktop capability is available when no paired device/runtime is online.

## 2. Runtime modules

| Module | Responsibility |
|---|---|
| src/index.ts | App manifest, catalog registration and public exports |
| src/web-server.ts | Authenticated Companion product surface and status/control UI |
| src/device-relay.ts | Paired device records, capability checks, idempotent command receipts and retry state |
| src/relay-client.ts | Authenticated WebSocket relay client and command/result protocol |
| src/obs-adapter.ts | OBS WebSocket v5 local adapter; passwords remain on the paired computer |
| src/runtime-handlers.ts | Typed relay action handlers for windows, OBS, audio, media, workflows and diagnostics |
| src/config-store.ts | Versioned local configuration and OS secure-storage boundary |
| src/media-jobs.ts | Local download, cache, FFmpeg transcode presets, hardware detection and bounded media library |
| src/workflow-jobs.ts | Allowlisted/reviewed local workflow jobs and approval lifecycle |
| src/workflow-store-sqlite.ts | Durable local workflow state |
| src/execution-worker.ts | Claims typed Companion device jobs from SPMT and reports progress/results |
| src/diagnostics.ts | Local diagnostic capture, redaction and bounded snapshot persistence |
| src/update-manager.ts | Desktop updater state and confirmation behavior |
| src/spmt-surfaces.ts | Resolve authenticated SpaceMountain/Commlink/Overlay surfaces |
| src/tenant-bootstrap.ts | Bind paired device/runtime to the authorized tenant |
| src/local-athena-wake.ts | Optional offline wake process and canonical suite-action routing |

## 3. Trust and pairing flow

1. User authenticates through SPMT.
2. Device pairing creates a tenant-bound device identity and explicit capability list.
3. SPMT issues a short-lived relay authorization for the paired device.
4. Apollo sends a typed, expiring command through the relay.
5. Companion validates device, tenant, capability, expiry, and idempotency.
6. Local adapter performs the allowlisted operation.
7. Companion returns a bounded receipt and reports the result to SPMT.

A listed device is not necessarily online. Online status requires a current ready runtime/worker projection. Revoked devices must not receive commands.

## 4. Local capabilities

### OBS

OBS uses a loopback-only WebSocket v5 connection. OBS passwords stay in the desktop secure store and are never sent to Apollo. Supported actions include scene selection, source visibility, stream start/stop and approved media input control.

### Overlay and windows

Companion controls local overlay and popout windows. Cloud app routes are resolved through an authenticated SPMT session; arbitrary cross-origin URLs are rejected.

### Media

The local media library supports allowlisted audio/video/image formats, bounded download and cache, and explicit FFmpeg presets such as MP4 web, MP3 audio and GIF. Download/cache pruning requires local confirmation.

The configured cache budget can be large (default 20 GiB). Treat it as a local resource policy, not a cloud storage allowance. Enforce max download size, disk budget, file extension checks, URL host policy and cancellation.

### Reviewed workflows

Only catalogued workflows may execute. A workflow marked as requiring confirmation must remain in review until the local owner approves it. Generated song/render briefs are stored for later/manual rendering; do not imply that an unavailable renderer has executed them.

### Offline wake

The optional local wake phrase is “hey athena”. The local process parses a bounded transcript and submits a typed suite-action job to SPMT. It does not execute arbitrary speech as a shell command.

## 5. Dependencies and runtime boundary

The package intentionally depends only on @spmt/contracts and @spmt/sdk. Desktop-specific adapters are injected through interfaces; the cloud package should not bundle Electron, OBS, FFmpeg, native audio, or arbitrary process managers.

Local Companion requires the appropriate desktop runtime, OBS (when enabled), and FFmpeg/FFprobe for media operations. These are machine-side dependencies, not Hostless Node dependencies.

## 6. Configuration and secrets

The local configuration store uses a versioned schema and OS secure storage for relay tokens, OBS password, pairing token and session token. Do not move these secrets into SPMT browser state or repository config.

Configuration areas include:

- local server host/port and relay WebSocket port;
- relay URL, device ID and enabled state;
- OBS loopback URL, enabled state and media input name;
- audio mute/volume/push-to-talk/output device;
- SpaceMountain/workspace/overlay/popout window settings;
- local media library path, cache budget, download enablement and transcode engine;
- device presence/client ID and display name;
- per-window bounds.

The default relay origin is currently https://spmt.live. Verify the deployed canonical SPMT origin and session behavior before changing it.

## 7. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/companion

Relevant tests cover device pairing/relay, command capability checks, idempotency, OBS WebSocket, media downloads/transcoding, cache pruning, workflow approval, diagnostics redaction, update manager and Athena wake parsing.

## 8. Security and reliability

- Pairing and device authorization are tenant-bound.
- Commands expire and are idempotent.
- The local adapter only exposes the typed action allowlist.
- OBS must connect to loopback; reject remote OBS URLs.
- Store passwords/tokens using OS secure storage.
- Download URLs must use approved HTTPS hosts; reject redirects and private/internal addresses.
- Bound downloads, cache size, transcoding time, output size, job concurrency and diagnostics.
- Redact JWTs, bearer tokens, cookies, passwords, API keys and authorization headers.
- Require explicit local confirmation for destructive or resource-intensive actions.
- A failed desktop adapter must report unavailable; it must not fabricate success.

## 9. Known packaging debt

The Companion package in this monorepo defines the app and runtime modules but does not itself contain a complete desktop installer project. The SpaceMountain download routes still point at historical release assets in the StreamWeaver and Rotator donor repositories. Before declaring the release chain Apollo-native, move the installer/APK artifacts and release workflow into Apollo-owned storage/releases, then update the download routes. Do not point at a guessed Apollo release URL until the assets exist.

## 10. Performance guidance

- Keep the cloud shell and web client thin; local media and OBS work run only on the paired desktop.
- Stream downloads to disk with byte limits rather than buffering whole files in memory.
- Enforce cache quotas and remove least-recently-used rebuildable entries.
- Use hardware encoder detection once per session, not on every transcode request.
- Bound concurrent FFmpeg jobs and terminate child processes on cancellation.
- Avoid continuously polling SPMT when a relay socket is healthy.
- Keep diagnostic snapshots small, sanitized and rotated.

## 11. Acceptance checklist

- [ ] Device pairing binds the correct user, tenant and device.
- [ ] Revocation prevents further relay commands.
- [ ] OBS connects only to local loopback and executes approved commands.
- [ ] Overlay/popout windows open through authenticated SPMT surface URLs.
- [ ] Media download/cache/transcode respects allowlists, byte budgets and cancellation.
- [ ] Reviewed workflows require local approval.
- [ ] Diagnostics redact secrets and rotate bounded files.
- [ ] Offline wake submits only recognized typed suite actions.
- [ ] Restart/reconnect preserves local config and receipts without duplicate actions.
- [ ] Installer/APK downloads are served from Apollo-owned release artifacts, not donor repos.
