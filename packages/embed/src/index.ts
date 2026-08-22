import {
  isEmbedBridgeMessageV1,
  type AppFrameLaunchV1,
  type EmbedBridgeMessageV1,
  type RuntimeStateV1,
  type ScopeGrantV1,
  type ShellLayoutMetricsV1,
  type SurfaceModeV1,
  type ThemeTokensV1,
} from "@spmt/contracts";

export const LAYER = Object.freeze({
  base: 0,
  sticky: 100,
  floating: 200,
  shellHeader: 300,
  modal: 400,
  toast: 500,
  emergency: 600,
});

export const SHELL_LAYOUT_VARS = Object.freeze({
  headerHeight: "--spmt-header-height",
  safeTop: "--spmt-safe-top",
  safeRight: "--spmt-safe-right",
  safeBottom: "--spmt-safe-bottom",
  safeLeft: "--spmt-safe-left",
  shellTopInset: "--spmt-shell-top-inset",
  availableHeight: "--spmt-shell-available-height",
  availableWidth: "--spmt-shell-available-width",
});

export function effectiveShellTopInset(mode: SurfaceModeV1, layout: ShellLayoutMetricsV1): number {
  return mode === "shell" ? layout.headerHeight + layout.safeTop : layout.safeTop;
}

export function applyShellLayoutMetrics(target: HTMLElement, mode: SurfaceModeV1, layout: ShellLayoutMetricsV1): void {
  const topInset = effectiveShellTopInset(mode, layout);
  target.style.setProperty(SHELL_LAYOUT_VARS.headerHeight, `${layout.headerHeight}px`);
  target.style.setProperty(SHELL_LAYOUT_VARS.safeTop, `${layout.safeTop}px`);
  target.style.setProperty(SHELL_LAYOUT_VARS.safeRight, `${layout.safeRight}px`);
  target.style.setProperty(SHELL_LAYOUT_VARS.safeBottom, `${layout.safeBottom}px`);
  target.style.setProperty(SHELL_LAYOUT_VARS.safeLeft, `${layout.safeLeft}px`);
  target.style.setProperty(SHELL_LAYOUT_VARS.shellTopInset, `${topInset}px`);
  target.style.setProperty(SHELL_LAYOUT_VARS.availableHeight, `${Math.max(0, layout.availableHeight - topInset - layout.safeBottom)}px`);
  target.style.setProperty(SHELL_LAYOUT_VARS.availableWidth, `${Math.max(0, layout.availableWidth - layout.safeLeft - layout.safeRight)}px`);
}

export function usableShellRect(mode: SurfaceModeV1, layout: ShellLayoutMetricsV1) {
  const top = effectiveShellTopInset(mode, layout);
  return {
    top,
    left: layout.safeLeft,
    right: Math.max(layout.safeLeft, layout.availableWidth - layout.safeRight),
    bottom: Math.max(top, layout.availableHeight - layout.safeBottom),
    width: Math.max(0, layout.availableWidth - layout.safeLeft - layout.safeRight),
    height: Math.max(0, layout.availableHeight - top - layout.safeBottom),
  };
}

export function hostHello(launch: AppFrameLaunchV1): EmbedBridgeMessageV1 {
  return { protocol: "spmt.embed", version: 1, type: "host.hello", launch };
}

export function childReady(appId: string): EmbedBridgeMessageV1 {
  return { protocol: "spmt.embed", version: 1, type: "child.ready", appId };
}

export interface BridgeEndpointOptions {
  allowedOrigin: string;
  targetWindow: Window;
  sourceWindow?: Window;
  onMessage?: (message: EmbedBridgeMessageV1) => void;
}

export function createBridgeEndpoint(options: BridgeEndpointOptions) {
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin !== options.allowedOrigin) return;
    if (options.sourceWindow && event.source !== options.sourceWindow) return;
    if (!isEmbedBridgeMessageV1(event.data)) return;
    options.onMessage?.(event.data);
  };

  return {
    start() { window.addEventListener("message", listener); },
    stop() { window.removeEventListener("message", listener); },
    send(message: EmbedBridgeMessageV1) { options.targetWindow.postMessage(message, options.allowedOrigin); },
  };
}

