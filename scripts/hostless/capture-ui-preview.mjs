import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const root = process.cwd();
const previewPassword = "screenshot-proof-only";
const previewEnv = {
  ...process.env,
  SPMT_PUBLIC_URL: "https://apollo-preview.hostless.app",
  APOLLO_PREVIEW_PASSWORD: previewPassword,
  PORT: "8080",
};
const preview = spawn(process.execPath, ["scripts/hostless/run-private-preview.mjs"], { cwd: root, env: previewEnv, stdio: "inherit" });
let browser;
const routes = [
  "/",
  "/apps/discord-stream-hub",
  "/apps/streamweaver",
  "/apps/hearmeout",
  "/apps/mountainview",
  "/apps/companion",
];
try {
  await mkdir("artifacts/ui-preview", { recursive: true });
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8080/health/ready", { signal: AbortSignal.timeout(1500) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  if (!ready) throw new Error("Local private preview did not become ready");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    extraHTTPHeaders: { authorization: `Basic ${Buffer.from(`owner:${previewPassword}`).toString("base64")}` },
  });
  for (const route of routes) {
    const response = await page.goto(`http://127.0.0.1:8080${route}`, { waitUntil: "networkidle", timeout: 30000 });
    if (!response || response.status() >= 400) throw new Error(`Preview route failed: ${route} (${response?.status() ?? "no response"})`);
    const pageText = await page.locator("body").innerText();
    if (pageText.includes("Private preview — sign in to continue.")) throw new Error(`Preview auth gate was not passed for ${route}`);
    await page.screenshot({ path: `artifacts/ui-preview/${route === "/" ? "spacemountain-home" : route.split("/").at(-1)}.png`, fullPage: true });
  }
  console.log("Screenshot proof captured for SpaceMountain and five app surfaces.");
} finally {
  await browser?.close().catch(() => undefined);
  preview.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 1200));
  if (preview.exitCode === null) preview.kill("SIGKILL");
}
