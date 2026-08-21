# Owner Action Runbook

Date prepared: **2026-08-21**

This is the work that must be performed by the account owner because it requires provider logins, new secret values, or approval of a production change. The clean-room work is already complete enough to begin this runbook. Do not deploy a clean base until Section 4 is complete.

## Safety rules

1. Never paste a secret into ChatGPT, GitHub, Discord, an issue, a commit, a screenshot, or a shared document.
2. Never reuse a historical value. Treat every value formerly present in source as compromised.
3. Work on one provider at a time. Verify the affected apps before moving to the next provider.
4. Keep the old Fly apps running. This runbook rotates credentials in place; it does not authorize a clean-room cutover.
5. Record only the provider, credential name, rotation time, affected apps, and result. Do not record the value or a value prefix.
6. If a provider reset immediately invalidates the old credential, announce a short maintenance window first and have Fly open and authenticated before pressing Reset.

## 1. Recover GitHub access

Try these in order and stop as soon as one works:

1. On every computer you have used for GitHub, search Downloads, Documents, your password manager, and backups for `github-recovery-codes.txt`.
2. On the GitHub two-factor screen choose **More options**, then **Use a 2FA recovery code**, and enter one unused recovery code.
3. If you registered a passkey or hardware security key, choose that option instead.
4. If neither works, choose **Begin account or email recovery**. Complete the email one-time password and prove access with a previously verified browser/device, SSH key, or personal access token if GitHub offers one.
5. GitHub says manual recovery review can take up to three business days. If no recovery factor exists, GitHub may be unable to restore the account. Follow the official recovery guide: <https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/recovering-your-account-if-you-lose-your-2fa-credentials>.

Immediately after access returns:

1. Add a passkey on a working device.
2. Add a second independent factor that is not on the same phone.
3. Download a new recovery-code file and store one encrypted digital copy plus one offline copy.
4. Remove the broken phone only after the new methods have been tested in a private browser window.

## 2. Inspect the blueprint pull request

Open <https://github.com/Mtman1987/ApolloStation/pull/2>.

1. Leave the pull request in Draft while credentials are being rotated.
2. In **Files changed**, confirm the repository contains architecture and runbook documents only. It must not contain application source, `.env` files, provider values, or tenant data.
3. Read `DECISIONS.md`. Record agreement or disagreement there before implementation changes the architecture.
4. After the security checklist is complete, choose **Ready for review**.
5. Merge only if the blueprint matches the architecture you want. Merging this documentation does not deploy Fly or change a live app.

## 3. Inventory Fly without exposing values

The clean bases identify these current Fly app names:

| Product | Fly app |
| --- | --- |
| SpaceMountain | `spacemountain-live` |
| SPMT | `spmt-live` |
| StreamWeaver | `streamweaver-new` |
| DiscordStreamHub | `discord-stream-hub-new` |
| HearMeOut | `hearmeout-main` |
| Chat Tag | `chat-tag-new` |
| Machine Rotator | `mtman-machine-rotator` |

For each app that still exists, run:

```bash
fly status -a APP_NAME
fly secrets list -a APP_NAME
```

`fly secrets list` shows names and digests, not plaintext values. Compare names against this rotation matrix:

| Credential | Expected consumers found in clean source | Required action |
| --- | --- | --- |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | HearMeOut and any LiveKit worker | Create a new key pair, deploy it, test rooms, then revoke the old pair. |
| `DISCORD_CLIENT_SECRET` | HearMeOut/DiscordStreamHub OAuth paths and any Discord login consumer | Reset, update every consumer, then test login/callback. |
| `DISCORD_BOT_TOKEN` | SPMT, StreamWeaver, DiscordStreamHub, HearMeOut, Chat Tag | Reset once, update every consuming app immediately, then test the bot. |
| `TWITCH_CLIENT_SECRET` | SPMT, StreamWeaver, DiscordStreamHub, HearMeOut, Chat Tag | Generate/reset once, update every consumer immediately, then test OAuth refresh. |
| `TWITCH_BOT_OAUTH_TOKEN` | HearMeOut and possibly bot workers | Revoke and re-authorize; never reuse the exposed token. |
| `KICK_CLIENT_SECRET` | StreamWeaver | Replace and re-authorize the Kick bot. |
| `FIREBASE_PRIVATE_KEY` and service-account identity | Retired paths only | Disable/delete the key; do not create a replacement unless inventory proves a live dependency. |
| Old Google/YouTube API key | HearMeOut browser playback | Create a replacement restricted to the required API and production origins, deploy it at build time, then delete the old key. |

If Fly lists one of these names on another app, add that app to the same rotation. Do not assume the table is exhaustive for the still-running historical deployments.

## 4. Rotate credentials

### 4.1 Prepare Fly first

