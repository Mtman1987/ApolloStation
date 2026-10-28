# HearMeOut parity: handoff

Last updated: 2026-10-28. Written for the next AI helper picking this up cold.

## Goal

Port HearMeOut donor behavior into `Mtman1987/ApolloStation` `main`. Repo-only: no deploys. The owner wants speed, several domains batched per PR, and one Oracle run per batch. Do not ask about tests or blockers; keep going.

Scope is recorded in `docs/donor-parity/HEARMEOUT_SCOPE.md`:
- HMO-001: auth and room access
- HMO-003: Lounge, queue, recovery
- HMO-004: YouTube and providers
- HMO-008: Watch and Xtream
- HMO-011: API contracts
- Finish P08

Excluded: HMO-009.01b Internet Archive fallback (archive.org must never be a playback origin), and YouTube upload (`watch/youtube/upload`).

## Current state

- `main` is at `f7e05d6` (PR #307, squashed).
- Merged this session: #301 (Watch route tests), #302 (scope doc), #303 (media proxy and Xtream diagnostics), #304 (Apollo-owned guest session), #305 (Twitch login), #307 (YouTube chunk proxies, HMO-004).
- Open: PR #306, `docs/hmo-parity-matrix`, docs only, not merged, no Oracle run needed.
- Working tree on `main` was clean at handoff.

## Owner decisions (binding)

- **Repo-only.** Donor repos are read-only: `/home/user/hearmeout-main` (HEAD `8401114`) and `/home/user/DiscordStreamHub` (HEAD `535fb6c`). Never run them.
- **No local build, tsc, or tests.** Verify only through GitHub Actions `oracle-release-validation.yml`. Four shards plus an aggregate report. Every `tests/*.test.mjs` runs in every shard.
- **Guest login:** an Apollo-owned signed session, not SPMT-side. The donor's shared `dev_local_user` is not ported.
- **Twitch login:** ported. The donor hands the OAuth exchange to DSH, which Apollo does not have, so the exchange runs in-process.
- **Proxy routes:** ported with leak tests mandatory and an origin check on every route.
- **Diagnostics** (`xtream/direct-test`, `xtream/status`): ported. No credentials or raw provider URLs in responses.
- Watch request/accept, Xtream lookups, and proxies run in the web process (`apps/hearmeout/src/web-server-v3.ts`). No internal route to the media worker.
- Do not generate a replacement avatar head without owner approval.

## How to work here

**Secrets.** `/home/user/ApolloStation/.env.github` (gitignored) holds `GITHUB_TOKEN`. Source it; never echo it. `/home/user/ApolloStation/.env.local` (gitignored) holds `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`. Do not print these.

**Push.**
```
git -c http.extraHeader="Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)" push https://github.com/Mtman1987/ApolloStation.git <ref>
```

**Commit identity.** `git -c user.name=Runable -c user.email=runable@runable.bot commit`

**Oracle dispatch.** `POST /repos/Mtman1987/ApolloStation/actions/workflows/oracle-release-validation.yml/dispatches` with `{"ref":"<branch>"}`. Expect HTTP 204.

**Oracle status.** `GET /repos/Mtman1987/ApolloStation/actions/runs/<id>` gives `status` and `conclusion`. Job list: `/actions/runs/<id>/jobs`. Logs: use `/actions/jobs/<jobid>/logs`. The `/runs/<id>/logs` path returns 403.

**Edits to `apps/hearmeout/src/web-server-v3.ts`.** Do not use the `edit` tool on this file. Use a Python script with exact-count `str.replace` and `assert count == 1`.

**Verify every edit.** The `edit` tool reported success once while the change was not on disk (PR #307 lost its registry block that way). After every edit, grep for the expected lines. Example checks used:
```
grep -c "export class YoutubeStreamRegistry" apps/hearmeout/src/media-proxy-routes.ts
grep -c "function windowedRange" apps/hearmeout/src/media-proxy-routes.ts
```

**Tool notes.** `bash` needs `cwd` on every call. `edit` needs `replace_all` set explicitly to `false`.

**Chromium media-browser check** is blocked: the token lacks the `workflows` scope for that path. Do not spend time on it.

## Remaining work, in priority order

1. **HMO-011 contract tests.** Donor has about 106 `route.ts` files. Apollo's HearMeOut API is about 30 endpoints dispatched inline in `web-server-v3.ts`. Add per-route contract tests, starting with the endpoints the web UI calls. Check `docs/donor-parity/HEARMEOUT_ROUTE_COVERAGE.md` for the list.
2. **Remaining HMO-001 and HMO-003 items.** See the ledger, `docs/donor-parity/HEARMEOUT_PARITY_LEDGER.md`.
3. **Merge or close PR #306** (parity matrix). Docs only, no Oracle needed.

## Known gaps

- `recordQueued` runs after `rooms.enqueue` in `web-server-v3.ts`. If the store fails, the item stays in the room. Ordering decision still open.
- Music enqueue idempotency has no test. Movie has one.
- YouTube HLS path (`watch/youtube/hls`) has no test.
- Guest and Twitch sessions are not revoked server-side. They expire only.
- Donor `auth/logout` clears a cookie. Apollo's guest logout clears `hmo_guest`. Donor SPMT-side logout behavior has not been compared.
- **Twitch redirect URI.** `TWITCH_REDIRECT_URI` in `.env.local` must match the Twitch console registration. Its value has never been displayed or checked. Check it with the owner; do not print the secret.

## Key files

- `apps/hearmeout/src/media-proxy-routes.ts`: watch proxy, YouTube proxy, YouTube chunk registry and handlers, Xtream status and direct-test.
- `apps/hearmeout/src/guest-session.ts`: guest session plus Twitch session claims.
- `apps/hearmeout/src/twitch-login.ts`: in-process OAuth exchange.
- `apps/hearmeout/src/watch-runtime.ts`: `prepareEpisode` returns a relative HLS path.
- `apps/hearmeout/src/web-server-v3.ts`: all HearMeOut routes dispatched inline. Guest check and Twitch session check in `resolvePrincipal`.
- Tests: `tests/hearmeout-*.test.mjs`. The YouTube tests import from `apps/hearmeout/dist/`, so they only run after the build step in Oracle.
- Docs: `docs/donor-parity/` (scope, ledger, route coverage, worker coverage, watch-state gap, parity matrix).

## Local branches to ignore

`feat/hmo-009-p08-consumer`, `wire/hmo-009-watch-routes`, `probe/file-ref-test`, `docs/hmo-scope-decision`. All stale.

## Conversation history

Full prior conversation: `/home/user/history/1793179433218.json`. Grep it for detail that is not here.
