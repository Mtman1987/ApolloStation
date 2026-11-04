import type { CompanionDiagnosticsStore } from "./diagnostics.js";
import type { CompanionMediaJobs, CompanionMediaPreset } from "./media-jobs.js";
import type { CompanionRelayActionV1, CompanionRelayHandlerV1 } from "./relay-client.js";
import { COMPANION_WORKFLOWS, type CompanionWorkflowIdV1, type CompanionWorkflowJobs } from "./workflow-jobs.js";

export interface CompanionWindowControllerV1 {
  showOverlay(): unknown | Promise<unknown>;
  hideOverlay(): unknown | Promise<unknown>;
  showPopout(id: string): unknown | Promise<unknown>;
  hidePopout(id: string): unknown | Promise<unknown>;
}

export interface CompanionObsControllerV1 {
  setScene(sceneName: string): unknown | Promise<unknown>;
  playMedia(payload: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface CompanionAudioControllerV1 {
  apply(input: { muted?: boolean; volume?: number }): unknown | Promise<unknown>;
}

export interface CompanionRuntimeStatusV1 {
  server: unknown;
  relay: unknown;
  obs: unknown;
}

export interface CompanionRuntimeHandlersOptionsV1 {
  windows: CompanionWindowControllerV1;
  obs: CompanionObsControllerV1;
  audio: CompanionAudioControllerV1;
  mediaJobs: CompanionMediaJobs;
  workflowJobs: CompanionWorkflowJobs;
  diagnosticsStore: CompanionDiagnosticsStore;
  getStatus: () => CompanionRuntimeStatusV1;
  localMediaRelayEnabled: () => boolean;
  onDiagnosticsSaved?: (saved: { filename: string; path: string; bytes: number; logCount: number; capturedAt: string }) => void;
}

export function createCompanionRelayHandlers(options: CompanionRuntimeHandlersOptionsV1): Partial<Record<CompanionRelayActionV1, CompanionRelayHandlerV1>> {
  const requireMediaRelay = () => {
    if (!options.localMediaRelayEnabled()) throw new Error("HearMeOut local media relay is disabled on this device");
  };
  return {
    "companion.status": async () => ({ ...options.getStatus(), media: options.mediaJobs.cacheStatus(), hardware: options.mediaJobs.hardware() }),
    "diagnostics.snapshot.write": async (payload) => {
      const saved = options.diagnosticsStore.writeSnapshot(payload);
      options.onDiagnosticsSaved?.(saved);
      return saved;
    },
    "overlay.show": async () => options.windows.showOverlay(),
    "overlay.hide": async () => options.windows.hideOverlay(),
    "popout.show": async (payload) => options.windows.showPopout(text(payload.id, "id", 120)),
    "popout.hide": async (payload) => options.windows.hidePopout(text(payload.id, "id", 120)),
    "obs.scene.set": async (payload) => options.obs.setScene(text(payload.sceneName, "sceneName", 180)),
    "audio.mute": async (payload) => options.audio.apply({ muted: bool(payload.muted, "muted") }),
    "audio.volume": async (payload) => options.audio.apply({ volume: boundedNumber(payload.volume, "volume", 0, 1) }),
    "media.transcode": async (payload) => options.mediaJobs.transcode(text(payload.inputName, "inputName", 240), mediaPreset(payload.preset)),
    "media.cache.status": async () => options.mediaJobs.cacheStatus(),
    "media.download": async (payload) => {
      requireMediaRelay();
      return options.mediaJobs.download({
        url: text(payload.url, "url", 4_000),
        ...(payload.fileName === undefined ? {} : { fileName: text(payload.fileName, "fileName", 240) }),
        ...(payload.expectedSha256 === undefined ? {} : { expectedSha256: sha256(payload.expectedSha256) }),
        ...(payload.maxBytes === undefined ? {} : { maxBytes: boundedNumber(payload.maxBytes, "maxBytes", 1, Number.MAX_SAFE_INTEGER) }),
      });
    },
    "media.download.cancel": async (payload) => options.mediaJobs.cancel(text(payload.jobId, "jobId", 160)),
    "media.cache.prune": async (payload) => {
      requireMediaRelay();
      return options.mediaJobs.pruneDownloads(payload.targetBytes === undefined ? undefined : boundedNumber(payload.targetBytes, "targetBytes", 0, Number.MAX_SAFE_INTEGER));
    },
    "obs.media.play": async (payload) => options.obs.playMedia(structuredClone(payload)),
    "workflow.run": async (payload) => {
      const workflowId = workflow(payload.workflowId);
      const input = object(payload.input);
      return options.workflowJobs.runApproved(workflowId, input, "relay");
    },
  };
}

function text(value: unknown, field: string, max: number): string {
  const result = String(value ?? "").trim().slice(0, max);
  if (!result) throw new Error(`${field} is required`);
  return result;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}
function boundedNumber(value: unknown, field: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${field} is outside the allowed range`);
  return number;
}
function mediaPreset(value: unknown): CompanionMediaPreset {
  const preset = String(value ?? "") as CompanionMediaPreset;
  if (preset !== "mp4-web" && preset !== "audio-mp3" && preset !== "gif") throw new Error("preset is not supported");
  return preset;
}
function workflow(value: unknown): CompanionWorkflowIdV1 {
  const id = String(value ?? "") as CompanionWorkflowIdV1;
  if (!(id in COMPANION_WORKFLOWS)) throw new Error("Workflow is not allowlisted");
  return id;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function sha256(value: unknown): string {
  const digest = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("expectedSha256 must be a SHA-256 hex digest");
  return digest;
}
