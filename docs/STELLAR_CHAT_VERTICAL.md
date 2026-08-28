# Stellar Chat Vertical

Status: verified in Green contracts and automated integration tests; production route remains `shadow`.

## Request path

1. An authorized user or app invokes `spmt.community-assistant` with a message, conversation ID, idempotency key, and optional route preference.
2. SPMT resolves plan and runtime eligibility. Automatic uses hosted Qwen. Companion requires a paid plan plus an installed, `ready` Companion runtime.
3. Stellar Core creates one `stellar-core.ai-chat.v1` execution job and consumes `ai-chat-requests` once under the job's idempotency key.
4. A service-authenticated worker claims the next authorized tenant job for its physical target, heartbeats progress, reads bounded user/tenant Stellar context and prior conversation jobs, and calls only a loopback OpenAI-compatible provider.
5. The worker succeeds with `stellar-chat-result.v1` or records a bounded retryable/non-retryable failure. Job transition logs contain no prompt, response, provider credential, or model endpoint.
6. SpaceMountain polls the user's job, shows progress or the real failure, then refreshes that user's Account usage.

## Security and identity boundaries

- `/v1/llm/health`, `/v1/llm/models`, and `/v1/llm/chat/completions` are not browser routes.
- Worker credentials are generated/passed by the supervisor and exchanged directly with SPMT for short-lived service access.
- Worker origins must be credential-free loopback HTTP origins.
- The worker can claim only its own execution-owner jobs and only across the tenant set granted to its service identity.
- Public results omit provider/model identity. Raw provider controls remain owner-only.
- The system prompt is persona-neutral. SpaceMountain labels the response as Stella; Athena remains a StreamWeaver configuration belonging to the owner.

## Machine and pricing behavior

| Preference | Eligibility | Physical target | Account target | User-visible result |
|---|---|---|---|---|
| Automatic | Everyone | Sprite | Hosted | Qwen default |
| Hosted | Eligible caller | Sprite | Hosted | Explicit hosted route |
| Companion | Paid + installed + ready | Companion | Companion | Local usage recorded; hosted bar unchanged under unmetered-local plans |
| Companion | Free or unavailable | Sprite | Hosted | Visible fallback reason |

The existing `qwen-cpu-pool` runtime policy remains zero-minimum, bounded, and production-mutation-disabled. This implementation supplies truthful queue demand and worker leases for later Rotator decisions; it does not grant Rotator or the app production Fly credentials.

## Remaining production gates

- enforce D-24 seven-day raw prompt/result retention and 30-day content-minimized metadata retention;
- add user export, delete, and do-not-remember controls;
- record live Qwen cold-start, latency, throughput, memory, and failure behavior;
- prove a real Companion worker registration, health report, disconnect fallback, and reconnect path;
- observe quota warnings and hard stops with production-like traffic;
- approve the capability-manifest route change from `shadow` only after those gates pass.
