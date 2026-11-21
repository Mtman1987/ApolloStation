import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const workerToken = process.env.APOLLO_COCKPIT_WORKER_TOKEN || "";
const ui = await readFile(join(root, "index.html"), "utf8");

const commands = new Map();
const queue = [];
let worker = { connected: false, browserReady: false, loggedIn: false, url: "about:blank", title: "", busy: false, restorePending: true, lastSeenAt: null, lastError: null };
let screenshot = null;
let profileSnapshot = null;
let restoreArchive = null;
let restoreEmpty = false;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
function send(res, status, value, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  if (Buffer.isBuffer(value)) return res.end(value);
  if (typeof value === "string") return res.end(value);
  res.end(JSON.stringify(value));
}
async function body(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function authorizedOwner(req) {
  const email = req.headers["x-hostless-access-email"];
  const role = req.headers["x-hostless-access-role"];
  return typeof email === "string" && email.trim().length > 0 && (role === "member" || role === "owner");
}
function authorizedWorker(req) {
  const value = req.headers.authorization || "";
  return Boolean(workerToken) && value.startsWith("Bearer ") && safeEqual(value.slice(7), workerToken);
}
function enqueue(kind, payload) {
  const id = randomUUID();
  const command = { id, kind, payload, status: "queued", createdAt: Date.now(), result: null };
  commands.set(id, command);
  queue.push(command);
  while (commands.size > 100) commands.delete(commands.keys().next().value);
  return command;
}
function validateBrowserInput(input) {
  if (!input || typeof input !== "object") throw new Error("Input action is required");
  if (input.action === "navigate") {
    const url = new URL(String(input.url || ""));
    if (url.protocol !== "https:" || !["chatgpt.com", "auth.openai.com", "openai.com"].some(host => url.hostname === host || url.hostname.endsWith("." + host))) throw new Error("Browser navigation is limited to ChatGPT and OpenAI sign-in");
    return { action: "navigate", url: url.href };
  }
  if (input.action === "click") {
    const x = Number(input.x), y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 1280 || y > 900) throw new Error("Click coordinates are outside the browser viewport");
    return { action: "click", x, y };
  }
  if (input.action === "type") {
    const text = String(input.text || "");
    if (!text || text.length > 2000) throw new Error("Text input must be 1–2000 characters");
    return { action: "type", text };
  }
  if (input.action === "press") {
    const key = String(input.key || "");
    if (!["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) throw new Error("Keyboard action is not allowed");
    return { action: "press", key };
  }
  throw new Error("Unsupported browser action");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health/ready") {
      return send(res, 200, { ready: true, service: "apollo-devops-cockpit", workerConnected: worker.connected, browserReady: worker.browserReady });
    }
    if (url.pathname.startsWith("/internal/")) {
      if (!authorizedWorker(req)) return send(res, 401, { error: "worker_auth_required" });
      if (req.method === "GET" && url.pathname === "/internal/status") return send(res, 200, { worker, queueLength: queue.length });
      if (req.method === "POST" && url.pathname === "/internal/heartbeat") {
        const value = await body(req);
        worker = { ...worker, ...value, connected: true, lastSeenAt: Date.now() };
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/internal/commands/next") {
        const command = queue.shift() || null;
        if (command) command.status = "running";
        return send(res, 200, { command });
      }
      const resultMatch = url.pathname.match(/^\/internal\/commands\/([a-f0-9-]+)\/result$/i);
      if (req.method === "POST" && resultMatch) {
        const command = commands.get(resultMatch[1]);
        if (!command) return send(res, 404, { error: "command_not_found" });
        const value = await body(req);
        command.status = value.ok ? "completed" : "failed";
        command.result = value;
        command.completedAt = Date.now();
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/internal/screenshot") {
        const value = await body(req, 3_000_000);
        if (typeof value.base64 !== "string" || value.base64.length > 2_800_000) return send(res, 400, { error: "invalid_screenshot" });
        screenshot = Buffer.from(value.base64, "base64");
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/internal/profile/snapshot") {
        const value = await body(req, 70_000_000);
        if (typeof value.base64 !== "string" || value.base64.length > 65_000_000) return send(res, 400, { error: "invalid_profile_snapshot" });
        profileSnapshot = value.base64;
        return send(res, 200, { ok: true, bytes: Buffer.byteLength(profileSnapshot, "base64") });
      }
      if (req.method === "GET" && url.pathname === "/internal/profile/export") {
        if (!profileSnapshot) return send(res, 404, { error: "profile_snapshot_not_ready" });
        return send(res, 200, { base64: profileSnapshot, createdAt: Date.now() });
      }
      if (req.method === "POST" && url.pathname === "/internal/profile/restore") {
        const value = await body(req, 70_000_000);
        if (typeof value.base64 !== "string" || value.base64.length > 65_000_000) return send(res, 400, { error: "invalid_profile_archive" });
        restoreArchive = value.base64;
        return send(res, 202, { accepted: true });
      }
      if (req.method === "GET" && url.pathname === "/internal/profile/restore-next") {
        const value = restoreArchive;
        const empty = restoreEmpty;
        restoreArchive = null;
        restoreEmpty = false;
        return send(res, 200, { base64: value, empty });
      }
      if (req.method === "POST" && url.pathname === "/internal/profile/restore-empty") {
        restoreEmpty = true;
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/internal/enqueue") {
        const value = await body(req);
        if (typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 4000) return send(res, 400, { error: "prompt_required" });
        return send(res, 202, { command: enqueue("dispatch", { prompt: value.prompt.trim() }) });
      }
      return send(res, 404, { error: "internal_not_found" });
    }

    if (!authorizedOwner(req)) return send(res, 403, { error: "hostless_owner_session_required" });
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, ui, { "content-type": "text/html; charset=utf-8" });
    if (req.method === "GET" && url.pathname === "/api/status") {
      return send(res, 200, { worker, queueLength: queue.length, recentCommands: [...commands.values()].slice(-12).reverse() });
    }
    if (req.method === "GET" && url.pathname === "/api/screenshot") {
      if (!screenshot) return send(res, 503, { error: "browser_screenshot_not_ready" });
      return send(res, 200, screenshot, { "content-type": "image/png" });
    }
    if (req.method === "POST" && url.pathname === "/api/input") {
      const value = await body(req);
      return send(res, 202, { command: enqueue("input", validateBrowserInput(value)) });
    }
    if (req.method === "POST" && url.pathname === "/api/dispatch") {
      const value = await body(req);
      if (typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 4000) return send(res, 400, { error: "prompt_required" });
      return send(res, 202, { command: enqueue("dispatch", { prompt: value.prompt.trim() }) });
    }
    if (req.method === "POST" && url.pathname === "/api/test") {
      return send(res, 202, { command: enqueue("dispatch", { prompt: "Reply with exactly: APOLLO_BROWSER_CONNECTED" }) });
    }
    const commandMatch = url.pathname.match(/^\/api\/commands\/([a-f0-9-]+)$/i);
    if (req.method === "GET" && commandMatch) {
      const command = commands.get(commandMatch[1]);
      return command ? send(res, 200, { command }) : send(res, 404, { error: "command_not_found" });
    }
    return send(res, 404, { error: "not_found" });
  } catch (error) {
    return send(res, 400, { error: String(error?.message || error).slice(0, 400) });
  }
});

server.listen(port, "0.0.0.0", () => console.log("[devops-cockpit] listening on " + port));
