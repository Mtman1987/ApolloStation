# Stella text AI failover chain

Code: `apps/stellar-core/src/chat-chain.ts`, wired in `worker-start.ts`. Tests: `tests/stellar-ai-chain.test.mjs`.

## How it works
- Providers are tried in order. A failed call (any HTTP error, timeout, empty or cut-off reply) moves to the next provider. The failed provider sits out for 60 seconds.
- A slot with no key is skipped silently. Nothing needs to be configured to leave a slot empty.
- The worker logs the active order at startup: `Stellar chat providers in failover order: ...`
- Each reply records which provider answered (`provider` field on the completion).

## Order and env names
Default order: `gemini, openai, together, groq, openrouter, cloudflare`. Override with `STELLAR_AI_CHAIN`.

| Slot | Secret(s) | Optional model override | Default model (verify before prod) |
|---|---|---|---|
| gemini | `GEMINI_API_KEY` | `GEMINI_CHAT_MODEL` | `gemini-2.5-flash` |
| openai | `OPENAI_API_KEY` | `OPENAI_CHAT_MODEL` | `gpt-5.6-luna` |
| together | `TOGETHER_API_KEY` | `TOGETHER_CHAT_MODEL` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| groq | `GROQ_API_KEY` | `GROQ_CHAT_MODEL` | `llama-3.3-70b-versatile` |
| openrouter | `OPENROUTER_API_KEY` | `OPENROUTER_CHAT_MODEL` | `meta-llama/llama-3.3-70b-instruct:free` |
| cloudflare | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | `CLOUDFLARE_CHAT_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |

Adding a slot later: create the GitHub secret, then add it to the worker's environment. No code change.

## Current state
- Half chain for testing: `gemini` and `openai`. Together, Groq, OpenRouter and Cloudflare keys are not created yet.
- `STELLAR_PROVIDER_ORIGIN` (local OpenAI-compatible server) is still supported and is tried last.
- Speech (Kokoro, Deepgram, EdenAI) is unchanged; it already had its own failover in `speech-provider.ts`.

## Not verified
- The model IDs above were not checked against each provider's live catalog. Confirm each before production.
- The stellar-core worker's deploy path (which env it receives) is not in the Hostless workflows in this repo. Confirm where those secrets get injected before relying on them in production.
