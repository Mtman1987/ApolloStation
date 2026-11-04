# Local Kokoro speech worker

This is the no-paid-provider TTS backend for Stellar Core. It runs the pinned
Kokoro ONNX model on CPU, serves WAV audio over a private HTTP endpoint, and
does not call Deepgram, EdenAI, OpenAI, or another hosted speech API.

## Image and runtime

Build the image with:

```sh
docker build -f workers/free-tts/Dockerfile -t apollo-kokoro-tts .
```

The image downloads the model and voice pack **during image build**, verifies
both SHA-256 digests, installs pinned Python dependencies, and runs as an
unprivileged user. Runtime startup performs a short model inference before the
health endpoint reports ready. There is no dependency installation or model
download at runtime.

Run it on the application's private container network. Do not publish port
8080 to the public host. The intended service name is `kokoro-tts`; configure
the separate Stellar speech worker with:

- `STELLAR_KOKORO_TTS_URL=http://kokoro-tts:8080`
- `SPMT_ORIGIN` pointing to the internal SPMT API
- the existing `STELLAR_WORKER_CREDENTIAL`

The speech worker reports `executionTarget=self-hosted` and only the
`stellar.speech.synthesize.v1` capability. Paid transcription remains a
separate, opt-in worker and is not required for Kokoro TTS.

## Endpoint

- `GET /health` — returns ready only after model and voice-pack initialization.
- `POST /v1/audio/speech` — JSON body `{"input":"...","voice":"af_heart"}`,
  returns 16-bit PCM WAV. Text is capped at 2,000 characters; supported voices
  are allowlisted; inference is serialized and limited to two CPU threads.

For a real endpoint test after the image is built and started:

```sh
python workers/free-tts/smoke.py http://127.0.0.1:8080
```

The smoke test verifies health and generates an actual WAV response. The CI
workflow builds and runs this image on pull requests; this repository change
does not deploy it or modify any live service.
