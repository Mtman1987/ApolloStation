import { redactCompanionText, sanitizeCompanionValue } from "./diagnostics.js";

export const COMPANION_RELAY_ACTION_CAPABILITIES = {
  "overlay.show": "overlay.control",
  "overlay.hide": "overlay.control",
  "popout.show": "overlay.control",
  "popout.hide": "overlay.control",
  "obs.scene.set": "obs.control",
  "audio.mute": "audio.control",
  "audio.volume": "audio.control",
  "media.transcode": "media.write",
  "media.download": "media.write",
  "media.download.cancel": "media.write",
  "media.cache.status": "media.read",
  "media.cache.prune": "media.write",
  "obs.media.play": "obs.control",
  "workflow.run": "workflow.run",
  "companion.status": "companion.status",
  "diagnostics.snapshot.write": "diagnostics.write",
} as const;

export type CompanionRelayActionV1 = keyof typeof COMPANION_RELAY_ACTION_CAPABILITIES;
export type CompanionRelayCapabilityV1 = (typeof COMPANION_RELAY_ACTION_CAPABILITIES)[CompanionRelayActionV1];
export const COMPANION_LOCAL_CONFIRMATION_ACTIONS = new Set<CompanionRelayActionV1>(["media.download", "media.cache.prune"]);

export interface CompanionRelayCommandV1 {
  schemaVersion: 1;
  id: string;
  issuedAt?: string;
  expiresAt: string;
  userId?: string;
  deviceId: string;
  source: string;
  capability: CompanionRelayCapabilityV1;
  action: CompanionRelayActionV1;
  payload: Record<string, unknown>;
  requiresConfirmation: boolean;
}

export interface CompanionRelayResultV1 {
  type: "companion.result";
  schemaVersion: 1;
  id: string;
  ok: boolean;
  result: unknown;
  error: string | null;
}

export interface CompanionRelayConfigV1 {
  relay?: {
    enabled: boolean;
    url: string;
    deviceId: string;
  };
}

export interface CompanionRelaySocketV1 {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open", listener: () => void): void;
  on(event: "message", listener: (raw: unknown) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: () => void): void;
}

export interface CompanionRelaySocketFactoryV1 {
  readonly OPEN: number;
  connect(url: string, options: { headers: { Authorization: string; "X-SPMT-Device": string }; rejectUnauthorized: true }): CompanionRelaySocketV1;
}

export type CompanionRelayHandlerV1 = (payload: Record<string, unknown>, command: CompanionRelayCommandV1) => unknown | Promise<unknown>;

