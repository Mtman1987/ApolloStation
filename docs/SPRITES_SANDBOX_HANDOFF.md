# ApolloStation staged Sprite sandbox handoff

Status: **existing private Sprite identified; empty-ecosystem plus SDK-published Chat Tag is code-complete and passes 151 local tests; branch publication is required before remote testing**

## Approved existing sandbox target

| Field | Value |
|---|---|
| Sprite ID | `sprite-fec8d6f2-49f0-4e28-bc6d-e8a7ae364280` |
| Sprite name | `web-terminal` (verify against the ID before use) |
| Organization | `testing-968` |
| Private URL | `https://web-terminal-bvesa.sprites.app` |
| URL authentication | `sprite` / organization admins |
| Label | `fly:sprite-terminal-ready` |

Reuse this Sprite. Do **not** create a second Sprite for ApolloStation unless the owner explicitly approves it. The URL must remain organization-authenticated during Green testing.

The supervised runner now has two explicit cohorts: `platform` (the Green SPMT authority and SpaceMountain shell) and `chat-tag` (the first completed product app). Chat Tag starts only its private SQLite authority, same-origin gameplay console, and OBS renderer. A cohort must pass its simulated-provider, restart, tenant-isolation, and migration fixtures before any live provider grant is introduced.

This runbook opens only the Green SPMT authority and SpaceMountain browser shell. It does not deploy a Fly App or Machine, register a Sprite service, start a bot/worker/scheduler, or connect a production provider identity.

## Already completed in code

- [x] SpaceMountain has a browser host on port `8080`.
- [x] SPMT stays on loopback at `127.0.0.1:3000`.
- [x] Browser API access is same-origin and allowlisted.
- [x] Login tokens stay in a Secure, HttpOnly, SameSite cookie and are redacted from browser responses.
- [x] Browser-supplied bearer tokens are discarded by the proxy.
- [x] Twitch, Discord, Kick, LiveKit, Firebase, Fly, and Sprites credentials are rejected by sandbox startup guards.
- [x] Webhook delivery is blocked in sandbox mode.
- [x] The platform sandbox starts with an empty app catalog; no fixture app is pre-registered.
- [x] Chat Tag runs as a hidden loopback candidate and becomes visible only after `SpmtClient.registerApp(...)` succeeds.
- [x] The full supervised zero-to-one test proves an empty registry, the SDK registration, exactly one `chat-tag` manifest, and clean shutdown of all three processes.
- [x] Stellar Core remains persona-neutral; Stella is the app-neutral Community Assistant; Athena is only the owner's configured StreamWeaver persona.
- [x] Stella discovery/invocation is exposed through SDK, HTTP API, CLI, and MCP; this provider-free sandbox truthfully returns `unavailable` instead of a fabricated reply.
- [x] Mission Control persists a synthetic, explicitly labeled operations fixture; SDK/API/CLI/MCP share the same scoped log/coder contracts; no Rotator or coder worker is started. The isolated account receives only sandbox-owner test scopes; normal production users do not receive operations access automatically.
- [x] The Sprite network policy allows GitHub/npm only and then denies `*`.
- [x] The supervised runner creates its webhook-encryption key in memory and stops SPMT and SpaceMountain together.
- [x] No `sprite-env services create` command exists in the runner.
- [x] Original Chat Tag has a standalone port-8080 sandbox host with readiness, gameplay, state, rotation, support inspection, and OBS routes.
- [x] Chat Tag sandbox startup rejects provider/Fly credentials and uses a no-egress SPMT adapter.
- [x] Chat Tag retains mutation replies, ordinary-chat wakeup, 40-minute/5-hour rotation, 60-minute FFA reminders, live/chatting paging, Pin ranking, durable support tickets, overlay mode/messages, and permanent opt-out.

## STOP conditions

Stop immediately if any of these are true:

- The selected Green branch and exact commit are not published and reviewable on GitHub.
- A command asks for a Discord, Twitch, Kick, LiveKit, Firebase, Fly API, or production database secret.
- The Sprite URL has been changed to public access.
- The network policy does not end with `{ "domain": "*", "action": "deny" }`.
- A provider domain resolves after the deny policy is applied.
- `sprite-env services list` contains an app service we did not explicitly approve.
- The SPMT readiness response does not say `runtimeMode: sandbox` and `outboundIntegrations: disabled`.
- A second consumer, bot, webhook worker, scheduler, or Rotator process appears.

## Manual steps for tonight (Windows PowerShell)

Do these only after the Green branch has been published.

On your Windows computer, set `$GreenBranch` to the reviewed branch that contains the completed app cohort, then clone or update that exact public ApolloStation branch so the checked-in policy and PowerShell verifier are available locally:

```powershell
$GreenBranch = 'REPLACE-WITH-REVIEWED-GREEN-BRANCH'
git clone --single-branch --branch $GreenBranch https://github.com/Mtman1987/ApolloStation.git ApolloStation-Green-Sandbox
Set-Location .\ApolloStation-Green-Sandbox
git status --short --branch
```

