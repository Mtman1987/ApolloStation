# Hostless Node 3 — Restream control port

Status: **isolated receiver implementation added in PR #411; runtime acceptance remains open.**

## Ownership and existing client contract

Restream browser control belongs with the Node 3 continuity runtime alongside Discord Stream Hub and its Lounge state. StreamWeaver remains the authenticated client and calls the receiver over HTTPS.

The client contract already exists in `apps/streamweaver/src/provider-runtime.ts` and uses `STREAMWEAVER_RESTREAM_CONTROL_ORIGIN` plus `STREAMWEAVER_RESTREAM_CONTROL_CREDENTIAL`. It sends `POST /restream/start`, rejects redirects, and independently verifies Twitch live state before reporting success. The environment validator requires a credential-free HTTPS origin and a 32+ character credential.

## Donor behavior preserved

The original implementation is `apps/hearmeout/legacy-worker/src/restream-control.js`, mounted by the legacy worker when `RUN_LOUNGE` is enabled. It:
- launches Chromium through Puppeteer under Xvfb;
- retains the authenticated browser profile;
- restricts browser control to HTTPS Restream hosts;
- requires exactly one visible start/stop button before clicking;
- recognizes login-required, ambiguous and unknown states;
- serializes start/reset and verifies the UI state transition;
- keeps automation disabled unless explicitly enabled.

The new isolated service in `services/restream-control/` ports that controller and preserves:
- `GET /restream/status`
- `POST /restream/start`
- `POST /restream/reset`

## What is implemented in the port

- Private HTTPS listener; mounted certificate and key are mandatory at startup.
- Dedicated bearer credential (minimum 32 characters) checked with constant-time comparison.
- Sanitized status response; browser URL, title and profile path are not returned.
- Start/reset remain locked unless `RESTREAM_AUTOMATION_ENABLED=true`.
- Reset hold time is bounded to 5–30 seconds.
- Absolute profile path and a marker on the mounted volume are required.
- Exclusive lock file prevents a second controller from opening the same profile.
- A standalone Node 22 / Chromium / Xvfb image and private Compose service are provided; no host port is published.
- A host preflight script verifies that the profile path is itself a mount point before creating the marker.
- CI tests cover auth denial, status sanitization, disabled automation, verified start, bounded reset, allowlisted HTTPS origin, profile path validation, volume marker and lock contention. CI also validates Compose and builds the image.

## Remaining release gates

1. Create the encrypted OCI block volume and mount it at the host path used by `RESTREAM_PROFILE_HOST_PATH`. Run `infra/oracle/prepare-restream-profile-volume.sh` only after mounting it.
2. Provision the signed-in Restream browser profile through the owner's approved secure process. This PR does not copy the legacy browser profile or any cookies.
3. Mount a private-CA TLS certificate/key whose SAN matches the private service hostname; make the key readable by container UID 10001.
4. Create the external `apollo-private` Docker network and confirm the StreamWeaver container can resolve and trust the receiver's HTTPS origin.
5. Confirm the proposed 2 GiB / 1 CPU container limits fit the selected Oracle shape under a real Chromium session. These are provisional caps, not measured capacity.
6. Verify profile survival after restart and image replacement; verify lock cleanup and crash recovery.
7. With owner authorization, enable automation for a controlled rehearsal. Run a real Restream start and reset, then independently verify Twitch live state. Keep the legacy receiver alive until success and rollback are proven.

## Current decision

The receiver code and container packaging are now present, but no OCI resources, profile, TLS identity, secret, browser login, or Twitch broadcast have been provisioned or changed. The new receiver is **not yet a production replacement**. Do not remove or disable the legacy Restream receiver before all gates above pass.
