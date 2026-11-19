# Stellar Core

**Workspace:** @spmt/stellar-core  
**Location:** apps/stellar-core  
**Runtime entrypoint:** src/worker-start.ts → dist/worker-start.js  
**Role:** persona-neutral assistant execution, private conversation context, research, memory/privacy, speech synthesis/transcription and worker orchestration. Stella is the default public community persona; Athena is a separate configured voice/persona choice.

## 1. Product responsibility

Stellar Core provides the shared AI execution capability used by first-party apps. It accepts typed assistant requests, creates durable SPMT execution jobs, routes to a configured provider chain, returns bounded results, and applies explicit privacy/retention behavior.

It is not a user-facing chat app and does not own app-specific product commands. Apps such as SpaceMountain, StreamWeaver, HearMeOut, Companion and MountainView invoke Stellar through the SPMT contract; they retain their own workflows and persona presentation.

## 2. Runtime modules

| Module | Responsibility |
|---|---|
| src/index.ts | Stellar runtime, manifest, catalog registration and public exports |
| src/contracts.ts | Chat capability/request/result contracts |
| src/worker-start.ts | Worker bootstrap, provider configuration, speech/research workers and SPMT token setup |
| src/worker.ts | Durable chat job worker and OpenAI-compatible provider adapter |
| src/chat-chain.ts | Hosted provider chain and failover order |
| src/private-assistant.ts | User-private conversation thread, summary and note orchestration |
| src/assistant-store.ts | Private assistant thread, notes and preferences persistence |
| src/public-memory.ts | Public/community memory behavior and retrieval |
| src/privacy.ts | User export/delete and retention enforcement |
| src/research.ts and research-packs.ts | Search provider integration, research context and curated packs |
| src/openai-tool-author.ts | Tool/structured output authoring support |
| src/speech-provider.ts | TTS/STT provider adapters, voice selection and failover |
| src/speech-worker.ts | Durable speech synthesis/transcription job worker |
| src/speech-voices.ts | Canonical voice catalog and voice metadata |
| src/speech-presence.ts | Speech capability and provider presence projection |

## 3. Chat execution flow

1. An app submits a typed assistant invocation with tenant, user/caller identity, request ID, idempotency key, conversation/surface context and privacy preference.
2. Stellar validates the request and creates a durable execution job owned by stellar-core.
3. A healthy worker claims the job using its configured execution target and worker credential.
4. The provider chain skips providers without configured credentials and tries the configured order.
5. The worker applies bounded prompts, tool/research context and continuation behavior.
6. Result text and usage are stored in the job result with user/tenant attribution.
7. The calling app polls or receives the result through the SPMT contract.

The app must not claim inference is available unless a fresh healthy worker is registered for the configured execution target.

## 4. Provider chain and model configuration

The default hosted failover order is Gemini, OpenAI, Together, Groq, OpenRouter and Cloudflare Workers AI. A provider is skipped unless its API key and required model/config are present. The worker can also accept a configured internal OpenAI-compatible endpoint.

Relevant configuration variables include:

- OPENAI_API_KEY and OPENAI_CHAT_MODEL;
- GEMINI_API_KEY and GEMINI_CHAT_MODEL;
- TOGETHER_API_KEY and TOGETHER_CHAT_MODEL;
- GROQ_API_KEY and GROQ_CHAT_MODEL;
- OPENROUTER_API_KEY and OPENROUTER_CHAT_MODEL;
- CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and CLOUDFLARE_CHAT_MODEL;
- STELLAR_PROVIDER_ORIGIN and STELLAR_PROVIDER_MODEL for an internal OpenAI-compatible endpoint;
- STELLAR_WORKER_CREDENTIAL, STELLAR_WORKER_ID, STELLAR_EXECUTION_TARGET and SPMT_ORIGIN.

The current worker bootstrap defaults STELLAR_EXECUTION_TARGET to sprite. Hostless must explicitly set it to hosted; do not let a missing variable silently select a retired Sprite execution path. The shared ExecutionTargetV1 enum still includes sprite/fly compatibility values and needs a coordinated migration.