- [ ] The local checkout is on `$GreenBranch` and clean.

### 1. Install and authenticate

- [ ] Install the current Sprites CLI using the official Windows instructions.
- [ ] Run `sprite --help` and confirm the CLI responds.
- [ ] Run `sprite org auth -o testing-968`.
- [ ] Complete Fly authentication in the browser. Do not paste credentials or tokens into chat.
- [ ] Run `sprite org list` and confirm `testing-968` is configured.

### 2. Select and verify the existing isolated Sprite

The CLI selects Sprites by name, so first list the organization and identify the name whose ID is exactly `sprite-fec8d6f2-49f0-4e28-bc6d-e8a7ae364280`.

```powershell
$SpriteOrg = 'testing-968'
$ExpectedSpriteId = 'sprite-fec8d6f2-49f0-4e28-bc6d-e8a7ae364280'
sprite list -o $SpriteOrg
$SpriteName = 'web-terminal'
sprite use -o $SpriteOrg $SpriteName
sprite url -o $SpriteOrg -s $SpriteName
```

- [ ] The selected list row matches `$ExpectedSpriteId`.
- [ ] The URL is exactly `https://web-terminal-bvesa.sprites.app`.
- [ ] Confirm the URL authentication mode is `sprite`, not `public`.
- [ ] Set `$SpriteUrl = 'https://web-terminal-bvesa.sprites.app'`.

### 3. Apply egress denial before code enters the VM

Create a short-lived Sprites API token from the official Sprites account page, then place it only in the current PowerShell process:

```powershell
$SecureToken = Read-Host 'Sprites API token' -AsSecureString
$env:SPRITES_TOKEN = [Net.NetworkCredential]::new('', $SecureToken).Password
.\scripts\sprites\Apply-NetworkPolicy.ps1 -SpriteName $SpriteName
Remove-Item Env:SPRITES_TOKEN
Remove-Variable SecureToken
```

- [ ] The script prints `Verified deny-by-default network policy`.
- [ ] The environment variable is removed immediately after use.
- [ ] The token is never saved in the repository, a `.env` file, terminal transcript, screenshot, or chat.

### 4. Prove forbidden egress is blocked

```powershell
sprite exec -- dig github.com
sprite exec -- dig registry.npmjs.org
sprite exec -- dig discord.com
sprite exec -- dig id.twitch.tv
sprite exec -- dig api.livekit.io
```

- [ ] GitHub resolves.
- [ ] npm resolves.
- [ ] Discord returns DNS `REFUSED`.
- [ ] Twitch returns DNS `REFUSED`.
- [ ] LiveKit returns DNS `REFUSED`.

If a provider domain resolves, **STOP**. Do not clone or run code.

### 5. Clone and verify the exact Green branch

```powershell
sprite exec -- git clone --single-branch --branch $GreenBranch https://github.com/Mtman1987/ApolloStation.git /home/sprite/ApolloStation
sprite exec --dir /home/sprite/ApolloStation -- git status --short --branch
sprite exec --dir /home/sprite/ApolloStation -- git rev-parse HEAD
```

- [ ] The branch is `$GreenBranch`.
- [ ] The working tree is clean.
- [ ] The commit matches the reviewed handoff commit.

### 6. Install, build, and test without lifecycle scripts

```powershell
sprite exec --dir /home/sprite/ApolloStation -- npm ci --ignore-scripts
sprite exec --dir /home/sprite/ApolloStation -- npm run typecheck
sprite exec --dir /home/sprite/ApolloStation -- npm test
```

- [ ] `npm ci` succeeds using only allowed npm domains.
- [ ] TypeScript is clean.
- [ ] Every test passes, including `spacemountain-web.test.mjs`.

### 7. Create a clean code checkpoint

```powershell
sprite checkpoint create --comment 'Green code built and tested; no runtime service registered'
sprite checkpoint list
```

- [ ] Record the checkpoint version locally.

### 8. Verify there are no registered services

```powershell
sprite exec -- sprite-env services list
```

- [ ] No SPMT, SpaceMountain, bot, worker, scheduler, webhook dispatcher, or Rotator service is listed.

### 9. Start the empty ecosystem with Chat Tag available only as an unpublished candidate

This starts the SPMT authority, SpaceMountain shell, and a loopback-only Chat Tag candidate. The candidate is deliberately absent from the registry, so the first browser view is the ecosystem with zero apps. It does not accept provider secrets, send provider traffic, or register a persistent Sprite service.

```powershell
$BuildSha = (sprite exec --dir /home/sprite/ApolloStation -- git rev-parse HEAD).Trim()
if ($BuildSha -notmatch '^[0-9a-f]{40}$') { throw 'Could not verify the Green commit SHA.' }
sprite exec --no-port-forward --dir /home/sprite/ApolloStation -- node scripts/sprites/run-supervised-sandbox.mjs --app platform --candidate-app chat-tag --public-url $SpriteUrl --data-root /home/sprite/data --build-sha $BuildSha --tenant-id chat-tag-sandbox --channel-id sandbox-channel
```

