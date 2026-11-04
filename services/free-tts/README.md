# Private Kokoro CPU speech service

This service ports the existing StreamWeaver free-voice worker and implements the exact local API consumed by `StellarSpeechProvider`:

- `GET /health`: model-ready probe, no request text or secrets.
- `POST /v1/audio/speech`: authenticated Kokoro synthesis, returns PCM WAV.

The service binds to the container network only. It requires `KOKORO_SERVICE_TOKEN` (32+ characters) and compares the full bearer value in constant time. It never logs request bodies or credentials. Inference is serialized, uses two ONNX CPU threads, and returns HTTP 429 while busy.

## Model and dependency provenance

- `kokoro-onnx==0.4.9`, `onnxruntime==1.22.1`, `soundfile==0.13.1` and `numpy==2.2.6` are pinned to the donor worker stack.
- The build downloads the upstream `model-files-v1.0` ONNX model and voice pack, then verifies their SHA-256 hashes before packaging them. Model weights are not committed to Git.
- Kokoro-ONNX is MIT-licensed; the Kokoro model is Apache-2.0. See the upstream [Kokoro ONNX release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0) and [model/package license notes](https://pypi.org/project/kokoro-onnx/).

## Apollo configuration

Set `STELLAR_KOKORO_URL=http://kokoro:8080` and `STELLAR_KOKORO_AUTH_TOKEN` on the Stellar worker. Set the same token as `KOKORO_SERVICE_TOKEN` on this service. The hostname `kokoro` is accepted only as an internal service name by Stellar's URL validator. Do not publish port 8080 on the host or route it through Caddy.

Kokoro supplies speech synthesis only. Stellar's chat worker still requires a separately configured inference provider origin or API key; this image does not provide a paid chat model or transcription service.
