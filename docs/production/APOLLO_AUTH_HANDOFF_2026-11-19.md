# Apollo sign-in handoff — 2026-11-19

Status for picking this back up. Read this before touching Apollo auth or the SPMT bridge.

## Current state

- Apollo sign-in works through the **SPMT bridge JSON** path on `https://apollo-node-1.hostless.app`. The user pastes the bridge JSON once; the Apollo browser session then survives restarts and deploys (HMAC-signed sessions, commit `075175c5`).
- Automatic "Sign in with SPMT" (`GET /v1/auth/spmt/start` → `/v1/auth/spmt/callback`, PKCE, no client secret, commit `a2a9f314`) is **built and merged but not usable yet**. Live `spmt.live` does not run the code that knows the `apollo-node-1` public client, so the authorize step cannot complete.
- ApolloStation `main` is at `4e6ff6ac` or later. Oracle release validation passed on `4e6ff6ac`. The two-node release passed on that commit. The "Hostless Node 2 retry" workflow failed at "Verify prior run and exact commit". It has not been rerun.
- spmt-live `main` is at `3870847`, which seeds the `apollo-node-1` PKCE public client. It is not deployed.

## Decisions made

- **Auth path for now: bridge JSON** against live spmt.live. No new secret.
- **Keep the `apollo-node-1` PKCE client on spmt-live main.** It is harmless while undeployed and is needed once spmt-live deploys.
- **Legacy SPMT is retired.** The donor SPMT (Fly app `spmt-live`) is being retired; everything moves to Apollo. Do not spend effort on the legacy Fly deploy.
- No new env vars or secrets in ApolloStation. The owner has no password.

## How sign-in works today

1. Open Apollo, go to the **SPMT bridge** tab.
2. Click **Open SPMT bridge JSON (copy it)**. That opens `https://spmt.live/api/session/bridge` while logged into spmt.live.
3. Paste the JSON into the form and submit. Apollo calls `POST /v1/auth/session/bridge-login`, which validates the token against `https://spmt.live/api/auth/me`, resolves the owner workspace, and sets the Apollo browser session cookie plus `spmt_donor_session`.

Verified: a bogus token returns 401 from `bridge-login` (it reaches live spmt.live validation). `spmt.live/api/session/bridge` and `/api/auth/me` both exist (401 when logged out). **Not verified:** a real end-to-end sign-in with the owner's account. That needs the owner to paste their own bridge JSON.

## Blockers

1. **spmt-live deploy is blocked by Fly billing.** Fly account has overdue invoices (`fly.io/dashboard/mtman-new/billing`). Deploy runs `44243600485` (cd80db4) and `44447130039` (3870847) both failed. The second also hit an Azure `BlobNotFound`. Billing will not be fixed, so this path is closed unless spmt-live moves to another host.
2. **Automatic sign-in** therefore cannot work until spmt-live runs somewhere other than Fly.
3. **Owner password gap.** The owner has no password, so password login is closed. Owner access relies on SPMT identity (bridge JSON). Dev shortcuts (`/sandbox/auth/login`, `isSandboxOwner`) exist only in sandbox mode and are not production auth.
4. Pre-existing failing test: `tests/hostless-runtime-config-bootstrap.test.mjs` ("canonical Turso database URL"). It also fails on base.

## Options for later

- **B. Move spmt-live off Fly** (e.g. onto Hostless). Unblocks automatic sign-in. Needs a hosting decision.
- **C. Apollo as its own identity authority** with an owner credential. This needs a new secret and explicit approval, because of the no-new-secrets rule.

## Next steps

1. Rerun "Hostless Node 2 retry" after confirming the release state, if Node 2 needs it.
2. Have the owner sign in once with the bridge JSON on `apollo-node-1` and record the result.
3. Pick option B or C for automatic sign-in and get approval before any new secret or hosting change.
4. Fix or retire `tests/hostless-runtime-config-bootstrap.test.mjs`.

## Where things are

- `packages/auth-core/src/index.ts`, `tests/browser-session-restart.test.mjs` — signed browser sessions
- `apps/spmt-service/src/index.ts` — `bridge-login`, `resolveDonorWorkspace`, `/v1/auth/spmt/start|callback`
- `apps/spacemountain-web/src/client.ts`, `page.ts` — bridge tab and SPMT sign-in link
- `tests/spacemountain-web.test.mjs` — auth UI and bridge-login assertions
- spmt-live: `db.ts` (`seedPublicOauthClient`), `server.ts` (`PKCE_PUBLIC_CLIENTS`, `EMBED_SCOPES_BY_CLIENT`), `tests/oauth-first-party-flow.test.cjs`
- Scratch logs: `/tmp/oracle.zip`, `/tmp/oraclelogs/`, `/tmp/spmt-ci.log`
- Do not read or print `/home/user/.github-token.env`.
