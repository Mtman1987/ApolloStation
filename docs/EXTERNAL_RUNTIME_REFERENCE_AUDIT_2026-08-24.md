# External Runtime Reference Audit and CPU AI Trial Plan

Updated: 2026-08-24

Status: implementation reference and benchmark plan for isolated Green only. This document does not select a production provider, authorize production data, add a dependency, or supersede `DECISIONS.md`.

## Purpose

This audit turns thirteen uploaded reference repositories into a bounded adoption plan for rebuilding the ecosystem. The sources are references, not donor authorities. Their code must not be copied unless its license and security posture permit it.

The plan preserves the accepted boundary:

- **Stellar Core** is the persona-neutral AI, routing, memory, tool, job, and audit subsystem.
- **Stella** is the default Community Assistant presentation using Stellar Core.
- **Coder** is the owner/developer work surface backed by durable jobs and isolated Sprites.
- Tenant personas such as Athena remain tenant-app configurations and do not become ecosystem infrastructure.
- Provider and model controls remain owner/entitlement scoped under D-20; ordinary users do not see raw provider, model, or fallback-order controls.

## Reference disposition

| Reference | Adopted lesson | Apollo target | Disposition |
|---|---|---|---|
| `sprites-agent-plugin` | Hosted Sprites MCP with browser OAuth, restricted connector policy, checkpoints, services, network policy, and no pasted long-lived API token | public developer tools and owner Coder control plane | Adapt contract and OAuth flow |
| `sprites-openrouter-sdk` | Workspace-scoped exec/read/write/patch/search/process tools, output limits, timeouts, serialized mutation, explicit approval, checkpoint/restore, and close-versus-destroy semantics | Coder worker adapter | Adapt interfaces; do not make experimental package a hard dependency |
| `wisp` | Durable per-chat model and exec session IDs, streamed tool events, reconnect/reattach, exact interrupt, automatic checkpoints after mutations, and GitHub device flow | Coder job/session state machine | Port concepts, not Swift UI or permissive execution flags |
| `sprites-cortex-plugin` | Exact-target destructive gates and a bounded long-job runner that keeps verbose output in the Sprite | Coder approval and evidence policy | Adapt as enforceable server policy plus UI approval; a prompt hook alone is insufficient |
| `sprites-deepseek-plugin` | OAuth bridge packaging for clients without native MCP OAuth | external developer compatibility | Reference only; this is not a DeepSeek model runtime |
| `openai-agents-python` | Sessions, tools, guardrails, human approval, tracing, sandbox agents, interruption/resume, and provider-neutral orchestration | Stellar Core runner | Adapt architecture; choose the runtime language only after integration testing |
| `convos` | Persistent IRC connections, conversation/participant state, unread and notification state, IRCv3 typing/reply/reaction tags, per-user WebSocket events, reconnect, history, and OIDC | canonical Commlink | Adapt data/event contracts. Convos is an IRC client/bouncer, not an IRC server |
| `chatgpt-mattermost-bot` | Mention/thread participation, typing indicators, bounded context, and plugin dispatch | Stella inside Commlink | Pattern only; the included SDK and secret logging are obsolete/unsafe |
| `fly-autoscaler` | Prometheus/queue-depth expressions controlling created and started Machine counts | inference and Coder worker pools | Adapt after bounding retries, cooldown, seed Machine, cost, and drain behavior |
| `fly-log-shipper` | Organization log intake through Fly NATS and Vector sinks | redacted Mission Control evidence | Reference only until upstream license is verified |
| `sprite-voice-bridge` | Browser capture, 16 kHz mono PCM, WebSocket transport, bounded FIFO backlog, and virtual ALSA capture | Coder voice and selected Stella transport components | Split adoption; see voice section |
| `openclaw-sprite-builder` | SSE progress and idempotent service setup | provisioning UX only | Do not reuse implementation: unsafe shell interpolation, credential persistence, and missing license file |
| `middleman-syntax` | Ruby static-site syntax highlighting | none | Do not adopt |

### License boundary

The audited archives carry MIT licenses except `fly-autoscaler` (Apache-2.0) and `convos` (Artistic-2.0). The `fly-log-shipper` archive has no license file. The OpenClaw README says MIT, but its archive has no license file. Missing or unclear licenses mean architecture reference only until verified. Any copied MIT or Apache code must retain required notices. Convos should be integrated behind a clean adapter or used as a service unless the Artistic-2.0 modification/distribution obligations are reviewed.

## CPU-only LLM candidates