export interface CompanionRelayClientOptionsV1 {
  getConfig: () => CompanionRelayConfigV1;
  getToken: () => string | undefined;
  socketFactory: CompanionRelaySocketFactoryV1;
  handlers: Partial<Record<CompanionRelayActionV1, CompanionRelayHandlerV1>>;
  onStatus?: (status: { state: "disabled" | "connecting" | "connected" | "error" | "disconnected"; message?: string }) => void;
  onConfirmationRequired?: (command: CompanionRelayCommandV1) => void;
  nowMs?: () => number;
  reconnectDelayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class CompanionRelayClient {
  private socket: CompanionRelaySocketV1 | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly seen = new Set<string>();
  private readonly pendingConfirmations = new Map<string, CompanionRelayCommandV1>();
  private stopped = true;
  private readonly onStatus: NonNullable<CompanionRelayClientOptionsV1["onStatus"]>;
  private readonly onConfirmationRequired: NonNullable<CompanionRelayClientOptionsV1["onConfirmationRequired"]>;
  private readonly nowMs: () => number;
  private readonly reconnectDelayMs: number;
  private readonly schedule: NonNullable<CompanionRelayClientOptionsV1["schedule"]>;
  private readonly cancelSchedule: NonNullable<CompanionRelayClientOptionsV1["cancelSchedule"]>;

  constructor(private readonly options: CompanionRelayClientOptionsV1) {
    this.onStatus = options.onStatus ?? (() => undefined);
    this.onConfirmationRequired = options.onConfirmationRequired ?? (() => undefined);
    this.nowMs = options.nowMs ?? Date.now;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 3_000;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) this.cancelSchedule(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }

  connect(): void {
    if (this.stopped) return;
    const config = this.options.getConfig();
    const token = this.options.getToken();
    const relay = config.relay;
    if (!relay?.enabled || !/^wss:\/\//i.test(relay.url) || !token || !relay.deviceId) {
      this.onStatus({ state: "disabled" });
      return;
    }
    this.onStatus({ state: "connecting" });
    const socket = this.options.socketFactory.connect(relay.url, {
      headers: { Authorization: `Bearer ${token}`, "X-SPMT-Device": relay.deviceId },
      rejectUnauthorized: true,
    });
    this.socket = socket;
    socket.on("open", () => {
      this.onStatus({ state: "connected" });
      socket.send(JSON.stringify({ type: "companion.ready", schemaVersion: 1, deviceId: relay.deviceId }));
    });
    socket.on("message", (raw) => { void this.handle(raw); });
    socket.on("error", (error) => this.onStatus({ state: "error", message: redactCompanionText(error.message) }));
    socket.on("close", () => {
      this.onStatus({ state: "disconnected" });
      if (!this.stopped) this.timer = this.schedule(() => this.connect(), this.reconnectDelayMs);
    });
  }

  async handle(raw: unknown): Promise<void> {
    let candidate: unknown;
    try {
      candidate = JSON.parse(rawToString(raw));
    } catch {
      return;
    }
    const command = this.validate(candidate);
    const id = record(candidate)?.id;
    if (!command) {
      this.reply(typeof id === "string" ? id : "", false, null, "Rejected relay command");
      return;
    }
    this.seen.add(command.id);
    if (this.seen.size > 500) {
      const oldest = this.seen.values().next().value as string | undefined;
      if (oldest) this.seen.delete(oldest);
    }
    if (command.requiresConfirmation || COMPANION_LOCAL_CONFIRMATION_ACTIONS.has(command.action)) {
      command.requiresConfirmation = true;
      this.pendingConfirmations.set(command.id, command);
      this.onConfirmationRequired(structuredClone(command));
      return;
    }
    await this.execute(command);
  }

  confirmations(): Array<Pick<CompanionRelayCommandV1, "id" | "source" | "action" | "payload" | "expiresAt">> {
    return Array.from(this.pendingConfirmations.values()).map((command) => ({
      id: command.id,
      source: command.source,
      action: command.action,
      payload: structuredClone(command.payload),
      expiresAt: command.expiresAt,
    }));
  }

  async resolveConfirmation(id: string, approved: boolean): Promise<{ id: string; approved: boolean; expired?: true }> {
    const key = String(id);
    const command = this.pendingConfirmations.get(key);
    if (!command) throw new Error("Confirmation request was not found");
    this.pendingConfirmations.delete(key);
    if (!approved) {
      this.reply(key, false, null, "Rejected by the local operator");
      return { id: key, approved: false };
    }
    if (Date.parse(command.expiresAt) <= this.nowMs()) {
      this.reply(key, false, null, "Command expired before local approval");
      return { id: key, approved: false, expired: true };
    }
    await this.execute(command);
    return { id: key, approved: true };
  }

  private validate(value: unknown): CompanionRelayCommandV1 | undefined {
    const input = record(value);
    if (!input || input.schemaVersion !== 1) return undefined;
    const id = typeof input.id === "string" ? input.id : "";
    const action = typeof input.action === "string" ? input.action as CompanionRelayActionV1 : undefined;
    const capability = typeof input.capability === "string" ? input.capability : "";
    const expiresAt = typeof input.expiresAt === "string" ? input.expiresAt : "";
    const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
    const source = typeof input.source === "string" ? input.source : "";
    const payload = record(input.payload) ?? {};
    const expectedDeviceId = this.options.getConfig().relay?.deviceId ?? "";
    const expectedCapability = action ? COMPANION_RELAY_ACTION_CAPABILITIES[action] : undefined;
    const expiresAtMs = Date.parse(expiresAt);
    if (!id || this.seen.has(id) || !action || !expectedCapability || capability !== expectedCapability || !expectedDeviceId || deviceId !== expectedDeviceId || !source || !Number.isFinite(expiresAtMs) || expiresAtMs <= this.nowMs()) return undefined;
    const command: CompanionRelayCommandV1 = {
      schemaVersion: 1,
      id,
      expiresAt,
      deviceId,
      source,
      capability: expectedCapability,
      action,
      payload,
      requiresConfirmation: input.requiresConfirmation === true,
    };
    if (typeof input.issuedAt === "string") command.issuedAt = input.issuedAt;
    if (typeof input.userId === "string") command.userId = input.userId;
    return command;
  }

  private async execute(command: CompanionRelayCommandV1): Promise<void> {
    try {
      const handler = this.options.handlers[command.action];
      if (!handler) throw new Error("Action is not available on this device");
      const result = await handler(structuredClone(command.payload), command);
      this.reply(command.id, true, sanitizeCompanionValue(result), null);
    } catch (error) {
      this.reply(command.id, false, null, redactCompanionText(error instanceof Error ? error.message : "Command failed"));
    }
  }

  private reply(id: string, ok: boolean, result: unknown, error: string | null): void {
    if (!this.socket || this.socket.readyState !== this.options.socketFactory.OPEN) return;
    const message: CompanionRelayResultV1 = { type: "companion.result", schemaVersion: 1, id, ok, result: sanitizeCompanionValue(result), error: error ? redactCompanionText(error) : null };
    this.socket.send(JSON.stringify(message));
  }
}

function rawToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw && typeof raw === "object" && "toString" in raw && typeof (raw as { toString?: unknown }).toString === "function") return String(raw);
  return "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
