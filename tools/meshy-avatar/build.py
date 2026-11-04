#!/usr/bin/env python3
"""Generate one textured GLB from a repository-local PNG/JPEG using Meshy.

Uses only Python's standard library. Never prints the API key or task response
bodies. Intended for a manually dispatched, isolated GitHub Actions job.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_MODEL_BYTES = 64 * 1024 * 1024
API_ROOT = "https://api.meshy.ai/openapi/v1/image-to-3d"
ASSET_HOST = "assets.meshy.ai"


def fail(message: str) -> "NoReturn":
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def request(url: str, *, method: str = "GET", headers: dict | None = None,
            body: bytes | None = None, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = response.read(MAX_MODEL_BYTES + 1)
            if len(data) > MAX_MODEL_BYTES:
                fail("Response exceeded the configured size limit")
            return data
    except urllib.error.HTTPError as exc:
        # Do not dump response body; provider responses may contain sensitive data.
        fail(f"Meshy request returned HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError) as exc:
        fail(f"Network request failed ({type(exc).__name__}); retry the workflow")


def api_json(url: str, key: str, *, method: str = "GET", payload: dict | None = None) -> dict:
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload, separators=(",", ":")).encode()
    raw = request(url, method=method, headers=headers, body=body)
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("Meshy returned an invalid JSON response")
    if not isinstance(value, dict):
        fail("Meshy returned an unexpected response shape")
    return value


def main() -> None:
    key = os.environ.get("MESHY_API_KEY", "").strip()
    if not key:
        fail("Repository secret MESHY_API_KEY is not configured")

    source_text = os.environ.get("SOURCE_IMAGE_PATH", "").strip()
    if not source_text:
        fail("Provide source_image_path when dispatching this workflow")
    source_path = Path(source_text)
    if source_path.is_absolute() or ".." in source_path.parts:
        fail("Source image path must be repository-relative and cannot traverse directories")
    if not source_path.is_file():
        fail(f"Source image does not exist in this repository: {source_path}")
    suffix = source_path.suffix.lower()
    content_type = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(suffix)
    if not content_type:
        fail("Source image must be PNG or JPEG")
    source = source_path.read_bytes()
    if not source or len(source) > MAX_SOURCE_BYTES:
        fail("Source image must be between 1 byte and 8 MiB")

    image_data = f"data:{content_type};base64," + base64.b64encode(source).decode("ascii")
    created = api_json(API_ROOT, key, method="POST", payload={
        "image_url": image_data,
        "model_type": "standard",
        "ai_model": "latest",
        "ultra_mode": True,
        "should_texture": True,
        "enable_pbr": True,
        "texture_resolution": "4k",
        "should_remesh": False,
        "image_enhancement": False,
        "target_formats": ["glb"],
    })
    task_id = str(created.get("result", ""))
    if not re.fullmatch(r"[A-Za-z0-9-]{8,128}", task_id):
        fail("Meshy did not return a valid task ID")
    print(f"Meshy task accepted: {task_id}")

    for attempt in range(180):
        task = api_json(f"{API_ROOT}/{urllib.parse.quote(task_id, safe='')}", key)
        status = str(task.get("status", "")).upper()
        if status == "SUCCEEDED":
            urls = task.get("model_urls")
            model_url = urls.get("glb") if isinstance(urls, dict) else None
            parsed = urlparse(str(model_url or ""))
            if parsed.scheme != "https" or parsed.hostname != ASSET_HOST or parsed.username or parsed.password:
                fail("Meshy returned an unexpected GLB download URL")
            model = request(parsed.geturl(), headers={"Accept": "model/gltf-binary"})
            if not model or len(model) > MAX_MODEL_BYTES or model[:4] != b"glTF":
                fail("Downloaded model is empty, too large, or not a GLB container")
            declared = int.from_bytes(model[8:12], "little") if len(model) >= 12 else 0
            if declared != len(model):
                fail("Downloaded GLB header length does not match its file size")
            output = Path(os.environ.get("OUTPUT_PATH", "output/avatar.glb"))
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(model)
            print(f"Generated and validated GLB: {output} ({len(model)} bytes)")
            return
        if status in {"FAILED", "CANCELED", "CANCELLED"}:
            error = task.get("task_error")
            message = error.get("message") if isinstance(error, dict) else ""
            fail("Meshy task failed: " + re.sub(r"[\r\n]+", " ", str(message or status))[:240])
        if status not in {"PENDING", "IN_PROGRESS", "PROCESSING", ""}:
            fail(f"Unexpected Meshy task status: {status[:40]}")
        if attempt and attempt % 15 == 0:
            print(f"Still processing (poll {attempt + 1}/180)")
        time.sleep(2)

    fail(f"Meshy task {task_id} exceeded the 6-minute polling window; inspect task status before retrying")


if __name__ == "__main__":
    main()