1. Install or update `flyctl` and run `fly auth whoami`.
2. Open the Fly dashboards for every consumer listed in Section 3.
3. Confirm each app is healthy before touching the provider.
4. Copy the current secret **names** into a private checklist. Do not copy values; Fly does not reveal them.
5. For a batch update, use stdin so the values do not appear in shell history:

```bash
fly secrets import --stage -a APP_NAME
```

Paste `NAME=VALUE` lines directly into the waiting command, then press Ctrl-D. Staging does not restart the Machines. Activate the staged batch with:

```bash
fly secrets deploy -a APP_NAME
```

Fly documents that runtime secrets are encrypted, values cannot be read back, setting secrets restarts Machines unless `--stage` is used, and `fly secrets deploy` activates staged values: <https://fly.io/docs/apps/secrets/>.

### 4.2 Retired Firebase key

1. In Google Cloud Console, select the historical Firebase/Google Cloud project.
2. Open **IAM & Admin → Service Accounts → Keys**.
3. Identify the service-account key represented by the old deployment configuration.
4. Because Firebase is retired from the ecosystem, disable or delete that key instead of generating a replacement.
5. Search the Fly secret-name lists for `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `FIREBASE_PRIVATE_KEY_ID`.
6. Do not unset them from a live app until its health and core flow have been checked after key disablement. Their presence identifies stale configuration that the clean-room deployment must omit.
7. If a live feature breaks, re-enable only long enough to identify the hidden dependency; do not put Firebase into the new architecture.

Google's compromised-credential guidance is to replace active keys and delete old ones, or delete retired service-account keys: <https://docs.cloud.google.com/docs/security/compromised-credentials>.

### 4.3 Google/YouTube API key

1. In Google Cloud Console, open **APIs & Services → Credentials**.
2. Create a new API key.
3. Restrict it to the smallest applicable YouTube/InnerTube API surface and to the production browser origins that need it.
4. Put it only in the clean HearMeOut build setting named `NEXT_PUBLIC_YOUTUBE_INNERTUBE_API_KEY`. The `NEXT_PUBLIC_` prefix means the value is browser-visible; restrictions, quota, and deletion are the protection—not secrecy.
5. Build and test YouTube search, resolution, and playback.
6. Delete the historical key after the replacement works.

Google recommends restricting API keys and deleting unused keys: <https://docs.cloud.google.com/api-keys/docs/overview>. YouTube's credential guidance is at <https://developers.google.com/youtube/registering_an_application>.

### 4.4 LiveKit

1. Open the LiveKit Cloud project dashboard: <https://cloud.livekit.io>.
2. Create a new API key and secret pair. Leave the old pair active temporarily if LiveKit allows both keys.
3. Stage `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` on `hearmeout-main` and every LiveKit worker.
4. Deploy those staged secrets.
5. Verify `/api/livekit-health`, create a room, join it from a second browser, and confirm the bot/worker can join.
6. Revoke the old key only after all consumers pass.

LiveKit's CLI/project documentation includes key revocation and the Cloud dashboard: <https://docs.livekit.io/reference/developer-tools/livekit-cli/projects/>.

### 4.5 Twitch

This rotation affects multiple apps, so do it in one short maintenance window.

1. Open the Twitch Developer Console and the registered application.
2. Have the Fly secret-import commands ready for `spmt-live`, `streamweaver-new`, `discord-stream-hub-new`, `hearmeout-main`, and `chat-tag-new`, plus any extra consumer found in Section 3.
3. Create/reset the Twitch client secret. Twitch documents that generating a new secret invalidates the previous secret.
4. Immediately stage the new `TWITCH_CLIENT_SECRET` on every consumer, then deploy each staged batch.
5. Re-authorize the bot/broadcaster accounts so new access and refresh tokens are issued. Revoke the exposed bot token rather than waiting for expiration.
6. Verify Twitch login, callback, token refresh, chat join, one read API call, and one harmless bot message.

Official Twitch application-secret guidance: <https://dev.twitch.tv/docs/authentication/register-app/>. Token revocation is documented at <https://dev.twitch.tv/docs/cli/token-command/>.

### 4.6 Kick

1. Open the Kick developer application used by StreamWeaver.
2. Replace the application client secret. If the portal cannot rotate it, create a replacement application with the same approved callback and scopes.
3. Stage `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` on `streamweaver-new`.
4. Deploy, then run the OAuth flow again to issue new access and refresh tokens.
5. Revoke the historical access/refresh token if it still exists.
6. Verify status, chat read, chat write, and reconnect after a Machine restart.

Kick's OAuth documentation covers authorization, refresh, and revocation: <https://github.com/KickEngineering/KickDevDocs/blob/main/getting-started/generating-tokens-oauth2-flow.md>.

### 4.7 Discord OAuth secret and bot token

Do the OAuth client secret and bot token separately so a failure has one cause.

1. Open the Discord Developer Portal and select the application.
2. Reset the OAuth client secret.
3. Stage `DISCORD_CLIENT_SECRET` on every OAuth consumer, deploy them, then verify Discord sign-in and callback.
4. Return to **Bot** and choose **Reset Token**. Copy the new bot token once; the old bot token stops working.
5. Immediately stage `DISCORD_BOT_TOKEN` on `spmt-live`, `streamweaver-new`, `discord-stream-hub-new`, `hearmeout-main`, `chat-tag-new`, and every additional consumer from Section 3.
6. Deploy each staged batch.
7. Verify the bot comes online, receives one command, sends one response, resolves a member, and does not log the token or a prefix.

Discord's official bot-token reset instructions are at <https://support-dev.discord.com/hc/en-us/articles/6470840524311-Why-can-t-I-copy-my-bot-s-token>. OAuth details are at <https://docs.discord.com/developers/topics/oauth2>.

## 5. Production verification after each provider

Run the safe health checks first:

```bash
curl -fsS https://spmt-live.fly.dev/api/health
curl -fsS https://streamweaver-new.fly.dev/api/health
curl -fsS https://discord-stream-hub-new.fly.dev/api/health
curl -fsS https://hearmeout-main.fly.dev/api/health
curl -fsS https://chat-tag-new.fly.dev/api/health
```

Then verify behavior in this order:

1. Sign into SPMT once and confirm the same tenant identity opens each connected app.
2. Open two different tenant accounts and confirm neither sees the other's points, messages, tokens, images, or settings.
3. Change one workspace background, reload two apps, and confirm both read the same canonical value.
4. Check one canonical points balance from SPMT and compare all app displays. Do not repair mismatches by copying totals between databases; record them as migration inputs.
5. Send one Discord message and one Twitch message through the bot path.
6. Create and join one HearMeOut/LiveKit room.
7. Test one YouTube playback and one Kick connection if those features are active.
8. Inspect Fly logs for authentication failures and accidental secret output:

```bash
fly logs -a APP_NAME
```

Never paste the log into a public issue. Redact tenant identifiers and all credential material before sharing a small excerpt.

For each provider, record only:

```text
Provider:
Rotated at (UTC):
Credential names:
Apps updated:
Health checks: pass/fail
Functional checks: pass/fail
Old credential revoked: yes/no
Notes without secret values:
```

## 6. Accept the clean bases

After all rotation checks pass, verify these immutable clean commits:

| Base | Commit |
| --- | --- |
| SpaceMountain | `ede8a2ea0e52773a47e6d34b1aa4f8450ef17168` |
| SPMT | `7e836f46b2283a2224c8de8c1383c4cb0e8d6c5c` |
| StreamWeaver | `31ac686e8cd8907a1e4d8ac110afe38be30c9ccb` |
| DiscordStreamHub | `953f3a7dd504f8101e8fa7aeed253066a3037a25` |
| HearMeOut | `43b72fcce676ce5654c5ca1f1338e9f0677267d9` |
| Chat Tag | `6b67baaa2a9639116f104c758cec968a09e0b6a2` |
| Machine Rotator | `184a07488d4250cce18c84e1c69dda4ffe64d8a7` |

1. Compare each downloaded archive with `SHA256SUMS.txt`.
2. Create a new empty GitHub repository per deployable unit when GitHub access is stable.
3. Import only the clean commit/tree. Do not push the historical source branch or copy its `.git` directory.
4. Protect `main`: require a pull request, passing checks, and no force-push.
5. Add secret scanning and dependency review before the first application PR.
6. Keep the old repositories read-only during parallel operation. Delete them only after the new system has passed the rollback window and backups are independently verified.

## 7. First implementation order after the debate

1. Approve or reject each open item in `DECISIONS.md`.
2. Build the SPMT identity/token authority and canonical data API.
3. Build the independent recovery replica and prove failover/restore.
4. Build the local-first LLM/TTS worker pool and paid-provider fallback policy.
5. Move bots and heavy per-streamer workloads onto isolated, autoscaled Machines with a warm spare only where the measured startup time justifies it.
6. Add tenant-facing apps one at a time, beginning with the smallest read-only slice.
7. Migrate one internal test tenant, then one willing tenant cohort. Stop on any isolation, authorization, or data-parity failure.
8. Cut production DNS only after rollback has been rehearsed and the old system remains available for the agreed window.

The immediate finish line is not “rebuild all 13 apps.” It is: regain account control, invalidate exposed credentials, approve the architecture contract, and make SPMT plus recovery trustworthy enough that every later app has one stable foundation.