No local Qwen model is provisioned for Apollo. Do not launch or wait for Qwen. The local OpenAI-compatible provider is optional and must be explicitly configured; the default path is the hosted provider chain.

## 5. Speech and voice

Speech is a separate capability from chat inference. The worker supports configured Deepgram/EdenAI transcription/speech paths and an internal Kokoro endpoint.

Relevant settings:

- DEEPGRAM_API_KEY
- EDENAI_API_KEY
- STELLAR_KOKORO_URL
- STELLAR_KOKORO_AUTH_TOKEN
- SPMT_SPEECH_OUTBOUND_ENABLED
- SPMT_OUTBOUND_MODE
- STELLAR_BRAVE_SEARCH_CREDENTIAL for research/search support

Kokoro requires an internal origin and a 32+ character service token. The provider returns a canonical voice catalog; failover must not silently change the selected speaker. No paid voice should be silently selected.

A configured provider is not accepted until actual browser output is audible and transcription is verified in the intended client path. Do not infer audio success from a job status alone.

## 6. Privacy and data ownership

Stellar's private assistant context is scoped by tenant and user. It is not shared persona memory and must not be mixed with another user's conversation.

Current policy constants define:

- raw request/job data retention: 7 days;
- ephemeral/do-not-remember context: 1 hour;
- metadata retention: 30 days.

The privacy service supports user export and deletion of assistant context and Stellar-owned jobs. Keep deletion and export behavior aligned with all backing stores and retention policies.

- SPMT owns identity, tenant membership, provider grants and platform execution jobs.
- Stellar owns private assistant threads/notes/preferences, research context and speech execution logic.
- Product apps own their product state and persona configuration.
- Provider credentials stay in the worker environment or SPMT grant broker, never in prompts or browser state.

## 7. Build and validation

From repository root:

    npm ci
    npm run build
    npm run typecheck
    npm test
    npm run test:offline

Package-local build:

    npm run build --workspace @spmt/stellar-core

Worker start:

    npm run start:worker --workspace @spmt/stellar-core

Focused tests cover provider-chain order/failover, worker idempotency, tool/research handling, private assistant context, privacy export/delete, speech provider selection, voice catalog and worker job behavior.

## 8. Security and reliability

- Validate tenant, user, caller app, capability and idempotency key.
- Use durable SPMT jobs with leases, heartbeats and bounded retries.
- Never place API keys or worker credentials in prompts, job results or browser code.
- Bound prompt/context size, completion tokens, continuation attempts, research results and provider timeouts.
- Redact secrets and sensitive raw context from logs.
- Respect remember/do-not-remember policy on every invocation.
- Delete user-owned private context and Stellar jobs through the privacy service.
- A provider outage should mark inference unavailable or fail over; it must not crash the shell.
- Report worker readiness only when a configured provider is actually usable.

## 9. Performance guidance

- Keep provider initialization and health checks outside each request path.
- Bound provider-chain retries and per-provider timeouts.
- Avoid loading large research packs unless the invocation requests them.
- Limit conversation context to a bounded recent window and compact summaries only through durable jobs.
- Cache only non-sensitive provider metadata; do not cache user conversation content across tenants.
- Keep speech/media bytes in the worker/media path rather than returning large blobs through the chat API.
- Measure provider latency, tokens, failure rates, job queue depth, speech start latency and memory.

## 10. Acceptance checklist

- [ ] Hostless worker registers as hosted on the intended node.
- [ ] At least one configured hosted chat provider reports healthy.
- [ ] Assistant requests create idempotent durable jobs and return bounded results.
- [ ] Provider failover skips missing keys and classifies retryable failures correctly.
- [ ] No local Qwen process or dependency is required.
- [ ] Private context remains tenant/user isolated and obeys remember preference.
- [ ] Export/delete removes the user's Stellar context and jobs.
- [ ] Kokoro or other configured speech is audible in the actual app/browser.
- [ ] Speech failover preserves selected speaker identity.
- [ ] Provider restart/recovery does not duplicate responses or speech output.
