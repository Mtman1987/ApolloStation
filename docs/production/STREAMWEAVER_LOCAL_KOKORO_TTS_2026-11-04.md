# Apollo Stellar local Kokoro speech — 2026-11-04

## Scope

This is the no-per-character-cost local TTS path for StreamWeaver/Stellar. It
does not enable Deepgram, EdenAI, Gemini, or any other paid inference route.
Speech synthesis and speech transcription are advertised as separate worker
capabilities: Kokoro reports TTS only; paid transcription is advertised only
when its explicit opt-in and credentials are present.

## Implementation

- `apps/stellar-core/kokoro/server.py` is an internal HTTP service using
  Kokoro ONNX CPU inference. It serializes inference, caps the session at two
  intra-op threads / one inter-op thread, rejects oversized text and request
  bodies, allowlists 28 voices, requires a 32+ character bearer token, disables
  request logging, and returns private/no-store WAV responses.
- `apps/stellar-core/kokoro/Dockerfile` builds a separate sidecar image. Python
  dependencies are pinned; model and voice artifacts are downloaded during
  image build and checked against SHA-256 digests. The image runs as UID 10001.
- `StellarSpeechProvider` accepts only an internal HTTP service address on
  port 8080 (loopback, private IPv4, or the named internal Kokoro service),
  sends the bearer token, validates WAV responses, and never falls back from a
  Kokoro voice to a paid provider.
- If the local worker is configured, the default speech voice is
  `kokoro:af_heart`. Paid speech requires
  `SPMT_SPEECH_OUTBOUND_ENABLED=1` and is still subject to
  `SPMT_OUTBOUND_MODE`; no paid credentials are required for Kokoro.
- The speech worker advertises only the capabilities it can actually serve.
  Kokoro-only workers advertise `stellar.speech.synthesize.v1`, not
  `stellar.speech.transcribe.v1`.

## Hosted container wiring

Build the sidecar image from the Apollo repository root so the Dockerfile can
copy its versioned source:

```sh
docker build -f apps/stellar-core/kokoro/Dockerfile -t apollo-stellar-kokoro:2026-11-04 .
```

Run it only on the private network shared with the Stellar worker; do not
publish port 8080 to the public ingress. Generate one random token of at least
32 characters and inject the same value into the two containers:

- Kokoro sidecar: `KOKORO_AUTH_TOKEN`
- Stellar worker: `STELLAR_KOKORO_URL=http://stellar-kokoro:8080` and
  `STELLAR_KOKORO_AUTH_TOKEN`
- Stellar worker execution target: `STELLAR_EXECUTION_TARGET=hosted`

No Deepgram or EdenAI key is needed for local TTS. Do not set
`SPMT_SPEECH_OUTBOUND_ENABLED=1` unless paid speech/transcription is separately
approved. The sidecar health route is internal and does not expose prompts or
credentials. Its POST route requires bearer authentication.

## Validation boundary

The pull-request workflow builds all TypeScript workspaces, syntax-checks the
Python service, and runs mocked Kokoro/provider, hosted-worker capability,
voice-catalog, and existing StreamWeaver regressions. It does not download model
weights, run ONNX inference, prove the container starts on a target VM, or
establish audible browser/Discord playback. Those require a configured private
hosted worker and a real WAV smoke test.

This is a GitHub-only code port. No Fly.io calls, deployments, machine changes,
secret writes, provider calls, or production tenant changes are part of it.
