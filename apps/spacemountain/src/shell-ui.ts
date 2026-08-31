import { createAppFrameHost, measureShellLayout } from "@spmt/embed";
import type { EmbedBridgeMessageV1, RuntimeStateV1, ThemeTokensV1 } from "@spmt/contracts";
import { installProductBackdrop, resolveProductBackdrop, resolveProductTheme } from "@spmt/ui";
import { SpaceMountainShellUi as BaseShellUi, type SpaceMountainUiOptions } from "./shell-ui-base.js";
import { buildAppFrameTarget, type SpaceMountainAppCardV1, type SpaceMountainShellSnapshotV1 } from "./index.js";
import { OverlayBayParityController } from "./overlay-bay-ui.js";
export type { SpaceMountainUiOptions, SpaceMountainViewV1 } from "./shell-ui-base.js";
export { SPACE_MOUNTAIN_CSS } from "./shell-ui-base.js";

interface AppSurfacePageV1 { id: string; label: string; description?: string; glyph?: string; home?: boolean; }
interface AppSurfaceManifestV1 {
  schemaVersion: 1;
  appId: string;
  scene: { imageUrl: string; imagePosition?: string };
  pages: AppSurfacePageV1[];
  shortcuts?: Array<{ id: string; label: string; pageId: string }>;
}
type AppSurfaceMessageV1 =
  | { protocol: "spmt.surface"; version: 1; type: "surface.manifest"; manifest: AppSurfaceManifestV1 }
  | { protocol: "spmt.surface"; version: 1; type: "page.changed"; appId: string; pageId: string };
function isAppSurfaceMessageV1(value: unknown): value is AppSurfaceMessageV1 {
  const message = record(value);
  if (!message || message.protocol !== "spmt.surface" || message.version !== 1) return false;
  if (message.type === "page.changed") return Boolean(text(message.appId) && text(message.pageId));
  if (message.type !== "surface.manifest") return false;
  const manifest = record(message.manifest);
  const scene = record(manifest?.scene);
  if (!manifest || manifest.schemaVersion !== 1 || !text(manifest.appId) || !scene || !text(scene.imageUrl) || !Array.isArray(manifest.pages) || !manifest.pages.length) return false;
  return manifest.pages.every((page) => { const item = record(page); return Boolean(item && text(item.id) && text(item.label)); });
}

