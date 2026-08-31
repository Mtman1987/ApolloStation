import { createAppFrameHost, measureShellLayout } from "@spmt/embed";
import type { EmbedBridgeMessageV1, RuntimeStateV1, ThemeTokensV1 } from "@spmt/contracts";
import { isAppSurfaceMessageV1, type AppSurfaceManifestV1 } from "@spmt/contracts/surface";
import { installProductBackdrop, resolveProductBackdrop, resolveProductTheme } from "@spmt/ui";
import { SpaceMountainShellUi as BaseShellUi, type SpaceMountainUiOptions } from "./shell-ui-base.js";
import { buildAppFrameTarget, type SpaceMountainAppCardV1, type SpaceMountainShellSnapshotV1 } from "./index.js";
import { OverlayBayParityController } from "./overlay-bay-ui.js";
export type { SpaceMountainUiOptions, SpaceMountainViewV1 } from "./shell-ui-base.js";
export { SPACE_MOUNTAIN_CSS } from "./shell-ui-base.js";

const APPFRAME_PRESENTATION_STYLE_ID = "spmt-appframe-presentation-contract";
const APPFRAME_PRESENTATION_CSS = `
.spmt-embedded-app-shell{border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
.spmt-embedded-app-shell iframe[data-shell-app-frame]{display:block!important;width:100%!important;height:100%!important;border:0!important;border-radius:0!important;background:transparent!important;color-scheme:normal!important}
.spmt-space-root[data-spmt-view="app"] .spmt-space-main{position:fixed!important;top:calc(var(--spmt-shell-top-inset,124px) + 18px)!important;right:14px!important;bottom:14px!important;left:14px!important;width:auto!important;max-width:none!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:hidden!important}
.spmt-space-root[data-spmt-view="app"] .spmt-embedded-app-shell{width:100%!important;height:100%!important;min-height:0!important;overflow:hidden!important}
.spmt-rocket-dock{z-index:860!important}.spmt-workspace-tray{z-index:870!important}.spmt-shell-header-stack{z-index:880!important}
.spmt-dock-owned header{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:26px minmax(0,1fr);align-items:center;gap:7px;padding:5px 5px 7px;background:linear-gradient(180deg,rgba(8,9,14,.96),rgba(8,9,14,.72));font-size:8px}.spmt-dock-owned header img{width:26px;height:26px;object-fit:contain}.spmt-dock-owned header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.spmt-surface-glyph{width:27px;height:27px;display:grid;place-items:center;flex:0 0 auto;border:1px solid color-mix(in srgb,var(--accent2) 25%,transparent);border-radius:9px;color:var(--accent2);font-size:13px;font-weight:900}.spmt-dock-owned button[aria-current="page"]{color:#fff;border-color:color-mix(in srgb,var(--accent) 34%,transparent);background:color-mix(in srgb,var(--accent) 14%,transparent);box-shadow:inset 3px 0 0 var(--accent)}
.spmt-space-root *{scrollbar-width:thin;scrollbar-color:transparent transparent}.spmt-space-root *:hover{scrollbar-color:color-mix(in srgb,var(--accent) 62%,transparent) transparent}.spmt-space-root *::-webkit-scrollbar{width:4px;height:4px}.spmt-space-root *::-webkit-scrollbar-track{background:transparent}.spmt-space-root *::-webkit-scrollbar-thumb{border-radius:999px;background:transparent}.spmt-space-root *:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--accent) 62%,transparent)}
@media(max-width:900px){
 .spmt-shell-header-stack{left:108px!important;right:10px!important}
 .spmt-rocket-dock{left:10px!important;right:auto!important;top:calc(var(--guard-height,38px) + 8px)!important;bottom:max(10px,env(safe-area-inset-bottom))!important;width:88px!important;height:auto!important;max-height:calc(100dvh - var(--guard-height,38px) - 20px)!important;box-sizing:border-box!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;padding:7px!important;border-radius:34px!important}
 .spmt-dock-orbit{display:grid!important;width:68px!important;height:62px!important;margin:0 auto 3px!important}
 .spmt-rocket-dock nav{width:100%!important;min-height:0!important;display:flex!important;flex:1!important;flex-direction:column!important;justify-content:flex-start!important;overflow:hidden!important}
 .spmt-dock-core,.spmt-dock-account,.spmt-dock-apps{min-width:0!important;display:flex!important;flex-direction:column!important}.spmt-dock-apps{overflow-y:auto!important;overflow-x:hidden!important}
 .spmt-rocket-dock nav button{min-height:43px!important;flex:0 0 auto!important;flex-direction:column!important;justify-content:center!important;gap:2px!important;padding:4px!important}.spmt-rocket-dock nav label{display:none!important}.spmt-dock-owned header{grid-template-columns:1fr;justify-items:center}.spmt-dock-owned header strong{display:none}
 .spmt-space-root[data-spmt-dock="collapsed"] .spmt-rocket-dock{left:10px!important;right:auto!important;top:calc(var(--guard-height,38px) + 8px)!important;bottom:auto!important;width:72px!important;height:70px!important;min-height:0!important;padding:4px!important}.spmt-space-root[data-spmt-dock="collapsed"] .spmt-dock-orbit{display:grid!important;width:100%!important;height:100%!important;margin:0!important}.spmt-space-root[data-spmt-dock="collapsed"] .spmt-shell-header-stack{left:94px!important}
 .spmt-space-root[data-spmt-view="app"] .spmt-space-main{top:calc(var(--spmt-shell-top-inset,112px) + 14px)!important;right:9px!important;bottom:9px!important;left:9px!important}
 .spmt-workspace-tray{left:10px!important;right:10px!important;bottom:max(10px,env(safe-area-inset-bottom))!important}.spmt-workspace-frames{height:min(68dvh,640px)!important}.spmt-workspace-tray.maximized .spmt-workspace-frames{left:10px!important;right:10px!important;top:calc(var(--spmt-shell-top-inset,112px) + 10px)!important;bottom:84px!important}
}
`;

