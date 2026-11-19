# MountainView

**Workspace:** @spmt/mountainview  
**Location:** apps/mountainview  
**Role:** phone, Bluetooth headset, glasses/camera and voice-command relay integrated with SPMT device identity and Companion execution.

## 1. Product responsibility

MountainView is the mobile/wearable-facing device surface. It supports device pairing, voice command routing, QR scans, camera capture events, media controls and approved actions routed to Companion or first-party applications.

SPMT owns canonical user/tenant/device identity and device authorization. MountainView owns its paired-device metadata and capture-event records. Companion owns local desktop execution such as OBS and media jobs.

## 2. Runtime modules

| Module | Responsibility |
|---|---|
| src/index.ts | App manifest, catalog registration and public exports |
| src/web-server.ts | Authenticated MountainView product surface and browser controls |
| src/device-runtime.ts | Paired device metadata, revocation and capture-event persistence |
| src/platform-client.ts | SPMT device pairing, listing/revocation, bootstrap and suite-action client |
| src/voice-router.ts | Typed voice intent planning and target-app routing |
| src/commander-listener.ts | Bounded rolling transcript buffer and Commander MT wake phrase parsing |
| src/foreground-wake.ts | Adapter for Android foreground-local wake service |

## 3. Device and voice flow

1. User authenticates through SPMT.
2. Device pairing creates a tenant/user-bound device identity with explicit capabilities.
3. MountainView lists/revokes devices through SPMT rather than a second identity store.
4. Voice input is transcribed locally by the browser/native client.
5. Commander MT wake parsing extracts a bounded command from a rolling transcript window.
6. The voice router maps the transcript to a typed action for Companion, HearMeOut, Discord Stream Hub, Nebula Arcade or StreamWeaver.
7. High-risk/destructive actions require explicit confirmation.
8. Accepted actions are submitted as SPMT suite-action jobs with user, tenant, source and idempotency context.

The browser listener uses speech recognition and does not call a paid AI or TTS provider. The transcript buffer stores text segments only; it does not retain microphone audio.

## 4. Device capabilities

Supported device kinds include phone, Bluetooth headset, glasses, camera and other. Capabilities include voice, camera, image, QR and media-control.

Capture events are tenant/user/device-bound and contain bounded metadata. Do not store raw microphone recordings or full camera images in the device event record. Image/media payloads must use the approved media storage path and retention policy.

## 5. Dependencies and boundaries

The package depends only on @spmt/contracts and @spmt/sdk. It intentionally does not bundle native Android/iOS SDKs, Bluetooth stacks, camera frameworks, or desktop process control.

- SPMT: user, tenant, device identity, pairing/revocation, scopes, suite-action jobs.
- MountainView: device-facing UI, voice planning, capture-event records and typed routing.
- Companion: local OBS, desktop windows, media download/transcode and approved local workflows.
- Product apps: own their actions and data after the typed command reaches them.

## 6. Mobile/native implementation status

The monorepo package contains TypeScript contracts, web surface, device runtime, voice router and a native-wake bridge interface. It does not contain a complete Android project or native foreground microphone service implementation. The Android wake policy describes the intended local-only permissions/service behavior; it is not proof an APK is built or installed.

The SpaceMountain download route still points to a historical MountainView APK release in the retired Rotator donor repository. Move the APK build/release artifact into Apollo-owned release storage and update the route only after the artifact and signature are available. Do not guess an Apollo release URL.

## 7. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/mountainview

Relevant tests cover device runtime, SPMT device pairing/revocation, voice routing, suite-action mapping, confirmation requirements, transcript bounds and local wake parsing.

## 8. Security and reliability

- Pairing and device commands are tenant/user scoped.
- Revoked devices cannot send captures or receive commands.
- Device capabilities are explicit; do not infer permissions from device type.
- Voice commands are parsed into known actions; never execute arbitrary transcript text as a shell command.
- Destructive actions pause for confirmation.
- All writes use idempotency keys and SPMT audit/job contracts.
- Transcript length/window and event payloads are bounded.
- Microphone audio remains local unless a separately authorized feature explicitly streams it.
- Native wake service must use foreground microphone permissions and local-only processing.

## 9. Performance guidance

- Keep transcript buffering bounded by time, segment count and character count.
- Avoid continuous cloud polling; use the relay/session contract.
- Do not upload microphone audio for command recognition when local browser/native transcription is sufficient.
- Store only small capture metadata in SQLite; route large media to the media service.
- Avoid running voice recognition and camera capture simultaneously without explicit device capability/resource checks.

## 10. Acceptance checklist

- [ ] Device pair/list/revoke works against SPMT.
- [ ] Phone/headset/glasses/camera capability declarations are enforced.
- [ ] Commander MT listener parses only bounded recent transcript text.
- [ ] Voice commands route to the correct product and tenant.
- [ ] Destructive commands require explicit confirmation.
- [ ] QR and camera capture events are attributed and bounded.
- [ ] Companion receives only approved device commands.
- [ ] Native Android wake service and APK are implemented, signed and served from Apollo-owned releases.
- [ ] No Rotator donor APK or Fly/Rotator control plane is required.
