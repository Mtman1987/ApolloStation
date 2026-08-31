import { createAppFrameHost, measureShellLayout } from "@spmt/embed";
import type { EmbedBridgeMessageV1, RuntimeStateV1, ThemeTokensV1 } from "@spmt/contracts";
import { resolveProductTheme } from "@spmt/ui";
import { SpaceMountainShellUi as BaseShellUi, type SpaceMountainUiOptions } from "./shell-ui-base.js";
import { buildAppFrameTarget, type SpaceMountainAppCardV1, type SpaceMountainShellSnapshotV1 } from "./index.js";
import { OverlayBayParityController } from "./overlay-bay-ui.js";
export type { SpaceMountainUiOptions, SpaceMountainViewV1 } from "./shell-ui-base.js";
export { SPACE_MOUNTAIN_CSS } from "./shell-ui-base.js";

export class SpaceMountainShellUi {
  private readonly base: BaseShellUi;
  private readonly overlayBay: OverlayBayParityController;
  private observer: MutationObserver | undefined;
  private snapshot: SpaceMountainShellSnapshotV1;
  private appFrame: HTMLIFrameElement | undefined;
  private appFrameHost: ReturnType<typeof createAppFrameHost> | undefined;

  constructor(private readonly options: SpaceMountainUiOptions) {
    this.snapshot = options.snapshot;
    this.base = new BaseShellUi(options);
    this.overlayBay = new OverlayBayParityController(options.root, this.snapshot);
  }

  mount() {
    this.base.mount();
    this.observe();
    this.overlayBay.mount();
    this.syncAppFrame();
    return this;
  }

  update(snapshot: SpaceMountainShellSnapshotV1) {
    this.snapshot = snapshot;
    this.base.update(snapshot);
    this.overlayBay.update(snapshot);
    this.syncAppFrame();
  }

  updatePersonalUsage(usage: SpaceMountainShellSnapshotV1["usage"]) {
    this.base.updatePersonalUsage(usage);
    if (usage) this.snapshot = { ...this.snapshot, usage };
    this.appFrameHost?.sync();
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.stopAppFrame();
    this.base.destroy();
  }

  private observe() {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => queueMicrotask(() => {
      this.overlayBay.mount();
      this.syncAppFrame();
    }));
    this.observer.observe(this.options.root, { childList: true, subtree: true });
  }

  private syncAppFrame() {
    const frame = this.options.root.querySelector<HTMLIFrameElement>("[data-shell-app-frame]") ?? undefined;
    if (!frame) {
      this.stopAppFrame();
      return;
    }
    const appId = this.options.root.dataset.spmtApp ?? "";
    const app = this.snapshot.apps.find((item) => item.appId === appId && item.installed && item.enabled && item.surfaces.includes("shell"));
    if (!app) {
      this.stopAppFrame();
      return;
    }
    if (frame === this.appFrame && this.appFrameHost) {
      this.appFrameHost.sync();
      return;
    }

    this.stopAppFrame();
    const target = buildAppFrameTarget(app, this.snapshot.tenantId, "shell", crypto.randomUUID());
    // The catalog URL is authoritative. Surface identity, tenant identity, scopes,
    // layout and appearance travel over AppFrame instead of private query params.
    if (frame.getAttribute("src") !== target.url) frame.setAttribute("src", target.url);
    this.appFrame = frame;
    this.appFrameHost = createAppFrameHost({
      frame,
      allowedOrigin: target.allowedOrigin,
      launch: target.launch,
      getState: () => ({
        authenticated: Boolean(this.snapshot.session),
        userId: this.snapshot.userId,
        tenantId: this.snapshot.tenantId,
        theme: bridgeTheme(this.snapshot.workspace),
        layout: this.shellLayout(),
        grants: app.grantedScopes.map((scope) => ({ scope, granted: true })),
        runtimeState: appRuntimeState(this.snapshot, app),
        ...(appRuntimeDetail(this.snapshot, app) ? { runtimeDetail: appRuntimeDetail(this.snapshot, app) } : {}),
      }),
      onMessage: (message) => this.handleAppFrameMessage(frame, target.allowedOrigin, message),
    });
    this.appFrameHost.start();
  }

  private stopAppFrame() {
    this.appFrameHost?.stop();
    this.appFrameHost = undefined;
    this.appFrame = undefined;
  }

  private shellLayout() {
    const header = this.options.root.querySelector<HTMLElement>("[data-spmt-shell-header]");
    if (header) return measureShellLayout({ header });
    return {
      schemaVersion: 1 as const,
      headerHeight: 0,
      safeTop: 0,
      safeRight: 0,
      safeBottom: 0,
      safeLeft: 0,
      availableWidth: window.innerWidth,
      availableHeight: window.innerHeight,
      measuredAt: new Date().toISOString(),
    };
  }

  private handleAppFrameMessage(frame: HTMLIFrameElement, allowedOrigin: string, message: EmbedBridgeMessageV1) {
    if (message.type !== "navigation.open") return;
    let target: URL;
    try { target = new URL(message.url, frame.src); }
    catch { return; }
    // Shell navigation remains inside the publisher origin. Apps can request a
    // direct/popout window without gaining an arbitrary cross-origin launcher.
    if (target.origin !== allowedOrigin) return;
    if (message.target === "shell") frame.src = target.toString();
    else window.open(target.toString(), message.target === "popout" ? `spmt-${this.options.root.dataset.spmtApp ?? "app"}` : "_blank", "noopener,noreferrer");
  }
}