export interface SafeAreaInsetsV1 {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ShellLayoutObserverOptions {
  header: HTMLElement;
  onChange: (layout: ShellLayoutMetricsV1) => void;
  viewport?: Window;
  readSafeArea?: () => Partial<SafeAreaInsetsV1>;
}

export function measureShellLayout(options: ShellLayoutObserverOptions): ShellLayoutMetricsV1 {
  const viewport = options.viewport ?? window;
  const safe = options.readSafeArea?.() ?? {};
  const headerHeight = Math.max(0, options.header.getBoundingClientRect().height);
  return {
    schemaVersion: 1,
    headerHeight,
    safeTop: Math.max(0, safe.top ?? 0),
    safeRight: Math.max(0, safe.right ?? 0),
    safeBottom: Math.max(0, safe.bottom ?? 0),
    safeLeft: Math.max(0, safe.left ?? 0),
    availableWidth: Math.max(0, viewport.innerWidth),
    availableHeight: Math.max(0, viewport.innerHeight),
    measuredAt: new Date().toISOString(),
  };
}

export function observeShellLayout(options: ShellLayoutObserverOptions) {
  const viewport = options.viewport ?? window;
  const publish = () => options.onChange(measureShellLayout(options));
  const ResizeObserverCtor = viewport.ResizeObserver;
  const observer = ResizeObserverCtor ? new ResizeObserverCtor(publish) : undefined;
  observer?.observe(options.header);
  viewport.addEventListener("resize", publish);
  viewport.visualViewport?.addEventListener("resize", publish);
  publish();
  return () => {
    observer?.disconnect();
    viewport.removeEventListener("resize", publish);
    viewport.visualViewport?.removeEventListener("resize", publish);
  };
}

export interface AppFrameHostStateV1 {
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
  theme?: ThemeTokensV1;
  layout: ShellLayoutMetricsV1;
  grants: ScopeGrantV1[];
  runtimeState: RuntimeStateV1;
  runtimeDetail?: string;
}

export interface AppFrameHostOptions {
  frame: HTMLIFrameElement;
  allowedOrigin: string;
  launch: AppFrameLaunchV1;
  getState: () => AppFrameHostStateV1;
  onMessage?: (message: EmbedBridgeMessageV1) => void;
}

export function createAppFrameHost(options: AppFrameHostOptions) {
  const childWindow = options.frame.contentWindow;
  if (!childWindow) throw new Error("AppFrame iframe has no contentWindow");

  const bridge = createBridgeEndpoint({
    allowedOrigin: options.allowedOrigin,
    targetWindow: childWindow,
    sourceWindow: childWindow,
    onMessage(message) {
      if (message.type === "child.ready") sendSnapshot();
      options.onMessage?.(message);
    },
  });

  function sendSnapshot() {
    const state = options.getState();
    bridge.send(hostHello(options.launch));
    bridge.send({
      protocol: "spmt.embed", version: 1, type: "session.changed", authenticated: state.authenticated,
      ...(state.userId ? { userId: state.userId } : {}),
      ...(state.tenantId ? { tenantId: state.tenantId } : {}),
    });
    if (state.theme) bridge.send({ protocol: "spmt.embed", version: 1, type: "theme.changed", theme: state.theme });
    bridge.send({ protocol: "spmt.embed", version: 1, type: "layout.changed", layout: state.layout });
    bridge.send({ protocol: "spmt.embed", version: 1, type: "capabilities.changed", grants: state.grants });
    bridge.send({
      protocol: "spmt.embed", version: 1, type: "runtime.changed", state: state.runtimeState,
      ...(state.runtimeDetail ? { detail: state.runtimeDetail } : {}),
    });
  }

  const onLoad = () => sendSnapshot();
  return {
    start() {
      bridge.start();
      options.frame.addEventListener("load", onLoad);
      sendSnapshot();
    },
    stop() {
      bridge.stop();
      options.frame.removeEventListener("load", onLoad);
    },
    sync: sendSnapshot,
    send: bridge.send,
  };
}
