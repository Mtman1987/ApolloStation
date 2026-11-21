import { mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium as playwrightChromium } from "playwright";
import { localBrowserPath } from "../../scripts/setup-local-browser.mjs";

const DEFAULT_TEST_ORIGIN = process.env.APOLLO_BROWSER_ALLOWED_ORIGIN || process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app";

export class ApolloChatGptBrowserWorker {
  constructor({ profilePath = process.env.APOLLO_BROWSER_PROFILE_PATH || "/tmp/apollo-browser-profile", allowedOrigin = DEFAULT_TEST_ORIGIN, now = () => Date.now(), launch = playwrightChromium.launchPersistentContext.bind(playwrightChromium) }) {
    this.profilePath = resolve(profilePath);
    this.allowedOrigin = new URL(allowedOrigin).origin;
    this.now = now;
    this.launch = launch;
    this.context = undefined;
    this.page = undefined;
    this.busy = false;
    this.lastReceipt = undefined;
  }

  async start() {
    await mkdir(dirname(this.profilePath), { recursive: true, mode: 0o700 });
    try { await access(this.profilePath); } catch { await mkdir(this.profilePath, { recursive: true, mode: 0o700 }); }
    const executablePath = await localBrowserPath();
    this.context = await this.launch(this.profilePath, {
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
    await page.goto(this.allowedOrigin + "/bulletin/fake-chatgpt", { waitUntil: "domcontentloaded", timeout: 45_000 });
    return this.status();
  }

  async status() {
    const page = this.#requirePage();
    const url = page.url();
    const title = await page.title().catch(() => "");
    const loginRequired = /\/auth\/(login|signin)|\/login/i.test(url) ||
      await page.getByRole("button", { name: /log in|sign up|sign in/i }).first().isVisible().catch(() => false);
    return {
      connected: url.startsWith(this.allowedOrigin),
      loginRequired,
      url,
      title,
      busy: this.busy,
      lastReceipt: this.lastReceipt,
      profilePath: this.profilePath,
    };
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
    return this.status();
  }

  async type(text) {
    if (typeof text !== "string" || text.length > 4000) throw new Error("Browser input must be text no longer than 4000 characters");
    await this.#requirePage().keyboard.insertText(text);
    return this.status();
  }

  async press(key) {
    if (!["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown"].includes(key)) {
      throw new Error("That keyboard action is not allowed in the browser control surface");
    }
    await this.#requirePage().keyboard.press(key);
    return this.status();
  }

  async sendTask(task) {
    if (this.busy) throw new Error("The dedicated ChatGPT browser is already handling a task");
    if (!task || typeof task.prompt !== "string" || !task.prompt.trim()) throw new Error("Task prompt is missing");
    const target = new URL(task.conversationUrl || this.allowedOrigin + "/bulletin/fake-chatgpt");
    if (target.origin !== this.allowedOrigin || target.pathname !== "/bulletin/fake-chatgpt") {
      throw new Error("The browser proof accepts only the Apollo simulated ChatGPT page on its own Hostless origin");
    }
    this.busy = true;
    const page = this.#requirePage();
    try {
      await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const composer = page.locator("#prompt-textarea,[contenteditable='true'][data-testid*='composer'],textarea").last();
      await composer.waitFor({ state: "visible", timeout: 20_000 });
      const before = await page.locator("[data-message-author-role='assistant']").count().catch(() => 0);
      await composer.fill(task.prompt);
      const sendButton = page.getByRole("button", { name: /send prompt|send message|send/i }).last();
      if (await sendButton.isVisible().catch(() => false)) await sendButton.click();
      else await composer.press("Enter");
      const submittedAt = this.now();
      await page.waitForFunction(
        previous => document.querySelectorAll("[data-message-author-role='assistant']").length > previous,
        before,
        { timeout: 90_000 },
      );
      const response = page.locator("[data-message-author-role='assistant']").last();
      await response.waitFor({ state: "visible", timeout: 10_000 });
      const reply = (await response.innerText()).trim().slice(0, 12000);
      if (!reply) return { submitted: false, reason: "chatgpt-response-not-confirmed; manual review required" };
      const receipt = { provider: "chatgpt", submittedAt, receivedAt: this.now(), conversationUrl: page.url(), reply };
      this.lastReceipt = receipt;
      return { submitted: true, receipt, reason: "ChatGPT response observed in the dedicated browser" };
    } catch (error) {
      return { submitted: false, reason: "browser-dispatch-uncertain: " + String(error?.message || error).slice(0, 500) };
    } finally {
      this.busy = false;
    }
  }

  async close() {
    if (this.context) await this.context.close();
    this.context = undefined;
    this.page = undefined;
  }

  #requirePage() {
    if (!this.context || !this.page) throw new Error("Dedicated ChatGPT browser is not started");
    return this.page;
  }
}

export async function createApolloChatGptBrowserWorkerFromEnvironment(environment = process.env) {
  const profilePath = environment.APOLLO_BROWSER_PROFILE_PATH || "/tmp/apollo-browser-profile";
  const worker = new ApolloChatGptBrowserWorker({ profilePath, allowedOrigin: environment.APOLLO_BROWSER_ALLOWED_ORIGIN || environment.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app" });
  await worker.start();
  return { enabled: true, worker };
}