type ExtendedThemeTokensV1 = ThemeTokensV1 & {
  themeId?: string;
  accentSecondary?: string;
  backgroundUrl?: string;
  starDensity?: number;
  glassOpacity?: number;
  blurStrength?: number;
  glowIntensity?: number;
  nebulaIntensity?: number;
  parallaxDepth?: number;
  borderStrength?: number;
  chatTransparency?: number;
};

function bridgeTheme(workspace: Record<string, unknown> | undefined): ExtendedThemeTokensV1 {
  const appearance = record(workspace?.appearance);
  const preset = resolveProductTheme(text(appearance?.theme), text(appearance?.accent), text(appearance?.accentSecondary));
  const density = appearance?.density === "compact" || appearance?.density === "spacious" ? appearance.density : "comfortable";
  const motion = appearance?.smoothTransitions === false ? "reduced" : "full";
  const backgroundUrl = text(appearance?.backgroundUrl);
  return {
    schemaVersion: 1,
    background: backgroundUrl ?? "#050710",
    surface: "#080a11",
    text: "#f8fafc",
    accent: preset.accent,
    radius: "24px",
    density,
    motion,
    themeId: preset.id,
    accentSecondary: preset.accentSecondary,
    ...(backgroundUrl ? { backgroundUrl } : {}),
    starDensity: boundedNumber(appearance?.starDensity, 70),
    glassOpacity: boundedNumber(appearance?.glassOpacity, 76),
    blurStrength: boundedNumber(appearance?.blurStrength, 18),
    glowIntensity: boundedNumber(appearance?.glowIntensity, 55),
    nebulaIntensity: boundedNumber(appearance?.nebulaIntensity, 55),
    parallaxDepth: boundedNumber(appearance?.parallaxDepth, 35),
    borderStrength: boundedNumber(appearance?.borderStrength, 35),
    chatTransparency: boundedNumber(appearance?.chatTransparency, 15),
  };
}

function appRuntimeState(snapshot: SpaceMountainShellSnapshotV1, app: SpaceMountainAppCardV1): RuntimeStateV1 {
  const projection = snapshot.runtimeStates.find((item) => text(item.appId) === app.appId);
  const state = text(projection?.state);
  return state === "starting" || state === "ready" || state === "degraded" || state === "draining" || state === "unavailable" ? state : "ready";
}

function appRuntimeDetail(snapshot: SpaceMountainShellSnapshotV1, app: SpaceMountainAppCardV1) {
  const projection = snapshot.runtimeStates.find((item) => text(item.appId) === app.appId);
  return text(projection?.detail);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown) { return typeof value === "string" && value ? value : undefined; }
function boundedNumber(value: unknown, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, number));
}
