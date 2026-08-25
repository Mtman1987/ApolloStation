import { redactCompanionText } from "./diagnostics.js";

export type CompanionUpdateStateV1 = "development" | "idle" | "checking" | "downloading" | "current" | "ready" | "error";
export interface CompanionUpdateStatusV1 {
  state: CompanionUpdateStateV1;
  currentVersion: string;
  availableVersion?: string | null;
  percent?: number;
  message?: string;
}
export interface CompanionUpdaterV1 {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): void;
  on(event: "update-available" | "update-downloaded", listener: (info: { version?: string }) => void | Promise<void>): void;
  on(event: "update-not-available", listener: () => void | Promise<void>): void;
  on(event: "download-progress", listener: (progress: { percent?: number }) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}
export interface CompanionDialogV1 {
  showMessageBox(windowOrOptions: unknown, maybeOptions?: unknown): Promise<{ response: number }>;
}
export interface CompanionUpdateManagerOptionsV1 {
  updater: CompanionUpdaterV1;
  dialog: CompanionDialogV1;
  isPackaged: boolean;
  currentVersion: string;
  getWindow?: () => unknown;
  onStatus?: (status: CompanionUpdateStatusV1) => void;
  log?: (message: string, error?: unknown) => void;
  initialDelayMs?: number;
  intervalMs?: number;
  setTimeoutFn?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
  setIntervalFn?: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}

export function createCompanionUpdateManager(options: CompanionUpdateManagerOptionsV1) {
  const getWindow = options.getWindow ?? (() => undefined);
  const onStatus = options.onStatus ?? (() => undefined);
  const log = options.log ?? (() => undefined);
  const initialDelayMs = boundedMs(options.initialDelayMs, 15_000, 1_000, 60 * 60 * 1000);
  const intervalMs = boundedMs(options.intervalMs, 6 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000);
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let manualCheck = false;
  let started = false;
  let status: CompanionUpdateStatusV1 = { state: options.isPackaged ? "idle" : "development", currentVersion: options.currentVersion };

  const publish = (next: Partial<CompanionUpdateStatusV1>) => {
    status = { ...status, ...next, currentVersion: options.currentVersion };
    onStatus(structuredClone(status));
  };
  const notify = (messageOptions: Record<string, unknown>) => {
    const window = getWindow();
    return window ? options.dialog.showMessageBox(window, messageOptions) : options.dialog.showMessageBox(messageOptions);
  };
  const check = async ({ manual = false }: { manual?: boolean } = {}): Promise<unknown> => {
    if (!options.isPackaged) {
      publish({ state: "development", message: "Updates are available in packaged builds." });
      if (manual) await notify({ type: "info", title: "Companion updates", message: "Update checks are only available in an installed Companion build." });
      return null;
    }
    manualCheck = manual;
    publish({ state: "checking", message: "Checking for updates…" });
    try {
      return await options.updater.checkForUpdates();
    } catch (error) {
      const message = redactCompanionText(error instanceof Error ? error.message : String(error));
      publish({ state: "error", message });
      log("Companion update check failed", error);
      if (manual) await notify({ type: "error", title: "Update check failed", message: "Companion could not check for updates.", detail: message });
      return null;
    }
  };
  const start = () => {
    if (!options.isPackaged || started) return;
    started = true;
    options.updater.autoDownload = true;
    options.updater.autoInstallOnAppQuit = true;
    options.updater.allowPrerelease = false;
    options.updater.on("checking-for-update", () => publish({ state: "checking", message: "Checking for updates…" }));
    options.updater.on("update-available", (info) => publish({ state: "downloading", availableVersion: version(info.version), message: `Downloading Companion ${version(info.version) || "update"}…` }));
    options.updater.on("update-not-available", async () => {
      publish({ state: "current", availableVersion: null, percent: undefined, message: "Companion is up to date." });
      if (manualCheck) {
        manualCheck = false;
        await notify({ type: "info", title: "Companion is up to date", message: `You are running SpaceMountain Companion ${options.currentVersion}.` });
      }
    });
    options.updater.on("download-progress", (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)));
      publish({ state: "downloading", percent, message: `Downloading update… ${percent}%` });
    });
    options.updater.on("error", (error) => {
      publish({ state: "error", message: redactCompanionText(error.message) });
      log("Companion updater error", error);
    });
    options.updater.on("update-downloaded", async (info) => {
      const availableVersion = version(info.version);
      publish({ state: "ready", availableVersion, percent: 100, message: `Companion ${availableVersion || "update"} is ready to install.` });
      const result = await notify({
        type: "info",
        title: "Companion update ready",
        message: `SpaceMountain Companion ${availableVersion || "update"} is ready.`,
        detail: "Restart now to install the signed update, or install it automatically when Companion exits.",
        buttons: ["Restart and install", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0) options.updater.quitAndInstall(false, true);
    });
    timer = setTimeoutFn(() => { void check(); }, initialDelayMs);
    interval = setIntervalFn(() => { void check(); }, intervalMs);
    unref(timer);
    unref(interval);
  };
  const stop = () => {
    if (timer) clearTimeoutFn(timer);
    if (interval) clearIntervalFn(interval);
    timer = null;
    interval = null;
    started = false;
  };
  return { check, start, stop, snapshot: () => structuredClone(status) };
}

function boundedMs(value: unknown, fallback: number, min: number, max: number): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.round(parsed) : fallback; }
function version(value: unknown): string { return String(value ?? "").trim().replace(/[^0-9A-Za-z.+_-]/g, "").slice(0, 80); }
function unref(timer: unknown): void { if (timer && typeof timer === "object" && "unref" in timer && typeof (timer as { unref?: unknown }).unref === "function") (timer as { unref(): void }).unref(); }
