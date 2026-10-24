#!/usr/bin/env python3
"""Upload rendered PNG views to a Discord webhook and save returned CDN URLs."""
import json, os, pathlib, sys, time
import requests

if len(sys.argv) != 3:
    raise SystemExit("Usage: publish_avatar_views.py IMAGE_DIR OUTPUT_JSON")
webhook = os.environ.get("DISCORD_WEBHOOK", "").strip()
if not webhook:
    raise SystemExit("Missing repository secret DISCORD_HEAD_UPLOAD_WEBHOOK")
if not webhook.startswith("https://discord.com/api/webhooks/"):
    raise SystemExit("Webhook must be a Discord webhook URL")

image_dir = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
images = sorted(image_dir.glob("*.png"))
if len(images) != 10:
    raise SystemExit(f"Expected exactly 10 PNGs, found {len(images)}")

results = []
for index, path in enumerate(images, 1):
    # Upload one image per request to stay within Discord request-size limits.
    with path.open("rb") as image:
        response = requests.post(
            webhook + ("&" if "?" in webhook else "?") + "wait=true",
            data={"content": f"Avatar head reference view {index}/10 — {path.name}"},
            files={"files[0]": (path.name, image, "image/png")},
            timeout=90,
        )
    if response.status_code not in (200, 201):
        raise SystemExit(f"Discord upload failed for {path.name}: HTTP {response.status_code}: {response.text[:400]}")
    payload = response.json()
    attachments = payload.get("attachments", [])
    if len(attachments) != 1 or not attachments[0].get("url"):
        raise SystemExit(f"Discord did not return one attachment URL for {path.name}")
    results.append({
        "index": index,
        "filename": path.name,
        "message_id": payload.get("id"),
        "url": attachments[0]["url"],
    })
    print(f"UPLOADED {index}/10 {path.name}: {attachments[0]['url']}")
    time.sleep(0.35)

output.write_text(json.dumps({
    "source": "original textured GLB rendered in Blender",
    "count": len(results),
    "images": results,
}, indent=2) + "\n", encoding="utf-8")
print(f"Saved {len(results)} image URLs to {output}")
