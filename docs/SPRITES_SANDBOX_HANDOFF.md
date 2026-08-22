# SPMT + SpaceMountain Sprite sandbox handoff

Status: **code-ready locally; stop before Fly/Sprites authentication and paid resource creation**

This runbook opens only the Green SPMT authority and SpaceMountain browser shell. It does not deploy a Fly App or Machine, register a Sprite service, start a bot/worker/scheduler, or connect a production provider identity.

## Already completed in code

- [x] SpaceMountain has a browser host on port `8080`.
- [x] SPMT stays on loopback at `127.0.0.1:3000`.
- [x] Browser API access is same-origin and allowlisted.
- [x] Login tokens stay in a Secure, HttpOnly, SameSite cookie and are redacted from browser responses.
- [x] Browser-supplied bearer tokens are discarded by the proxy.
- [x] Twitch, Discord, Kick, LiveKit, Firebase, Fly, and Sprites credentials are rejected by sandbox startup guards.
- [x] Webhook delivery is blocked in sandbox mode.
- [x] Orbit Beacon proves registry-driven discovery without a hardcoded tile.
- [x] Athena remains the bot persona; Stellar Core remains the generic system capability surface.
- [x] The Sprite network policy allows GitHub/npm only and then denies `*`.
- [x] The supervised runner creates its webhook-encryption key in memory and stops SPMT and SpaceMountain together.
- [x] No `sprite-env services create` command exists in the runner.

## STOP conditions

Stop immediately if any of these are true:

- The branch `green-spacemountain-sprite-web-host` is not published and reviewable on GitHub.
- A command asks for a Discord, Twitch, Kick, LiveKit, Firebase, Fly API, or production database secret.
- The Sprite URL has been changed to public access.
- The network policy does not end with `{ "domain": "*", "action": "deny" }`.
- A provider domain resolves after the deny policy is applied.
- `sprite-env services list` contains an app service we did not explicitly approve.
- The SPMT readiness response does not say `runtimeMode: sandbox` and `outboundIntegrations: disabled`.
- A second consumer, bot, webhook worker, scheduler, or Rotator process appears.

## Manual steps for tonight (Windows PowerShell)

Do these only after the Green branch has been published.

On your Windows computer, first clone or update the public ApolloStation branch so the checked-in policy and PowerShell verifier are available locally:

```powershell
git clone --single-branch --branch green-spacemountain-sprite-web-host https://github.com/Mtman1987/ApolloStation.git ApolloStation-Green-Sandbox
Set-Location .\ApolloStation-Green-Sandbox
git status --short --branch
```

- [ ] The local checkout is on `green-spacemountain-sprite-web-host` and clean.

### 1. Install and authenticate

- [ ] Install the current Sprites CLI using the official Windows instructions.
- [ ] Run `sprite --help` and confirm the CLI responds.
- [ ] Run `sprite org auth`.
- [ ] Complete Fly authentication in the browser. Do not paste credentials or tokens into chat.
- [ ] Run `sprite org list` and confirm the intended organization is current.

### 2. Create the isolated Sprite

Creating a Sprite is the first paid external mutation in this runbook.

```powershell
$SpriteName = 'spmt-ecosystem-sandbox'
sprite create $SpriteName
sprite use $SpriteName
sprite url update --auth sprite
sprite url
```

- [ ] Confirm the URL authentication mode is `sprite`, not `public`.
- [ ] Copy the private `https://...sprites.app` URL into a temporary PowerShell variable named `$SpriteUrl`.

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
sprite exec -- git clone --single-branch --branch green-spacemountain-sprite-web-host https://github.com/Mtman1987/ApolloStation.git /home/sprite/ApolloStation
sprite exec --dir /home/sprite/ApolloStation -- git status --short --branch
sprite exec --dir /home/sprite/ApolloStation -- git rev-parse HEAD
```

- [ ] The branch is `green-spacemountain-sprite-web-host`.
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

### 9. Start the supervised foreground sandbox

This command generates a sandbox-only key in memory. It does not accept provider secrets and does not register a service.

```powershell
$BuildSha = (sprite exec --dir /home/sprite/ApolloStation -- git rev-parse HEAD).Trim()
if ($BuildSha -notmatch '^[0-9a-f]{40}$') { throw 'Could not verify the Green commit SHA.' }
sprite exec --no-port-forward --dir /home/sprite/ApolloStation -- node scripts/sprites/run-supervised-sandbox.mjs --public-url $SpriteUrl --data-root /home/sprite/data --build-sha $BuildSha
```

- [ ] The terminal says `Green sandbox is supervised and ready`.
- [ ] The terminal says outbound provider actions are disabled.
- [ ] Keep this terminal open during the supervised test.

### 10. Open and verify SpaceMountain

- [ ] Open `$SpriteUrl` while signed into the correct Fly/Sprites organization.
- [ ] The page shows `GREEN SPRITE SANDBOX`.
- [ ] Create a new sandbox-only account; do not reuse a production password.
- [ ] Home, Shipyard, Commlink, Stellar Core, Workspace, Settings, and Help render.
- [ ] Shipyard shows both `SpaceMountain` and `Orbit Beacon` from SPMT.
- [ ] Install Orbit Beacon with no scopes.
- [ ] Launch Orbit Beacon and confirm it says it came from the SPMT registry.
- [ ] Refresh SpaceMountain and confirm the installed state persists in the isolated SQLite file.
- [ ] Stellar Core shows the sandbox registry-inspection capability.
- [ ] No page asks for or displays a provider token.

### 11. Verify runtime health and isolation

From a second PowerShell window:

```powershell
sprite exec -- curl -fsS http://127.0.0.1:3000/health/ready
sprite exec -- curl -fsS http://127.0.0.1:8080/sandbox/health
sprite exec -- sprite-env services list
```

- [ ] SPMT reports `runtimeMode` as `sandbox`.
- [ ] SPMT reports `outboundIntegrations` as `disabled`.
- [ ] SPMT reports `sandboxFixtures` as `true`.
- [ ] The web health endpoint reports both layers ready.
- [ ] The services list remains empty.

### 12. Stop cleanly

- [ ] Return to the supervised runner terminal.
- [ ] Press `Ctrl+C` once.
- [ ] Confirm both processes exit.

```powershell
sprite exec -- sh -lc "! pgrep -af 'spmt-service/dist/index.js|spacemountain-web/dist/server.js'"
sprite exec -- sprite-env services list
```

- [ ] No SPMT or SpaceMountain process remains.
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

## Evidence to bring back

Do not include secrets. Record only:

- Sprite name and private URL hostname
- Git commit SHA
- Network-policy verification result
- Test count and pass/fail result
- Checkpoint version
- `/health/ready` JSON with no secret values
- Screenshots of Home, Shipyard, Orbit Beacon, Commlink, and Stellar Core
- Any STOP condition or unexpected process/service

## Official references checked 2026-08-22

- Sprites quickstart: <https://docs.sprites.dev/quickstart/>
- CLI authentication: <https://docs.sprites.dev/cli/authentication/>
- Networking and URL authentication: <https://docs.sprites.dev/concepts/networking/>
- Services and restart behavior: <https://docs.sprites.dev/concepts/services/>
- Checkpoints: <https://docs.sprites.dev/concepts/checkpoints/>
- Network Policy API: <https://sprites.dev/api/sprites/policies>
