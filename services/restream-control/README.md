# Apollo Restream control service

This isolated Node 3 receiver preserves the StreamWeaver client contract:

- `GET /restream/status`
- `POST /restream/start`
- `POST /restream/reset`

It ports the donor Puppeteer/Xvfb controller and its exact visible-button checks. The service must be reachable only over the private Apollo service network. StreamWeaver sends its dedicated 32+ character bearer credential and rejects redirects.

## Required runtime configuration

- `RESTREAM_CONTROL_CREDENTIAL`: dedicated random 32+ character secret; never reuse an SPMT, DSH, StreamWeaver or HearMeOut credential.
- `RESTREAM_PROFILE_DIR=/var/lib/restream-profile`: absolute path on the mounted persistent volume.
- `RESTREAM_PROFILE_VOLUME_MARKER=/var/lib/restream-profile/.restream-profile-volume`: marker file required at startup; prepare it only after verifying the host mount.
- `RESTREAM_TLS_CERT_FILE` and `RESTREAM_TLS_KEY_FILE`: absolute paths to a private-CA certificate/key mounted read-only into the container.
- `RESTREAM_AUTOMATION_ENABLED=false`: remains false until the owner-authorized rehearsal is complete.
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`.

The process requires an absolute profile path and the volume marker, creates an exclusive lock in the profile volume and refuses a second controller. If forcibly killed and a lock remains, first verify that no controller is running, then remove `.restream-control.lock` from the mounted profile volume. Never remove it while a controller may still be active.

## Persistent profile

Mount a dedicated encrypted OCI block volume at the host path used for `RESTREAM_PROFILE_HOST_PATH`. Run `sudo env RESTREAM_PROFILE_HOST_PATH=/the/mount bash infra/oracle/prepare-restream-profile-volume.sh`; it refuses to create the marker unless the supplied path is itself a mount point. The container receives that path at `/var/lib/restream-profile`. Do not use anonymous container storage or the container layer. Provision the authenticated browser profile only through the owner's approved secure process. Never commit, upload to chat, or log cookies or profile contents. A fresh profile reports `login_required` until the owner signs in.

## Network and StreamWeaver

Attach this container to the existing external Docker network `apollo-private`, also used by StreamWeaver. The compose file deliberately does not publish port 3018 on the host. Do not expose Chromium remote debugging, Xvfb, screenshots, cookies or profile files.

The service itself listens on HTTPS and requires a certificate/key pair mounted read-only at `RESTREAM_TLS_CERT_FILE` and `RESTREAM_TLS_KEY_FILE`. Use a certificate trusted by the Apollo runtime with the private DNS name in its SAN. The existing StreamWeaver production origin validator requires credential-free HTTPS. Do not configure the client with internal plaintext HTTP in production. Keep the dedicated credential server-side and reject redirects.

## Verification and cutover

1. Build the image and run the API tests.
2. Provision and mount the encrypted persistent volume; verify it is the mounted filesystem and seed the signed-in profile securely.
3. Start with automation disabled; verify authenticated status returns `login_required` or a recognized UI state without exposing URL, title or profile path.
4. Verify the exclusive lock blocks a second instance and is removed on graceful shutdown.
5. Run owner-authorized start/reset rehearsal only after enabling automation explicitly; verify Twitch reports live after the Restream UI transition.
6. Keep the legacy receiver available until the new receiver passes all acceptance checks and rollback is tested.

This service does not move or copy the existing profile, touch player data, create OCI resources or deploy itself.
