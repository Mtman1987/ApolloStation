# ApolloStation — Oracle Cloud foundation

This is the initial, deliberately small OCI foundation for the permanent Apollo host. It provisions one Ubuntu ARM flexible compute instance, a VCN, public subnet, internet gateway, route table and network security group. SSH is restricted to `admin_cidr`; only HTTP/HTTPS are public.

## Before applying

1. Create the Oracle Cloud account and choose the home region.
2. Create a compartment dedicated to Apollo.
3. Create an API signing key; keep the private key outside this repository. Terraform reads the tenancy/user OCIDs, key fingerprint, region, and private-key path from your local `terraform.tfvars`. An OCI CLI profile is optional for separate CLI inspection.
4. Select a currently available Ubuntu ARM64 image OCID in that region.
5. Create an SSH key and set `admin_cidr` to your own fixed public IP.
6. Copy `terraform.tfvars.example` to `terraform.tfvars`, fill values locally, and review `terraform plan`.

Do not apply this until account, billing limits, region, quotas and the instance shape are confirmed. OCI Always Free capacity is not guaranteed. The default A1 shape values are starting values, not a promise of capacity or cost.

## Apply

From this directory, with Terraform and OCI credentials configured:

```sh
terraform init
terraform fmt -check
terraform validate
terraform plan
# Apply only after reviewing the plan and estimated cost:
terraform apply
```

The resulting public IP is an origin target only. Do not point production DNS at it until Apollo services, persistent volumes, backups, TLS, secrets, monitoring and rollback are configured.

## State and secrets

- Keep Terraform state private and backed up; move it to an OCI Object Storage backend after the account exists.
- Never commit `terraform.tfvars`, state files, API private keys, bot tokens, provider credentials, OAuth secrets or database exports.
- Use OCI Vault for runtime secrets; inject them at deployment time, never into images or Git.
- Use encrypted block volumes/Object Storage for durable databases and media. Back up before every migration.

## Scope boundary

The repository now contains a **single-host Apollo Compose stack** in `apollo-core.compose.yml`, a monorepo runtime image, a Caddy edge proxy, an isolated Restream receiver, a CPU Kokoro speech service, and the HearMeOut Lounge worker image. The manifest covers:

- SPMT authority and SpaceMountain integrated front door
- Chat Gateway, StreamWeaver web, Discord Stream Hub web and live worker
- Nebula live server and Stellar Core worker
- HearMeOut web and the Lounge-only legacy worker
- Restream browser control and private Kokoro CPU TTS
- Caddy public TLS routes plus a private-IP-only Restream hostname

This is a **single Oracle VM / single local block-volume deployment**, not the future three-node topology. Every SQLite-backed process is co-located on the same host filesystem. DSH web/worker share one DSH database; Nebula live and Chat Gateway share one Nebula database; StreamWeaver web and Chat Gateway share one StreamWeaver database; SPMT owns its own database. Do not put these SQLite files on NFS or a remote mount, and do not split these processes across nodes until persistence has been migrated to a multi-node-safe adapter.

## Prepare the runtime configuration

1. Mount a dedicated encrypted OCI block volume at the host path chosen for `APOLLO_DATA_HOST_PATH`.
2. Run the preflight as root. It refuses to proceed unless that exact path is a mount point, then creates the data/media/config/backups/Caddy directories and assigns the root to container UID 1000:

   ```sh
   sudo env APOLLO_DATA_HOST_PATH=/mnt/apollo-data bash infra/oracle/prepare-apollo-data-volume.sh
   ```

3. Copy the Nebula and DSH runtime examples into the mounted `config/` directory and replace all tenant, channel, provider-user, and Discord guild placeholders:

   ```sh
   cp config/nebula-arcade-runtime.production.example.json /mnt/apollo-data/config/nebula-arcade-runtime.production.json
   cp config/discord-stream-hub-runtime.production.example.json /mnt/apollo-data/config/discord-stream-hub-runtime.production.json
   ```

   The Nebula `NEBULA_ARCADE_CHANNEL_ID` must match a configured `stateChannelId`; its tenant ID must match the runtime config and Chat Gateway connection list. DSH's tenant and provider-user IDs must be linked in SPMT. Populate the member directory and Discord support/pack channels with the real production configuration before starting the live workers.

4. Copy `infra/oracle/apollo.env.example` to `infra/oracle/apollo.env`. This populated file is git-ignored. Generate every worker credential independently with `openssl rand -hex 32`; generate `SPMT_WEBHOOK_KEY` and `SPMT_PROVIDER_CREDENTIAL_KEY` as base64url encodings of exactly 32 random bytes. Replace all OAuth, bot, tenant, channel, provider-account, and public-host placeholders. `CHAT_GATEWAY_CONNECTIONS` must be valid tenant-scoped JSON matching the provider grants registered in SPMT.
5. Configure `STELLAR_PROVIDER_ORIGIN` to an OpenAI-compatible inference service you operate if you do not want paid AI. The bundled Kokoro service supplies local speech synthesis only; it does not supply chat inference or transcription.
6. Mount a trusted TLS certificate/key for `RESTREAM_PRIVATE_HOST` at the paths in `apollo.env`. Its SAN must match that hostname and the private key must be readable by Restream container UID 10001. Mount a separate encrypted block volume for `RESTREAM_PROFILE_HOST_PATH`, then run:

   ```sh
   sudo env RESTREAM_PROFILE_HOST_PATH=/mnt/apollo-restream-profile bash infra/oracle/prepare-restream-profile-volume.sh
   ```

   Provision the authenticated browser profile through the owner's secure process. This repository does not copy legacy cookies or session data.

## Validate and start the stack

Point the public SPMT, API, Nebula, StreamWeaver, DSH and HearMeOut DNS names at the Oracle VM. The Restream hostname must also resolve to the VM for TLS, but Caddy rejects requests to it unless they originate from a private network address. Create the private Docker network once, then validate the Compose model:

```sh
docker network create apollo-private
docker compose --env-file infra/oracle/apollo.env --file infra/oracle/apollo-core.compose.yml config
```

Only after the VM, encrypted volumes, production config files, secrets, TLS identity, DNS and backups are ready should the operator build/start the stack:

```sh
docker compose --env-file infra/oracle/apollo.env --file infra/oracle/apollo-core.compose.yml up -d --build
```

Caddy publishes only ports 80/443. App, worker, Kokoro, Restream and database ports are not published to the host. Restream automation defaults off; leave it off until the owner-authorized authenticated-profile and Twitch start/reset rehearsal passes. The Lounge worker runs in direct-only mode and shares the durable Apollo media volume.

## What CI does and does not prove

The Oracle container workflow builds the monorepo image and HearMeOut Lounge image, verifies all core process entrypoints, validates the Compose model and Caddyfile, and runs real CPU Kokoro voice smoke tests. This proves packaging and offline service contracts. It does not prove that the Oracle account has A1 capacity, that the full ecosystem fits the selected VM under concurrent load, that the real OAuth/Discord/Twitch credentials work, that the imported player data is present, or that the Restream profile is signed in. It also does not provision OCI resources or deploy anything.

Before cutover, verify every database path and backup, the DSH/Nebula/StreamWeaver shared-file relationships, provider reconnects, overlay/OBS URLs, the Lounge 24/7 loop, speech playback, Restream session persistence and rollback. Existing player data is not imported or modified by this manifest. Do not remove the legacy receiver or switch production DNS until the owner-run acceptance rehearsal succeeds.
