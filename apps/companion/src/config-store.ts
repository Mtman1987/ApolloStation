import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const COMPANION_CONFIG_SCHEMA_VERSION = 7;

export interface CompanionSecureStorageV1 {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Uint8Array;
  decryptString(value: Uint8Array): string;
}

export interface CompanionConfigV1 {
  schemaVersion: number;
  server: { host: string; port: number; wsPort: number };
  startup: { openAtLogin: boolean; startMinimized: boolean };
  relay: { url: string; deviceId: string; enabled: boolean };
  obs: { url: string; enabled: boolean; mediaInputName: string };
  audio: { muted: boolean; volume: number; pttKey: string; outputDeviceId: string };
  windows: {
    spaceMountain: { url: string };
    workspace: { url: string };
    overlay: {
      url: string;
      socialUrl: string;
      socialEnabled: boolean;
      visible: boolean;
      clickThrough: boolean;
      alwaysOnTop: boolean;
      opacity: number;
      fitToDisplay: boolean;
      interactionHotkey: string;
    };
    popouts: Array<{ id: number; title: string; url: string; visible: boolean }>;
  };
  media: {
    libraryPath: string;
    localRelayEnabled: boolean;
    downloadsEnabled: boolean;
    cacheBudgetBytes: number;
    transcodeEngine: "auto" | "cpu" | "nvidia" | "intel" | "amd";
  };
  presence: { clientId: string; displayName: string };
  windowBounds: Record<string, { x?: number; y?: number; width?: number; height?: number }>;
}

export interface CompanionSecretsV1 {
  relayToken?: string;
  obsPassword?: string;
  pairingToken?: string;
  sessionToken?: string;
  [key: string]: string | undefined;
}

export const DEFAULT_COMPANION_CONFIG: CompanionConfigV1 = {
  schemaVersion: COMPANION_CONFIG_SCHEMA_VERSION,
  server: { host: "127.0.0.1", port: 3100, wsPort: 8090 },
  startup: { openAtLogin: false, startMinimized: true },
  relay: { url: "wss://spmt.live/api/companion/relay", deviceId: "", enabled: false },
  obs: { url: "ws://127.0.0.1:4455", enabled: false, mediaInputName: "SpaceMountain Jingles" },
  audio: { muted: false, volume: 0.7, pttKey: "Space", outputDeviceId: "" },
  windows: {
    spaceMountain: { url: "https://spacemountain.live/crew" },
    workspace: { url: "https://spacemountain.live/?companionWorkspace=streamweaver" },
    overlay: {
      url: "",
      socialUrl: "",
      socialEnabled: true,
      visible: false,
      clickThrough: true,
      alwaysOnTop: true,
      opacity: 1,
      fitToDisplay: true,
      interactionHotkey: "CommandOrControl+Shift+O",
    },
    popouts: [
      { id: 1, title: "Nebula Arcade", url: "https://spacemountain.live/?app=nebula-arcade", visible: false },
      { id: 2, title: "TTS Studio", url: "http://127.0.0.1:3100/tts-mixer", visible: false },
      { id: 3, title: "HearMeOut", url: "https://spacemountain.live/?app=hearmeout", visible: false },
    ],
  },
  media: {
    libraryPath: "",
    localRelayEnabled: false,
    downloadsEnabled: false,
    cacheBudgetBytes: 20 * 1024 * 1024 * 1024,
    transcodeEngine: "auto",
  },
  presence: { clientId: "", displayName: "SpaceMountain Companion" },
  windowBounds: {},
};

export class CompanionConfigStore {
  readonly configPath: string;
  readonly secretPath: string;

  constructor(readonly root: string, private readonly secureStorage: CompanionSecureStorageV1) {
    this.configPath = join(root, "companion.json");
    this.secretPath = join(root, "companion.secrets");
    mkdirSync(root, { recursive: true });
  }

  read(): CompanionConfigV1 {
    let stored: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(this.configPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
    } catch { /* defaults are authoritative when no valid file exists */ }
    return normalizeCompanionConfig(stored);
  }

