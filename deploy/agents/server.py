"""Private Fly HTTP entrypoint for the pinned Athena/Stella runner."""
import hmac
import json
import os
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, "/app")
from openai_runner import SisterRunner, package_path

TOKEN = os.environ["AGENT_SERVICE_TOKEN"]
MODEL = os.environ.get("OPENAI_CHAT_MODEL", "gpt-4.1-mini")
ROOT = Path("/opt/agents")
RUNNER = SisterRunner(package_path(ROOT), MODEL, os.environ["OPENAI_API_KEY"])

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self.reply(200, {"status": "ok", "package_version": RUNNER.manifest["version"], "model": MODEL})

    def do_POST(self):
        if self.path != "/v1/respond":
            self.send_error(404)
            return
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            self.reply(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 65536:
                raise ValueError("Request size must be between 1 and 65536 bytes")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("JSON object required")
            persona, message = data.get("persona"), data.get("message")
            context, history = data.get("context") or {}, data.get("history") or []
            if not isinstance(context, dict) or not isinstance(history, list) or len(history) > 20:
                raise ValueError("Invalid context or history")
            # The caller is an authenticated host. Tool RPC remains disabled until
            # the host supplies its real SPMT transport; never advertise phantom tools.
            result = RUNNER.run(persona, message, context=context, history=history)
            self.reply(200, result)
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            self.reply(400, {"error": str(exc)})
        except (OSError, RuntimeError):
            self.reply(502, {"error": "Upstream agent call failed"})

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Do not log prompts, conversation content, or authorization headers.
        print("agent_http", self.address_string(), format % args, flush=True)

class PrivateServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6

if __name__ == "__main__":
    PrivateServer(("::", 8080), Handler).serve_forever()
