# Stellar Chat Vertical

Status: hosted Qwen is `green-primary-with-fallback`. A release cannot become ready unless the real hosted provider and authenticated worker publish a fresh lease.

## Request path

1. An authorized user or app invokes `spmt.community-assistant` with a message, conversation ID, idempotency key, optional route preference, and an explicit remember choice.
2. SPMT resolves plan and live worker eligibility. Automatic uses hosted Qwen. Companion requires a paid plan, an installed Companion, and a fresh tenant-compatible worker lease; a stale app-runtime projection is never sufficient.
3. Stellar Core creates one `stellar-core.ai-chat.v1` execution job and consumes `ai-chat-requests` once under the job's idempotency key.
4. A service-authenticated worker claims the next authorized tenant job for its physical target, heartbeats progress, reads bounded user/tenant Stellar context and prior conversation jobs, and calls only a loopback OpenAI-compatible provider.
5. The worker succeeds with `stellar-chat-result.v1` or records a bounded retryable/non-retryable failure. Job transition logs contain no prompt, response, provider credential, or model endpoint.
6. SpaceMountain polls the user's job, shows progress or the real failure, then refreshes that user's Account usage.

## Security and identity boundaries

- `/v1/llm/health`, `/v1/llm/models`, and `/v1/llm/chat/completions` are not browser routes.
- Worker credentials are generated/passed by the supervisor and exchanged directly with SPMT for short-lived service access.
- The supervisor rotates the worker credential with every supervised cohort; it is never stored in the service definition, database, job, or log.
- Worker origins must be credential-free loopback HTTP origins.
- The worker can claim only its own execution-owner jobs and only across the tenant set granted to its service identity.
- Public results omit provider/model identity. Raw provider controls remain owner-only.
- The system prompt is persona-neutral. SpaceMountain labels the response as Stella; Athena remains a StreamWeaver configuration belonging to the owner.

## Machine and pricing behavior

| Preference | Eligibility | Physical target | Account target | User-visible result |
|---|---|---|---|---|
| Automatic | Everyone | Sprite | Hosted | Qwen default |
| Hosted | Eligible caller | Sprite | Hosted | Explicit hosted route |
| Companion | Paid + installed + fresh authenticated worker | Companion | Companion | Local usage recorded; hosted bar unchanged under unmetered-local plans |
| Companion | Free or unavailable | Sprite | Hosted | Visible fallback reason |

The existing `qwen-cpu-pool` runtime policy remains zero-minimum, bounded, and production-mutation-disabled. This implementation supplies truthful queue demand and worker leases for later Rotator decisions; it does not grant Rotator or the app production Fly credentials. The Sprite supervisor waits up to ten minutes for `/health/stellar`, which requires provider health and a fresh worker lease, before declaring a release ready.

## Privacy and user control

- Remembered raw prompts/results are retained for seven days, then replaced by content-minimized metadata; metadata is deleted after 30 days.
- Do-not-remember turns retain raw content for at most one hour so a durable result can be delivered, then minimize it.
- Account exposes authenticated export and irreversible delete controls. Both derive the user from the access token and ignore caller-supplied identities.
- Explicitly curated personal context remains separate and is included in export/delete.

## Release evidence and continuing observation

- Worker leases fail closed after 30 seconds without a heartbeat.
- Each heartbeat reports provider health, cold start, last inference latency, token throughput, success/failure counts, and Qwen RSS when the operating system exposes it.
- The real Stella route has been driven to the Free-plan 70/90/100 warning regime and 100% hard stop in automated production-like traffic.
- A real Companion worker is optional, not fabricated: until a paired local process reports fresh tenant-compatible evidence, explicit Companion requests visibly use hosted fallback. Disconnect and reconnect are governed by the same lease.
- Production deployment records the exact build SHA and accepts the release only after live Qwen readiness. Longer-term latency/capacity tuning remains telemetry work, not a route-safety gate.
