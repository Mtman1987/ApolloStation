import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { detectSpmtSuiteActionCommand, type SpmtClient } from "@spmt/sdk";

export const COMPANION_LOCAL_WAKE_PHRASE = "hey athena";
export const COMPANION_WAKE_READY_PREFIX = "SPMT_WAKE_READY";
export const COMPANION_WAKE_PREFIX = "SPMT_WAKE\t";
export const COMPANION_WAKE_ERROR_PREFIX = "SPMT_WAKE_ERROR\t";
export type CompanionLocalWakeStateV1 = "stopped" | "starting" | "listening" | "triggered" | "error" | "unsupported";
export interface CompanionLocalWakeSnapshotV1 { schemaVersion: 1; state: CompanionLocalWakeStateV1; phrase: typeof COMPANION_LOCAL_WAKE_PHRASE; localOnly: true; detail?: string; }
export type CompanionLocalWakeLineV1 = { type: "ready" } | { type: "wake"; transcript: string } | { type: "error"; message: string } | { type: "ignore" };
export interface CompanionLocalWakeProcessV1 { start(encodedPowerShell: string): ChildProcess; }

/** Bridges offline Windows wake transcripts into the canonical suite-action job pipeline. */
export class CompanionSuiteActionRouter {
  constructor(private readonly client: Pick<SpmtClient, "createSuiteActionJob">, private readonly context: { tenantId: string; userId: string; username?: string; role?: "member" | "moderator" | "admin" | "owner"; deviceId: string }) {}
  async route(transcript: string, idempotencyKey = `companion-suite:${randomUUID()}`) {
    const command = detectSpmtSuiteActionCommand(transcript.replace(/^hey\s+athena\b[:,]?\s*/i, ""));
    if (!command) return { status: "unmatched" as const };
    const result = await this.client.createSuiteActionJob(this.context.tenantId, { schemaVersion: 1, action: command.action, args: command.args, actor: { userId: this.context.userId, username: this.context.username ?? this.context.userId, role: this.context.role ?? "member" }, source: { kind: "companion", deviceId: this.context.deviceId } }, idempotencyKey);
    return { status: "accepted" as const, action: command.action, job: result.job, duplicate: result.duplicate };
  }
  wakeHandler(callbacks: { onResult?: (result: Awaited<ReturnType<CompanionSuiteActionRouter["route"]>>) => void; onError?: (error: Error) => void } = {}) { return (value: { transcript: string }) => { void this.route(value.transcript).then(callbacks.onResult).catch((error) => callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))); }; }
}

export class WindowsCompanionWakeProcess implements CompanionLocalWakeProcessV1 {
  start(encodedPowerShell: string) { return spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedPowerShell], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false }); }
}

