"""Container smoke test: validates health and a real local WAV response."""
import json
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080").rstrip("/")
with urllib.request.urlopen(BASE + "/health", timeout=5) as response:
    health = json.loads(response.read())
if health.get("ok") is not True or health.get("model") != "kokoro-82m-onnx":
    raise SystemExit("Kokoro health check did not report the expected model")
request = urllib.request.Request(
    BASE + "/v1/audio/speech",
    data=json.dumps({"input": "Apollo speech worker ready.", "voice": "af_heart"}).encode(),
    headers={"Content-Type": "application/json", "Accept": "audio/wav"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=30) as response:
    audio = response.read()
    if response.status != 200 or not response.headers.get("Content-Type", "").startswith("audio/wav"):
        raise SystemExit("Kokoro did not return WAV audio")
if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
    raise SystemExit("Kokoro returned an invalid WAV container")
print(f"Kokoro smoke test passed: {len(audio)} bytes of WAV audio")
