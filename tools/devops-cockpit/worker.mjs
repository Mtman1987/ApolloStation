import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { localBrowserPath } from "../../scripts/setup-local-browser.mjs";

const origin = (process.env.APOLLO_COCKPIT_PUBLIC_URL || "").replace(/\/+$/, "");
const token = process.env.APOLLO_COCKPIT_WORKER_TOKEN || process.env.APOLLO_PREVIEW_PASSWORD || "";
const profileDir = process.env.APOLLO_COCKPIT_PROFILE_PATH || "/tmp/apollo-devops-cockpit-profile";
const viewport = { width: 1280, height: 900 };
const allowedKeys = new Set(["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
let context;
let page;
let busy = false;
let restorePending = true;
let lastError = null;
let lastSnapshotAt = 0;

if (!origin || !token) throw new Error("APOLLO_COCKPIT_PUBLIC_URL and APOLLO_COCKPIT_WORKER_TOKEN are required");

async function request(path, options = {}) {
  const response = await fetch(origin + path, {
    ...options,
    headers: { authorization: "Bearer " + token, "X-Hostless-Access-Bypass": token, "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let value = {};
  try { value = text ? JSON.parse(text) : {}; } catch { value = { message: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(value.error || value.message || ("HTTP " + response.status));
  return value;
}
function safeUrl(value) {
  const url = new URL(value || "https://chatgpt.com/");
  if (url.protocol !== "https:" || !["chatgpt.com", "auth.openai.com", "openai.com"].some(host => url.hostname === host || url.hostname.endsWith("." + host))) {
    throw new Error("Browser navigation is limited to ChatGPT and OpenAI sign-in");
  }
  return url.href;
}
async function launchBrowser() {
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const executablePath = await localBrowserPath();
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: true,
    viewport,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    acceptDownloads: false,
  });
  page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("crash", () => { lastError = "ChatGPT browser page crashed"; });
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(error => { lastError = error.message; });
}
async function closeBrowser() {
  if (context) await context.close().catch(() => {});
  context = undefined;
  page = undefined;
}
async function status() {
  if (!page || page.isClosed()) return { browserReady: false, loggedIn: false, url: null, title: "", busy, restorePending, lastError };
  const state = await page.evaluate(() => {
    const visible = element => { if (!element) return false; const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const composer = document.querySelector("#prompt-textarea,[contenteditable='true'][role='textbox'],textarea");
    const send = document.querySelector("[data-testid='send-button'],button[aria-label*='Send']");
    const stop = document.querySelector("[data-testid='stop-button'],button[aria-label*='Stop generating']");
    return { loggedIn: visible(composer), composerReady: visible(composer) && !composer.disabled && composer.getAttribute("aria-disabled") !== "true", sendVisible: visible(send), busy: visible(stop) };
  }).catch(() => ({ loggedIn: false, composerReady: false, sendVisible: false, busy: false }));
  return { browserReady: true, url: page.url(), title: await page.title().catch(() => ""), ...state, busy: busy || state.busy, restorePending, lastError };
}
async function dispatch(prompt) {
  if (busy) throw new Error("Browser is already handling a command");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) throw new Error("Prompt must be 1–4000 characters");
  busy = true;
  try {
    const state = await status();
    if (!state.loggedIn || !state.composerReady) return { ok: false, reason: "ChatGPT sign-in or composer is not ready" };
    const composer = page.locator("#prompt-textarea,[contenteditable='true'][role='textbox'],textarea").first();
    await composer.fill(prompt);
    const send = page.locator("[data-testid='send-button'],button[aria-label*='Send']").first();
    await send.waitFor({ state: "visible", timeout: 10000 });
    await send.click();
    await page.waitForTimeout(700);
    const cleared = await composer.evaluate(element => {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value.trim() === "";
      return (element.innerText || element.textContent || "").trim() === "";
    }).catch(() => false);
    if (!cleared) return { ok: false, reason: "ChatGPT send was not confirmed; prompt was not automatically retried" };
    return { ok: true, submittedAt: Date.now(), conversationUrl: page.url(), reason: "Prompt submitted; response is not read or monitored" };
  } finally { busy = false; }
}
async function input(value) {
  if (!page || page.isClosed()) throw new Error("Browser is not ready");
  if (value.action === "navigate") { await page.goto(safeUrl(value.url), { waitUntil: "domcontentloaded", timeout: 60000 }); return { ok: true }; }
  if (value.action === "click") {
    const x = Number(value.x), y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > viewport.width || y > viewport.height) throw new Error("Click coordinates outside viewport");
    await page.mouse.click(x, y); return { ok: true };
  }
  if (value.action === "type") {
    const text = String(value.text || "");
    if (!text || text.length > 2000) throw new Error("Text input must be 1–2000 characters");
    await page.keyboard.insertText(text); return { ok: true };
  }
  if (value.action === "press") {
    if (!allowedKeys.has(value.key)) throw new Error("Keyboard action is not allowed");
    await page.keyboard.press(value.key); return { ok: true };
  }
  throw new Error("Unsupported browser input");
}
async function takeSnapshot() {
  if (!page || page.isClosed() || Date.now() - lastSnapshotAt < 240000) return;
  lastSnapshotAt = Date.now();
  try {
    const archive = execFileSync("tar", ["-czf", "-", "-C", profileDir, "."], { maxBuffer: 80 * 1024 * 1024 });
    await request("/internal/profile/snapshot", { method: "POST", body: JSON.stringify({ base64: archive.toString("base64") }) });
  } catch (error) { lastError = "Profile checkpoint failed: " + String(error.message || error).slice(0, 180); }
}
async function applyRestore(base64) {
  if (!base64) { restorePending = false; return; }
  await closeBrowser();
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const archivePath = join("/tmp", "apollo-cockpit-restore.tar.gz");
  await writeFile(archivePath, Buffer.from(base64, "base64"), { mode: 0o600 });
  const entries = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }).split("\n").filter(Boolean);
  if (entries.some(entry => entry.startsWith("/") || entry.split("/").includes(".."))) throw new Error("Rejected unsafe browser profile archive");
  execFileSync("tar", ["-xzf", archivePath, "-C", profileDir], { maxBuffer: 80 * 1024 * 1024 });
  lastSnapshotAt = 0;
  restorePending = false;
  await launchBrowser();
  lastError = null;
}
async function run() {
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  await launchBrowser();
  console.log("[devops-cockpit-worker] Chromium started");
  let lastScreenshotAt = 0;
  for (;;) {
    try {
      const pendingRestore = await request("/internal/profile/restore-next");
      if (pendingRestore.base64) await applyRestore(pendingRestore.base64);
      else if (pendingRestore.empty) restorePending = false;
      const commandData = await request("/internal/commands/next");
      if (commandData.command) {
        const command = commandData.command;
        let result;
        try {
          result = command.kind === "dispatch" ? await dispatch(command.payload.prompt) : await input(command.payload);
        } catch (error) { result = { ok: false, reason: String(error.message || error).slice(0, 300) }; }
        await request("/internal/commands/" + encodeURIComponent(command.id) + "/result", { method: "POST", body: JSON.stringify(result) });
      }
      const current = await status();
      await request("/internal/heartbeat", { method: "POST", body: JSON.stringify(current) });
      if (page && !page.isClosed() && Date.now() - lastScreenshotAt > 1800) {
        lastScreenshotAt = Date.now();
        const shot = await page.screenshot({ type: "png" });
        await request("/internal/screenshot", { method: "POST", body: JSON.stringify({ base64: shot.toString("base64") }) });
      }
      await takeSnapshot();
      if (restorePending && current.loggedIn) restorePending = false;
    } catch (error) {
      lastError = String(error.message || error).slice(0, 300);
      await request("/internal/heartbeat", { method: "POST", body: JSON.stringify({ connected: false, browserReady: Boolean(page && !page.isClosed()), restorePending, lastError }) }).catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}
process.once("SIGTERM", () => { void closeBrowser().finally(() => process.exit(0)); });
process.once("SIGINT", () => { void closeBrowser().finally(() => process.exit(0)); });
run().catch(error => { console.error("[devops-cockpit-worker] fatal:", error); process.exit(1); });