- [ ] The terminal says `Green sandbox is supervised and ready`.
- [ ] The terminal says `The SPMT app catalog starts empty. Chat Tag is available only through the SDK publish control.`
- [ ] Keep this terminal open during the supervised test.

### 10. Prove the ecosystem is empty, then publish exactly Chat Tag through the SDK

- [ ] Open `$SpriteUrl` while signed into the correct Fly/Sprites organization.
- [ ] Register or sign in with a sandbox-only account.
- [ ] The Shipyard/app catalog shows zero apps.
- [ ] Select **Publish Chat Tag through SDK** once.
- [ ] The status confirms exactly one app and the catalog contains only **Chat Tag**.
- [ ] Open Chat Tag from that registry-driven entry.
- [ ] The page shows `CHAT TAG · GREEN` and `FIRST COMPLETE APP COHORT`.
- [ ] Send `spmt join` as Alpha and confirm Alpha becomes it.
- [ ] Change the user ID and username, join a second player, then tag that player.
- [ ] Verify score, status, players, sleep, wake, live, and Pin-rank controls respond.
- [ ] Refresh and confirm players, scores, holder, and history persist.
- [ ] As a moderator, send `spmt mute`; verify later command replies are recorded in the overlay feed.
- [ ] Open **OBS output** and confirm the transparent status bar, current holder, player count, leaderboard/history cycle, and tag animation render.
- [ ] Create a support ticket and confirm it appears at `/v1/chat-tag/support`.
- [ ] Test `spmt optout` only at the end: it is deliberately permanent for that sandbox channel and requires a broadcaster/mod role.
- [ ] No page asks for or displays a provider token, and no Twitch/Discord/Kick message is sent.

### 11. Verify runtime health and isolation

From a second PowerShell window:

```powershell
sprite exec -- curl -fsS http://127.0.0.1:8080/health/ready
sprite exec -- curl -fsS http://127.0.0.1:8080/v1/chat-tag/state
sprite exec -- sprite-env services list
```

- [ ] SpaceMountain reports ready and SPMT reports `runtimeMode: sandbox`, `outboundIntegrations: disabled`, and `sandboxFixtures: false`.
- [ ] The authenticated app list contains exactly `chat-tag` after publication.
- [ ] The state endpoint contains only the isolated `chat-tag-sandbox` tenant.
- [ ] The services list remains empty.

### 12. Stop cleanly

- [ ] Return to the supervised runner terminal.
- [ ] Press `Ctrl+C` once.
- [ ] Confirm the Chat Tag process exits.

```powershell
sprite exec -- sh -lc "! pgrep -af 'chat-tag-sandbox-server.js|spmt-service/dist/index.js|spacemountain-web/dist/server.js'"
sprite exec -- sprite-env services list
```

- [ ] No Chat Tag, SPMT, or SpaceMountain process remains.
- [ ] No service definition exists to restart one later.

## Deliberately not authorized yet

- Registering persistent Sprite services
- Making the Sprite URL public
- Adding any provider credential
- Connecting Blue/production databases, queues, webhooks, tenants, bots, or workers
- Starting the Machine Rotator
- Enabling background outbox delivery
- Deploying a Fly App or Fly Machine
- Changing production DNS

## App-by-app cohort rule

For each completed app, create a checkpoint before starting it, run it in the foreground, and use a separate path under `/home/sprite/data/<app-id>/`. Do not copy a production volume into the Sprite. Import only an explicitly redacted fixture through the app's tested migration adapter.

The order is:

1. build and run the complete local suite;
2. checkpoint the clean Sprite;
3. start the one app cohort and only the SPMT services or bounded emulators it requires;
4. run direct, embedded, restart, tenant-isolation, migration, and output tests;
5. stop every process and verify `sprite-env services list` is unchanged;
6. record the commit, checkpoint, test count, and non-secret health output;
7. only then add the next completed app.

Provider credentials, persistent services, public URL access, production volumes, Fly deploys, and DNS changes remain separate approvals. Linked billing does not make the Sprite a production authority.

## Evidence to bring back

Do not include secrets. Record only:

- Sprite name and private URL hostname
- Git commit SHA
- Network-policy verification result
- Test count and pass/fail result
- Checkpoint version
- `/health/ready` JSON with no secret values
- Screenshots of the Chat Tag console, persisted leaderboard, and OBS output
- Any STOP condition or unexpected process/service

## Official references checked 2026-08-22

- Sprites quickstart: <https://docs.sprites.dev/quickstart/>
- CLI authentication: <https://docs.sprites.dev/cli/authentication/>
- Networking and URL authentication: <https://docs.sprites.dev/concepts/networking/>
- Services and restart behavior: <https://docs.sprites.dev/concepts/services/>
- Checkpoints: <https://docs.sprites.dev/concepts/checkpoints/>
- Network Policy API: <https://sprites.dev/api/sprites/policies>
