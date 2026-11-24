import { mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium as playwrightChromium } from "playwright";
import { localBrowserPath } from "../../scripts/setup-local-browser.mjs";

const DEFAULT_TEST_ORIGIN = process.env.APOLLO_BROWSER_ALLOWED_ORIGIN || process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app";

export function normalizeChatGptConversationUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("An exact ChatGPT conversation URL is required");
  let target;
  try { target = new URL(value); } catch { throw new Error("Enter a valid ChatGPT conversation URL"); }
  if (target.origin !== "https://chatgpt.com" || !/^\/c\/[A-Za-z0-9-]+$/.test(target.pathname) || target.search || target.hash) {
    throw new Error("Use the exact https://chatgpt.com/c/<conversation-id> URL without query parameters or fragments");
  }
  return target.href;
}

export class ApolloChatGptBrowserWorker {
  constructor({ profilePath = process.env.APOLLO_BROWSER_PROFILE_PATH || "/tmp/apollo-browser-profile", allowedOrigin = DEFAULT_TEST_ORIGIN, now = () => Date.now(), launch = playwrightChromium.launchPersistentContext.bind(playwrightChromium), sessionStore }) {
    this.profilePath = resolve(profilePath);
    this.allowedOrigin = new URL(allowedOrigin).origin;
    this.now = now;
    this.launch = launch;
    this.context = undefined;
    this.page = undefined;
    this.busy = false;
    this.lastReceipt = undefined;
    this.sessionStore = sessionStore;
  }

  async start() {
    await mkdir(dirname(this.profilePath), { recursive: true, mode: 0o700 });
    try { await access(this.profilePath); } catch { await mkdir(this.profilePath, { recursive: true, mode: 0o700 }); }
    const executablePath = await localBrowserPath();
    const storageState = await this.sessionStore?.loadBrowserState?.();
    this.context = await this.launch(this.profilePath, {
      ...(storageState ? { storageState } : {}),
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: false,
    });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    return this.status();
  }

  async openLogin() {
    const page = this.#requirePage();
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await this.#persistSession();
    return this.status();
  }

  async isHealthy() {
    if (!this.context || !this.page) return false;
    try {
      if (this.page.isClosed()) return false;
      const browser = this.context.browser?.();
      if (!browser || typeof browser.isConnected !== "function" || !browser.isConnected()) return false;
      const host = new URL(this.page.url()).hostname.toLowerCase();
      return ["chatgpt.com", "auth.openai.com", "openai.com"].some(domain => host === domain || host.endsWith("." + domain));
    } catch {
      return false;
    }
  }

  async status() {
    const page = this.#requirePage();
    const url = page.url();
    const title = await page.title().catch(() => "");
    const loginRequired = /\/auth\/(login|signin)|\/login/i.test(url) ||
      await page.getByRole("button", { name: /log in|sign up|sign in/i }).first().isVisible().catch(() => false);
    const healthy = await this.isHealthy();
    return {
      connected: healthy,
      healthy,
      loginRequired,
      url,
      title,
      busy: this.busy,
      lastReceipt: this.lastReceipt,
      profilePath: this.profilePath,
    };
  }

  async navigate(targetUrl) {
    const target = new URL(targetUrl);
    if (target.protocol !== "https:" || !["chatgpt.com", "auth.openai.com", "openai.com"].some(host => target.hostname === host || target.hostname.endsWith("." + host))) throw new Error("Browser navigation is limited to ChatGPT and OpenAI sign-in domains");
    await this.#requirePage().goto(target.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await this.#persistSession();
    return this.status();
  }

  async screenshot() {
    const page = this.#requirePage();
    return page.screenshot({ type: "png", fullPage: false });
  }