There is no universal “most correct” model. Correctness depends on task, quantization, prompt format, retrieval quality, tool results, and post-answer verification. Green should compare candidates on ecosystem-owned tests instead of selecting from a single vendor benchmark.

### Recommended trial order

1. **gpt-oss-20b, native MXFP4 — strongest first reasoning/tool challenger**
   - 21B total and 3.6B active parameters.
   - Official documentation states it fits in 16 GB memory, supports 128K context, adjustable reasoning effort, structured output, and tool use.
   - Best candidate for owner operations, tool planning, diagnosis, and questions requiring deliberate reasoning.
   - It must use the Harmony prompt format correctly.

2. **Qwen3-30B-A3B-Instruct-2507, reproducible Q4-class quantization — preferred Stella default candidate**
   - 30.5B total with about 3.3B active parameters.
   - Strong official results for general knowledge, instruction following, math, coding, writing, multilingual work, and long context.
   - Better fit for the existing Qwen preference, community conversation, multilingual users, and Stella’s general assistant role.
   - Quantize official Qwen weights in the controlled build pipeline and record source revision, quantizer revision, parameters, checksum, and evaluation results. Do not quietly depend on an arbitrary community quantization.

3. **Qwen3-Coder-30B-A3B-Instruct — local Coder challenger**
   - Evaluate only for code work. Coder may still route difficult jobs to an approved hosted model when the local result fails tests or confidence gates.

4. **Smaller degraded-mode model**
   - Keep a smaller Qwen model only for health messages, classification, command routing, summarization, and graceful degradation. It must never pretend to have completed tools or coding work that did not run.

The intended router is therefore not one model forced onto every task:

| Work | First local candidate | Fallback condition |
|---|---|---|
| Stella conversation/community help | Qwen3-30B-A3B-Instruct-2507 | failed verification, unavailable local capacity, unsupported modality |
| Owner operational reasoning | gpt-oss-20b | tool/result validation failure or task exceeds bounded local latency |
| Coder | Qwen3-Coder-30B-A3B-Instruct | failing tests, unsupported repository/tool workload, owner-selected hosted route |
| Classification/routing/summaries | measured smaller Qwen | low confidence or safety escalation |

### Fly Machine shape and lifecycle

CPU inference must use **performance CPUs**. Fly documents that shared CPUs receive a 6.25% baseline quota per period while performance CPUs receive the full period. Shared Machines are suitable for gateways and light jobs, not sustained token generation.

Initial benchmark shapes:

- `performance-4x`, 32 GB RAM for Qwen3 30B-A3B Q4-class trials.
- A 16–24 GB performance-CPU shape for gpt-oss-20b trials, subject to actual KV-cache and runtime headroom.
- One request at a time per CPU model until load tests establish a safe concurrency above one.
- Keep model artifacts on a versioned persistent volume or image cache and verify their checksum before serving.
- Use a private Flycast service; only Stellar Core may invoke inference.
- Use stop/start, not suspend, for these large-memory workers. Fly discourages suspend above 2 GB.
- Keep zero or one warm worker only from measured latency/cost evidence. Cold start includes model loading, not merely the Machine boot.
- Scale from queue depth, active generations, time-to-first-token, memory pressure, and job age. Enforce minimum, maximum, cooldown, drain, per-plan credit, and daily cost ceilings.

Fly’s metrics autoscaler clones an existing Machine and does not scale from zero created Machines. Maintain a stopped seed Machine and bound every creation retry.

## Correctness and RAG

A larger model alone will not make Stella reliably correct about this ecosystem. The correctness path is:

1. retrieve only authorized current documents and state;
2. rerank the candidates;
3. answer with source identifiers and timestamps;
4. use live tools for mutable facts;
5. refuse or disclose uncertainty when evidence is missing;
6. run task-specific verification before a tool result or deployment is described as complete.

Recommended CPU retrieval candidates:

- `Qwen3-Embedding-0.6B` for multilingual text/code embeddings;
- `Qwen3-Reranker-0.6B` for second-stage relevance scoring;
- a versioned `RetrievalStoreV1` contract so storage can begin economically and later move without changing Stella;
- PostgreSQL with `pgvector` is an eligible implementation if the canonical storage decision moves there, but it is not required by this document.

Every chunk must carry tenant, app, visibility, document revision, source path/URL, created/updated time, retention class, and deletion state. Authorization filters apply before retrieval and again before response composition. Public community knowledge, private user memory, owner operations, and tenant-persona memory must remain separate indexes or enforced partitions. Raw chat history is not automatically RAG knowledge.

