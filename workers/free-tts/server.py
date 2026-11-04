"""Private local Kokoro ONNX speech worker; no external API or request logging."""
import io
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

MODEL = os.getenv("MODEL_PATH", "/opt/kokoro-models/kokoro.onnx")
VOICES_PATH = os.getenv("VOICES_PATH", "/opt/kokoro-models/voices.bin")
HOST = os.getenv("KOKORO_BIND_HOST", "0.0.0.0")
PORT = int(os.getenv("KOKORO_PORT", "8080"))
CPU_THREADS = max(1, min(4, int(os.getenv("KOKORO_CPU_THREADS", "2"))))
MAX_TEXT_CHARS = 2000
MAX_BODY_BYTES = 16384
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MODEL_ID = "kokoro-82m-onnx"
VOICES = {
    "af_heart", "af_bella", "af_nicole", "af_kore", "af_sarah", "af_aoede",
    "af_alloy", "af_jessica", "af_nova", "af_river", "af_sky", "am_michael",
    "am_puck", "am_fenrir", "am_adam", "am_echo", "am_eric", "am_liam",
    "am_onyx", "am_santa", "bf_emma", "bf_alice", "bf_isabella", "bf_lily",
    "bm_george", "bm_daniel", "bm_fable", "bm_lewis",
}

options = ort.SessionOptions()
options.intra_op_num_threads = CPU_THREADS
options.inter_op_num_threads = 1
options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
session = ort.InferenceSession(MODEL, sess_options=options, providers=["CPUExecutionProvider"])
engine = Kokoro.from_session(session, VOICES_PATH)
inference_lock = threading.Lock()
# Do not advertise ready until the model and voice pack can synthesize.
engine.create("Voice ready.", voice="af_heart", lang="en-us")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
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
            return self.reply(404, b'{"error":"not_found"}')
        body = json.dumps({"ok": True, "model": MODEL_ID, "cpuThreads": CPU_THREADS, "voiceCount": len(VOICES)}).encode()
        self.reply(200, body)

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self.reply(404, b'{"error":"not_found"}')
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY_BYTES:
                return self.reply(413, b'{"error":"invalid_body_size"}')
            payload = json.loads(self.rfile.read(size))
            text = payload.get("input", "")
            voice = payload.get("voice", "af_heart")
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS or voice not in VOICES:
                return self.reply(400, b'{"error":"invalid_text_or_voice"}')
        except (ValueError, AttributeError, TypeError):
            return self.reply(400, b'{"error":"invalid_request"}')
        if not inference_lock.acquire(blocking=False):
            return self.reply(429, b'{"error":"worker_busy"}')
        try:
            language = "en-gb" if voice.startswith(("bf_", "bm_")) else "en-us"
            samples, rate = engine.create(text.strip(), voice=voice, lang=language)
            audio = io.BytesIO()
            sf.write(audio, samples, rate, format="WAV", subtype="PCM_16")
            payload = audio.getvalue()
            if len(payload) > MAX_AUDIO_BYTES:
                return self.reply(413, b'{"error":"audio_too_large"}')
            self.reply(200, payload, "audio/wav")
        except Exception:
            self.reply(503, b'{"error":"voice_temporarily_unavailable"}')
        finally:
            inference_lock.release()


class Server(ThreadingHTTPServer):
    address_family = socket.AF_INET
    daemon_threads = True

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(20)
        return connection, address


if __name__ == "__main__":
    print(f"{MODEL_ID} ready; CPU threads={CPU_THREADS}; port={PORT}", flush=True)
    Server((HOST, PORT), Handler).serve_forever()