export class SpaceMountainShellUi {
  private readonly base: BaseShellUi;
  private readonly overlayBay: OverlayBayParityController;
  private observer: MutationObserver | undefined;
  private snapshot: SpaceMountainShellSnapshotV1;
  private appFrame: HTMLIFrameElement | undefined;
  private appFrameHost: ReturnType<typeof createAppFrameHost> | undefined;
  private appFrameOrigin = "";
  private surfaceManifest: AppSurfaceManifestV1 | undefined;
  private activeSurfacePage = "home";
  private surfaceListener: ((event: MessageEvent<unknown>) => void) | undefined;

  constructor(private readonly options: SpaceMountainUiOptions) {
    this.snapshot = options.snapshot;
    this.base = new BaseShellUi(options);
    this.overlayBay = new OverlayBayParityController(options.root, this.snapshot);
  }
  mount() { this.installAppFramePresentationContract(); this.listenForAppSurfaces(); this.base.mount(); this.observe(); this.overlayBay.mount(); this.syncAppFrame(); return this; }
  update(snapshot: SpaceMountainShellSnapshotV1) { this.snapshot = snapshot; this.base.update(snapshot); this.overlayBay.update(snapshot); this.syncAppFrame(); this.applyAppSurfaceManifest(); }
  updatePersonalUsage(usage: SpaceMountainShellSnapshotV1["usage"]) { this.base.updatePersonalUsage(usage); if (usage) this.snapshot = { ...this.snapshot, usage }; this.appFrameHost?.sync(); }
  destroy() { this.observer?.disconnect(); this.observer = undefined; if (this.surfaceListener) window.removeEventListener("message", this.surfaceListener); this.surfaceListener = undefined; this.stopAppFrame(); this.base.destroy(); }

