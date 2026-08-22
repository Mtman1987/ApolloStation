import {
  isEmbedBridgeMessageV1,
  type AppFrameLaunchV1,
  type EmbedBridgeMessageV1,
  type ShellLayoutMetricsV1,
  type SurfaceModeV1,
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

export function applyShellLayoutMetrics(
  target: HTMLElement,
  mode: SurfaceModeV1,
  layout: ShellLayoutMetricsV1,
): void {
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
  onMessage?: (message: EmbedBridgeMessageV1) => void;
}

export function createBridgeEndpoint(options: BridgeEndpointOptions) {
  const listener = (event: MessageEvent<unknown>) => {
    if (event.origin !== options.allowedOrigin) return;
    if (!isEmbedBridgeMessageV1(event.data)) return;
    options.onMessage?.(event.data);
  };

  return {
    start() { window.addEventListener("message", listener); },
    stop() { window.removeEventListener("message", listener); },
    send(message: EmbedBridgeMessageV1) { options.targetWindow.postMessage(message, options.allowedOrigin); },
  };
}
