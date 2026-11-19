# HearMeOut provider canary evidence — 2026-08-30

Status: provider canary is **blocked by LiveKit HTTP 429**. Blue remains authoritative. No DNS, production channel, or production traffic handoff occurred.

## Preconditions already passed

Before this provider canary, the production-data recovery/import rehearsal passed with:

- fresh Fly volume snapshot;
- application-consistent `/data/app.db` recovery copy;
- SQLite integrity `ok`;
- exact SHA-256 match through the Apollo migration bundle;
- 31 Blue documents classified;
- 7 real queued media items imported into isolated Green SQLite;
- Green playback reopened paused;
- Green voice bridge desired state imported disabled;
- explicit handoff required before any bridge can start.

Apollo main also contains the migration-era `HttpHearMeOutVoiceBridgeWorker` adapter. It keeps canonical room/queue/playback/voice desired state in Green and treats the existing `hmo-dj-worker` as execution only.

## Canary fencing

The owner-approved live provider canary was intentionally narrower than a production-room handoff.

The bounded Rotator canary:

- targets the single running `hmo-dj-worker`;
- accepts only the owner-only `/rotator hmocanary` command;
- uses the worker-local Discord bot token when available and never prints or moves the token;
- discovers only an empty Discord voice/stage channel whose name explicitly contains `canary`, `test`, `sandbox`, `dev`, or `bot`;
- does not emit guild/channel IDs in the public control result;
- creates a unique ephemeral `apollo-canary-*` room;
- intends to force Discord output into listen-only mode before observation;
- always attempts a stop after any bridge start attempt, including when the start HTTP response times out;
- never changes DNS or Blue data authority.

## Live results

### Credential and channel discovery

The latest canary proved:

- the worker has `DISCORD_BOT_TOKEN` locally (`tokenSource=worker-env`), so the Blue token-broker hop is not required for Discord discovery;
- Discord login succeeded;
- an **empty** channel explicitly categorized as `test` was found;
- no production channel was reused.

### Bridge start

The bridge start did **not** complete.

Observed bounded result:

- `startAttempted=true`
- `bridgeStarted=false`
- `runningObserved=false`
- `listenOnly=false` because start never completed
- `bridgeStopped=true`
- `canaryRoomEphemeral=true`
- Blue remained authoritative
- DNS remained unchanged

The worker error log identifies the provider failure as:

`engine: signal failure: ws failure: HTTP error: 429 Too Many Requests`

The same LiveKit 429 was observed on more than one canary attempt. The donor bridge starts its LiveKit side before it joins Discord, so this failure happened before a successful Discord voice join.

## Interpretation

This is a **provider quota/rate gate**, not a reason to weaken Apollo's fencing or to increase retries blindly.

The donor bridge already implements bounded exponential retry for LiveKit 429 responses. Repeated immediate canary attempts would add provider pressure without proving a new property.

Current LiveKit Cloud documentation states that project quotas can reject new operations until capacity becomes available or the relevant rate window resets, and that current project limits are visible in the LiveKit Cloud dashboard under **Settings → Project**.

## What is proven

- real production HMO state can be recovered, transformed, opened, and verified in Green;
- Green defaults remain paused/disabled after import;
- the migration-era Green-to-worker control adapter is implemented and contract-tested;
- the worker has a usable local Discord credential;
- Discord gateway discovery works;
- a safe empty test voice channel exists;
- the canary cleanup fence successfully issues stop after a timed-out start attempt;
- no production Discord channel, DNS route, or Blue authority was changed.

## Remaining provider gate

Before the canary can be considered passed, LiveKit must permit the bridge's required participant connections. Then rerun exactly one bounded empty-test-channel canary and require all of:

- bridge start completes;
- listen-only gate confirms false outbound room audio;
- running status is observed;
- bridge stop completes;
- no production channel is reused;
- Blue remains authoritative throughout.

Only after that should Apollo move to a persistent Green-authority owner/test canary. Production `discord-activity` handoff and `hearmeout.spacemountain.live` DNS remain later gates.

## Required human/provider check

Open the LiveKit Cloud project used by HearMeOut and inspect **Settings → Project**. Capture the current WebRTC/participant usage and any quota/limit banner or exhausted allowance. Do not rotate credentials or change limits yet. The only information needed back is which limit/allowance is currently reached (or that none is shown as reached).
