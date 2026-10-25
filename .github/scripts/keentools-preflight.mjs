#!/usr/bin/env node
/**
 * Read-only-ish KeenTools preflight.
 * Validates the configured API key against the documented init endpoint but
 * deliberately DOES NOT upload images, call /process, or download a model.
 * KeenTools may create an empty avatar session as part of /init; no reconstruction
 * is started by this script.
 */
import { readFile } from "node:fs/promises";

const fail = (message) => {
  console.error(`BAD — ${message}`);
  process.exitCode = 1;
};
const pass = (message) => console.log(`GOOD — ${message}`);

try {
  const key = process.env.STREAMWEAVER_KEENTOOLS_API_KEY_SECOND;
  if (!key?.trim()) {
    fail("GitHub secret STREAMWEAVER_KEENTOOLS_API_KEY_SECOND is missing or empty.");
    process.exit();
  }
  pass("KeenTools API secret is present (value hidden).");

  const manifest = JSON.parse(await readFile(".github/data/keentools-discord-reference-upload.json", "utf8"));
  const required = [
    "01_front.png", "02_front_threequarter_left.png", "03_left.png",
    "04_rear_threequarter_left.png", "05_back.png", "06_rear_threequarter_right.png",
    "07_right.png", "08_front_threequarter_right.png", "09_front_high.png", "10_front_low.png"
  ];
  const files = (manifest.messages ?? []).flatMap(m => m.attachments ?? []);
  const byName = new Map(files.map(f => [f.filename, f]));
  if (files.length !== 10 || required.some(name => !byName.has(name))) {
    fail("Manifest must contain exactly the 10 expected reference-image filenames.");
    process.exit();
  }
  pass("Manifest contains all 10 expected image names in the reconstruction order.");

  for (const name of required) {
    const u = new URL(String(byName.get(name)?.url ?? ""));
    if (u.protocol !== "https:" || !["cdn.discordapp.com", "media.discordapp.net"].includes(u.hostname.toLowerCase())) {
      fail(`Reference URL for ${name} is not an approved HTTPS Discord CDN URL.`);
      process.exit();
    }
  }
  pass("All reference URLs use approved HTTPS Discord CDN hosts.");

  console.log("INFO — Checking KeenTools API access using /v1/avatar/init only.");
  console.log("INFO — This does not upload photos, start processing, or download a model.");
  const response = await fetch("https://api.keentools.io/v1/avatar/init", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ image_count: 10 }),
    redirect: "error",
    signal: AbortSignal.timeout(30000)
  });
  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  if (!response.ok) {
    const detail = String(data.detail ?? data.message ?? data.error ?? raw ?? "No provider error detail returned").replace(/[\r\n\t]+/g, " ").slice(0, 400);
    fail(`KeenTools init check returned HTTP ${response.status}: ${detail || "no detail returned"}`);
    process.exit();
  }
  const id = String(data.avatar_id ?? "");
  const urls = data.img_urls;
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(id) || !Array.isArray(urls) || urls.length !== 10) {
    fail("KeenTools responded successfully but the init response was missing a valid avatar ID or 10 upload URLs.");
    process.exit();
  }
  pass("KeenTools accepted the init request and returned 10 upload URLs.");
  console.log("RESULT — PREFLIGHT GOOD. No images uploaded and no reconstruction started.");
  console.log("NOTE — This confirms init access only; it does not prove the account can pay for or complete processing.");
} catch (error) {
  fail(String(error?.message ?? error).slice(0, 400));
}