export class CompanionLocalAthenaWake {
  private child: ChildProcess | undefined;
  private stopped = true;
  private state: CompanionLocalWakeSnapshotV1;
  constructor(private readonly options: { platform?: NodeJS.Platform; process?: CompanionLocalWakeProcessV1; onWake?: (value: { transcript: string; phrase: string; capturedAt: number; source: "windows-companion-local" }) => void; onStatus?: (value: CompanionLocalWakeSnapshotV1) => void; onError?: (error: Error) => void } = {}) { this.state = { schemaVersion: 1, state: (options.platform ?? process.platform) === "win32" ? "stopped" : "unsupported", phrase: COMPANION_LOCAL_WAKE_PHRASE, localOnly: true }; }
  snapshot() { return structuredClone(this.state); }
  start() { const platform = this.options.platform ?? process.platform; if (!this.stopped && this.child) return this.snapshot(); if (platform !== "win32") { this.stopped = true; return this.setState("unsupported", "Local Athena wake requires Windows Companion."); } this.stop(); this.stopped = false; this.setState("starting", "Starting offline Windows wake listener."); const encoded = Buffer.from(companionPowerShellWakeScript(), "utf16le").toString("base64"), child = (this.options.process ?? new WindowsCompanionWakeProcess()).start(encoded); this.child = child; if (!child.stdout || !child.stderr) { this.stopped = true; child.kill(); return this.setState("error", "Local wake process did not expose output streams."); } const lines = createInterface({ input: child.stdout }); lines.on("line", (line) => this.line(line)); child.stderr.on("data", (chunk) => { const message = String(chunk ?? "").trim(); if (message) this.options.onError?.(new Error(redact(message))); }); child.on("error", (error) => { if (this.child === child) this.child = undefined; this.stopped = true; this.setState("error", redact(error.message)); this.options.onError?.(error); }); child.on("exit", (code) => { if (this.child === child) this.child = undefined; if (this.stopped) return this.setState("stopped", "Local wake listener stopped."); this.stopped = true; this.setState(code === 0 ? "stopped" : "error", `Local wake listener exited (${code ?? "unknown"}).`); }); return this.snapshot(); }
  stop() { this.stopped = true; const child = this.child; this.child = undefined; if (child && child.exitCode == null) child.kill(); if ((this.options.platform ?? process.platform) === "win32") this.setState("stopped", "Local wake listener stopped."); return this.snapshot(); }
  private line(line: string) { const event = decodeCompanionWakeLine(line); if (event.type === "ready") this.setState("listening", `Listening locally for “${COMPANION_LOCAL_WAKE_PHRASE}”.`); else if (event.type === "wake") { this.setState("triggered", event.transcript); this.options.onWake?.({ transcript: event.transcript, phrase: COMPANION_LOCAL_WAKE_PHRASE, capturedAt: Date.now(), source: "windows-companion-local" }); this.setState("listening", `Listening locally for “${COMPANION_LOCAL_WAKE_PHRASE}”.`); } else if (event.type === "error") { this.setState("error", event.message); this.options.onError?.(new Error(event.message)); } }
  private setState(state: CompanionLocalWakeStateV1, detail: string) { this.state = { schemaVersion: 1, state, phrase: COMPANION_LOCAL_WAKE_PHRASE, localOnly: true, detail: redact(detail) }; this.options.onStatus?.(this.snapshot()); return this.snapshot(); }
}

export function decodeCompanionWakeLine(line: string): CompanionLocalWakeLineV1 { const value = String(line ?? "").trim(); if (value === COMPANION_WAKE_READY_PREFIX) return { type: "ready" }; if (value.startsWith(COMPANION_WAKE_PREFIX)) { const transcript = decode(value.slice(COMPANION_WAKE_PREFIX.length)); return transcript ? { type: "wake", transcript } : { type: "ignore" }; } if (value.startsWith(COMPANION_WAKE_ERROR_PREFIX)) return { type: "error", message: decode(value.slice(COMPANION_WAKE_ERROR_PREFIX.length)) || "Local wake listener failed" }; return { type: "ignore" }; }
export function companionPowerShellWakeScript() { return `$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1
  if ($null -eq $installed) { throw 'No offline Windows English speech recognizer is installed.' }
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($installed)
  $recognizer.SetInputToDefaultAudioDevice()
  $wake = New-Object System.Speech.Recognition.GrammarBuilder
  $wake.Culture = $installed.Culture
  $wake.Append('${COMPANION_LOCAL_WAKE_PHRASE}')
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.Grammar($wake)))
  $command = New-Object System.Speech.Recognition.GrammarBuilder
  $command.Culture = $installed.Culture
  $command.Append('${COMPANION_LOCAL_WAKE_PHRASE}')
  $command.AppendDictation()
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.Grammar($command)))
  [Console]::Out.WriteLine('${COMPANION_WAKE_READY_PREFIX}')
  [Console]::Out.Flush()
  while ($true) {
    $result = $recognizer.Recognize()
    if ($null -eq $result) { continue }
    $text = [string]$result.Text
    if ([string]::IsNullOrWhiteSpace($text) -or $text -notmatch '^(?i)hey\\s+athena\\b') { continue }
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text.Trim()))
    [Console]::Out.WriteLine('${COMPANION_WAKE_PREFIX}' + $payload)
    [Console]::Out.Flush()
  }
} catch {
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.Exception.Message))
  [Console]::Out.WriteLine('${COMPANION_WAKE_ERROR_PREFIX}' + $payload)
  [Console]::Out.Flush()
  exit 2
}`; }
function decode(value: string) { try { return Buffer.from(value, "base64").toString("utf8").trim().slice(0, 2_000); } catch { return ""; } }
function redact(value: string) { return value.replace(/(?:token|secret|authorization|password)\s*[:=]?\s*\S+/gi, "$1=[redacted]").replace(/[\r\n]+/g, " ").slice(0, 500); }