The evaluation set must include:

- ApolloStation architecture and current-state questions;
- live-app status questions that require tools rather than stale RAG;
- cross-tenant exfiltration attempts;
- contradictory/obsolete donor documents;
- command/tool selection;
- Commlink conversation behavior;
- coding fixes with executable tests;
- hallucination and citation accuracy;
- latency, memory, tokens/second, cost, and cold-start measurements.

No model becomes the default until it passes the owner/test-tenant suite and beats the current baseline on weighted correctness without violating latency and cost bounds.

## Voice bridge: Coder versus Stella

The uploaded Sprite Voice Bridge is **not inherently Coder-only**. It creates a normal ALSA capture device, so any process in that Sprite that reads the default microphone can consume the audio.

### Coder

For Coder, the full design is useful:

`browser microphone -> 16 kHz PCM WebSocket -> FIFO -> PulseAudio/ALSA -> coding agent voice input`

Retain its real-time drain/backlog protection and origin allowlist, but place it behind Apollo authentication. Do not consume the only public Sprite HTTP slot if the Coder web surface already uses it; mount the WebSocket route in the canonical server or use a separate private voice service.

### Stella

For Stella, the bridge is only the microphone transport. It does not provide:

- speech-to-text;
- voice-activity detection;
- turn detection or interruption/barge-in;
- Stella/tenant authorization;
- conversation memory;
- text-to-speech;
- return audio;
- echo cancellation;
- LiveKit/Discord routing;
- multi-user room ownership.

The Stella path should reuse the browser capture/resampling, WebSocket lifecycle, and backpressure ideas, then connect them to the canonical voice pipeline:

`authenticated browser/LiveKit/Discord audio -> VAD -> STT -> Stellar Core/Stella -> tool/RAG verification -> TTS -> originating surface`

For ordinary web Stella, bypass the virtual ALSA/FIFO layer and stream audio directly into the voice gateway. Use the ALSA bridge only when the downstream process specifically expects a local microphone device. Voice settings such as local volume, microphone selection, noise suppression, push-to-talk, and echo cancellation remain device-local; identity, grants, conversation state, and audit remain canonical.

## Implementation slices

1. **Coder runtime contract**
   - Add a Sprite adapter with bounded tools, serialized mutations, exact approvals, checkpoint-before-risk, durable sessions, reattach, exact cancel, bounded output, and truthful job states.
   - Use hosted Sprites MCP OAuth for human/developer clients. The Rotator’s service identity remains server-side and scope-limited.

2. **Commlink runtime**
   - Implement a provider-neutral connection/conversation/event contract using Convos as the IRC behavior reference.
   - If the ecosystem hosts IRC, deploy and operate a separate IRC server; do not mistake the Convos client layer for the server.
   - Map Google OIDC users into canonical SPMT identities. Never copy the “first login becomes admin” rule; the owner identity is explicit.

3. **Stellar Core inference and RAG trial**
   - Add provider adapters, the private llama.cpp-compatible worker contract, durable jobs, streaming, health, usage accounting, fallback reasons, retrieval/citation envelopes, and the benchmark harness.
   - Keep owner/provider controls out of ordinary-user views.

4. **Operations**
   - Send redacted runtime/job evidence to Mission Control.
   - Add queue/cost metrics and bounded autoscaling only after single-worker correctness and cold-start evidence pass.

5. **Voice**
   - First wire Stella text correctly.
   - Add authenticated browser voice transport.
   - Then add LiveKit/Discord routes and canonical TTS without creating a second memory or persona authority.

## Primary references

- Fly CPU performance: https://fly.io/docs/machines/cpu-performance/
- Fly Machine sizing: https://fly.io/docs/machines/guides-examples/machine-sizing/
- Fly metric autoscaling: https://fly.io/docs/launch/autoscale-by-metric/
- Fly autostop/autostart: https://fly.io/docs/launch/autostop-autostart/
- Fly suspend limitations: https://fly.io/docs/reference/suspend-resume/
- gpt-oss: https://openai.com/index/introducing-gpt-oss/
- gpt-oss-20b model: https://huggingface.co/openai/gpt-oss-20b
- Qwen3-30B-A3B-Instruct-2507: https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507
- Qwen3 GGUF/runtime reference: https://huggingface.co/Qwen/Qwen3-30B-A3B-GGUF
- Qwen3 retrieval family: https://huggingface.co/Qwen/Qwen3-Reranker-0.6B
- pgvector filtering/indexing: https://github.com/pgvector/pgvector