  private installAppFramePresentationContract() {
    const document = this.options.root.ownerDocument;
    if (document.getElementById(APPFRAME_PRESENTATION_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = APPFRAME_PRESENTATION_STYLE_ID;
    style.textContent = APPFRAME_PRESENTATION_CSS;
    document.head.append(style);
  }

  private listenForAppSurfaces() {
    if (this.surfaceListener) return;
    this.surfaceListener = (event) => {
      const frame = this.appFrame;
      if (!frame || event.source !== frame.contentWindow || event.origin !== this.appFrameOrigin || !isAppSurfaceMessageV1(event.data)) return;
      const message = event.data;
      const appId = this.options.root.dataset.spmtApp ?? "";
      if (message.type === "surface.manifest") {
        if (message.manifest.appId !== appId) return;
        this.surfaceManifest = message.manifest;
        const home = message.manifest.pages.find((page) => page.home)?.id ?? "home";
        if (!message.manifest.pages.some((page) => page.id === this.activeSurfacePage)) this.activeSurfacePage = home;
        this.applyAppSurfaceManifest();
      } else if (message.appId === appId && message.type === "page.changed") {
        this.activeSurfacePage = message.pageId;
        this.syncSurfacePageState();
      }
    };
    window.addEventListener("message", this.surfaceListener);
  }

  private observe() {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => queueMicrotask(() => { this.overlayBay.mount(); this.syncAppFrame(); this.applyAppSurfaceManifest(); }));
    this.observer.observe(this.options.root, { childList: true, subtree: true });
  }

  private syncAppFrame() {
    const frame = this.options.root.querySelector<HTMLIFrameElement>("[data-shell-app-frame]") ?? undefined;
    if (!frame) { this.stopAppFrame(); return; }
    this.applyAppFramePresentation(frame);
    const appId = this.options.root.dataset.spmtApp ?? "";
    const app = this.snapshot.apps.find((item) => item.appId === appId && item.installed && item.enabled && item.surfaces.includes("shell"));
    if (!app) { this.stopAppFrame(); return; }
    if (frame === this.appFrame && this.appFrameHost) { this.appFrameHost.sync(); this.applyAppSurfaceManifest(); return; }

    this.stopAppFrame();
    const target = buildAppFrameTarget(app, this.snapshot.tenantId, "shell", crypto.randomUUID());
    if (frame.getAttribute("src") !== target.url) frame.setAttribute("src", target.url);
    this.appFrame = frame;
    this.appFrameOrigin = target.allowedOrigin;
    this.activeSurfacePage = "home";
    this.appFrameHost = createAppFrameHost({
      frame,
      allowedOrigin: target.allowedOrigin,
      launch: target.launch,
      getState: () => {
        const runtimeDetail = appRuntimeDetail(this.snapshot, app);
        return {
          authenticated: Boolean(this.snapshot.session),
          userId: this.snapshot.userId,
          tenantId: this.snapshot.tenantId,
          theme: bridgeTheme(this.snapshot.workspace),
          layout: this.shellLayout(),
          grants: app.grantedScopes.map((scope) => ({ scope, granted: true })),
          runtimeState: appRuntimeState(this.snapshot, app),
          ...(runtimeDetail ? { runtimeDetail } : {}),
        };
      },
      onMessage: (message) => this.handleAppFrameMessage(frame, target.allowedOrigin, message),
    });
    this.appFrameHost.start();
  }

  private applyAppFramePresentation(frame: HTMLIFrameElement) {
    const shell = frame.closest<HTMLElement>(".spmt-embedded-app-shell");
    if (shell) {
      shell.style.border = "0";
      shell.style.borderRadius = "0";
      shell.style.background = "transparent";
      shell.style.boxShadow = "none";
    }
    frame.style.background = "transparent";
    frame.style.setProperty("color-scheme", "normal");
    frame.setAttribute("allowtransparency", "true");
  }

  private applyAppSurfaceManifest() {
    const manifest = this.surfaceManifest;
    const frame = this.appFrame;
    const appId = this.options.root.dataset.spmtApp ?? "";
    if (!manifest || !frame || manifest.appId !== appId) return;
    const appearance = record(this.snapshot.workspace?.appearance);
    installProductBackdrop(this.options.root, resolveProductBackdrop(
      { appId, imageUrl: manifest.scene.imageUrl, ...(manifest.scene.imagePosition ? { imagePosition: manifest.scene.imagePosition } : {}) },
      text(appearance?.theme), text(appearance?.accent), text(appearance?.backgroundUrl), text(appearance?.accentSecondary),
    ));
    const owner = this.options.root.querySelector<HTMLElement>(".spmt-dock-owned");
    const app = this.snapshot.apps.find((item) => item.appId === appId);
    if (!owner || !app) return;
    const signature = `${manifest.appId}:${manifest.pages.map((page) => `${page.id}:${page.label}`).join("|")}`;
    if (owner.dataset.spmtSurfaceSignature !== signature) {
      owner.dataset.spmtSurfaceSignature = signature;
      const theme = bridgeTheme(this.snapshot.workspace);
      const iconUrl = app.iconUrl || `/assets/product/app-icons/${theme.themeId ?? "solar-flare"}/${encodeURIComponent(appId)}.png`;
      owner.innerHTML = `<header><img src="${escapeHtml(iconUrl)}" alt=""><strong>${escapeHtml(app.name)}</strong></header>${manifest.pages.map((page) => `<button type="button" data-spmt-surface-page="${escapeHtml(page.id)}" title="${escapeHtml(page.description ? `${page.label} — ${page.description}` : page.label)}"><span class="spmt-surface-glyph">${escapeHtml(page.glyph ?? (page.home ? "⌂" : "◇"))}</span><label>${escapeHtml(page.label)}</label></button>`).join("")}`;
      owner.querySelectorAll<HTMLButtonElement>("[data-spmt-surface-page]").forEach((button) => button.addEventListener("click", () => this.openSurfacePage(button.dataset.spmtSurfacePage ?? "")));
    }
    this.syncSurfacePageState();
  }

  private openSurfacePage(pageId: string) {
    const manifest = this.surfaceManifest;
    const frame = this.appFrame;
    if (!manifest || !frame || !manifest.pages.some((page) => page.id === pageId)) return;
    frame.contentWindow?.postMessage({ protocol: "spmt.surface", version: 1, type: "page.open", appId: manifest.appId, pageId }, this.appFrameOrigin);
  }

  private syncSurfacePageState() {
    this.options.root.querySelectorAll<HTMLButtonElement>("[data-spmt-surface-page]").forEach((button) => {
      const active = button.dataset.spmtSurfacePage === this.activeSurfacePage;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
  }

  private stopAppFrame() { this.appFrameHost?.stop(); this.appFrameHost = undefined; this.appFrame = undefined; this.appFrameOrigin = ""; this.surfaceManifest = undefined; this.activeSurfacePage = "home"; }
  private shellLayout() {
    const header = this.options.root.querySelector<HTMLElement>("[data-spmt-shell-header]");
    if (header) return measureShellLayout({ header, onChange: () => undefined });
    return { schemaVersion: 1 as const, headerHeight: 0, safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0, availableWidth: window.innerWidth, availableHeight: window.innerHeight, measuredAt: new Date().toISOString() };
  }
  private handleAppFrameMessage(frame: HTMLIFrameElement, allowedOrigin: string, message: EmbedBridgeMessageV1) {
    if (message.type !== "navigation.open") return;
    let target: URL;
    try { target = new URL(message.url, frame.src); } catch { return; }
    if (target.origin !== allowedOrigin) return;
    if (message.target === "shell") frame.src = target.toString();
    else window.open(target.toString(), message.target === "popout" ? `spmt-${this.options.root.dataset.spmtApp ?? "app"}` : "_blank", "noopener,noreferrer");
  }
}

type ExtendedThemeTokensV1 = ThemeTokensV1 & { themeId?: string; accentSecondary?: string; backgroundUrl?: string; starDensity?: number; glassOpacity?: number; blurStrength?: number; glowIntensity?: number; nebulaIntensity?: number; parallaxDepth?: number; borderStrength?: number; chatTransparency?: number; };
function bridgeTheme(workspace: Record<string, unknown> | undefined): ExtendedThemeTokensV1 {
  const appearance = record(workspace?.appearance);
  const preset = resolveProductTheme(text(appearance?.theme), text(appearance?.accent), text(appearance?.accentSecondary));
  const density = appearance?.density === "compact" || appearance?.density === "spacious" ? appearance.density : "comfortable";
  const motion = appearance?.smoothTransitions === false ? "reduced" : "full";
  const backgroundUrl = text(appearance?.backgroundUrl);
  return { schemaVersion: 1, background: backgroundUrl ?? "#050710", surface: "#080a11", text: "#f8fafc", accent: preset.accent, radius: "24px", density, motion, themeId: preset.id, accentSecondary: preset.accentSecondary, ...(backgroundUrl ? { backgroundUrl } : {}), starDensity: boundedNumber(appearance?.starDensity, 70), glassOpacity: boundedNumber(appearance?.glassOpacity, 76), blurStrength: boundedNumber(appearance?.blurStrength, 18), glowIntensity: boundedNumber(appearance?.glowIntensity, 55), nebulaIntensity: boundedNumber(appearance?.nebulaIntensity, 55), parallaxDepth: boundedNumber(appearance?.parallaxDepth, 35), borderStrength: boundedNumber(appearance?.borderStrength, 35), chatTransparency: boundedNumber(appearance?.chatTransparency, 15) };
}
function appRuntimeState(snapshot: SpaceMountainShellSnapshotV1, app: SpaceMountainAppCardV1): RuntimeStateV1 { const projection = snapshot.runtimeStates.find((item) => text(item.appId) === app.appId); const state = text(projection?.state); return state === "starting" || state === "ready" || state === "degraded" || state === "draining" || state === "unavailable" ? state : "ready"; }
function appRuntimeDetail(snapshot: SpaceMountainShellSnapshotV1, app: SpaceMountainAppCardV1) { return text(snapshot.runtimeStates.find((item) => text(item.appId) === app.appId)?.detail); }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown) { return typeof value === "string" && value ? value : undefined; }
function boundedNumber(value: unknown, fallback: number) { const number = typeof value === "number" && Number.isFinite(value) ? value : fallback; return Math.max(0, Math.min(100, number)); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