  write(next: CompanionConfigV1): CompanionConfigV1 {
    const normalized = normalizeCompanionConfig(next as unknown as Record<string, unknown>);
    const temporary = `${this.configPath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.configPath);
    return normalized;
  }

  readSecrets(): CompanionSecretsV1 {
    try {
      if (!this.secureStorage.isEncryptionAvailable()) return {};
      const encoded = readFileSync(this.secretPath);
      const parsed = JSON.parse(this.secureStorage.decryptString(encoded));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return sanitizeSecrets(parsed as Record<string, unknown>);
    } catch {
      return {};
    }
  }

  writeSecrets(secrets: CompanionSecretsV1): void {
    if (!this.secureStorage.isEncryptionAvailable()) throw new Error("OS credential encryption is unavailable");
    const normalized = sanitizeSecrets(secrets as Record<string, unknown>);
    const temporary = `${this.secretPath}.tmp`;
    writeFileSync(temporary, this.secureStorage.encryptString(JSON.stringify(normalized)), { mode: 0o600 });
    renameSync(temporary, this.secretPath);
  }
}

export function normalizeCompanionConfig(raw: Record<string, unknown>): CompanionConfigV1 {
  const stored = structuredClone(raw);
  const storedVersion = finiteInt(stored.schemaVersion, 1, 1, COMPANION_CONFIG_SCHEMA_VERSION);
  const windows = record(stored.windows);
  const overlay = record(windows.overlay);
  if (storedVersion < 2 && overlay.url === "http://127.0.0.1:3100/tts-mixer") overlay.url = "";
  if (storedVersion < 4 && typeof overlay.url === "string" && overlay.url.includes("desktopOverlay=1")) overlay.url = "";

  const defaults = structuredClone(DEFAULT_COMPANION_CONFIG);
  const server = record(stored.server);
  const startup = record(stored.startup);
  const relay = record(stored.relay);
  const obs = record(stored.obs);
  const audio = record(stored.audio);
  const media = record(stored.media);
  const presence = record(stored.presence);
  const spaceMountain = record(windows.spaceMountain);
  const workspace = record(windows.workspace);
  const storedPopouts = Array.isArray(windows.popouts) ? windows.popouts.slice(0, 3).map((value, index) => normalizePopout(value, defaults.windows.popouts[index])) : defaults.windows.popouts;

  return {
    schemaVersion: COMPANION_CONFIG_SCHEMA_VERSION,
    server: {
      host: loopbackHost(server.host, defaults.server.host),
      port: finiteInt(server.port, defaults.server.port, 1, 65535),
      wsPort: finiteInt(server.wsPort, defaults.server.wsPort, 1, 65535),
    },
    startup: { openAtLogin: bool(startup.openAtLogin, defaults.startup.openAtLogin), startMinimized: bool(startup.startMinimized, defaults.startup.startMinimized) },
    relay: {
      url: secureWss(relay.url, defaults.relay.url),
      deviceId: boundedText(relay.deviceId, 120),
      enabled: bool(relay.enabled, defaults.relay.enabled),
    },
    obs: {
      url: loopbackWs(obs.url, defaults.obs.url),
      enabled: bool(obs.enabled, defaults.obs.enabled),
      mediaInputName: boundedText(obs.mediaInputName, 180) || defaults.obs.mediaInputName,
    },
    audio: {
      muted: bool(audio.muted, defaults.audio.muted),
      volume: finiteNumber(audio.volume, defaults.audio.volume, 0, 1),
      pttKey: boundedText(audio.pttKey, 80) || defaults.audio.pttKey,
      outputDeviceId: boundedText(audio.outputDeviceId, 240),
    },
    windows: {
      spaceMountain: { url: trustedHttps(spaceMountain.url, defaults.windows.spaceMountain.url) },
      workspace: { url: trustedHttps(workspace.url, defaults.windows.workspace.url) },
      overlay: {
        url: optionalHttps(overlay.url),
        socialUrl: optionalHttps(overlay.socialUrl),
        socialEnabled: bool(overlay.socialEnabled, defaults.windows.overlay.socialEnabled),
        visible: bool(overlay.visible, defaults.windows.overlay.visible),
        clickThrough: bool(overlay.clickThrough, defaults.windows.overlay.clickThrough),
        alwaysOnTop: bool(overlay.alwaysOnTop, defaults.windows.overlay.alwaysOnTop),
        opacity: finiteNumber(overlay.opacity, defaults.windows.overlay.opacity, 0.05, 1),
        fitToDisplay: bool(overlay.fitToDisplay, defaults.windows.overlay.fitToDisplay),
        interactionHotkey: boundedText(overlay.interactionHotkey, 120) || defaults.windows.overlay.interactionHotkey,
      },
      popouts: storedPopouts,
    },
    media: {
      libraryPath: boundedText(media.libraryPath, 2_048),
      localRelayEnabled: bool(media.localRelayEnabled, defaults.media.localRelayEnabled),
      downloadsEnabled: bool(media.downloadsEnabled, defaults.media.downloadsEnabled),
      cacheBudgetBytes: finiteNumber(media.cacheBudgetBytes, defaults.media.cacheBudgetBytes, 512 * 1024 * 1024, 100 * 1024 * 1024 * 1024),
      transcodeEngine: transcodeEngine(media.transcodeEngine),
    },
    presence: {
      clientId: boundedText(presence.clientId, 96).replace(/[^A-Za-z0-9._:-]/g, ""),
      displayName: boundedText(presence.displayName, 60) || defaults.presence.displayName,
    },
    windowBounds: normalizeBounds(record(stored.windowBounds)),
  };
}

function normalizePopout(value: unknown, fallback: CompanionConfigV1["windows"]["popouts"][number] | undefined): CompanionConfigV1["windows"]["popouts"][number] {
  const input = record(value);
  const base = fallback ?? { id: 1, title: "Companion", url: "https://spacemountain.live/", visible: false };
  return { id: finiteInt(input.id, base.id, 1, 99), title: boundedText(input.title, 100) || base.title, url: managedUrl(input.url, base.url), visible: bool(input.visible, base.visible) };
}
function normalizeBounds(input: Record<string, unknown>): CompanionConfigV1["windowBounds"] {
  const output: CompanionConfigV1["windowBounds"] = {};
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    const entry = record(value);
    const bounds: { x?: number; y?: number; width?: number; height?: number } = {};
    if (Number.isFinite(Number(entry.x))) bounds.x = Math.round(Number(entry.x));
    if (Number.isFinite(Number(entry.y))) bounds.y = Math.round(Number(entry.y));
    if (Number.isFinite(Number(entry.width)) && Number(entry.width) > 0) bounds.width = Math.round(Number(entry.width));
    if (Number.isFinite(Number(entry.height)) && Number(entry.height) > 0) bounds.height = Math.round(Number(entry.height));
    output[key.slice(0, 120)] = bounds;
  }
  return output;
}
function sanitizeSecrets(input: Record<string, unknown>): CompanionSecretsV1 {
  const output: CompanionSecretsV1 = {};
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (typeof value !== "string") continue;
    const normalizedKey = key.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
    if (normalizedKey) output[normalizedKey] = value.slice(0, 16_384);
  }
  return output;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function boundedText(value: unknown, max: number): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function bool(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
function finiteInt(value: unknown, fallback: number, min: number, max: number): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function finiteNumber(value: unknown, fallback: number, min: number, max: number): number { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function loopbackHost(value: unknown, fallback: string): string { const host = boundedText(value, 120); return host === "127.0.0.1" || host === "localhost" || host === "::1" ? host : fallback; }
function secureWss(value: unknown, fallback: string): string { try { const url = new URL(String(value ?? "")); return url.protocol === "wss:" && !url.username && !url.password ? url.toString() : fallback; } catch { return fallback; } }
function loopbackWs(value: unknown, fallback: string): string { try { const url = new URL(String(value ?? "")); return url.protocol === "ws:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) && !url.username && !url.password ? url.toString() : fallback; } catch { return fallback; } }
function trustedHttps(value: unknown, fallback: string): string { const result = optionalHttps(value); return result || fallback; }
function optionalHttps(value: unknown): string { const text = boundedText(value, 4_096); if (!text) return ""; try { const url = new URL(text); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : ""; } catch { return ""; } }
function managedUrl(value: unknown, fallback: string): string { const text = boundedText(value, 4_096); if (!text) return fallback; try { const url = new URL(text); if ((url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname))) && !url.username && !url.password) return url.toString(); } catch { /* fallback */ } return fallback; }
function transcodeEngine(value: unknown): CompanionConfigV1["media"]["transcodeEngine"] { const engine = String(value ?? "").toLowerCase(); return engine === "cpu" || engine === "nvidia" || engine === "intel" || engine === "amd" ? engine : "auto"; }
