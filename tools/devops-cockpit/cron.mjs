import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const origin = (process.env.APOLLO_COCKPIT_PUBLIC_URL || "").replace(/\/+$/, "");
const token = process.env.APOLLO_COCKPIT_WORKER_TOKEN || process.env.APOLLO_PREVIEW_PASSWORD || "";
const prompt = (process.env.APOLLO_TEST_PROMPT || await readFile(join(root, "test-prompt.txt"), "utf8")).trim();

if (!origin || !token) throw new Error("APOLLO_COCKPIT_PUBLIC_URL and APOLLO_COCKPIT_WORKER_TOKEN are required");
if (!prompt || prompt.length > 4000) throw new Error("The saved test prompt must be 1–4000 characters");

const response = await fetch(origin + "/internal/enqueue", {
  method: "POST",
  headers: { authorization: "Bearer " + token, "content-type": "application/json" },
  body: JSON.stringify({ prompt }),
});
const raw = await response.text();
let value = {};
try { value = raw ? JSON.parse(raw) : {}; } catch { value = { message: raw.slice(0, 300) }; }
if (!response.ok) throw new Error(value.error || value.message || ("Hostless cockpit returned HTTP " + response.status));
console.log(JSON.stringify({ queued: true, commandId: value.command?.id || null }));
