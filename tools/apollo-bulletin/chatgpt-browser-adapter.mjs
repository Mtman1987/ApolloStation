import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { localBrowserPath } from "../../scripts/setup-local-browser.mjs";

const CHATGPT_ORIGIN = "https://chatgpt.com";
const PROFILE_DIR = process.env.APOLLO_BULLETIN_BROWSER_PROFILE || "/tmp/apollo-bulletin-chatgpt-profile";

function safeConversationUrl(value) {
  const url = new URL(value || CHATGPT_ORIGIN);
  if (url.origin !== CHATGPT_ORIGIN || !["", "/"].includes(url.pathname) && !url.pathname.startsWith("/c/")) {
    throw new Error("The Bulletin browser can only open ChatGPT conversations");
  }
  return url.href;
}

export function createChatGPTBrowserAdapter({ launch = chromium.launchPersistentContext, browserPath = localBrowserPath, profileDir = PROFILE_DIR } = {}) {
  let context;
  let page;
  let opening;
  let lastError = null;

  async function ensure(url = null) {
    const target = url ? safeConversationUrl(url) : null;
    if (page && !page.isClosed()) {
      if (target && page.url() !== target) await page.goto(target || CHATGPT_ORIGIN, { waitUntil: "domcontentloaded", timeout: 45000 });
      return page;
    }
    if (opening) { await opening; return ensure(target); }
    opening = (async () => {
      await mkdir(profileDir, { recursive: true, mode: 0o700 });
      const executablePath = await browserPath();
      context = await launch(profileDir, {
        executablePath,
        headless: true,
        viewport: { width: 1280, height: 900 },
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      page = context.pages()[0] || await context.newPage();
      page.setDefaultTimeout(12000);
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
      page.on("crash", () => { lastError = "ChatGPT browser page crashed"; });
      lastError = null;
    })().catch(error => { lastError = error.message || String(error); throw error; }).finally(() => { opening = null; });
    await opening;
    return page;
  }

  async function snapshot(url) {
    const current = await ensure(url);
    return current.evaluate(() => {
      const visible = element => {
        if (!element || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const composer = document.querySelector("#prompt-textarea, [contenteditable='true'][role='textbox'], textarea");
      const send = document.querySelector("[data-testid='send-button'], button[aria-label*='Send']");
      const stop = document.querySelector("[data-testid='stop-button'], button[aria-label*='Stop generating']");
      return {
        url: location.href,
        loggedIn: Boolean(composer),
        composerReady: visible(composer),
        sendControlVisible: visible(send),
        busy: Boolean(stop),
        stopControlVisible: Boolean(stop && visible(stop)),
      };
    });
  }

  async function dispatch(task) {
    try {
      const current = await ensure(task.conversationUrl);
      const state = await snapshot(task.conversationUrl);
      if (!state.loggedIn) return { submitted: false, reason: "chatgpt-login-required-open-bulletin-browser" };
      if (state.url !== safeConversationUrl(task.conversationUrl)) return { submitted: false, reason: "conversation-url-mismatch" };
      if (state.busy || !state.composerReady || !state.sendControlVisible) return { submitted: false, reason: "chatgpt-composer-not-ready" };
      const composer = current.locator("#prompt-textarea, [contenteditable='true'][role='textbox'], textarea").first();
      await composer.fill(task.prompt);
      const send = current.locator("[data-testid='send-button'], button[aria-label*='Send']").first();
      await send.click();
      await current.waitForTimeout(500);
      const cleared = await composer.evaluate(element => {
        if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value.trim() === "";
        return (element.innerText || element.textContent || "").trim() === "";
      }).catch(() => false);
      if (!cleared) return { submitted: false, reason: "chatgpt-send-not-confirmed" };
      return { submitted: true, reason: "Prompt submitted to ChatGPT; response is intentionally not monitored" };
    } catch (error) {
      lastError = error.message || String(error);
      return { submitted: false, reason: "chatgpt-browser-error:" + lastError.slice(0, 180) };
    }
  }

  async function browserStatus() {
    try {
      const current = await ensure();
      const state = await snapshot();
      return { connected: true, url: current.url(), loggedIn: state.loggedIn, composerReady: state.composerReady, error: null };
    } catch {
      return { connected: false, url: page?.url?.() || null, loggedIn: false, composerReady: false, error: lastError || "Browser unavailable" };
    }
  }

  async function screenshot() {
    const current = await ensure();
    return current.screenshot({ type: "png" });
  }

  async function input(value = {}) {
    const current = await ensure();
    if (value.action === "navigate") {
      const target = safeConversationUrl(value.url);
      await current.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
      return { ok: true };
    }
    if (value.action === "click") {
      const x = Number(value.x), y = Number(value.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 1280 || y > 900) throw new Error("Click coordinates are outside the browser viewport");
      await current.mouse.click(x, y);
      return { ok: true };
    }
    if (value.action === "type") {
      const text = String(value.text || "");
      if (!text || text.length > 2000) throw new Error("Browser text input must be 1–2000 characters");
      await current.keyboard.type(text);
      return { ok: true };
    }
    if (value.action === "press") {
      const allowed = new Set(["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
      if (!allowed.has(value.key)) throw new Error("Unsupported browser key");
      await current.keyboard.press(value.key);
      return { ok: true };
    }
    return { ok: false, error: "Unsupported browser input action" };
  }

  return {
    dispatch,
    status: browserStatus,
    screenshot,
    input,
    async close() { await context?.close().catch(() => {}); context = undefined; page = undefined; },
  };
}

export function browserControlPage() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bulletin ChatGPT Browser</title><style>body{margin:0;padding:12px;background:#0b1220;color:#eef;font:14px system-ui}header{display:flex;gap:12px;align-items:center;flex-wrap:wrap}button,input{padding:9px;background:#17243a;color:#fff;border:1px solid #496080;border-radius:7px}#screen{display:block;width:100%;max-width:1280px;margin:12px auto;border:1px solid #496080;touch-action:manipulation}#status{color:#9fc}p{color:#bac7db}</style></head><body><header><b>ChatGPT browser · development proof</b><button id="refresh">Refresh</button><span id="status">Connecting…</span></header><p>Sign in to ChatGPT here once. This browser only submits task prompts; it does not read or monitor replies. Tap the browser image to click. Use the input below to type into the focused field.</p><img id="screen" alt="ChatGPT browser screen"><form id="type"><input id="text" autocomplete="off" placeholder="Type into the browser"><button>Send keys</button><button type="button" id="enter">Enter</button></form><script>const screen=document.querySelector("#screen"),status=document.querySelector("#status");async function refresh(){try{const s=await fetch("/bulletin/browser/status").then(r=>r.json());status.textContent=s.loggedIn?"ChatGPT signed in · "+s.url:s.connected?"Browser open · sign in to ChatGPT":"Browser starting";screen.src="/bulletin/browser/screenshot?t="+Date.now();}catch(e){status.textContent="Browser unavailable";}}screen.addEventListener("click",async e=>{const r=screen.getBoundingClientRect();await fetch("/bulletin/browser/input",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"click",x:(e.clientX-r.left)*1280/r.width,y:(e.clientY-r.top)*900/r.height})});refresh();});document.querySelector("#type").addEventListener("submit",async e=>{e.preventDefault();const input=document.querySelector("#text");if(input.value)await fetch("/bulletin/browser/input",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"type",text:input.value})});input.value="";refresh();});document.querySelector("#enter").onclick=async()=>{await fetch("/bulletin/browser/input",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"press",key:"Enter"})});refresh();};document.querySelector("#refresh").onclick=refresh;refresh();setInterval(refresh,1500);</script></body></html>`;
}
