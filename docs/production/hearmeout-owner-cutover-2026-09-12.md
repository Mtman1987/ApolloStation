# HearMeOut persistent owner cutover — 2026-09-12

The code supports a protected owner cutover. Production room data and provider credentials have **not** been transferred, and the installer has **not** run. Blue remains the production authority. Public routing and production rollout flags remain unchanged.

## Verified baseline

- Apollo PR95 merged and deployed at `6f815842ac8994f5dbba23f6f2e89a79fedf95d1`: [release promotion](https://github.com/Mtman1987/ApolloStation/actions/runs/34706563883).
- Read-only destination probe found 11 saved rooms, SQLite integrity `ok`, one existing owner profile and one active owned workspace. No provider credentials were installed: [destination probe](https://github.com/Mtman1987/ApolloStation/actions/runs/34707884512).
- The donor worker passed an idle, empty-channel provider lifecycle canary: startup receive gain 0.23, update 0.41, listen-only mode, and verified stop. This did not test human speech or playback: [provider canary](https://github.com/Mtman1987/hearmeout-main/actions/runs/34707003452).
- HMO PR77 prevents different rooms from taking the same Discord guild connection during startup or while connected: [PR77](https://github.com/Mtman1987/hearmeout-main/pull/77).

## What this release provides

- The real room bridge API and UI use the existing signed-in owner/admin checks, with connect, disconnect, privacy, gain and audio-profile controls.
- Apollo worker requests and browser RTC grants share a deterministic tenant-and-room provider identity. A solo owner joins LiveKit when a bridge is enabled.
- Persisted desired bridge state reconciles after restart. Failed or timed-out starts request worker cleanup.
- The optional private configuration enables the bounded worker adapter for one existing owner workspace. Without that configuration, the release does not connect to the worker. Other suite actions remain read-only.
- The private installer creates a SQLite recovery copy and a separate migrated target, preserving existing saved rooms. Imported playback is paused and imported voice is disabled. Existing targets are never overwritten.

## Blocked transfer and exact approval scope

Automatic approval review rejected publication of a workflow that would export the production Fly SQLite room data and the existing LiveKit/API and worker authentication credentials into an encrypted migration capsule in GitHub Actions. It said the existing conversation did not explicitly authorize exporting those payloads to that destination. The rejected workflow was not published or run. Do not execute an alternative transfer until that approval is explicit.

The proposed transfer reads a verified Fly database copy after a recovery snapshot, transforms only the canonical Discord Activity room, and excludes legacy user, transient presence, and configuration documents. It carries the existing LiveKit URL/key/secret and worker shared authorization separately as private server configuration. AES-256-GCM protects the capsule; an RSA-OAEP wrapping key held only by the protected Sprite unwraps it. No plaintext credentials belong in repository contents or logs. The encrypted payload is still sensitive and should be removed from transit storage after installation.

## Activation after approval

1. Refresh Blue machine/volume inventory and provider status. Confirm the destination Sprite identity, existing owner and current release. Take a new Blue recovery snapshot and verified database copy. Never reuse a stale capsule.
2. With the owner transfer approval recorded, export the bounded room bundle and existing provider configuration encrypted for the destination. Transfer the capsule into the protected Sprite without exposing plaintext.
3. Quiesce the source room's writers during the final export/handoff. Stop Apollo's supervised processes before installing so saved-room writes cannot race the final destination snapshot. The installer rejects an active listener on port 3200. Keep the supervisor stopped through the next step.
4. From the tested release, run `node scripts/sprites/install-hearmeout-cutover.mjs <approved-encrypted-capsule.json>`. It derives the actual existing owner from SPMT; it does not create an owner or migrate legacy authentication.
5. Restart the supervised release and confirm health, exact build SHA, preserved room counts, receipt digest, queue order, paused media, imported bridge disabled, and existing owner access. Open the room, explicitly connect in an idle test channel, and verify both audio directions, receive gain and the privacy gate. Verify restart and disconnect cleanup.
6. Remove the transit capsule and wrapping key after success. Keep recovery copies and the receipt. Public traffic cutover and Blue retirement require the remaining production acceptance gates; a provider lifecycle canary alone does not satisfy those gates.

## Destination paths and rollback

All paths below are under `/home/sprite/data/release` on the protected release Sprite.

| Purpose | Path |
| --- | --- |
| Original room authority | `hearmeout-room-sandbox.sqlite` |
| Separate migrated authority | `hearmeout-room-owner-canary.sqlite` |
| Private activation configuration | `hearmeout-cutover.json` |
| Original-room recovery copy | `recovery/hearmeout-before-cutover.sqlite` |
| Migration receipt and Blue recovery reference | `recovery/hearmeout-cutover-receipt.json` |

Before any rollback, disconnect the Apollo bridge and verify it stopped. Stop the supervisor, move the private activation configuration aside, and restart the release against the original database. Preserve the migrated database for reconciliation; changes made there after activation must be reconciled before reverting authority. Do not delete or replace either database to force a retry. The installer deliberately refuses an existing target or recovery file.

## Validation

The full offline suite passed 1,043 tests, including independent recovery, invalid-import cleanup, owner-only web controls, solo RTC provider identity, persisted restart, workspace isolation, and bounded worker egress. HMO PR77 passed its required CI with the real Docker audio-state patch applied. CI and the Sprite release workflow remain the deployment gates; live data transfer and human audio acceptance remain outstanding.
