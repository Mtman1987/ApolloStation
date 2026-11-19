# Restream Control Service

**Package:** @spmt/restream-control  
**Location:** services/restream-control  
**Runtime:** isolated Node.js/Express/Puppeteer service.  
**Intended placement:** private Apollo Node 2 service boundary. It is not a Node 3 service and is not currently launched by scripts/hostless/start-node.mjs.

## 1. Responsibility

This service preserves the StreamWeaver Restream browser-control contract:

- GET /restream/status
- POST /restream/start
- POST /restream/reset

It opens the authenticated Restream web UI in a persistent Chromium profile, recognizes only known visible start/stop controls, and performs a controlled start/reset only when automation is explicitly enabled.

It is not a general browser automation endpoint. It does not expose screenshots, arbitrary selectors, remote debugging, arbitrary URLs, cookies or profile contents.

## 2. Current integration status

The service implementation and its tests exist. Chat Gateway/StreamWeaver configuration supports RESTREAM_CONTROL_ORIGIN and RESTREAM_CONTROL_CREDENTIAL. However, the active Hostless Node 2 process composition currently starts Chat Gateway, StreamWeaver web and optionally Nebula; it does not start this service.

The previous README described a separate Node 3/Oracle deployment. That topology is retired and is not an approved Apollo production target. Before this service is used in production, integrate it as an Apollo-owned Node 2 supervised process or a private Hostless app with an explicit service boundary, persistent profile mount, HTTPS certificate, health/readiness and rollback. Do not revive Oracle, Fly, or a third node.

Until that integration and owner rehearsal are complete, keep RESTREAM_AUTOMATION_ENABLED=false and treat the service as unaccepted infrastructure code.

## 3. HTTP contract

- GET /healthz — minimal service health; does not expose browser state or secrets.
- GET /restream/status — requires bearer auth and returns bounded configured/automation/state/recognized-control information.
- POST /restream/start — requires bearer auth and automation enabled; returns success only when the UI is verified live.
- POST /restream/reset — requires bearer auth and automation enabled; holdMs must be an integer from 5,000 to 30,000; returns success only when the UI is verified live.

The API uses a dedicated RESTREAM_CONTROL_CREDENTIAL of at least 32 characters. Comparison is timing-safe. Requests reject redirects and return bounded error messages.

## 4. Runtime configuration

Required:

- RESTREAM_CONTROL_CREDENTIAL — dedicated random 32+ character secret; never reuse SPMT, DSH, StreamWeaver or HearMeOut credentials.
- RESTREAM_PROFILE_DIR — absolute path on a mounted persistent volume.
- RESTREAM_PROFILE_VOLUME_MARKER — marker file required at startup after the mount is verified.
- RESTREAM_TLS_CERT_FILE and RESTREAM_TLS_KEY_FILE — private-CA certificate/key mounted read-only.
- PUPPETEER_EXECUTABLE_PATH — Chromium executable path.
- RESTREAM_AUTOMATION_ENABLED — must remain false until owner-approved rehearsal and explicit release.

Optional:

- RESTREAM_CONTROL_URL — defaults to https://app.restream.io/channel.
- RESTREAM_CONTROL_HOST and RESTREAM_CONTROL_PORT — listener binding, subject to private network policy.

Never log environment values or browser profile content.

## 5. Persistent browser profile

The authenticated Restream profile must live on an encrypted, durable, mounted volume. The process requires an absolute profile path and a marker file that proves the expected mount is present. It creates an exclusive lock to prevent two controllers from using the same profile.

A fresh profile reports login_required until the owner signs in through the approved secure process. Do not automate login, export cookies, upload the profile, or put profile contents into repository artifacts.

If the process is forcibly killed and a lock remains, first verify no controller is active before removing the lock from the mounted profile. Never delete a lock while Chromium may still be using the profile.

## 6. Network and security

- The service must be reachable only on a private Apollo service network.
- Use HTTPS with a certificate trusted by the Node 2 runtime and a private DNS SAN.
- Do not publish the controller port publicly.
- Do not expose Chromium remote debugging, Xvfb, screenshots, cookies or profile files.
- The browser may navigate only to approved Restream HTTPS hosts.
- Use a dedicated bearer credential and reject redirects.
- Keep automation disabled until owner rehearsal is approved.
- Enforce a single controller per persistent profile.
- Bound request body, action duration, UI waits and response fields.
- Do not allow arbitrary selectors, URL parameters, scripts or browser commands.

## 7. Build and tests

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test

Package-local commands:

    npm start --workspace @spmt/restream-control
    npm test --workspace @spmt/restream-control

The package uses Express and Puppeteer. Chromium and Xvfb are runtime dependencies in the container image. Keep them isolated from the global SpaceMountain shell and Chat Gateway web bundle.

## 8. Performance and lifecycle

- Keep one browser/controller instance per persistent profile.
- Use explicit startup and shutdown handling for Chromium and Xvfb.
- Enforce an exclusive profile lock.
- Avoid opening a new browser for every status request.
- Keep UI polling and visible-button recognition bounded.
- Restart the service only through the supervised Node 2 lifecycle.
- Preserve the profile volume across app replacement; never rely on container-layer storage.

## 9. Integration checklist

- [ ] Add the service to the Node 2 supervised process map or deploy it as an explicitly private Hostless app.
- [ ] Provide a durable encrypted profile mount and marker.
- [ ] Provide private HTTPS certificate/key and private service DNS.
- [ ] Inject a dedicated 32+ character RESTREAM_CONTROL_CREDENTIAL.
- [ ] Configure StreamWeaver with the private HTTPS origin and credential.
- [ ] Confirm /healthz and authenticated /restream/status.
- [ ] Verify login_required state and owner-controlled sign-in.
- [ ] Keep automation disabled until owner approves a rehearsal.
- [ ] Verify controlled start/reset and UI state after action.
- [ ] Verify restart, lock cleanup, volume persistence and rollback.
- [ ] Confirm no public listener, debug port, screenshot, cookie or profile leak.