  async click(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 1440 || y > 1000) {
      throw new Error("Browser click coordinates are outside the managed viewport");
    }
    const page = this.#requirePage();
    await page.mouse.click(x, y);
    await this.#persistSession();
    return this.status();
  }

  async type(text) {
    if (typeof text !== "string" || text.length > 4000) throw new Error("Browser input must be text no longer than 4000 characters");
    await this.#requirePage().keyboard.insertText(text);
    await this.#persistSession();
    return this.status();
  }

  async press(key) {
    if (!["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown"].includes(key)) {
      throw new Error("That keyboard action is not allowed in the browser control surface");
    }
    await this.#requirePage().keyboard.press(key);
    await this.#persistSession();
    return this.status();
  }

  async sendTask(task) {
    if (this.busy) throw new Error("The dedicated ChatGPT browser is already handling a task");
    if (!task || typeof task.prompt !== "string" || !task.prompt.trim()) throw new Error("Task prompt is missing");
    const targetUrl = normalizeChatGptConversationUrl(task.conversationUrl);
    this.busy = true;
    const page = this.#requirePage();
    let clickAttempted = false;
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (normalizeChatGptConversationUrl(page.url()) !== targetUrl) {
        throw new Error("ChatGPT redirected away from the exact target conversation; refusing to send");
      }
      const composer = page.locator("#prompt-textarea,[contenteditable='true'][data-testid*='composer'],[contenteditable='true'][id*='prompt'],textarea").last();
      await composer.waitFor({ state: "visible", timeout: 20_000 });
      const existingDraft = await composer.evaluate(element => {
        if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value;
        return element.innerText || element.textContent || "";
      });
      if (String(existingDraft).trim()) throw new Error("The ChatGPT composer contains an unsent draft; it was left untouched");
      const assistantMessages = page.locator("[data-message-author-role='assistant']");
      const before = await assistantMessages.count();
      const sendButton = page.getByRole("button", { name: /send prompt|send message|send/i }).last();
      if (!(await sendButton.isVisible().catch(() => false))) throw new Error("A visible ChatGPT Send button was not found");
      await composer.fill(task.prompt);
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll("button")];
        const send = buttons.filter(button => /^(send|send prompt|send message)$/i.test((button.getAttribute("aria-label") || button.innerText || "").trim())).at(-1);
        return Boolean(send && !send.disabled && send.getAttribute("aria-disabled") !== "true");
      }, null, { timeout: 8_000 });
      if (!(await sendButton.isVisible().catch(() => false)) || !(await sendButton.isEnabled().catch(() => false))) {
        throw new Error("ChatGPT Send did not become visibly enabled after filling the empty composer");
      }
      const submittedAt = this.now();
      clickAttempted = true;
      await sendButton.click();
      await this.#persistSession();
      await page.waitForFunction(
        previous => document.querySelectorAll("[data-message-author-role='assistant']").length > previous,
        before,
        { timeout: 120_000 },
      );
      const response = assistantMessages.last();
      await response.waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForFunction(() => {
        const stop = [...document.querySelectorAll("button")].some(button =>
          /stop generating/i.test((button.getAttribute("aria-label") || button.innerText || "").trim()) &&
          button.offsetParent !== null
        );
        const composerElement = document.querySelector("#prompt-textarea,[contenteditable='true'][data-testid*='composer'],[contenteditable='true'][id*='prompt'],textarea");
        const composerReady = Boolean(composerElement && !composerElement.hasAttribute("disabled") && composerElement.getAttribute("aria-disabled") !== "true");
        return !stop && composerReady;
      }, null, { timeout: 120_000 });
      if (normalizeChatGptConversationUrl(page.url()) !== targetUrl) {
        throw new Error("The ChatGPT conversation changed while the response was being generated");
      }
      const reply = (await response.innerText()).trim().slice(0, 12000);
      if (!reply) throw new Error("ChatGPT response was empty; manual review required");
      const receipt = { provider: "chatgpt-visible-ui", submittedAt, receivedAt: this.now(), conversationUrl: targetUrl, reply };
      this.lastReceipt = receipt;
      return { submitted: true, receipt, reason: "ChatGPT response observed in the exact conversation" };
    } catch (error) {
      return { submitted: false, reason: (clickAttempted ? "browser-dispatch-uncertain-no-retry: " : "browser-dispatch-blocked: ") + String(error?.message || error).slice(0, 500) };
    } finally {
      this.busy = false;
    }
  }

  async close() {
    if (this.context) await this.context.close();
    this.context = undefined;
    this.page = undefined;
  }

  async #persistSession() {
    if (!this.sessionStore?.saveBrowserState || !this.context) return;
    const state = await this.context.storageState({ indexedDB: true });
    await this.sessionStore.saveBrowserState(state);
  }

  #requirePage() {
    if (!this.context || !this.page) throw new Error("Dedicated ChatGPT browser is not started");
    return this.page;
  }
}

export async function createApolloChatGptBrowserWorkerFromEnvironment(environment = process.env, { sessionStore } = {}) {
  const profilePath = environment.APOLLO_BROWSER_PROFILE_PATH || "/tmp/apollo-browser-profile";
  const worker = new ApolloChatGptBrowserWorker({ profilePath, sessionStore, allowedOrigin: environment.APOLLO_BROWSER_ALLOWED_ORIGIN || environment.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app" });
  await worker.start();
  return { enabled: true, worker };
}
