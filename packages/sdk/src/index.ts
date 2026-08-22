import type { OverlayWidgetManifestV1, RuntimeStateV1 } from "@spmt/contracts";

export interface SpmtClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getAccessToken?: () => string | Promise<string | undefined> | undefined;
  appId: string;
}

export interface ApiRequestOptions extends RequestInit {
  tenantId?: string;
  correlationId?: string;
}

export class SpmtClient {
  readonly baseUrl: string;
  readonly appId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessToken?: SpmtClientOptions["getAccessToken"];

  constructor(options: SpmtClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.appId = options.appId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getAccessToken = options.getAccessToken;
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");
    headers.set("x-spmt-app", this.appId);
    if (options.tenantId) headers.set("x-spmt-tenant", options.tenantId);
    if (options.correlationId) headers.set("x-correlation-id", options.correlationId);
    const token = await this.getAccessToken?.();
    if (token) headers.set("authorization", `Bearer ${token}`);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...options, headers });
    if (!response.ok) throw new SpmtApiError(response.status, await response.text());
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  getSession() {
    return this.request<{ authenticated: boolean; userId?: string; tenantId?: string }>("/v1/session");
  }

  getWorkspaceProfile(tenantId: string) {
    return this.request<Record<string, unknown>>("/v1/workspace/profile", { tenantId });
  }

  publishEvent<T extends Record<string, unknown>>(tenantId: string, type: string, payload: T, idempotencyKey: string) {
    return this.request<{ eventId: string }>("/v1/events", {
      method: "POST",
      tenantId,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ type, payload }),
    });
  }

  registerOverlayWidget(tenantId: string, manifest: OverlayWidgetManifestV1) {
    return this.request<{ widgetId: string }>("/v1/overlay/widgets", {
      method: "PUT",
      tenantId,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(manifest),
    });
  }

  reportRuntimeState(tenantId: string, state: RuntimeStateV1, detail?: string) {
    return this.request<void>("/v1/runtime/state", {
      method: "POST",
      tenantId,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, detail }),
    });
  }
}

export class SpmtApiError extends Error {
  constructor(public readonly status: number, public readonly responseBody: string) {
    super(`SPMT API request failed with status ${status}`);
    this.name = "SpmtApiError";
  }
}
