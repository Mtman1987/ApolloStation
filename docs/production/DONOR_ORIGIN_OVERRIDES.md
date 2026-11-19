# Donor origin overrides (production)

Status: non-auth operational hardening. These defaults still point at retired
Fly donor hosts so existing behaviour does not break. Production Hostless
nodes should set the overrides below so traffic stays inside Apollo.

## Rule

1. Prefer an explicit env override on the Hostless app.
2. Keep HTTPS, credential-free origins only.
3. Do not delete the Fly fallback until the Apollo origin is proven live.

## Overrides

| App / path | Env name | Suggested Apollo value | Code default (fallback) |
|------------|----------|------------------------|-------------------------|
| Nebula Mosaic → StreamWeaver image API | `STREAMWEAVER_URL` | `https://apollo-node-2.hostless.app` | `https://streamweaver-new.fly.dev` |
| HearMeOut Lounge / donor bridge | `HEARMEOUT_DONOR_ORIGIN` | Apollo HearMeOut origin when hosted | `https://hearmeout-main.fly.dev` |
| HearMeOut prepared media | `HEARMEOUT_VOICE_BRIDGE_ORIGIN` | Apollo media worker origin when hosted | requires full binding (see prepared-media) |
| HMO spotlight broadcast | `SPOTLIGHT_ENDPOINT` | DSH community-spotlight on Node 1 when live | `https://discord-stream-hub-new.fly.dev/api/community-spotlight` |

## Node placement

- **Node 1** — SPMT, SpaceMountain, DSH web: set DSH/spotlight-related overrides here if used.
- **Node 2** — Chat Gateway, StreamWeaver, Nebula: set `STREAMWEAVER_URL` here for Mosaic.

## Verification

After setting an override, confirm the target returns a healthy response on the
expected path before removing the Fly default from source in a later PR.

## Out of scope

Auth, sessions, Turso identity wiring, and XP balance display are intentionally
not covered here.
