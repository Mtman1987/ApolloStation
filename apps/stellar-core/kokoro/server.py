"""Private local Kokoro ONNX speech service. One inference at a time, two CPU threads."""
import hmac
import io
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

VOICES = {
    "af_heart", "af_bella", "af_nicole", "af_kore", "af_sarah", "af_aoede",
    "af_alloy", "af_jessica", "af_nova", "af_river", "af_sky", "am_michael",
    "am_puck", "am_fenrir", "am_adam", "am_echo", "am_eric", "am_liam",
    "am_onyx", "am_santa", "bm_george", "bf_emma", "bf_alice", "bf_isabella",
    "bf_lily", "bm_daniel", "bm_fable", "bm_lewis",
}
AUTH_TOKEN = os.environ.get("KOKORO_AUTH_TOKEN", "")
if len(AUTH_TOKEN) < 32:
    raise RuntimeError("KOKORO_AUTH_TOKEN must contain at least 32 characters")

options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
session = ort.InferenceSession(
    os.getenv("MODEL_PATH", "/models/kokoro.onnx"),
    sess_options=options,
    providers=["CPUExecutionProvider"],
)
engine = Kokoro.from_session(session, os.getenv("VOICES_PATH", "/models/voices.bin"))
inference_lock = threading.Lock()
# Fail startup rather than advertising a ready but broken worker.
engine.create("Voice ready.", voice="af_heart", lang="en-us")


class Handler(BaseHTTPRequestHandler):
    server_version = "KokoroLocal/1"

    def log_message(self, *_):
        # Request paths, prompts and credentials must never enter logs.
        pass

    def reply(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, b'{"error":"not found"}')
        self.reply(200, b'{"ready":true,"provider":"kokoro","cpuThreads":2}')

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self.reply(404, b'{"error":"not found"}')
        supplied = self.headers.get("Authorization", "")
        expected = "Bearer " + AUTH_TOKEN
        if not hmac.compare_digest(supplied, expected):
            return self.reply(401, b'{"error":"unauthorized"}')
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384:
                return self.reply(413, b'{"error":"invalid body size"}')
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                return self.reply(400, b'{"error":"invalid request"}')
            text = payload.get("input", "")
            voice = payload.get("voice", "af_heart")
            if (
                not isinstance(text, str) or not text.strip() or len(text) > 2000
                or not isinstance(voice, str) or voice not in VOICES
            ):
                return self.reply(400, b'{"error":"invalid text or voice"}')
        except (ValueError, AttributeError, TypeError):
            return self.reply(400, b'{"error":"invalid request"}')
        if not inference_lock.acquire(blocking=False):
            return self.reply(429, b'{"error":"voice worker busy"}')
        try:
            language = "en-gb" if voice.startswith(("bf_", "bm_")) else "en-us"
            samples, rate = engine.create(text.strip(), voice=voice, lang=language)
            audio = io.BytesIO()
            sf.write(audio, samples, rate, format="WAV", subtype="PCM_16")
            body = audio.getvalue()
            if not body.startswith(b"RIFF") or len(body) > 8 * 1024 * 1024:
                return self.reply(503, b'{"error":"voice output unavailable"}')
            self.reply(200, body, "audio/wav")
        except Exception:
            self.reply(503, b'{"error":"voice temporarily unavailable"}')
        finally:
            inference_lock.release()


class Server(ThreadingHTTPServer):
    address_family = socket.AF_INET
    daemon_threads = True
    allow_reuse_address = True

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        return connection, address


if __name__ == "__main__":
    host = os.getenv("KOKORO_HOST", "0.0.0.0")
    port = int(os.getenv("KOKORO_PORT", "8080"))
    print("Kokoro ready; two CPU threads; private local service", flush=True)
    Server((host, port), Handler).serve_forever()