const APPFRAME_PRESENTATION_STYLE_ID = "spmt-appframe-presentation-contract";
const APPFRAME_PRESENTATION_CSS = `
.spmt-embedded-app-shell{border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
.spmt-embedded-app-shell iframe[data-shell-app-frame]{display:block!important;width:100%!important;height:100%!important;border:0!important;border-radius:0!important;background:transparent!important;color-scheme:normal!important}
.spmt-space-root[data-spmt-view="app"] .spmt-space-main{position:fixed!important;right:14px!important;bottom:14px!important;left:14px!important;width:auto!important;max-width:none!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:hidden!important}
.spmt-space-root[data-spmt-view="app"] .spmt-embedded-app-shell{width:100%!important;height:100%!important;min-height:0!important;overflow:hidden!important}
.spmt-rocket-dock{z-index:860!important}.spmt-workspace-tray{z-index:870!important}.spmt-shell-header-stack{z-index:880!important}
.spmt-dock-owned header{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:26px minmax(0,1fr);align-items:center;gap:7px;padding:5px 5px 7px;background:linear-gradient(180deg,rgba(8,9,14,.96),rgba(8,9,14,.72));font-size:8px}.spmt-dock-owned header img{width:26px;height:26px;object-fit:contain}.spmt-dock-owned header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.spmt-surface-glyph{width:27px;height:27px;display:grid;place-items:center;flex:0 0 auto;border:1px solid color-mix(in srgb,var(--accent2) 25%,transparent);border-radius:9px;color:var(--accent2);font-size:13px;font-weight:900}.spmt-dock-owned button[aria-current="page"]{color:#fff;border-color:color-mix(in srgb,var(--accent) 34%,transparent);background:color-mix(in srgb,var(--accent) 14%,transparent);box-shadow:inset 3px 0 0 var(--accent)}
.spmt-space-root *{scrollbar-width:thin;scrollbar-color:transparent transparent}.spmt-space-root *:hover{scrollbar-color:color-mix(in srgb,var(--accent) 62%,transparent) transparent}.spmt-space-root *::-webkit-scrollbar{width:4px;height:4px}.spmt-space-root *::-webkit-scrollbar-track{background:transparent}.spmt-space-root *::-webkit-scrollbar-thumb{border-radius:999px;background:transparent}.spmt-space-root *:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--accent) 62%,transparent)}
@media(max-width:900px){
 .spmt-shell-header-stack{left:108px!important;right:10px!important}
 .spmt-rocket-dock{left:10px!important;right:auto!important;width:88px!important;height:auto!important;max-height:calc(100dvh - var(--guard-height,38px) - 20px)!important;box-sizing:border-box!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;padding:7px!important;border-radius:34px!important}
 .spmt-dock-orbit{display:grid!important;width:68px!important;height:62px!important;margin:0 auto 3px!important}
 .spmt-rocket-dock nav{width:100%!important;min-height:0!important;display:flex!important;flex:1!important;flex-direction:column!important;justify-content:flex-start!important;overflow:hidden!important}
 .spmt-dock-core,.spmt-dock-account,.spmt-dock-apps{min-width:0!important;display:flex!important;flex-direction:column!important}.spmt-dock-apps{overflow-y:auto!important;overflow-x:hidden!important}
 .spmt-rocket-dock nav button{min-height:43px!important;flex:0 0 auto!important;flex-direction:column!important;justify-content:center!important;gap:2px!important;padding:4px!important}.spmt-rocket-dock nav label{display:none!important}.spmt-dock-owned header{grid-template-columns:1fr;justify-items:center}.spmt-dock-owned header strong{display:none}
 .spmt-space-root[data-spmt-dock="collapsed"] .spmt-rocket-dock{left:10px!important;right:auto!important;bottom:auto!important;width:72px!important;height:70px!important;min-height:0!important;padding:4px!important}.spmt-space-root[data-spmt-dock="collapsed"] .spmt-dock-orbit{display:grid!important;width:100%!important;height:100%!important;margin:0!important}.spmt-space-root[data-spmt-dock="collapsed"] .spmt-shell-header-stack{left:94px!important}
 .spmt-space-root[data-spmt-view="app"] .spmt-space-main{right:9px!important;bottom:9px!important;left:9px!important}
 .spmt-workspace-tray{left:10px!important;right:10px!important;bottom:max(10px,env(safe-area-inset-bottom))!important}.spmt-workspace-frames{height:min(68dvh,640px)!important}.spmt-workspace-tray.maximized .spmt-workspace-frames{left:10px!important;right:10px!important;bottom:84px!important}
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
  private geometryListener: (() => void) | undefined;

  constructor(private readonly options: SpaceMountainUiOptions) {
    this.snapshot = options.snapshot;
    this.base = new BaseShellUi(options);
    this.overlayBay = new OverlayBayParityController(options.root, this.snapshot);
  }
  mount() { this.installAppFramePresentationContract(); this.base.mount(); this.listenForAppSurfaces(); this.bindShellGeometry(); this.observe(); this.overlayBay.mount(); this.syncAppFrame(); return this; }
  update(snapshot: SpaceMountainShellSnapshotV1) { this.snapshot = snapshot; this.base.update(snapshot); this.overlayBay.update(snapshot); this.applyShellGeometry(); this.syncAppFrame(); this.applyAppSurfaceManifest(); }
  updatePersonalUsage(usage: SpaceMountainShellSnapshotV1["usage"]) { this.base.updatePersonalUsage(usage); if (usage) this.snapshot = { ...this.snapshot, usage }; this.appFrameHost?.sync(); }
  destroy() { this.observer?.disconnect(); this.observer = undefined; if (this.surfaceListener) window.removeEventListener("message", this.surfaceListener); this.surfaceListener = undefined; if (this.geometryListener) { window.removeEventListener("resize", this.geometryListener); window.visualViewport?.removeEventListener("resize", this.geometryListener); } this.geometryListener = undefined; this.stopAppFrame(); this.base.destroy(); }

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

  private bindShellGeometry() {
    if (!this.geometryListener) {
      this.geometryListener = () => this.applyShellGeometry();
      window.addEventListener("resize", this.geometryListener);
      window.visualViewport?.addEventListener("resize", this.geometryListener);
    }
    this.applyShellGeometry();
  }

  private applyShellGeometry() {
    const root = this.options.root;
    const header = root.querySelector<HTMLElement>("[data-spmt-shell-header]");
    const main = root.querySelector<HTMLElement>(".spmt-space-main");
    const dock = root.querySelector<HTMLElement>(".spmt-rocket-dock");
    if (!header || !main || !dock) return;
    const headerRect = header.getBoundingClientRect();
    const mobile = window.matchMedia("(max-width:900px)").matches;
    const gap = mobile ? 10 : 14;
    const edge = mobile ? 9 : 14;
    main.style.setProperty("position", "fixed", "important");
    main.style.setProperty("top", `${Math.ceil(headerRect.bottom) + gap}px`, "important");
    main.style.setProperty("right", `${edge}px`, "important");
    main.style.setProperty("bottom", `${edge}px`, "important");
    main.style.setProperty("left", `${edge}px`, "important");
    main.style.setProperty("width", "auto", "important");
    main.style.setProperty("max-width", "none", "important");
    main.style.setProperty("height", "auto", "important");
    main.style.setProperty("min-height", "0", "important");
    main.style.setProperty("margin", "0", "important");
    if (root.dataset.spmtView === "app") {
      main.style.setProperty("padding", "0", "important");
      main.style.setProperty("overflow", "hidden", "important");
    }
    dock.style.setProperty("position", "fixed", "important");
    dock.style.setProperty("left", mobile ? "10px" : "16px", "important");
    dock.style.setProperty("right", "auto", "important");
    dock.style.setProperty("top", `${Math.max(8, Math.ceil(headerRect.top))}px`, "important");
    if (root.dataset.spmtDock === "collapsed") {
      dock.style.setProperty("bottom", "auto", "important");
      dock.style.setProperty("width", mobile ? "72px" : "112px", "important");
      dock.style.setProperty("height", mobile ? "70px" : "82px", "important");
      dock.style.setProperty("min-height", "0", "important");
    }
  }

  private observe() {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => queueMicrotask(() => { this.overlayBay.mount(); this.applyShellGeometry(); this.syncAppFrame(); this.applyAppSurfaceManifest(); }));
    this.observer.observe(this.options.root, { childList: true, subtree: true });
  }

  private syncAppFrame() {
    this.applyShellGeometry();
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
    if (header) {
      const layout = measureShellLayout({ header, onChange: () => undefined });
      const headerTop = Math.max(0, Math.ceil(header.getBoundingClientRect().top));
      return { ...layout, safeTop: Math.max(layout.safeTop, headerTop) };
    }
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
