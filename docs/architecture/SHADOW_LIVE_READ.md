# Shadow live read

Status: public production reads are enabled without a developer-created credential. Outbound provider actions remain disabled.

## Boundary

The supervised Sprite continues to run with `SPMT_RUNTIME_MODE=sandbox` and `SPMT_OUTBOUND_MODE=disabled`. Each app web process authenticates the browser against the local SPMT session first, then reads approved public production projections from `https://spmt.live` on the server.

- No GitHub secret, pasted bearer token, token file, or feature token enables this mode.
- The offline network guard permits only `GET` requests to the exact configured HTTPS origin.
- The Sprite network policy permits only that production hostname in addition to build dependencies and still ends with a wildcard deny rule.
- A failed production read is shown as unavailable. It does not silently fall back and label sandbox data as live.
- Workers, SPMT, Chat Gateway, and the model runtime receive no production credential.

The `blue-v1` projection adapter reads the existing production API contracts that have a safe counterpart: apps/runtime, platform events, overlay workspace, XP, Athena capabilities, and the current identity. Sources with no production read counterpart remain explicitly unavailable.

## Voice Commander

StreamWeaver receives `operationMode=read-only` whenever outbound mode is disabled. Voice Commander remains visible and can capture a transcript in the browser. It applies the shared suite-action risk catalog as follows:

- `read` actions may enter the local app-owned job pipeline;
- `write` and `broadcast` actions return a blocked preview and create no job;
- free-form assistant invocations and Twitch/Discord sends return a blocked preview;
- the UI displays `Live input · read only · no outbound`.

This policy is enforced by the server. The UI label is explanatory, not the security boundary.

## Authentication boundary

Deployment always supplies the fixed `https://spmt.live` read origin. Public projections can therefore flow into Apollo immediately with no developer setup.

Private identity, XP, provider-link, and tenant projections still require real SPMT authorization. They must use the existing SPMT OAuth authorization-code flow and read-only scopes. Apollo must not create a parallel access token or ask a developer to paste one into GitHub. Until production registers Apollo's exact Sprite callback as a first-party/public OAuth client, those sources remain truthfully unavailable.

## Provider ingress

Chat Gateway also recognizes `SPMT_LIVE_INGRESS_MODE=enabled` with outbound disabled. In that mode it requests provider read scopes, registers no provider senders, and does not start StreamWeaver or Nebula active consumers. Provider credentials come from the existing SPMT provider-grant authority; Apollo does not invent a second credential system.
