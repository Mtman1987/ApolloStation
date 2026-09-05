import { applyShellLayoutMetrics, observeShellLayout } from "@spmt/embed";
import { SPMT_SIMULATION_ROOM_EVENT, type MeteredResourceV1, type OperationsLogV1, type PersonalUsageResourceV1 } from "@spmt/contracts";
import { bindProductRocketNavigation, installProductBackdrop, PRODUCT_UI_CSS, resolveProductBackdrop, resolveProductTheme, type ProductSceneV1 } from "@spmt/ui";
import { DEFERRED_RUNTIME_SOURCES, type SourceStateV1, type SpaceMountainAppCardV1, type SpaceMountainShellSnapshotV1 } from "./index.js";
import { POLISHED_SPACE_MOUNTAIN_CSS } from "./product-shell-css.js";
import { THEMED_SURFACE_CSS } from "./themed-surface-css.js";

const VISUAL_FINISH_CSS = `.spmt-header-action-icon{display:block;width:28px;height:28px;object-fit:contain;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--accent2) 55%,transparent))}.spmt-core-nav-icon{width:30px;height:30px;display:grid;place-items:center;flex:0 0 auto}.spmt-core-nav-icon img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--accent2) 55%,transparent))}.spmt-core-nav-icon .spmt-svg{width:24px;height:24px;color:var(--accent2);filter:drop-shadow(0 0 7px color-mix(in srgb,var(--accent2) 45%,transparent))}.spmt-rocket-dock .spmt-core-nav-icon{width:27px;height:27px}.spmt-header-actions .spmt-core-nav-icon{width:28px;height:28px}.spmt-account-summary{display:flex;align-items:center;gap:8px;padding:0 3px;cursor:pointer;border-radius:12px}.spmt-account-summary:hover,.spmt-account-summary:focus-visible{background:color-mix(in srgb,var(--accent) 12%,transparent);outline:1px solid var(--theme-border)}.spmt-space-root[data-spmt-view="home"] .spmt-hero-logo-large{width:min(820px,100%)!important;height:clamp(180px,48cqh,390px)!important;max-height:66%!important;margin:0!important;object-fit:contain!important;object-position:left center!important;filter:drop-shadow(0 0 26px color-mix(in srgb,var(--accent2) 36%,transparent))}.spmt-theme-native{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important}.spmt-theme-picker{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.spmt-theme-picker button{min-height:104px;display:grid;place-items:center;gap:4px;padding:10px;border:1px solid var(--border);border-radius:16px;background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 10%,#050713),#050713);color:white}.spmt-theme-picker button:hover,.spmt-theme-picker button[aria-pressed="true"]{border-color:var(--accent2);box-shadow:0 0 24px color-mix(in srgb,var(--accent2) 30%,transparent);transform:translateY(-2px)}.spmt-theme-picker img{width:100%;height:58px;object-fit:contain}.spmt-theme-picker span{font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}@media(max-width:1040px){.spmt-account-summary .spmt-account-copy{display:none}}@media(max-width:800px){.spmt-theme-picker{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
const PERSONAL_OVERLAY_CSS = `.spmt-shell-personal-overlay{position:fixed;inset:0;width:100%;height:100%;border:0;z-index:14;pointer-events:none;background:transparent;color-scheme:normal}.spmt-shell-personal-overlay[hidden]{display:none}.spmt-workspace-surfaces button.active{color:#bbf7d0;border-color:color-mix(in srgb,#22c55e 55%,transparent)}.spmt-simulation-rooms{height:100%;overflow:auto;padding:14px;background:rgba(4,6,14,.96)}.spmt-simulation-rooms>header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--border);border-radius:14px;background:rgba(8,10,20,.96)}.spmt-simulation-rooms h2,.spmt-simulation-rooms p{margin:0}.spmt-simulation-rooms p{color:#a8aab7;font-size:11px}.spmt-simulation-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:9px;margin-top:10px}.spmt-simulation-event{display:grid;gap:6px;padding:11px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.035)}.spmt-simulation-event>span{color:var(--accent2);font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.spmt-simulation-event small{color:#858795}.spmt-simulation-empty{padding:24px;border:1px dashed var(--border);border-radius:14px;color:#858795;text-align:center}`;

export type SpaceMountainViewV1 = "home" | "apps" | "workspace" | "settings" | "account";
type CommlinkFilterV1 = "all" | "chat" | "events" | "streamweaver" | "queued";
interface CommlinkWorkspaceUiV1 {
  schemaVersion: 1;
  chatSpaces: Array<{ id: string; name: string; sourceIds: string[] }>;
  desks: Array<{ id: string; name: string; chatSpaceIds: string[] }>;
  activeChatSpaceId: string;
  activeDeskId: string;
  view: "focus" | "desk";
  filter: CommlinkFilterV1;
  compact: boolean;
}
export interface SpaceMountainUiOptions {
  root: HTMLElement;
  snapshot: SpaceMountainShellSnapshotV1;
  onNavigate?: (view: SpaceMountainViewV1) => void;
  onLaunchApp?: (app: SpaceMountainAppCardV1) => void;
  onInstallApp?: (app: SpaceMountainAppCardV1) => void;
  onOpenConversation?: (conversation: Record<string, unknown>) => void;
  onSearchCommlink?: (query: string) => void;
  onSendCommlinkMessage?: (conversation: Record<string, unknown>, text: string) => void;
  onComposeCommlinkMail?: (recipientUserIds: string[], subject: string, text: string) => void;
  onMarkAllCommlinkRead?: () => void;
  onInvokeStella?: (message: string, conversationId: string, routingPreference: "automatic" | "hosted" | "companion", remember: boolean) => void;
  onExportStellarData?: () => void;
  onDeleteStellarData?: () => void;
  onMarkNotificationRead?: (notification: Record<string, unknown>) => void;
  onUnlinkProvider?: (link: Record<string, unknown>) => void;
  onSaveWorkspace?: (expectedRevision: number, patch: Record<string, unknown>) => void;
  onPrepareCoderLog?: (log: OperationsLogV1) => void;
  onPrepareCoderPrompt?: (appId: string, prompt: string) => void;
  onIssueOverlayOutput?: (appId: string, widgetId: string, personal: boolean) => void;
  onRevokeOverlayOutput?: (grantId: string) => void;
}

const NAV: Array<{ id: SpaceMountainViewV1; label: string; description: string; icon: IconName }> = [
  { id: "home", label: "Home", description: "SpaceMountain ecosystem home.", icon: "home" },
  { id: "apps", label: "Shipyard", description: "Install, launch, and manage ecosystem apps.", icon: "grid" },
  { id: "workspace", label: "Workspace", description: "Canonical overlays, scenes, appearance, and three persistent slots.", icon: "layout" },
  { id: "settings", label: "Settings", description: "Configure ecosystem apps and advanced behavior.", icon: "settings" },
];
const SHELL_APP_RENDERERS = new Set(["commlink", "stellar-core", "mission-control"]);
interface AppDockItemV1 { label: string; description: string; icon: IconName; target: string; }
const APP_DOCK_NAVIGATION: Readonly<Record<string, readonly AppDockItemV1[]>> = {
  commlink: [
    { label: "ChatSpaces", description: "Saved communication spaces and source selection.", icon: "mail", target: ".cosmo-rail" },
    { label: "Feed", description: "The active canonical message and event feed.", icon: "pulse", target: ".cosmo-feed" },
    { label: "Compose", description: "Write new private account mail or reply to a conversation.", icon: "arrow", target: "[data-commlink-new-mail]" },
  ],
  "stellar-core": [
    { label: "Stella", description: "Talk with the ecosystem assistant.", icon: "spark", target: "[data-stella-form]" },
    { label: "Models", description: "Owner-visible inference platform and model controls.", icon: "grid", target: ".spmt-command-grid" },
    { label: "Context", description: "Authorized context and capabilities.", icon: "layout", target: ".spmt-context-grid" },
  ],
  "mission-control": [
    { label: "Evidence", description: "Recent scoped operational evidence.", icon: "pulse", target: ".spmt-account-section" },
    { label: "Coder", description: "Prepare and inspect Coder work.", icon: "rocket", target: "[data-coder-form]" },
  ],
  "nebula-arcade": [
    { label: "Games", description: "Browse every equal game title.", icon: "grid", target: "#games" },
    { label: "Play", description: "Open the selected game console.", icon: "rocket", target: "#game-console" },
    { label: "Scores", description: "View the active game leaderboard.", icon: "pulse", target: "#leaderboard-panel" },
    { label: "Settings", description: "Edit Nebula Arcade through the canonical workspace.", icon: "settings", target: "#open-settings" },
  ],
};

const SPACEMOUNTAIN_SCENE: ProductSceneV1 = Object.freeze({
  appId: "spacemountain",
  imageUrl: "/assets/product/theme-solar-flare-background.webp",
  imagePosition: "center",
});
const SHELL_APP_SCENES: Readonly<Record<string, ProductSceneV1>> = Object.freeze({
  commlink: Object.freeze({ appId: "commlink", imageUrl: "/assets/product/commlink-communications-background.webp", imagePosition: "center" }),
  "stellar-core": Object.freeze({ appId: "stellar-core", imageUrl: "/assets/product/stellar-core-background.webp", imagePosition: "center" }),
  "mission-control": Object.freeze({ appId: "mission-control", imageUrl: "/assets/product/mission-control-background.webp", imagePosition: "center" }),
  "nebula-arcade": Object.freeze({ appId: "nebula-arcade", imageUrl: "/assets/nebula-arcade/solar-system.webp", imagePosition: "center" }),
  "discord-stream-hub": Object.freeze({ appId: "discord-stream-hub", imageUrl: "/assets/product/discord-stream-hub-background.webp", imagePosition: "center" }),
  streamweaver: Object.freeze({ appId: "streamweaver", imageUrl: "/assets/product/streamweaver-background.webp", imagePosition: "center" }),
  hearmeout: Object.freeze({ appId: "hearmeout", imageUrl: "/assets/product/hearmeout-background.webp", imagePosition: "center" }),
  mountainview: Object.freeze({ appId: "mountainview", imageUrl: "/assets/product/mountainview-background.webp", imagePosition: "center" }),
  companion: Object.freeze({ appId: "companion", imageUrl: "/assets/product/companion-background.webp", imagePosition: "center" }),
});

export class SpaceMountainShellUi {
  private snapshot: SpaceMountainShellSnapshotV1;
  private view: SpaceMountainViewV1 = "home";
  private activeAppId: string | undefined;
  private stopLayout: (() => void) | undefined;
  private clockTimer: number | undefined;
  private workspaceTray: HTMLElement | undefined;
  private personalOverlay: HTMLIFrameElement | undefined;
  private personalOverlayVisible = true;
  private workspaceOpen = false;
  private workspaceExpanded = false;
  private workspaceMaximized = false;
  private workspaceClickThrough = false;
  private workspaceOpacity = 92;
  private workspaceTarget = 0;
  private simulationRoomsOpen = false;
  private simulationRoomEvents: Array<Record<string, unknown>> = [];
  private dockCollapsed = false;
  private commlinkDraft: CommlinkWorkspaceUiV1 | undefined;

  constructor(private readonly options: SpaceMountainUiOptions) {
    this.snapshot = options.snapshot;
    if (typeof window !== "undefined") {
      const requested = new URLSearchParams(window.location.search).get("view");
      if (requested === "account" || NAV.some((item) => item.id === requested)) this.view = requested as SpaceMountainViewV1;
      if (new URLSearchParams(window.location.search).get("surface") === "simulation") { this.workspaceOpen = true; this.workspaceExpanded = true; this.simulationRoomsOpen = true; }
      const requestedApp = new URLSearchParams(window.location.search).get("app");
      if (requestedApp && this.shellApp(requestedApp)) this.activeAppId = requestedApp;
      const matchedApp = window.location.pathname.match(/^\/apps\/([^/]+)$/)?.[1];
      if (!this.activeAppId && matchedApp && SHELL_APP_RENDERERS.has(decodeURIComponent(matchedApp))) this.activeAppId = decodeURIComponent(matchedApp);
      try { this.personalOverlayVisible = window.localStorage.getItem("spmt:personal-overlay-visible") !== "off"; } catch {}
    }
  }

  mount() { this.options.root.classList.add("spmt-space-root", "spmt-product-surface"); this.render(); return this; }
  openSimulationRooms() { this.simulationRoomsOpen = true; this.workspaceOpen = true; this.workspaceExpanded = true; this.workspaceMaximized = false; this.syncWorkspaceTray(); void this.loadSimulationRooms(); }
  update(snapshot: SpaceMountainShellSnapshotV1) { this.snapshot = snapshot; this.commlinkDraft = undefined; if (this.activeAppId && !this.shellApp(this.activeAppId)) this.activeAppId = undefined; this.render(); }
  updatePersonalUsage(usage: SpaceMountainShellSnapshotV1["usage"]) { this.snapshot = { ...this.snapshot, ...(usage ? { usage } : {}) }; if (!this.activeAppId && this.view === "account") this.render(); }
  destroy() { this.stopLayout?.(); this.stopLayout = undefined; if (this.clockTimer !== undefined) window.clearInterval(this.clockTimer); this.clockTimer = undefined; this.options.root.replaceChildren(); }

  private bindLayout() {
    this.stopLayout?.();
    const header = this.options.root.querySelector<HTMLElement>("[data-spmt-shell-header]");
    if (!header) { this.stopLayout = undefined; return; }
    this.stopLayout = observeShellLayout({ header, onChange: (layout) => applyShellLayoutMetrics(this.options.root, "shell", layout) });
  }

  navigate(view: SpaceMountainViewV1) {
    this.activeAppId = undefined;
    this.view = view;
    if (typeof window !== "undefined") window.history.pushState(null, "", view === "home" ? "/" : `/?view=${view}`);
    this.options.onNavigate?.(view);
    this.render();
  }

  private openApp(app: SpaceMountainAppCardV1) {
    if (!this.shellApp(app.appId)) return this.options.onLaunchApp?.(app);
    this.activeAppId = app.appId;
    if (typeof window !== "undefined") {
      const target = new URL(window.location.href);
      target.pathname = "/";
      target.search = "";
      target.searchParams.set("app", app.appId);
      window.history.pushState(null, "", `${target.pathname}${target.search}`);
    }
    this.render();
  }

  private render() {
    const root = this.options.root;
    const appearance = recordObject(this.snapshot.workspace, "appearance");
    const accent = recordText(appearance, ["accent"]);
    const accentSecondary = recordText(appearance, ["accentSecondary", "accent_secondary"]);
    const backgroundUrl = recordText(appearance, ["backgroundUrl", "background_url"]);
    const configuredTheme = recordText(appearance, ["theme"]);
    const scene = this.activeAppId ? SHELL_APP_SCENES[this.activeAppId] ?? SPACEMOUNTAIN_SCENE : SPACEMOUNTAIN_SCENE;
    const backdrop = resolveProductBackdrop(scene, configuredTheme, accent, backgroundUrl, accentSecondary);
    const theme = resolveProductTheme(backdrop.theme.id, backdrop.theme.accent, accentSecondary);
    root.dataset.spmtView = this.activeAppId ? "app" : this.view;
    root.dataset.spmtDock = this.dockCollapsed ? "collapsed" : "expanded";
    if (this.activeAppId) root.dataset.spmtApp = this.activeAppId; else delete root.dataset.spmtApp;
    root.dataset.theme = theme.id;
    root.dataset.spmtTheme = theme.id;
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--accent2", theme.accentSecondary);
    root.style.setProperty("--spmt-accent", theme.accent);
    root.style.setProperty("--spmt-accent-secondary", theme.accentSecondary);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme.accent);
    root.style.setProperty("--spmt-glow", `${recordNumber(appearance, "glowIntensity") ?? 55}%`);
    root.style.setProperty("--spmt-stars", String((recordNumber(appearance, "starDensity") ?? 70) / 100));
    root.style.setProperty("--spmt-glass-opacity", String((recordNumber(appearance, "glassOpacity") ?? 76) / 100));
    root.style.setProperty("--spmt-blur", `${recordNumber(appearance, "blurStrength") ?? 18}px`);
    const nebulaIntensity = recordNumber(appearance, "nebulaIntensity") ?? 55;
    const borderStrength = recordNumber(appearance, "borderStrength") ?? 35;
    const chatTransparency = recordNumber(appearance, "chatTransparency") ?? 15;
    const parallaxDepth = recordNumber(appearance, "parallaxDepth") ?? 35;
    root.style.setProperty("--spmt-surface-tint", `${Math.round(8 + nebulaIntensity * 0.12)}%`);
    root.style.setProperty("--spmt-tint-opacity", String(0.34 + nebulaIntensity * 0.0022));
    root.style.setProperty("--spmt-border-mix", `${Math.round(10 + borderStrength * 0.45)}%`);
    root.style.setProperty("--spmt-chat-opacity", String(Math.max(0.38, (100 - chatTransparency) / 100)));
    root.style.setProperty("--spmt-backdrop-scale", String(1.015 + parallaxDepth / 2000));
    const retainedTray = this.workspaceTray;
    const retainedPersonalOverlay = this.personalOverlay;
    retainedTray?.remove();
    retainedPersonalOverlay?.remove();
    root.innerHTML = `<style data-spmt-space-style>${PRODUCT_UI_CSS}${SPACE_MOUNTAIN_CSS}${POLISHED_SPACE_MOUNTAIN_CSS}${WORKSPACE_SETTINGS_CSS}${VISUAL_FINISH_CSS}${PERSONAL_OVERLAY_CSS}${COMMLINK_FORM_CSS}${COMMLINK_MAIL_CSS}${COSMO_COMMLINK_CSS}${THEMED_SURFACE_CSS}</style><div class="spmt-space-shell">${this.header()}${this.dock()}<main class="spmt-space-main">${this.body()}</main></div>`;
    this.personalOverlay = retainedPersonalOverlay ?? this.createPersonalOverlay();
    root.append(this.personalOverlay);
    this.workspaceTray = retainedTray ?? this.createWorkspaceTray();
    root.append(this.workspaceTray);
    this.syncPersonalOverlay();
    this.syncWorkspaceTray();
    installProductBackdrop(root, backdrop);
    bindProductRocketNavigation(root, NAV, this.view, (view) => this.navigate(view));
    root.querySelectorAll<HTMLElement>("[data-nav]").forEach((node) => node.addEventListener("click", () => this.navigate(node.dataset.nav as SpaceMountainViewV1)));
    root.querySelector<HTMLElement>(".spmt-account-summary")?.addEventListener("click", () => this.navigate("account"));
    root.querySelectorAll<HTMLElement>("[data-launch-app]").forEach((node) => node.addEventListener("click", () => { const app = this.snapshot.apps.find((item) => item.appId === node.dataset.launchApp); if (app) this.openApp(app); }));
    root.querySelectorAll<HTMLElement>("[data-app-dock-target]").forEach((node) => node.addEventListener("click", () => this.openAppDockTarget(node.dataset.appDockTarget ?? "")));
    root.querySelectorAll<HTMLElement>("[data-install-app]").forEach((node) => node.addEventListener("click", () => { const app = this.snapshot.apps.find((item) => item.appId === node.dataset.installApp); if (app) this.options.onInstallApp?.(app); }));
    root.querySelectorAll<HTMLElement>("[data-commlink-space]").forEach((node) => node.addEventListener("click", () => this.updateCommlink({ activeChatSpaceId: node.dataset.commlinkSpace ?? "", view: "focus" })));
    root.querySelectorAll<HTMLElement>("[data-commlink-desk]").forEach((node) => node.addEventListener("click", () => this.updateCommlink({ activeDeskId: node.dataset.commlinkDesk ?? "", view: "desk" })));
    root.querySelectorAll<HTMLElement>("[data-commlink-view]").forEach((node) => node.addEventListener("click", () => this.updateCommlink({ view: node.dataset.commlinkView === "desk" ? "desk" : "focus" })));
    root.querySelectorAll<HTMLElement>("[data-commlink-filter]").forEach((node) => node.addEventListener("click", () => this.updateCommlink({ filter: node.dataset.commlinkFilter as CommlinkFilterV1 })));
    root.querySelectorAll<HTMLElement>("[data-commlink-source]").forEach((node) => node.addEventListener("click", () => this.toggleCommlinkSource(node.dataset.commlinkSource ?? "")));
    root.querySelector<HTMLElement>("[data-commlink-new-space]")?.addEventListener("click", () => this.createChatSpace());
    root.querySelector<HTMLElement>("[data-commlink-new-desk]")?.addEventListener("click", () => this.createDesk());
    root.querySelector<HTMLElement>("[data-commlink-edit-space]")?.addEventListener("click", () => this.renameChatSpace());
    root.querySelector<HTMLElement>("[data-commlink-edit-desk]")?.addEventListener("click", () => this.renameDesk());
    root.querySelector<HTMLElement>("[data-commlink-delete-space]")?.addEventListener("click", () => this.deleteChatSpace());
    root.querySelector<HTMLElement>("[data-commlink-delete-desk]")?.addEventListener("click", () => this.deleteDesk());
    root.querySelector<HTMLElement>("[data-commlink-compact]")?.addEventListener("click", () => { const state = this.commlinkWorkspace(); this.updateCommlink({ compact: !state.compact }); });
    root.querySelector<HTMLElement>("[data-commlink-popout]")?.addEventListener("click", () => window.open(`${window.location.pathname}?view=commlink`, "spmt-commlink", "popup,width=1440,height=920"));
    root.querySelector<HTMLButtonElement>("[data-commlink-new-mail]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("[data-commlink-mail-dialog]")?.showModal());
    root.querySelector<HTMLButtonElement>("[data-commlink-mail-cancel]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("[data-commlink-mail-dialog]")?.close());
    root.querySelector<HTMLButtonElement>("[data-commlink-read-all]")?.addEventListener("click", () => this.options.onMarkAllCommlinkRead?.());
    root.querySelector<HTMLFormElement>("[data-commlink-mail-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const recipientUserIds = data.getAll("recipientUserIds").filter((value): value is string => typeof value === "string" && Boolean(value));
      const subject = String(data.get("subject") ?? "").trim();
      const message = String(data.get("message") ?? "").trim();
      if (recipientUserIds.length && message) {
        this.options.onComposeCommlinkMail?.(recipientUserIds, subject, message);
        root.querySelector<HTMLDialogElement>("[data-commlink-mail-dialog]")?.close();
        form.reset();
      }
    });
    root.querySelector<HTMLFormElement>("[data-commlink-compose]")?.addEventListener("submit", (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const text = String(new FormData(form).get("message") ?? "").trim(); const conversation = this.activeCommlinkConversation(); if (text && conversation) { this.options.onSendCommlinkMessage?.(conversation, text); form.reset(); } });
    root.querySelectorAll<HTMLElement>("[data-open-conversation]").forEach((node) => node.addEventListener("click", () => { const item = this.snapshot.conversations.find((conversation) => conversation.id === node.dataset.openConversation); if (item) this.options.onOpenConversation?.(item); }));
    root.querySelector<HTMLFormElement>("[data-commlink-search]")?.addEventListener("submit", (event) => { event.preventDefault(); const query = String(new FormData(event.currentTarget as HTMLFormElement).get("query") ?? "").trim(); if (query) this.options.onSearchCommlink?.(query); });
    root.querySelector<HTMLFormElement>("[data-stella-form]")?.addEventListener("submit", (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const values = new FormData(form); const message = String(values.get("message") ?? "").trim(); const rawRoute = String(values.get("routingPreference") ?? "automatic"); const route = rawRoute === "companion" || rawRoute === "hosted" ? rawRoute : "automatic"; const remember = values.get("remember") === "on"; if (message) { this.options.onInvokeStella?.(message, `stella-${this.snapshot.userId}`, route, remember); form.reset(); } });
    root.querySelector<HTMLElement>("[data-stellar-export]")?.addEventListener("click", () => this.options.onExportStellarData?.());
    root.querySelector<HTMLElement>("[data-stellar-delete]")?.addEventListener("click", () => this.options.onDeleteStellarData?.());
    root.querySelectorAll<HTMLElement>("[data-notification-read]").forEach((node) => node.addEventListener("click", () => { const item = this.snapshot.notifications.find((notification) => notification.id === node.dataset.notificationRead); if (item) this.options.onMarkNotificationRead?.(item); }));
    root.querySelectorAll<HTMLElement>("[data-provider-unlink]").forEach((node) => node.addEventListener("click", () => { const item = this.snapshot.providerLinks.find((link) => providerLinkKey(link) === node.dataset.providerUnlink); if (item) this.options.onUnlinkProvider?.(item); }));
    root.querySelectorAll<HTMLElement>("[data-provider-link]").forEach((node) => node.addEventListener("click", () => {
      const provider = node.dataset.providerLink;
      if (provider !== "twitch" && provider !== "discord") return;
      window.location.assign(`/v1/identity/providers/${provider}/start?tenantId=${encodeURIComponent(this.snapshot.tenantId)}`);
    }));
    root.querySelector<HTMLFormElement>("[data-workspace-settings]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const revision = recordNumber(this.snapshot.workspace, "revision");
      if (!revision) return;
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const value = (name: string) => String(form.get(name) ?? "").trim();
      const number = (name: string) => Math.max(0, Math.min(100, Number(value(name)) || 0));
      const checked = (name: string) => form.get(name) === "on";
      this.options.onSaveWorkspace?.(revision, {
        appearance: { theme: value("theme"), ...(value("accent") ? { accent: value("accent") } : {}), ...(value("accentSecondary") ? { accentSecondary: value("accentSecondary") } : {}), ...(value("backgroundUrl") ? { backgroundUrl: value("backgroundUrl") } : {}), glowIntensity: number("glowIntensity"), starDensity: number("starDensity"), glassOpacity: number("glassOpacity"), blurStrength: number("blurStrength"), nebulaIntensity: number("nebulaIntensity"), parallaxDepth: number("parallaxDepth"), borderStrength: number("borderStrength"), chatTransparency: number("chatTransparency"), density: value("density"), sidebarCollapsed: checked("sidebarCollapsed"), sidebarStyle: value("sidebarStyle"), sidebarPosition: value("sidebarPosition"), topbarStyle: value("topbarStyle"), tabStyle: value("tabStyle"), tabPosition: value("tabPosition"), showAvatars: checked("showAvatars"), smoothTransitions: checked("smoothTransitions"), pushToTalk: checked("pushToTalk"), animation: { speed: number("animationSpeed"), particles: checked("particles"), shootingStars: checked("shootingStars") } },
        dockSlots: [value("dockSlot0") || null, value("dockSlot1") || null, value("dockSlot2") || null],
      });
    });
    root.querySelectorAll<HTMLElement>("[data-coder-log]").forEach((node) => node.addEventListener("click", () => { const item = this.snapshot.operations.logs.find((log) => log.id === node.dataset.coderLog); if (item) this.options.onPrepareCoderLog?.(item); }));
    root.querySelector<HTMLFormElement>("[data-coder-form]")?.addEventListener("submit", (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const appId = String(form.get("appId") ?? "").trim(); const prompt = String(form.get("prompt") ?? "").trim(); if (appId && prompt) this.options.onPrepareCoderPrompt?.(appId, prompt); });
    root.querySelector<HTMLElement>("[data-workspace-toggle]")?.addEventListener("click", () => this.toggleWorkspaceTray());
    root.querySelector<HTMLElement>("[data-apps-toggle]")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLElement;
      const tray = root.querySelector<HTMLElement>("[data-apps-tray]");
      const liveTray = root.querySelector<HTMLElement>("[data-live-tray]");
      if (!tray) return;
      tray.hidden = !tray.hidden;
      button.setAttribute("aria-expanded", String(!tray.hidden));
      if (liveTray) liveTray.hidden = true;
      root.querySelector<HTMLElement>("[data-live-toggle]")?.setAttribute("aria-expanded", "false");
    });
    root.querySelector<HTMLElement>("[data-live-toggle]")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLElement;
      const tray = root.querySelector<HTMLElement>("[data-live-tray]");
      const appsTray = root.querySelector<HTMLElement>("[data-apps-tray]");
      if (!tray) return;
      tray.hidden = !tray.hidden;
      button.setAttribute("aria-expanded", String(!tray.hidden));
      if (appsTray) appsTray.hidden = true;
      root.querySelector<HTMLElement>("[data-apps-toggle]")?.setAttribute("aria-expanded", "false");
    });
    root.querySelectorAll<HTMLInputElement>('.spmt-slider-grid input[type="range"]').forEach((input) => input.addEventListener("input", () => { const output = input.parentElement?.querySelector<HTMLOutputElement>("output"); if (output) output.value = input.value; }));
    const themeSelect = root.querySelector<HTMLSelectElement>("[data-workspace-theme]");
    if (themeSelect && !root.querySelector("[data-theme-picker]")) {
      const picker = document.createElement("div");
      picker.className = "spmt-theme-picker";
      picker.dataset.themePicker = "";
      picker.setAttribute("role", "group");
      picker.setAttribute("aria-label", "Theme artwork");
      for (const choice of ["solar-flare", "nebula-purple", "oceanic-blue", "aurora-green"]) {
        const preset = resolveProductTheme(choice);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.themeChoice = choice;
        button.setAttribute("aria-label", `Use ${preset.name}`);
        button.setAttribute("aria-pressed", String(choice === themeSelect.value));
        button.innerHTML = `<img src="${themeLogoUrl(choice, "name")}" alt=""><span>${preset.name}</span>`;
        picker.append(button);
      }
      themeSelect.closest("label")?.after(picker);
      themeSelect.closest("label")?.classList.add("spmt-theme-native");
    }
    const accentInput = root.querySelector<HTMLInputElement>("[data-workspace-accent]");
    let secondaryInput = root.querySelector<HTMLInputElement>("[data-workspace-accent-secondary]");
    if (accentInput && !secondaryInput) {
      const label = document.createElement("label");
      label.textContent = "Logo accent";
      secondaryInput = document.createElement("input");
      secondaryInput.name = "accentSecondary";
      secondaryInput.type = "color";
      secondaryInput.value = accentSecondary ?? resolveProductTheme(themeSelect?.value).accentSecondary;
      secondaryInput.dataset.workspaceAccentSecondary = "";
      label.append(secondaryInput);
      accentInput.parentElement?.after(label);
    }
    const previewTheme = () => {
      if (!themeSelect || !accentInput || !secondaryInput) return;
      const next = resolveProductTheme(themeSelect.value, accentInput.value, secondaryInput.value);
      root.dataset.theme = next.id;
      root.dataset.spmtTheme = next.id;
      root.style.setProperty("--accent", next.accent);
      root.style.setProperty("--accent2", next.accentSecondary);
      root.style.setProperty("--spmt-accent", next.accent);
      root.style.setProperty("--spmt-accent-secondary", next.accentSecondary);
      root.querySelectorAll<HTMLImageElement>("[data-theme-logo]").forEach((image) => {
        const kind = image.dataset.themeLogo === "name" ? "name" : image.dataset.themeLogo === "spmt" ? "spmt" : image.dataset.themeLogo === "hero-secondary" ? "hero-secondary" : "hero";
        image.src = themeLogoUrl(next.id, kind);
      });
      root.querySelectorAll<HTMLImageElement>("[data-core-nav-art]").forEach((image) => {
        image.src = themedAppIconUrl(next.id, image.dataset.coreNavArt ?? "") ?? image.src;
      });
      root.querySelectorAll<HTMLImageElement>("[data-themed-app-art]").forEach((image) => {
        image.src = themedAppIconUrl(next.id, image.dataset.themedAppArt ?? "") ?? image.src;
      });
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", next.accent);
    };
    themeSelect?.addEventListener("change", () => {
      if (!accentInput) return;
      const preset = resolveProductTheme(themeSelect.value);
      accentInput.value = preset.accent;
      if (secondaryInput) secondaryInput.value = preset.accentSecondary;
      previewTheme();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => {
      if (!themeSelect || !accentInput) return;
      themeSelect.value = button.dataset.themeChoice ?? "solar-flare";
      const preset = resolveProductTheme(themeSelect.value);
      accentInput.value = preset.accent;
      if (secondaryInput) secondaryInput.value = preset.accentSecondary;
      root.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)));
      previewTheme();
    }));
    accentInput?.addEventListener("input", previewTheme);
    secondaryInput?.addEventListener("input", previewTheme);
    if (this.view === "workspace") {
      mountOverlayBay(root, this.snapshot);
      root.querySelectorAll<HTMLElement>("[data-overlay-issue]").forEach((node) => node.addEventListener("click", () => this.options.onIssueOverlayOutput?.(node.dataset.overlayApp ?? "", node.dataset.overlayIssue ?? "", node.dataset.overlayPersonal === "true")));
      root.querySelectorAll<HTMLElement>("[data-overlay-revoke]").forEach((node) => node.addEventListener("click", () => this.options.onRevokeOverlayOutput?.(node.dataset.overlayRevoke ?? "")));
    }
    bindEcosystemEggs(root, (collapsed) => { this.dockCollapsed = collapsed; root.dataset.spmtDock = collapsed ? "collapsed" : "expanded"; });
    this.bindHeaderClock();
    this.bindLayout();
  }

  private bindHeaderClock() {
    if (this.clockTimer !== undefined) window.clearInterval(this.clockTimer);
    const update = () => {
      const now = new Date();
      const local = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(now);
      const utc = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
      const iso = now.toISOString();
      const localNode = this.options.root.querySelector<HTMLTimeElement>("[data-spmt-local-clock]");
      const utcNode = this.options.root.querySelector<HTMLTimeElement>("[data-spmt-utc-clock]");
      if (localNode) { localNode.dateTime = iso; localNode.textContent = local; }
      if (utcNode) { utcNode.dateTime = iso; utcNode.textContent = utc; }
    };
    update();
    this.clockTimer = window.setInterval(update, 30_000);
  }

  private createPersonalOverlay() {
    const frame = document.createElement("iframe");
    frame.className = "spmt-shell-personal-overlay";
    frame.title = "Personal workspace overlay";
    frame.setAttribute("aria-hidden", "true");
    return frame;
  }

  private syncPersonalOverlay() {
    const frame = this.personalOverlay;
    if (!frame) return;
    const url = this.snapshot.tenantOutputs?.personal.url ?? "";
    if (url && frame.src !== url) frame.src = url;
    if (!url && frame.getAttribute("src")) frame.removeAttribute("src");
    frame.hidden = !this.personalOverlayVisible || !url;
    const toggle = this.workspaceTray?.querySelector<HTMLElement>("[data-personal-overlay-toggle]");
    if (toggle) { toggle.textContent = `Personal ${this.personalOverlayVisible ? "On" : "Off"}`; toggle.classList.toggle("active", this.personalOverlayVisible); }
  }

  private copyTenantOutput(output: "public" | "personal") {
    const url = this.snapshot.tenantOutputs?.[output].url;
    if (!url) return;
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(url);
    else window.prompt(`Copy ${output} overlay URL`, url);
  }

  private createWorkspaceTray() {
    const tray = document.createElement("section");
    tray.className = "spmt-workspace-tray";
    tray.setAttribute("aria-label", "SPMT workspace tray");
    tray.innerHTML = `<div class="spmt-workspace-frames" aria-live="polite">${[0, 1, 2].map((index) => `<div data-workspace-frame="${index}"><iframe title="Workspace slot ${index + 1}" allow="autoplay; microphone; camera; fullscreen; clipboard-write"></iframe><p>This workspace slot is empty. Assign an installed app in Workspace.</p></div>`).join("")}<section class="spmt-simulation-rooms" data-simulation-rooms hidden></section></div><footer><strong>${icon("layout")}<span>Workspace</span></strong><nav aria-label="Persistent app slots">${[0, 1, 2].map((index) => `<button type="button" data-workspace-slot="${index}"><span>Slot ${index + 1}</span><small>Empty</small></button>`).join("")}</nav><div class="spmt-workspace-surfaces"><button type="button" data-simulation-rooms-toggle>Simulation Rooms</button><button type="button" data-workspace-surface="workspace">Overlay Bay</button><button type="button" data-personal-overlay-toggle>Personal On</button><button type="button" data-copy-tenant-output="public">Copy Public</button><button type="button" data-copy-tenant-output="personal">Copy Personal</button><button type="button" data-workspace-surface="settings">Settings</button></div><div class="spmt-workspace-controls"><button type="button" data-workspace-minimize aria-label="Minimize workspace frame" title="Minimize">−</button><button type="button" data-workspace-maximize aria-label="Maximize workspace frame" title="Maximize">□</button><button type="button" data-workspace-popout aria-label="Pop out active workspace slot" title="Pop out">↗</button><button type="button" data-workspace-clickthrough aria-label="Toggle click-through" title="Click-through">◎</button><label title="Workspace opacity"><span>Opacity</span><input type="range" min="35" max="100" value="92" data-workspace-opacity><output>92%</output></label><button type="button" data-workspace-close aria-label="Close workspace footer" title="Close">×</button></div></footer>`;
    tray.querySelectorAll<HTMLElement>("[data-workspace-slot]").forEach((node) => node.addEventListener("click", () => { this.workspaceTarget = Number(node.dataset.workspaceSlot); this.simulationRoomsOpen = false; this.workspaceOpen = true; this.workspaceExpanded = true; this.syncWorkspaceTray(); }));
    tray.querySelector<HTMLElement>("[data-simulation-rooms-toggle]")?.addEventListener("click", () => { this.simulationRoomsOpen = true; this.workspaceOpen = true; this.workspaceExpanded = true; this.syncWorkspaceTray(); void this.loadSimulationRooms(); });
    tray.querySelectorAll<HTMLElement>("[data-workspace-surface]").forEach((node) => node.addEventListener("click", () => { this.workspaceExpanded = false; this.navigate(node.dataset.workspaceSurface as SpaceMountainViewV1); }));
    tray.querySelector<HTMLElement>("[data-personal-overlay-toggle]")?.addEventListener("click", () => { this.personalOverlayVisible = !this.personalOverlayVisible; try { window.localStorage.setItem("spmt:personal-overlay-visible", this.personalOverlayVisible ? "on" : "off"); } catch {} this.syncPersonalOverlay(); });
    tray.querySelectorAll<HTMLElement>("[data-copy-tenant-output]").forEach((node) => node.addEventListener("click", () => this.copyTenantOutput(node.dataset.copyTenantOutput === "personal" ? "personal" : "public")));
    tray.querySelector<HTMLElement>("[data-workspace-minimize]")?.addEventListener("click", () => { this.workspaceExpanded = false; this.workspaceMaximized = false; this.syncWorkspaceTray(); });
    tray.querySelector<HTMLElement>("[data-workspace-maximize]")?.addEventListener("click", () => { this.workspaceExpanded = true; this.workspaceMaximized = !this.workspaceMaximized; this.syncWorkspaceTray(); });
    tray.querySelector<HTMLElement>("[data-workspace-popout]")?.addEventListener("click", () => {
      if (this.simulationRoomsOpen) return;
      const frame = tray.querySelector<HTMLIFrameElement>(`[data-workspace-frame="${this.workspaceTarget}"] iframe`);
      if (frame?.src) window.open(frame.src, `spmt-workspace-${this.workspaceTarget}`, "popup,width=1440,height=920");
    });
    tray.querySelector<HTMLElement>("[data-workspace-clickthrough]")?.addEventListener("click", () => { this.workspaceClickThrough = !this.workspaceClickThrough; this.syncWorkspaceTray(); });
    tray.querySelector<HTMLInputElement>("[data-workspace-opacity]")?.addEventListener("input", (event) => { this.workspaceOpacity = Number((event.currentTarget as HTMLInputElement).value); this.syncWorkspaceTray(); });
    tray.querySelector<HTMLElement>("[data-workspace-close]")?.addEventListener("click", () => { this.workspaceOpen = false; this.workspaceExpanded = false; this.workspaceMaximized = false; this.syncWorkspaceTray(); });
    tray.querySelector<HTMLElement>("[data-simulation-rooms]")?.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("[data-simulation-refresh]")) void this.loadSimulationRooms(); });
    return tray;
  }

  private toggleWorkspaceTray() { this.workspaceOpen = !this.workspaceOpen; if (!this.workspaceOpen) { this.workspaceExpanded = false; this.workspaceMaximized = false; } this.syncWorkspaceTray(); }

  private syncWorkspaceTray() {
    const tray = this.workspaceTray;
    if (!tray) return;
    tray.classList.toggle("open", this.workspaceOpen);
    tray.classList.toggle("expanded", this.workspaceExpanded);
    tray.classList.toggle("maximized", this.workspaceMaximized);
    tray.classList.toggle("click-through", this.workspaceClickThrough);
    tray.hidden = !this.workspaceOpen;
    tray.style.setProperty("--workspace-opacity", String(this.workspaceOpacity / 100));
    const opacity = tray.querySelector<HTMLInputElement>("[data-workspace-opacity]");
    if (opacity && Number(opacity.value) !== this.workspaceOpacity) opacity.value = String(this.workspaceOpacity);
    const opacityOutput = opacity?.parentElement?.querySelector<HTMLOutputElement>("output");
    if (opacityOutput) opacityOutput.value = `${this.workspaceOpacity}%`;
    tray.querySelector<HTMLElement>("[data-workspace-clickthrough]")?.classList.toggle("active", this.workspaceClickThrough);
    tray.querySelector<HTMLElement>("[data-workspace-maximize]")?.classList.toggle("active", this.workspaceMaximized);
    tray.querySelector<HTMLElement>("[data-simulation-rooms-toggle]")?.classList.toggle("active", this.simulationRoomsOpen);
    const simulationPanel=tray.querySelector<HTMLElement>("[data-simulation-rooms]");
    if(simulationPanel){simulationPanel.hidden=!this.workspaceExpanded||!this.simulationRoomsOpen;if(this.simulationRoomsOpen)this.renderSimulationRooms();}
    const slots = workspaceDockSlots(this.snapshot.workspace);
    slots.forEach((appId, index) => {
      const app = this.snapshot.apps.find((item) => item.appId === appId && item.installed && item.enabled);
      const button = tray.querySelector<HTMLElement>(`[data-workspace-slot="${index}"]`);
      if (button) { button.innerHTML = `<span>Slot ${index + 1}</span><small>${escapeHtml(app?.name ?? "Empty")}</small>`; button.classList.toggle("active", index === this.workspaceTarget); }
      const panel = tray.querySelector<HTMLElement>(`[data-workspace-frame="${index}"]`);
      const frame = panel?.querySelector<HTMLIFrameElement>("iframe");
      if (!panel || !frame) return;
      panel.hidden = !this.workspaceExpanded || this.simulationRoomsOpen || index !== this.workspaceTarget;
      const nextUrl = app?.launchUrl ?? "";
      if (nextUrl && frame.dataset.appId !== app?.appId) { frame.src = nextUrl; frame.dataset.appId = app?.appId ?? ""; }
      if (!nextUrl && frame.dataset.appId) { frame.removeAttribute("src"); delete frame.dataset.appId; }
      frame.hidden = !nextUrl;
      const emptyState = panel.querySelector<HTMLElement>("p");
      if (emptyState) emptyState.hidden = Boolean(nextUrl);
    });
  }

  private async loadSimulationRooms() {
    try {
      const response=await fetch(`/v1/events?type=${encodeURIComponent(SPMT_SIMULATION_ROOM_EVENT)}&limit=100`,{credentials:"same-origin",cache:"no-store",headers:{"x-spmt-tenant":this.snapshot.tenantId}});
      if(!response.ok)throw new Error(`Simulation rooms could not be read (${response.status})`);
      const value=await response.json() as unknown;
      this.simulationRoomEvents=Array.isArray(value)?value.filter((item):item is Record<string,unknown>=>Boolean(item&&typeof item==="object"&&!Array.isArray(item))):[];
    } catch (error) {
      this.simulationRoomEvents=[{type:"simulation-room.error",createdAt:new Date().toISOString(),payload:{roomId:"unavailable",lane:"app",direction:"preview",title:"Simulation Rooms unavailable",body:error instanceof Error?error.message:String(error)}}];
    }
    this.renderSimulationRooms();
  }

  private renderSimulationRooms() {
    const panel=this.workspaceTray?.querySelector<HTMLElement>("[data-simulation-rooms]");if(!panel)return;
    const source=this.simulationRoomEvents.length?this.simulationRoomEvents:this.snapshot.events.filter((event)=>event.type===SPMT_SIMULATION_ROOM_EVENT),events=source.slice(0,100);
    const cards=events.map((event)=>{const payload=event.payload&&typeof event.payload==="object"&&!Array.isArray(event.payload)?event.payload as Record<string,unknown>:{};const room=String(payload.roomId??"simulation"),lane=String(payload.lane??"app"),direction=String(payload.direction??"preview"),title=String(payload.title??"Simulation event"),body=String(payload.body??""),when=String(event.createdAt??payload.occurredAt??"");return `<article class="spmt-simulation-event"><span>${escapeHtml(lane)} · ${escapeHtml(direction)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p><small>${escapeHtml(room)}${when?` · ${escapeHtml(formatRecordTime(when))}`:""}</small></article>`;}).join("");
    panel.innerHTML=`<header><div><h2>Simulation Rooms</h2><p>Tenant-scoped chat, overlay, game, and app previews. No provider output leaves Apollo.</p></div><button type="button" data-simulation-refresh>Refresh</button></header><div class="spmt-simulation-list">${cards||'<div class="spmt-simulation-empty">No room activity yet. Preview a StreamWeaver flow, Overlay Bay scene, or Nebula Arcade game.</div>'}</div>`;
  }

  private appVisible(app: SpaceMountainAppCardV1) {
    return app.appId !== "mission-control" || this.snapshot.operations.canReadLogs || this.snapshot.operations.canReadCoder;
  }

  private sidebarApps() {
    return this.snapshot.apps.filter((app) => app.installed && app.enabled && this.appVisible(app));
  }

  private shellApp(appId: string) {
    return this.snapshot.apps.find((app) => app.appId === appId && app.installed && app.enabled && app.surfaces.includes("shell") && this.appVisible(app));
  }

  private shellLaunchUrl(app: SpaceMountainAppCardV1) {
    const target = new URL(app.launchUrl, typeof window === "undefined" ? "https://spacemountain.live" : window.location.origin);
    target.searchParams.set("surface", "shell");
    return target.toString();
  }

  private openAppDockTarget(target: string) {
    if (!target) return;
    const frame = this.options.root.querySelector<HTMLIFrameElement>("[data-shell-app-frame]");
    const embedded = frame?.contentDocument?.querySelector<HTMLElement>(target);
    if (embedded) {
      if (target === "#open-settings") embedded.click(); else embedded.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    this.options.root.querySelector<HTMLElement>(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private header() {
    const unread = this.snapshot.notifications.filter((item) => !item.readAt && !item.read_at).length;
    const user = recordText(this.snapshot.session, ["displayName", "display_name", "username"]) ?? "Captain";
    const live = ecosystemPresence(this.snapshot.events, this.snapshot.apps);
    const connectedApps = this.sidebarApps();
    const appearance = recordObject(this.snapshot.workspace, "appearance");
    const theme = resolveProductTheme(recordText(appearance, ["theme"]), recordText(appearance, ["accent"]));
    const appsTray = `<section id="spmt-apps-tray" class="spmt-apps-tray spmt-product-glass" data-apps-tray hidden><header><strong>Connected apps</strong><span>${connectedApps.length} enabled</span></header><div>${connectedApps.map((app) => { const active = connectedAppUsage(this.snapshot.events, app.appId); const themed = themedAppIconUrl(theme.id, app.appId); const art = themed ? `<img src="${escapeHtml(themed)}" alt="" loading="lazy">` : app.iconUrl ? `<img src="${escapeHtml(app.iconUrl)}" alt="" loading="lazy">` : `<span>${escapeHtml(initials(app.name))}</span>`; return `<button type="button" data-launch-app="${escapeHtml(app.appId)}" title="Launch ${escapeHtml(app.name)}"><i>${art}</i><span><strong>${escapeHtml(app.name)}</strong><small>${escapeHtml(app.description || "SpaceMountain ecosystem application")}</small></span><b aria-label="${active} active now">${active}<small>live</small></b></button>`; }).join("") || `<p>No connected apps are enabled for this account.</p>`}</div><footer><button type="button" data-nav="apps">Manage apps in Shipyard</button></footer></section>`;
    const liveTray = `<section id="spmt-live-tray" class="spmt-live-tray spmt-product-glass" data-live-tray hidden><header><strong>Live now</strong><span>${live.length} creator${live.length === 1 ? "" : "s"}</span></header><div>${live.map((person) => `<article><span class="spmt-live-dot"></span><div><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.sources.join(" + "))}</small></div></article>`).join("") || `<p>No creators are live across the installed app pool.</p>`}</div></section>`;
    return `<header class="spmt-shell-header-stack" data-spmt-shell-header><div class="spmt-cosmic-header spmt-product-glass"><div class="spmt-brand-cluster"><button class="spmt-brand" data-spmt-black-hole-trigger aria-label="SpaceMountain home; double-click for the Black Hole"><img data-theme-logo="spmt" src="${themeLogoUrl(theme.id, "spmt")}" alt=""><strong>SPACEMOUNTAIN<em>.LIVE</em></strong></button><div class="spmt-header-clocks" aria-label="Local and UTC time"><span><time data-spmt-local-clock></time><small>LOCAL</small></span><span><time data-spmt-utc-clock></time><small>UTC</small></span></div></div><div class="spmt-header-actions"><button data-nav="home" class="spmt-icon-button" aria-label="Open Home" title="Home">${coreNavIcon(theme.id, "home")}</button><button data-apps-toggle class="spmt-icon-button" aria-label="Explore connected apps" aria-controls="spmt-apps-tray" aria-expanded="false" title="Shipyard">${coreNavIcon(theme.id, "apps")}</button><button data-workspace-toggle class="spmt-icon-button" aria-label="Open canonical workspace" title="Workspace and Overlay Bay">${coreNavIcon(theme.id, "workspace")}</button><button data-nav="settings" class="spmt-icon-button" aria-label="Open Settings" title="Settings">${coreNavIcon(theme.id, "settings")}</button><button data-live-toggle class="spmt-icon-button spmt-live-button" aria-label="Show creators live across the installed app pool" aria-controls="spmt-live-tray" aria-expanded="false" title="Live now">${themedHeaderIcon(theme.id, "discord-stream-hub")}${live.length ? `<i>${Math.min(live.length, 9)}${live.length > 9 ? "+" : ""}</i>` : ""}</button><button data-launch-app="commlink" class="spmt-icon-button" aria-label="Open Commlink" title="Commlink">${themedHeaderIcon(theme.id, "commlink")}${unread ? `<i>${Math.min(unread, 9)}${unread > 9 ? "+" : ""}</i>` : ""}</button><button type="button" class="spmt-account-summary" aria-label="Open Account for ${escapeHtml(user)}" title="Account and personal usage"><span class="spmt-avatar">${escapeHtml(initials(user))}</span><span class="spmt-account-copy"><strong>${escapeHtml(user)}</strong><small>${(this.snapshot.xp?.balance ?? 0).toLocaleString()} XP</small></span></button></div></div>${appsTray}${liveTray}</header>`;
  }

  private dock() {
    const core = NAV.filter((item) => item.id === "home" || item.id === "apps");
    const account = NAV.filter((item) => item.id === "workspace" || item.id === "settings");
    const apps = this.sidebarApps();
    const appearance = recordObject(this.snapshot.workspace, "appearance");
    const theme = resolveProductTheme(recordText(appearance, ["theme"]), recordText(appearance, ["accent"]));
    const navButtons = (items: typeof NAV) => items.map((item) => `<button data-spmt-product-nav="${item.id}" class="${!this.activeAppId && this.view === item.id ? "active" : ""}" title="${escapeHtml(`${item.label} — ${item.description}`)}" aria-label="${escapeHtml(`${item.label}: ${item.description}`)}">${coreNavIcon(theme.id, item.id)}<label>${item.label}</label></button>`).join("");
    const appButtons = apps.map((app) => { const themed = themedAppIconUrl(theme.id, app.appId); return `<button data-launch-app="${escapeHtml(app.appId)}" class="${this.activeAppId === app.appId ? "active" : ""}" title="${escapeHtml(`${app.name} — ${app.description || "SpaceMountain ecosystem application"}`)}" aria-label="${escapeHtml(`${app.name}: ${app.description || "SpaceMountain ecosystem application"}`)}"><i class="spmt-dock-app-icon">${themed ? `<img src="${escapeHtml(themed)}" alt="" loading="lazy">` : app.iconUrl ? `<img src="${escapeHtml(app.iconUrl)}" alt="" loading="lazy">` : escapeHtml(initials(app.name))}</i><label>${escapeHtml(app.name)}</label></button>`; }).join("");
    const activeApp = this.activeAppId ? this.shellApp(this.activeAppId) : undefined;
    const appNav: readonly AppDockItemV1[] | undefined = activeApp ? APP_DOCK_NAVIGATION[activeApp.appId] ?? [{ label: activeApp.name, description: activeApp.description || "Application overview.", icon: "grid", target: "body" }] : undefined;
    const appOwnedButtons = appNav?.map((item) => `<button data-app-dock-target="${escapeHtml(item.target)}" title="${escapeHtml(`${item.label} — ${item.description}`)}" aria-label="${escapeHtml(`${item.label}: ${item.description}`)}">${icon(item.icon)}<label>${escapeHtml(item.label)}</label></button>`).join("");
    const activeIcon = activeApp ? themedAppIconUrl(theme.id, activeApp.appId) : undefined;
    const middle = appOwnedButtons ? `<section class="spmt-dock-apps spmt-dock-owned" aria-label="${escapeHtml(activeApp?.name ?? "App")} navigation"><header>${activeIcon ? `<img src="${escapeHtml(activeIcon)}" alt="">` : ""}<strong>${escapeHtml(activeApp?.name ?? "App")}</strong></header>${appOwnedButtons}</section>` : `<section class="spmt-dock-apps" aria-label="Installed applications">${appButtons}</section>`;
    return `<aside class="spmt-rocket-dock spmt-product-glass" data-dock-owner="${escapeHtml(this.activeAppId ?? "spacemountain")}"><div id="rocketLauncher" class="spmt-dock-orbit docked" data-spmt-rocket-trigger role="button" tabindex="0" aria-label="Open or close app navigation; double-click to launch the rocket" title="Click to open or close navigation · Double-click to launch"><span></span><img src="/assets/product/model-rocket.png" alt="SpaceMountain rocket"></div><nav class="spmt-dock-nav"><section class="spmt-dock-core" aria-label="SpaceMountain">${navButtons(core)}</section>${middle}<section class="spmt-dock-account" aria-label="Workspace and account">${navButtons(account)}</section></nav></aside>`;
  }

  private body() {
    if (this.activeAppId === "commlink" && this.shellApp("commlink")) return this.commlink();
    if (this.activeAppId === "stellar-core" && this.shellApp("stellar-core")) return this.stellar();
    if (this.activeAppId === "mission-control" && this.shellApp("mission-control")) return this.operations();
    if (this.activeAppId) {
      const app = this.shellApp(this.activeAppId);
      if (app) return `<section class="spmt-embedded-app-shell" aria-label="${escapeHtml(app.name)}"><iframe data-shell-app-frame title="${escapeHtml(app.name)}" src="${escapeHtml(this.shellLaunchUrl(app))}" loading="eager"></iframe></section>`;
    }
    if (this.view === "apps") return this.shipyard();
    if (this.view === "workspace") return this.workspace();
    if (this.view === "account") return this.account();
    if (this.view === "settings") return this.settings();
    return this.home();
  }

  private home() {
    const installed = this.snapshot.apps.filter((app) => app.installed && app.enabled);
    const unread = this.snapshot.notifications.filter((item) => !item.readAt && !item.read_at).length;
    const appearance = recordObject(this.snapshot.workspace, "appearance");
    const theme = resolveProductTheme(recordText(appearance, ["theme"]), recordText(appearance, ["accent"]));
    return `<section class="spmt-hero spmt-product-glass"><div class="spmt-hero-copy"><img class="spmt-hero-logo spmt-hero-logo-large" data-theme-logo="hero-secondary" src="${themeLogoUrl(theme.id, "hero-secondary")}" alt="SpaceMountain"><div class="actions"><button data-nav="apps" class="primary">${icon("rocket")}Open Shipyard</button><button data-launch-app="commlink">${icon("mail")}Open Commlink</button></div></div><div class="spmt-metrics">${metric("Apps online", `${installed.length}/${this.snapshot.apps.length}`)}${metric("Unread", String(unread))}${metric("Active apps", String((this.snapshot.runtimeStates ?? []).filter((item) => recordText(item, ["state"]) === "ready").length))}${metric("Theme", theme.name)}</div></section>`;
  }

  private shipyard() { const apps = this.snapshot.apps.filter((app) => this.appVisible(app)); const appearance = recordObject(this.snapshot.workspace, "appearance"); const theme = resolveProductTheme(recordText(appearance, ["theme"])).id; return `${page("Apps and capabilities", "Registry, install state, granted scopes, and entitlements come directly from SPMT.", "SHIPYARD")}<div class="spmt-app-grid wide">${apps.map((app) => appCard(app, theme)).join("")}${overlayBayCard(theme)}</div>`; }
  private commlink() {
    const state = this.commlinkWorkspace();
    const appearance = recordObject(this.snapshot.workspace, "appearance");
    const theme = resolveProductTheme(recordText(appearance, ["theme"]), recordText(appearance, ["accent"]));
    const sources = commlinkSources(this.snapshot);
    const activeSpace = state.chatSpaces.find((item) => item.id === state.activeChatSpaceId) ?? state.chatSpaces[0]!;
    const activeDesk = state.desks.find((item) => item.id === state.activeDeskId) ?? state.desks[0]!;
    const sourceIds = new Set(activeSpace.sourceIds);
    const visible = this.commlinkRecords(activeSpace, state.filter);
    const feed = visible.map((item) => commlinkCard(item)).join("") || empty("No canonical messages or app events match this ChatSpace yet.");
    const panels = activeDesk.chatSpaceIds.map((spaceId) => state.chatSpaces.find((item) => item.id === spaceId)).filter((item): item is { id: string; name: string; sourceIds: string[] } => Boolean(item)).map((space) => `<section class="cosmo-desk-panel"><header><strong>${escapeHtml(space.name)}</strong><button data-commlink-space="${escapeHtml(space.id)}">Focus</button></header><div>${this.commlinkRecords(space, "all").slice(0, 8).map((item) => commlinkCard(item, true)).join("") || `<p class="cosmo-panel-empty">No records yet</p>`}</div></section>`).join("");
    const writable = this.activeCommlinkConversation();
    return `${sourceNotice("Commlink", this.snapshot.sources.commlink)}<section class="cosmo-commlink spmt-product-glass ${state.compact ? "compact" : ""}">
      <aside class="cosmo-rail"><div class="cosmo-mark"><img src="${themedAppIconUrl(theme.id, "commlink")}" alt=""><div><strong>Cosmo</strong><small>Commlink</small></div></div><button class="cosmo-create" data-commlink-new-space>＋ New ChatSpace</button><header><span>SAVED CHATSPACES</span></header><nav>${state.chatSpaces.map((space) => `<button data-commlink-space="${escapeHtml(space.id)}" class="${space.id === activeSpace.id ? "active" : ""}"><b>${escapeHtml(initials(space.name))}</b><span><strong>${escapeHtml(space.name)}</strong><small>${space.sourceIds.length} source${space.sourceIds.length === 1 ? "" : "s"}</small></span></button>`).join("")}</nav><header><span>SAVED DESKS</span><button data-commlink-new-desk aria-label="Create Desk">＋</button></header><nav>${state.desks.map((desk) => `<button data-commlink-desk="${escapeHtml(desk.id)}" class="${desk.id === activeDesk.id ? "active" : ""}"><b>⌘</b><span><strong>${escapeHtml(desk.name)}</strong><small>${desk.chatSpaceIds.length} ChatSpace${desk.chatSpaceIds.length === 1 ? "" : "s"}</small></span></button>`).join("")}</nav><footer><span class="state-${this.snapshot.sources.commlink.state}"></span><small>Account synced · revision ${recordNumber(this.snapshot.workspace, "revision") ?? "—"}</small></footer></aside>
      <div class="cosmo-workspace"><header class="cosmo-topbar"><div><span>COMMLINK DESK / ${escapeHtml(activeDesk.name)}</span><h1>${escapeHtml(state.view === "desk" ? activeDesk.name : activeSpace.name)}</h1></div><div class="cosmo-actions"><div class="cosmo-switch"><button data-commlink-view="focus" class="${state.view === "focus" ? "active" : ""}">Focus</button><button data-commlink-view="desk" class="${state.view === "desk" ? "active" : ""}">Desk</button></div><button class="primary" data-commlink-new-mail>New mail</button><button data-commlink-read-all>Mark all read</button><button data-commlink-edit-space title="Rename active ChatSpace">Edit space</button><button data-commlink-delete-space title="Delete active ChatSpace">Delete space</button><button data-commlink-edit-desk title="Rename active Desk">Edit desk</button><button data-commlink-delete-desk title="Delete active Desk">Delete desk</button><button data-commlink-popout>Pop out</button></div></header>
      <section class="cosmo-sources"><div><i></i><strong>${sources.filter((source) => sourceIds.has(source.id)).length} sources · ${this.snapshot.sources.commlink.state}</strong><span>${this.snapshot.sources.commlink.state === "ready" ? "Canonical account feed" : "Unavailable sources remain visible and explicit"}</span></div><nav>${sources.map((source) => `<button data-commlink-source="${escapeHtml(source.id)}" class="${sourceIds.has(source.id) ? "active" : ""}" title="${escapeHtml(source.detail)}"><b>${escapeHtml(source.short)}</b><span>${escapeHtml(source.label)}</span><i class="state-${escapeHtml(source.state)}"></i></button>`).join("")}</nav></section>
      ${state.view === "desk" ? `<section class="cosmo-desk-grid">${panels}</section>` : `<section class="cosmo-focus"><div class="cosmo-feed-pane"><div class="cosmo-toolbar"><nav>${(["all", "chat", "events", "streamweaver", "queued"] as CommlinkFilterV1[]).map((filter) => `<button data-commlink-filter="${filter}" class="${state.filter === filter ? "active" : ""}">${filter === "all" ? "All" : filter === "streamweaver" ? "StreamWeaver" : filter[0]!.toUpperCase() + filter.slice(1)}${filter === "queued" ? " 0" : ""}</button>`).join("")}</nav><div><button data-commlink-compact>${state.compact ? "Comfortable" : "Compact"}</button><form data-commlink-search><input name="query" type="search" minlength="2" maxlength="200" required placeholder="Search history"><button>Search</button></form></div></div><div class="cosmo-feed" aria-live="polite">${feed}</div><form class="cosmo-composer" data-commlink-compose><div><span>DESTINATION</span><b>${escapeHtml(writable ? recordText(writable, ["title"]) ?? "SPMT conversation" : "Select a writable SPMT conversation")}</b><small>Replies remain source-locked</small></div><textarea name="message" maxlength="8000" rows="1" ${writable ? "required" : "disabled"} placeholder="${writable ? "Message this canonical conversation…" : "No writable destination in this ChatSpace"}"></textarea><button class="primary" ${writable ? "" : "disabled"}>Send</button></form></div><aside class="cosmo-context"><span>◎</span><h2>Message context</h2><p>Select a conversation card to inspect its canonical history, identity, and available reply actions.</p><button data-open-conversation="${escapeHtml(recordText(writable, ["id"]) ?? "")}" ${writable ? "" : "disabled"}>Open active conversation</button><a href="/docs/developers#commlink">Developer IRC & API</a></aside></section>`}
      <dialog class="cosmo-mail-dialog" data-commlink-mail-dialog><form method="dialog" data-commlink-mail-form><header><div><span>PRIVATE ACCOUNT MAIL</span><h2>New Commlink message</h2></div><button type="button" data-commlink-mail-cancel aria-label="Close">×</button></header><label>Recipients<select name="recipientUserIds" multiple required size="${Math.min(6, Math.max(2, this.snapshot.commlinkRecipients.length))}">${this.snapshot.commlinkRecipients.map((recipient) => `<option value="${escapeHtml(recipient.userId)}">${escapeHtml(recipient.displayName)} · @${escapeHtml(recipient.username)}</option>`).join("")}</select></label><label>Subject<input name="subject" maxlength="200" placeholder="Optional subject"></label><label>Message<textarea name="message" maxlength="8000" rows="7" required placeholder="Write a private message…"></textarea></label><footer><small>${this.snapshot.commlinkRecipients.length ? "Select one or more people in this workspace." : "No other workspace members are available."}</small><button class="primary" ${this.snapshot.commlinkRecipients.length ? "" : "disabled"}>Send mail</button></footer></form></dialog>
      </div></section>`;
  }

  private commlinkWorkspace(): CommlinkWorkspaceUiV1 {
    if (this.commlinkDraft) return this.commlinkDraft;
    const stored = recordObject(this.snapshot.workspace, "commlink");
    if (isCommlinkWorkspace(stored)) return stored as unknown as CommlinkWorkspaceUiV1;
    const sources = commlinkSources(this.snapshot).map((source) => source.id);
    return { schemaVersion: 1, chatSpaces: [{ id: "all-messages", name: "All messages", sourceIds: sources }], desks: [{ id: "account", name: "Account", chatSpaceIds: ["all-messages"] }], activeChatSpaceId: "all-messages", activeDeskId: "account", view: "focus", filter: "all", compact: false };
  }

  private updateCommlink(patch: Partial<CommlinkWorkspaceUiV1>) {
    const next = { ...this.commlinkWorkspace(), ...patch };
    this.commlinkDraft = next;
    const revision = recordNumber(this.snapshot.workspace, "revision");
    if (revision) this.options.onSaveWorkspace?.(revision, { commlink: next });
    this.render();
  }

  private toggleCommlinkSource(sourceId: string) {
    const state = this.commlinkWorkspace();
    const spaces = state.chatSpaces.map((space) => space.id !== state.activeChatSpaceId ? space : { ...space, sourceIds: space.sourceIds.includes(sourceId) ? space.sourceIds.filter((id) => id !== sourceId) : [...space.sourceIds, sourceId] });
    this.updateCommlink({ chatSpaces: spaces });
  }

  private createChatSpace() {
    const name = window.prompt("Name this ChatSpace")?.trim();
    if (!name) return;
    const state = this.commlinkWorkspace();
    const id = `space-${crypto.randomUUID()}`;
    this.updateCommlink({ chatSpaces: [...state.chatSpaces, { id, name: name.slice(0, 60), sourceIds: commlinkSources(this.snapshot).map((source) => source.id) }], activeChatSpaceId: id, view: "focus" });
  }

  private createDesk() {
    const name = window.prompt("Name this Desk")?.trim();
    if (!name) return;
    const state = this.commlinkWorkspace();
    const id = `desk-${crypto.randomUUID()}`;
    this.updateCommlink({ desks: [...state.desks, { id, name: name.slice(0, 60), chatSpaceIds: state.chatSpaces.slice(0, 6).map((space) => space.id) }], activeDeskId: id, view: "desk" });
  }

  private renameChatSpace() {
    const state = this.commlinkWorkspace(); const active = state.chatSpaces.find((space) => space.id === state.activeChatSpaceId); if (!active) return;
    const name = window.prompt("Rename this ChatSpace", active.name)?.trim(); if (!name) return;
    this.updateCommlink({ chatSpaces: state.chatSpaces.map((space) => space.id === active.id ? { ...space, name: name.slice(0, 60) } : space) });
  }

  private renameDesk() {
    const state = this.commlinkWorkspace(); const active = state.desks.find((desk) => desk.id === state.activeDeskId); if (!active) return;
    const name = window.prompt("Rename this Desk", active.name)?.trim(); if (!name) return;
    this.updateCommlink({ desks: state.desks.map((desk) => desk.id === active.id ? { ...desk, name: name.slice(0, 60) } : desk) });
  }

  private deleteChatSpace() {
    const state = this.commlinkWorkspace(); if (state.chatSpaces.length === 1) return;
    const active = state.chatSpaces.find((space) => space.id === state.activeChatSpaceId); if (!active || !window.confirm(`Delete ChatSpace “${active.name}”? Connected accounts will not be disconnected.`)) return;
    const chatSpaces = state.chatSpaces.filter((space) => space.id !== active.id); const first = chatSpaces[0]!;
    const desks = state.desks.map((desk) => ({ ...desk, chatSpaceIds: desk.chatSpaceIds.filter((id) => id !== active.id) })).map((desk) => desk.chatSpaceIds.length ? desk : { ...desk, chatSpaceIds: [first.id] });
    this.updateCommlink({ chatSpaces, desks, activeChatSpaceId: first.id });
  }

  private deleteDesk() {
    const state = this.commlinkWorkspace(); if (state.desks.length === 1) return;
    const active = state.desks.find((desk) => desk.id === state.activeDeskId); if (!active || !window.confirm(`Delete Desk “${active.name}”? Its ChatSpaces will remain saved.`)) return;
    const desks = state.desks.filter((desk) => desk.id !== active.id); this.updateCommlink({ desks, activeDeskId: desks[0]!.id, view: "focus" });
  }

  private activeCommlinkConversation() {
    const state = this.commlinkWorkspace(); const space = state.chatSpaces.find((item) => item.id === state.activeChatSpaceId);
    return this.snapshot.conversations.find((conversation) => !space || space.sourceIds.includes(commlinkRecordSource(conversation)) || space.sourceIds.includes(`conversation:${recordText(conversation, ["id"]) ?? ""}`));
  }

  private commlinkRecords(space: { sourceIds: string[] }, filter: CommlinkFilterV1) {
    const sourceIds = new Set(space.sourceIds);
    const signalMessageIds = new Set(this.snapshot.events.filter((event) => (recordText(event, ["type"]) ?? "").includes("lost-signal-message.requested")).map((event) => recordText(recordObject(event, "payload"), ["targetMessageId", "target_message_id"])).filter((id): id is string => Boolean(id)));
    const messages = (this.snapshot.messages ?? []).map((item) => ({ ...item, __recordType: "chat", ...(signalMessageIds.has(recordText(item, ["messageId", "message_id", "id"]) ?? "") ? { hiddenSignal: true } : {}) }));
    const liveChat = (this.snapshot.liveChat ?? []).map((item) => ({ ...item, __recordType: "chat" }));
    const conversations = this.snapshot.conversations.map((item) => ({ ...item, __recordType: "chat" }));
    const events = this.snapshot.events.map((item) => ({ ...item, __recordType: "event" }));
    const notifications = this.snapshot.notifications.map((item) => ({ ...item, __recordType: "event" }));
    return [...liveChat, ...messages, ...conversations, ...events, ...notifications]
      .filter((item) => !sourceIds.size || sourceIds.has(commlinkRecordSource(item)) || sourceIds.has(`conversation:${recordText(item, ["conversationId", "id"]) ?? ""}`))
      .filter((item) => filter === "all" || (filter === "chat" && item.__recordType === "chat") || (filter === "events" && item.__recordType === "event") || (filter === "streamweaver" && commlinkRecordSource(item) === "streamweaver") || (filter === "queued" && recordBoolean(item, "queued", false)))
      .sort((left, right) => Date.parse(recordText(right, ["occurredAt", "occurred_at", "createdAt", "created_at", "updatedAt", "updated_at"]) ?? "") - Date.parse(recordText(left, ["occurredAt", "occurred_at", "createdAt", "created_at", "updatedAt", "updated_at"]) ?? ""))
      .slice(0, 120);
  }

  private notificationPanel() {
    const items = this.snapshot.notifications.slice(0, 100);
    return `${sourceNotice("Notifications", this.snapshot.sources.notifications)}<div class="spmt-list spmt-account-list">${items.map((item) => { const unread = isUnread(item); return `<article class="${unread ? "unread" : ""}"><div><span class="spmt-record-kind">${escapeHtml(recordText(item, ["type"]) ?? "notification")}${unread ? " • NEW" : ""}</span><strong>${escapeHtml(recordText(item, ["title"]) ?? "Notification")}</strong><p>${escapeHtml(recordText(item, ["body"]) ?? "")}</p><small>${escapeHtml(recordText(item, ["sourceAppId", "source_app_id"]) ?? "SPMT")} • ${escapeHtml(formatRecordTime(recordText(item, ["createdAt", "created_at"])))}</small></div>${unread ? `<button data-notification-read="${escapeHtml(recordText(item, ["id"]) ?? "")}">Mark read</button>` : ""}</article>`; }).join("") || empty("No notifications yet.")}</div>`;
  }

  private eventPanel() {
    const items = this.snapshot.events.slice(0, 100);
    return `${sourceNotice("App Events", this.snapshot.sources.events)}<div class="spmt-list spmt-account-list">${items.map((item) => `<article><div><span class="spmt-record-kind">${escapeHtml(recordText(item, ["sourceAppId", "source_app_id"]) ?? "unknown app")}</span><strong>${escapeHtml(recordText(item, ["type"]) ?? "app.event")}</strong><p>${escapeHtml(payloadKeySummary(item.payload))}</p><small>${escapeHtml(formatRecordTime(recordText(item, ["createdAt", "created_at"])))}</small></div></article>`).join("") || empty("No app events yet.")}</div>`;
  }

  private stellar() {
    // Stella is the default ecosystem assistant; configured StreamWeaver personas use the same public contracts.
    // Runtime capability remains identified as stellar-core-inference and reports unavailable truthfully.
    const capabilities = this.snapshot.stellar.capabilities.slice(0, 100);
    const owner = sessionHasScope(this.snapshot.session, "apps:register");
    const runtime = capabilities.find((item) => recordText(item, ["id"]) === "spmt.community-assistant");
    const runtimeAvailable = recordText(runtime, ["availability"]) === "available";
    const companionReady = this.snapshot.usage?.plan.planId !== "free" && this.snapshot.apps.some((app) => app.appId === "companion" && app.installed && app.enabled) && this.snapshot.runtimeStates.some((item) => recordText(item, ["appId", "app_id"]) === "companion" && recordText(item, ["state"]) === "ready");
    const routeControl = companionReady ? `<label class="spmt-stella-route">Route<select name="routingPreference"><option value="automatic">Automatic · hosted</option><option value="companion">Companion · local</option><option value="hosted">Hosted</option></select></label>` : `<input type="hidden" name="routingPreference" value="automatic">`;
    const ownerControls = owner ? `<section class="spmt-account-section spmt-owner-controls"><header><span>OWNER CONTROL</span><h2>Stellar Core model platform</h2></header><div class="spmt-field-grid"><label>Platform<select disabled><option>${runtimeAvailable ? "Connected Stellar Core worker" : "No inference worker connected"}</option></select></label><label>Model<select disabled><option>${runtimeAvailable ? "Runtime-managed model" : "Connect a model deployment"}</option></select></label><label class="spmt-check"><input type="checkbox" checked disabled> Canonical RAG context</label></div><p>Only the ecosystem owner sees model and platform controls. The model worker is deployed separately from this private Review Sprite and receives scoped, redacted SPMT context.</p></section>` : "";
    return `${page("Speak with Stella", "Stellar Core is the ecosystem AI layer; Stella is its default assistant.", "STELLA CORE")}${sourceNotice("Stellar Core catalog", this.snapshot.sources.stellar)}<section class="spmt-stella-chat"><header><span>STELLA</span><h2>Community Assistant</h2></header><div class="spmt-stella-history" data-stella-history><p>Ask Stella about the ecosystem, your workspace, or creator tools.</p></div><form data-stella-form>${routeControl}<input name="message" maxlength="4000" required placeholder="Speak to Stella…"><label class="spmt-check"><input type="checkbox" name="remember" checked> Remember this conversation</label><button class="primary" type="submit">Send</button></form></section>${ownerControls}<section class="spmt-account-section"><header><span>CAPABILITY CATALOG</span><h2>What Stella can use</h2></header><div class="spmt-command-grid">${capabilities.map((item) => { const available = recordText(item, ["availability"]) === "available"; return `<article><div><span class="spmt-command-state ${available ? "available" : "unavailable"}">${available ? "AVAILABLE" : "UNAVAILABLE"}</span><h3>${escapeHtml(recordText(item, ["title", "id"]) ?? "System capability")}</h3></div><p>${escapeHtml(recordText(item, ["description"]) ?? "")}</p><small>${available ? escapeHtml(recordStrings(item, "requiredScopes").join(", ") || "Ready") : escapeHtml(recordText(item, ["unavailableReason", "unavailable_reason"]) ?? "Runtime unavailable")}</small></article>`; }).join("") || empty("No Stellar Core capabilities have been declared yet.")}</div></section>`;
  }
  private operations() {
    const logs = this.snapshot.operations.logs.slice(0, 100);
    const jobs = this.snapshot.operations.jobs.slice(0, 50);
    const apps = new Set(logs.map((item) => item.sourceAppId));
    const errors = logs.filter((item) => item.level === "error" || item.level === "critical").length;
    const warnings = logs.filter((item) => item.level === "warn").length;
    const coder = this.snapshot.operations.coder;
    const coderAvailable = coder?.availability === "available";
    const coderNotice = coderAvailable
      ? `<aside class="spmt-deferred state-ready"><div><span>ROTATOR CODER</span><strong>Worker available</strong></div><p>Selected redacted evidence can be queued through the scoped coder contract.</p><small>No merge or deployment authority is implied</small></aside>`
      : `<aside class="spmt-deferred"><div><span>ROTATOR CODER</span><strong>Draft-only handoff</strong></div><p>${escapeHtml(coder?.unavailableReason ?? "The Rotator coder worker is not connected. Evidence can be saved as a draft without fabricating analysis.")}</p><small>Prepared drafts do not change code</small></aside>`;
    const logList = logs.map((item) => `<article class="spmt-ops-log level-${escapeHtml(item.level)}"><div><span class="spmt-record-kind">${escapeHtml(item.sourceAppId)} • ${escapeHtml(item.level)}</span><strong>${escapeHtml(item.summary)}</strong>${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}<small>${escapeHtml(item.kind)} • ${escapeHtml(formatRecordTime(item.occurredAt))}${item.correlationId ? ` • ${escapeHtml(item.correlationId)}` : ""}</small></div>${this.snapshot.operations.canInvokeCoder ? `<button data-coder-log="${escapeHtml(item.id)}">Prepare coder</button>` : ""}</article>`).join("");
    const jobList = jobs.map((job) => `<article><div><span class="spmt-record-kind">${escapeHtml(job.targetAppId)} • ${escapeHtml(job.state)}</span><strong>${escapeHtml(job.prompt)}</strong><p>${job.evidence.length} bounded evidence record${job.evidence.length === 1 ? "" : "s"}</p><small>${escapeHtml(formatRecordTime(job.updatedAt))}${job.unavailableReason ? ` • ${escapeHtml(job.unavailableReason)}` : ""}</small></div></article>`).join("");
    const appOptions = this.snapshot.apps.map((app) => `<option value="${escapeHtml(app.appId)}">${escapeHtml(app.name)}</option>`).join("");
    const coderChat = this.snapshot.operations.canInvokeCoder ? `<section class="spmt-stella-chat"><header><span>CODER</span><h2>Work with the ecosystem coder</h2></header><div class="spmt-stella-history">${jobs.slice(0, 5).map((job) => `<p><b>${escapeHtml(job.targetAppId)}</b> · ${escapeHtml(job.prompt)} <small>${escapeHtml(job.state)}</small></p>`).join("") || `<p>Describe a change, test, or investigation. Coder will create a bounded job for the selected app.</p>`}</div><form data-coder-form><select name="appId" required>${appOptions}</select><input name="prompt" maxlength="4000" required placeholder="Ask Coder to inspect, test, or prepare a change…"><button class="primary" type="submit">Send to Coder</button></form></section>` : "";
    return `${page("Ecosystem operations", "Work with Coder, then inspect the scoped app and Rotator evidence behind each job.", "MISSION CONTROL")}${sourceNotice("Operations", this.snapshot.sources.operations)}${coderChat}<div class="spmt-metrics spmt-operations-metrics">${metric("Apps reporting", String(apps.size))}${metric("Warnings", String(warnings))}${metric("Errors", String(errors))}${metric("Coder", coderAvailable ? "ready" : "draft only")}</div>${coderNotice}<section class="spmt-account-section"><header><span>CONSOLIDATED EVIDENCE</span><h2>Recent operational records</h2></header><div class="spmt-list spmt-account-list">${logList || empty("No app or Rotator operational records are available for this tenant.")}</div></section><section class="spmt-account-section"><header><span>CODER HANDOFFS</span><h2>Prepared and active coder jobs</h2></header><div class="spmt-list spmt-account-list">${jobList || empty("No coder jobs have been prepared.")}</div></section>`;
  }
  private workspace() {
    const profile = this.snapshot.workspace;
    const slots = workspaceDockSlots(profile);
    const appearance = recordObject(profile, "appearance");
    const theme = recordText(appearance, ["theme"]) ?? "system";
    const accent = recordText(appearance, ["accent"]) ?? "#ff7a18";
    const backgroundUrl = recordText(appearance, ["backgroundUrl", "background_url"]) ?? "";
    const animation = recordObject(appearance, "animation");
    const appOptions = this.snapshot.apps.filter((app) => app.installed && app.enabled).map((app) => ({ value: app.appId, label: app.name }));
    return `${page("Portable station layout", "One canonical workspace profile, shared overlays, and three persistent app slots.", "WORKSPACE")}${sourceNotice("Workspace", this.snapshot.sources.workspace)}<form class="spmt-settings-form" data-workspace-settings><section><header><span>APPEARANCE</span><h2>One color language, a unique scene in every app</h2></header><p class="spmt-appearance-rule">Your theme recolors each app's own cosmic scene. The shared stars, glass, and navigation remain familiar everywhere.</p><div class="spmt-field-grid"><label>Theme<select name="theme" data-workspace-theme>${selectOption("solar-flare", theme, "Solar flare")}${selectOption("nebula-purple", theme, "Nebula purple")}${selectOption("oceanic-blue", theme, "Oceanic blue")}${selectOption("aurora-green", theme, "Aurora green")}${!theme.includes("-") ? selectOption(theme, theme, `Existing: ${theme}`) : ""}</select></label><label>Accent<input name="accent" data-workspace-accent type="color" value="${escapeHtml(accent)}"></label><label class="wide">Custom scene override <small>Optional; leave blank to use each app's artwork.</small><input name="backgroundUrl" type="url" inputmode="url" placeholder="https://…" value="${escapeHtml(backgroundUrl)}"></label></div><div class="spmt-slider-grid">${rangeControl("glowIntensity", "Glow", recordNumber(appearance, "glowIntensity") ?? 55)}${rangeControl("starDensity", "Stars", recordNumber(appearance, "starDensity") ?? 70)}${rangeControl("glassOpacity", "Glass", recordNumber(appearance, "glassOpacity") ?? 76)}${rangeControl("blurStrength", "Blur", recordNumber(appearance, "blurStrength") ?? 18)}${rangeControl("nebulaIntensity", "Nebula", recordNumber(appearance, "nebulaIntensity") ?? 55)}${rangeControl("parallaxDepth", "Parallax", recordNumber(appearance, "parallaxDepth") ?? 35)}${rangeControl("borderStrength", "Borders", recordNumber(appearance, "borderStrength") ?? 35)}${rangeControl("chatTransparency", "Chat transparency", recordNumber(appearance, "chatTransparency") ?? 15)}${rangeControl("animationSpeed", "Animation speed", recordNumber(animation, "speed") ?? 50)}</div></section><section><header><span>LAYOUT & MOTION</span><h2>Shared interface behavior</h2></header><div class="spmt-field-grid"><label>Density<select name="density">${selectOption("compact", recordText(appearance, ["density"]) ?? "comfortable", "Compact")}${selectOption("comfortable", recordText(appearance, ["density"]) ?? "comfortable", "Comfortable")}${selectOption("spacious", recordText(appearance, ["density"]) ?? "comfortable", "Spacious")}</select></label><label>Sidebar style<select name="sidebarStyle">${selectOption("glass", recordText(appearance, ["sidebarStyle"]) ?? "glass", "Glass")}${selectOption("solid", recordText(appearance, ["sidebarStyle"]) ?? "glass", "Solid")}${selectOption("minimal", recordText(appearance, ["sidebarStyle"]) ?? "glass", "Minimal")}</select></label><label>Sidebar position<select name="sidebarPosition">${selectOption("left", recordText(appearance, ["sidebarPosition"]) ?? "left", "Left")}${selectOption("right", recordText(appearance, ["sidebarPosition"]) ?? "left", "Right")}</select></label><label>Topbar style<select name="topbarStyle">${selectOption("glass", recordText(appearance, ["topbarStyle"]) ?? "glass", "Glass")}${selectOption("solid", recordText(appearance, ["topbarStyle"]) ?? "glass", "Solid")}${selectOption("minimal", recordText(appearance, ["topbarStyle"]) ?? "glass", "Minimal")}</select></label><label>Tab style<select name="tabStyle">${selectOption("pills", recordText(appearance, ["tabStyle"]) ?? "pills", "Pills")}${selectOption("underline", recordText(appearance, ["tabStyle"]) ?? "pills", "Underline")}${selectOption("cards", recordText(appearance, ["tabStyle"]) ?? "pills", "Cards")}</select></label><label>Tab position<select name="tabPosition">${selectOption("top", recordText(appearance, ["tabPosition"]) ?? "top", "Top")}${selectOption("bottom", recordText(appearance, ["tabPosition"]) ?? "top", "Bottom")}</select></label></div><div class="spmt-toggle-grid">${checkControl("sidebarCollapsed", "Collapse sidebar", recordBoolean(appearance, "sidebarCollapsed", false))}${checkControl("showAvatars", "Show avatars", recordBoolean(appearance, "showAvatars", true))}${checkControl("smoothTransitions", "Smooth transitions", recordBoolean(appearance, "smoothTransitions", true))}${checkControl("pushToTalk", "Push to talk", recordBoolean(appearance, "pushToTalk", false))}${checkControl("particles", "Particles", recordBoolean(animation, "particles", true))}${checkControl("shootingStars", "Shooting stars", recordBoolean(animation, "shootingStars", true))}</div></section><section><header><span>DOCK</span><h2>Three persistent app slots</h2></header><div class="spmt-field-grid">${slots.map((slot, index) => `<label>Slot ${index + 1}<select name="dockSlot${index}">${selectOption("", slot ?? "", "Empty")}${slot && !appOptions.some((option) => option.value === slot) ? selectOption(slot, slot, `Existing: ${slot}`) : ""}${appOptions.map((option) => selectOption(option.value, slot ?? "", option.label)).join("")}</select></label>`).join("")}</div></section><button type="submit" class="primary">Save canonical workspace</button><small>Revision ${recordNumber(profile, "revision") ?? "unavailable"} · changes are written once to SPMT and read by every authorized app.</small></form>`;
  }
  private account() {
    const links = this.snapshot.providerLinks.slice().sort((left, right) => providerLinkKey(left).localeCompare(providerLinkKey(right)));
    const linkedProviders = new Set(links.map((item) => recordText(item, ["provider"])).filter((item): item is string => Boolean(item)));
    const usage = this.snapshot.usage;
    const ai = usage?.resources.filter((item) => ["ai-chat-requests", "ai-coding-requests", "image-generations"].includes(item.resource)) ?? [];
    const services = usage?.resources.filter((item) => !["ai-chat-requests", "ai-coding-requests", "image-generations"].includes(item.resource)) ?? [];
    const plan = usage ? `<section class="spmt-account-plan"><div><span>CURRENT PLAN</span><h2>${escapeHtml(usage.plan.name)}</h2><p>${usage.plan.monthlyPriceUsd ? `$${usage.plan.monthlyPriceUsd}/month` : "Free"} · ${escapeHtml(usage.period)}</p></div><strong>${usage.plan.companionLocalProcessing === "unmetered-local" ? "Companion local processing included" : "Companion fair use"}</strong></section>` : "";
    return `${page("Your account", "Your plan, personal usage, linked identities, and XP in one private view.", "ACCOUNT")}${sourceNotice("Usage", this.snapshot.sources.usage)}${plan}<section class="spmt-account-section spmt-usage-section"><header><span>PERSONAL USAGE</span><h2>AI and creation</h2><p>Only usage assigned to your signed-in SPMT identity appears here.</p></header><div class="spmt-usage-grid">${ai.map(usageBar).join("") || empty("Personal AI usage is temporarily unavailable.")}</div></section><section class="spmt-account-section spmt-usage-section"><header><span>PLAN RESOURCES</span><h2>Hosted services and storage</h2></header><div class="spmt-usage-grid">${services.map(usageBar).join("") || empty("Personal service usage is temporarily unavailable.")}</div></section><section class="spmt-account-section"><header><span>STELLA DATA</span><h2>Your AI privacy controls</h2><p>Raw remembered prompts and answers are retained for seven days, content-minimized metadata for 30 days, and do-not-remember turns for at most one hour.</p></header><div class="actions"><button type="button" data-stellar-export>Export my Stella data</button><button type="button" data-stellar-delete>Delete my Stella data</button></div></section>${sourceNotice("Linked accounts", this.snapshot.sources.identity)}<section class="spmt-account-section"><header><span>LINKED IDENTITIES</span><h2>Your sign-in providers</h2><p>Verify Twitch or Discord here once. App-owned bot connections and channel delivery are configured separately inside StreamWeaver or Discord Stream Hub.</p></header><div class="actions"><button type="button" class="primary" data-provider-link="twitch">${linkedProviders.has("twitch") ? "Re-verify" : "Link"} Twitch</button><button type="button" class="primary" data-provider-link="discord">${linkedProviders.has("discord") ? "Re-verify" : "Link"} Discord</button></div><div class="spmt-list spmt-account-list">${links.map((item) => { const provider = recordText(item, ["provider"]) ?? "provider"; const providerUserId = recordText(item, ["providerUserId", "provider_user_id"]) ?? "unknown"; return `<article><div><span class="spmt-record-kind">${escapeHtml(provider)}</span><strong>${escapeHtml(providerUserId)}</strong><p>This verified account signs into the same SPMT user identity.</p></div><button data-provider-unlink="${escapeHtml(providerLinkKey(item))}">Unlink</button></article>`; }).join("") || empty("No provider accounts are linked to this SPMT identity.")}</div></section>`;
  }

  private settings() {
    const installed = this.snapshot.apps.filter((app) => app.installed && app.enabled);
    return `${page("App and ecosystem settings", "Advanced controls stay with the app or shared system they configure.", "SETTINGS")}<section class="spmt-account-section"><header><span>ECOSYSTEM</span><h2>Shared appearance and workspace behavior</h2><p>Themes, animation, layout, dock slots, scenes, and other shared controls are maintained in Workspace.</p></header><div class="actions"><button type="button" class="primary" data-nav="workspace">Open workspace settings ${icon("arrow")}</button></div></section><section class="spmt-account-section"><header><span>APP SETTINGS</span><h2>Advanced controls by owning app</h2><p>Open an app to configure its integrations, automation, output, privacy, and advanced switches without mixing them into your personal account.</p></header><div class="spmt-app-grid wide">${installed.map((app) => `<article class="spmt-app-card"><span>APP SETTINGS</span><h2>${escapeHtml(app.name)}</h2><p>${escapeHtml(app.description)}</p><button type="button" data-launch-app="${escapeHtml(app.appId)}">Open ${escapeHtml(app.name)} settings ${icon("arrow")}</button></article>`).join("") || empty("Install an app in Shipyard to expose its settings.")}</div></section>`;
  }
}

const USAGE_LABELS: Record<MeteredResourceV1, string> = { "workspaces": "Workspaces", "connected-providers": "Connected providers", "hosted-rooms": "Hosted rooms", "hosted-worker-minutes": "Worker minutes", "ai-chat-requests": "AI chat", "ai-coding-requests": "AI coding", "image-generations": "Image generation", "hosted-voice-minutes": "Voice minutes", "xbox-session-minutes": "Xbox sessions", "storage-gb": "Storage" };
function usageBar(item: PersonalUsageResourceV1) {
  const percent = Math.max(0, Math.min(100, item.percent));
  const companion = item.companion > 0 ? `<small>${item.companion.toLocaleString()} processed locally by Companion</small>` : "";
  return `<article class="spmt-usage-card state-${item.warning}" aria-label="${escapeHtml(USAGE_LABELS[item.resource])}: ${percent}% used"><header><strong>${escapeHtml(USAGE_LABELS[item.resource])}</strong><b>${percent}%</b></header><div class="spmt-usage-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div><footer><span>${item.hosted.toLocaleString()} of ${item.limit.toLocaleString()}</span>${companion}</footer></article>`;
}

function sourceNotice(label: string, state: SourceStateV1) { if (state.state === "ready") return ""; return `<aside class="spmt-source-notice state-${state.state}"><strong>${escapeHtml(label)} is ${escapeHtml(state.state)}</strong><span>${escapeHtml(state.detail ?? "The source is temporarily unavailable.")}</span></aside>`; }
function deferredPanel(id: string, body: string) { const source = DEFERRED_RUNTIME_SOURCES.find((item) => item.id === id); return `<aside class="spmt-deferred"><div><span>SEPARATE RUNTIME</span><strong>${escapeHtml(source?.presentation ?? id)}</strong></div><p>${escapeHtml(body)}</p><small>Owner: ${escapeHtml(source?.owner ?? "unassigned")} • no fabricated data</small></aside>`; }
function unreadCount(items: Array<Record<string, unknown>>) { return items.filter(isUnread).length; }
function ecosystemPresence(events: Array<Record<string, unknown>>, apps: SpaceMountainAppCardV1[]) {
  const appPool = new Map(apps.filter((app) => app.installed && app.enabled).map((app) => [app.appId, app.name]));
  const people = new Map<string, { name: string; sources: string[] }>();
  for (const event of events) {
    const type = recordText(event, ["type"])?.toLowerCase() ?? "";
    if (!type.includes("live")) continue;
    const payload = recordObject(event, "payload") ?? event;
    const canonicalId = recordText(payload, ["canonicalUserId", "canonical_user_id", "userId", "user_id", "providerUserId", "provider_user_id"]);
    const name = recordText(payload, ["displayName", "display_name", "username", "userName", "login"]);
    if (!canonicalId || !name) continue;
    const sourceId = recordText(event, ["sourceAppId", "source_app_id"]) ?? recordText(payload, ["sourceAppId", "source_app_id", "source"]) ?? "ecosystem";
    const source = appPool.get(sourceId) ?? sourceLabel(sourceId);
    const existing = people.get(canonicalId) ?? { name, sources: [] };
    if (!existing.sources.includes(source)) existing.sources.push(source);
    people.set(canonicalId, existing);
  }
  return [...people.values()].sort((left, right) => left.name.localeCompare(right.name));
}
function connectedAppUsage(events: Array<Record<string, unknown>>, appId: string) {
  const people = new Set<string>();
  for (const event of events) {
    if (!(recordText(event, ["type"])?.toLowerCase() ?? "").includes("live")) continue;
    const payload = recordObject(event, "payload") ?? event;
    const sourceId = recordText(event, ["sourceAppId", "source_app_id"]) ?? recordText(payload, ["sourceAppId", "source_app_id", "source"]);
    if (sourceId !== appId) continue;
    const personId = recordText(payload, ["canonicalUserId", "canonical_user_id", "userId", "user_id", "providerUserId", "provider_user_id"]);
    if (personId) people.add(personId);
  }
  return people.size;
}
function commlinkSources(snapshot: SpaceMountainShellSnapshotV1) {
  const sources = new Map<string, { id: string; label: string; short: string; state: "ready" | "degraded" | "unavailable"; detail: string }>();
  const add = (id: string, label: string, state: "ready" | "degraded" | "unavailable", detail: string) => { if (!sources.has(id)) sources.set(id, { id, label, short: label.slice(0, 1).toUpperCase(), state, detail }); };
  add("spacemountain", "SPMT", snapshot.sources.commlink.state, "Canonical SPMT conversations, mail, notifications, and events");
  const liveProviders = new Set((snapshot.liveChat ?? []).map((item) => item.provider));
  snapshot.providerLinks.forEach((link) => { const provider = recordText(link, ["provider"]) ?? "provider"; const live = liveProviders.has(provider as "twitch" | "discord" | "kick"); add(provider, provider[0]!.toUpperCase() + provider.slice(1), live ? "ready" : "degraded", live ? `${provider} messages are arriving through Chat Gateway` : `${provider} identity is linked; no current Chat Gateway message has been projected`); });
  liveProviders.forEach((provider) => add(provider, provider[0]!.toUpperCase() + provider.slice(1), "ready", `${provider} messages are arriving through Chat Gateway`));
  snapshot.apps.filter((app) => app.installed && app.enabled).forEach((app) => add(app.appId, app.name, app.appId === "streamweaver" ? snapshot.sources.commlink.state : "ready", `${app.name} app messages and typed events`));
  snapshot.conversations.forEach((conversation) => { const id = commlinkRecordSource(conversation); if (id && id !== "spacemountain") add(id, sourceLabel(id), snapshot.sources.commlink.state, `${sourceLabel(id)} canonical conversation source`); });
  snapshot.events.forEach((event) => { const id = commlinkRecordSource(event); if (id && id !== "spacemountain") add(id, sourceLabel(id), snapshot.sources.events.state, `${sourceLabel(id)} typed app events`); });
  return [...sources.values()];
}
function sourceLabel(value: string) { return value.split(/[-_]/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ") || "SPMT"; }
function commlinkRecordSource(value: Record<string, unknown>) { return recordText(value, ["sourceAppId", "source_app_id", "provider", "source"]) ?? recordText(recordObject(value, "payload"), ["sourceAppId", "source_app_id", "provider", "source"]) ?? "spacemountain"; }
function isCommlinkWorkspace(value: Record<string, unknown> | undefined) {
  return Boolean(value && value.schemaVersion === 1 && Array.isArray(value.chatSpaces) && value.chatSpaces.length && Array.isArray(value.desks) && value.desks.length && typeof value.activeChatSpaceId === "string" && typeof value.activeDeskId === "string" && (value.view === "focus" || value.view === "desk"));
}
function commlinkCard(item: Record<string, unknown>, small = false) {
  const source = commlinkRecordSource(item);
  const kind = recordText(item, ["__recordType", "kind", "type"]) ?? "message";
  const title = recordText(item, ["displayName", "display_name", "authorName", "senderUserId", "title", "type"]) ?? sourceLabel(source);
  const body = recordText(item, ["text", "body", "content", "summary", "title"]) ?? payloadKeySummary(item.payload);
  const conversationId = recordText(item, ["conversationId"]) ?? (recordText(item, ["kind"]) ? recordText(item, ["id"]) : undefined);
  const signal = isDiscordSignal(item);
  return `<article class="cosmo-message ${small ? "small" : ""} ${signal ? "signal" : ""}" ${conversationId ? `data-open-conversation="${escapeHtml(conversationId)}"` : ""} ${signal ? "data-spmt-signal-trigger" : ""}><span class="cosmo-message-avatar">${escapeHtml(initials(title))}</span><div><header><strong>${escapeHtml(title)}</strong><b>${escapeHtml(sourceLabel(source))}</b><small>${escapeHtml(formatRecordTime(recordText(item, ["occurredAt", "occurred_at", "createdAt", "created_at", "updatedAt", "updated_at"])))}</small></header><p>${escapeHtml(body)}</p><footer><span>${escapeHtml(kind)}</span>${signal ? "<button type=\"button\" data-spmt-signal-trigger>Trace signal</button>" : ""}</footer></div></article>`;
}
function isDiscordSignal(item: Record<string, unknown>) {
  const source = commlinkRecordSource(item).toLowerCase(); const payload = recordObject(item, "payload");
  return source.includes("discord") && (recordText(item, ["easterEgg", "easter_egg"]) === "signal" || recordText(payload, ["easterEgg", "easter_egg", "discoveryId", "discovery_id"]) === "signal" || recordBoolean(item, "hiddenSignal", false) || recordBoolean(payload, "hiddenSignal", false));
}
function mountOverlayBay(root: HTMLElement, snapshot: SpaceMountainShellSnapshotV1) {
  const form = root.querySelector<HTMLElement>("[data-workspace-settings]");
  if (!form || root.querySelector("[data-overlay-bay]")) return;
  const section = document.createElement("section");
  section.dataset.overlayBay = "canonical";
  section.className = "spmt-overlay-bay spmt-product-glass";
  const widgets = snapshot.overlayWidgets ?? [];
  const outputs = snapshot.overlayOutputs ?? [];
  const owner = sessionHasScope(snapshot.session, "overlay:outputs:write");
  section.innerHTML = `<header><span>OVERLAY BAY</span><h2>Shared overlay workspace</h2></header><p>This is the one editing authority consumed by every ecosystem app. Overlay Bay issues first-party, revocable browser-source URLs served by SpaceMountain.</p><div class="spmt-overlay-grid">${widgets.map((item) => { const manifest = recordObject(item, "manifest"); const appId = recordText(manifest, ["appId"]) ?? "ecosystem"; const widgetId = recordText(manifest, ["widgetId", "id"]) ?? "widget"; return `<article><b>${escapeHtml(recordText(manifest, ["title"]) ?? "Overlay widget")}</b><small>${escapeHtml(appId)} · ${escapeHtml(widgetId)}</small>${owner ? `<div><button type="button" data-overlay-issue="${escapeHtml(widgetId)}" data-overlay-app="${escapeHtml(appId)}">Create public URL</button><button type="button" data-overlay-issue="${escapeHtml(widgetId)}" data-overlay-app="${escapeHtml(appId)}" data-overlay-personal="true">Create personal URL</button></div>` : ""}</article>`; }).join("") || `<article><b>Empty scene</b><small>Installed apps register widgets here through the public overlay contract.</small></article>`}</div><div class="spmt-list spmt-account-list">${outputs.map((item) => `<article><div><span class="spmt-record-kind">BROWSER SOURCE</span><strong>${escapeHtml(recordText(item, ["appId"]) ?? "ecosystem")} · ${escapeHtml(recordText(item, ["widgetId"]) ?? "widget")}</strong><small>Expires ${escapeHtml(formatRecordTime(recordText(item, ["expiresAt"])))}</small></div>${owner && !recordText(item, ["revokedAt"]) ? `<button type="button" data-overlay-revoke="${escapeHtml(recordText(item, ["grantId"]) ?? "")}">Revoke</button>` : ""}</article>`).join("") || empty("No active browser-source URLs have been issued.")}</div>`;
  form.before(section);
}
function bindEcosystemEggs(root: HTMLElement, onDockToggle: (collapsed: boolean) => void) {
  const logo = root.querySelector<HTMLElement>("[data-spmt-black-hole-trigger]");
  let logoClick: number | undefined;
  logo?.addEventListener("click", () => { window.clearTimeout(logoClick); logoClick = window.setTimeout(() => root.querySelector<HTMLElement>('[data-spmt-product-nav="home"]')?.click(), 260); });
  logo?.addEventListener("dblclick", (event) => { event.preventDefault(); window.clearTimeout(logoClick); openBlackHole(root, logo); });
  const rocket = root.querySelector<HTMLElement>("[data-spmt-rocket-trigger]");
  let rocketClick: number | undefined;
  let follow: ((move: PointerEvent) => void) | undefined;
  let portal: HTMLElement | undefined;
  const dockParent = rocket?.parentNode;
  const dockNext = rocket?.nextSibling;
  const restoreRocket = () => {
    if (!rocket) return;
    if (follow) window.removeEventListener("pointermove", follow);
    follow = undefined;
    portal?.remove();
    portal = undefined;
    rocket.classList.remove("spmt-rocket-free", "free");
    rocket.classList.add("docked");
    rocket.removeAttribute("style");
    if (dockParent) dockParent.insertBefore(rocket, dockNext ?? null);
  };
  rocket?.addEventListener("click", () => {
    if (rocket.classList.contains("spmt-rocket-free")) return;
    window.clearTimeout(rocketClick);
    rocketClick = window.setTimeout(() => onDockToggle(root.dataset.spmtDock !== "collapsed"), 260);
  });
  rocket?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onDockToggle(root.dataset.spmtDock !== "collapsed");
  });
  rocket?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    window.clearTimeout(rocketClick);
    if (rocket.classList.contains("spmt-rocket-free")) { restoreRocket(); return; }
    rocket.classList.remove("docked");
    rocket.classList.add("spmt-rocket-free", "free");
    document.body.appendChild(rocket);
    rocket.style.setProperty("--rocket-x", `${event.clientX}px`);
    rocket.style.setProperty("--rocket-y", `${event.clientY}px`);
    portal = openRocketPortal(root);
    follow = (move: PointerEvent) => {
      rocket.style.setProperty("--rocket-x", `${move.clientX}px`);
      rocket.style.setProperty("--rocket-y", `${move.clientY}px`);
      const target = portal!.getBoundingClientRect();
      const centerX = target.left + target.width / 2; const centerY = target.top + target.height / 2;
      if (Math.hypot(move.clientX - centerX, move.clientY - centerY) <= Math.min(target.width, target.height) * .42) {
        restoreRocket();
        openHiddenArena(root);
      }
    };
    window.addEventListener("pointermove", follow);
  });
  root.querySelectorAll<HTMLElement>("[data-spmt-signal-trigger]").forEach((node) => node.addEventListener("click", (event) => { event.stopPropagation(); showEggResult(root, "LOST SIGNAL FOUND", "signal"); }));
}
function openRocketPortal(root: HTMLElement) {
  root.querySelector("#rocketArenaBlackHole")?.remove();
  const portal = document.createElement("div"); portal.id = "rocketArenaBlackHole"; portal.setAttribute("aria-label", "Black hole entrance to the Arena");
  portal.innerHTML = `<span>ENTER HERE</span>`; root.appendChild(portal); return portal;
}
function openHiddenArena(root: HTMLElement) {
  const arena = document.createElement("section"); arena.id = "spmt-hidden-arena";
  arena.innerHTML = `<button aria-label="Leave the hidden arena">×</button><div><span>ROCKET DISCOVERY</span><h2>Hidden Battle Arena</h2><p>You flew the released rocket through the portal. The Arena signal is retained to your canonical SPMT account.</p><strong>ARENA ENTRANCE UNLOCKED</strong></div>`;
  root.appendChild(arena); arena.querySelector("button")?.addEventListener("click", () => arena.remove()); showEggResult(root, "HIDDEN ARENA DISCOVERED", "rocket");
}
function openBlackHole(root: HTMLElement, mark: HTMLElement) {
  if (root.querySelector("#spmt-black-hole-game")) return;
  const game = document.createElement("section");
  game.id = "spmt-black-hole-game";
  const positions = [[18, 28], [78, 34], [48, 78]];
  game.innerHTML = `<div class="egg-hud"><strong>THE BLACK HOLE</strong><span>Guide all anomalies into the singularity</span><b data-egg-count>0 / 3</b></div><div class="egg-void"></div>${["🚀","📡","🌌"].map((item, index) => `<button class="egg-artifact" style="left:${positions[index]![0]}%;top:${positions[index]![1]}%">${item}</button>`).join("")}<button class="egg-close" aria-label="Close">×</button>`;
  root.appendChild(game);
  const center = mark.getBoundingClientRect();
  const voidNode = game.querySelector<HTMLElement>(".egg-void")!;
  voidNode.style.left = `${center.left + center.width / 2}px`;
  voidNode.style.top = `${center.top + center.height / 2}px`;
  let captured = 0;
  game.querySelector<HTMLElement>(".egg-close")?.addEventListener("click", () => game.remove());
  game.querySelectorAll<HTMLElement>(".egg-artifact").forEach((artifact) => artifact.addEventListener("click", () => {
    if (artifact.classList.contains("captured")) return;
    artifact.classList.add("captured");
    artifact.style.left = "50%";
    artifact.style.top = "50%";
    captured += 1;
    const count = game.querySelector<HTMLElement>("[data-egg-count]");
    if (count) count.textContent = `${captured} / 3`;
    if (captured === 3) window.setTimeout(() => { game.remove(); showEggResult(root, "ANOMALY STABILIZED", "blackHole"); }, 450);
  }));
}
function showEggResult(root: HTMLElement, title: string, egg: "rocket" | "blackHole" | "signal") {
  const result = document.createElement("div");
  result.className = "spmt-egg-result";
  result.textContent = title;
  root.appendChild(result);
  window.dispatchEvent(new CustomEvent("spmt:easter-egg-complete", { detail: { egg, completed: true } }));
  window.setTimeout(() => result.remove(), 2200);
}
function isUnread(item: Record<string, unknown>) { return !recordText(item, ["readAt", "read_at"]); }
function recordStrings(value: unknown, key: string) { if (!value || typeof value !== "object" || Array.isArray(value)) return []; const raw = (value as Record<string, unknown>)[key]; return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : []; }
function payloadKeySummary(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return "No structured payload fields"; const keys = Object.keys(value as Record<string, unknown>).sort(); return keys.length ? `Payload fields: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? "…" : ""}` : "No structured payload fields"; }
function formatRecordTime(value: string | undefined) { if (!value) return "Time unavailable"; const timestamp = Date.parse(value); if (!Number.isFinite(timestamp)) return value; return new Date(timestamp).toISOString().replace("T", " ").replace(".000Z", " UTC"); }
function appCard(app: SpaceMountainAppCardV1, theme: string) { const action = app.installed && app.enabled ? `<button class="primary" data-launch-app="${escapeHtml(app.appId)}">Launch ${icon("arrow")}</button>` : `<button data-install-app="${escapeHtml(app.appId)}">Install</button>`; const themed = themedAppIconUrl(theme, app.appId); const art = themed ? `<img src="${escapeHtml(themed)}" alt="" loading="lazy">` : app.iconUrl ? `<img src="${escapeHtml(app.iconUrl)}" alt="" loading="lazy">` : `<span>${escapeHtml(initials(app.name))}</span>`; return `<article class="spmt-app-card"><div class="app-icon">${art}</div><div class="spmt-app-status"><span>${app.installed ? (app.enabled ? "INSTALLED" : "DISABLED") : "AVAILABLE"}</span><small>v${escapeHtml(app.version || "—")}</small></div><h3>${escapeHtml(app.name)}</h3><p>${escapeHtml(app.description || "SpaceMountain ecosystem application")}</p><footer>${action}<small>${escapeHtml(app.surfaces.join(" · ") || "standalone")}</small></footer></article>`; }
function overlayBayCard(theme: string) { return `<article class="spmt-app-card"><div class="app-icon"><img src="${themedAppIconUrl(theme, "overlay-bay")}" alt="" loading="lazy"></div><div class="spmt-app-status"><span>WORKSPACE TOOL</span><small>canonical</small></div><h3>Overlay Bay</h3><p>Compose app widgets into sandbox-safe OBS scenes and managed outputs.</p><footer><button class="primary" data-nav="workspace">Open ${icon("arrow")}</button><small>workspace · overlay</small></footer></article>`; }
function metric(label: string, value: string) { return `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`; }
function quick(title: string, body: string, nav: SpaceMountainViewV1, iconName: IconName = "pulse") { return `<button data-nav="${nav}"><i>${icon(iconName)}</i><strong>${title}</strong><span>${body}</span><em>${icon("arrow")}</em></button>`; }
function page(title: string, body: string, kicker = "SPACEMOUNTAIN") { return `<section class="spmt-page-title"><span>${kicker}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></section>`; }
function empty(message: string, nav?: SpaceMountainViewV1) { return `<div class="spmt-empty"><i>${icon("spark")}</i><strong>Clear orbit</strong><span>${escapeHtml(message)}</span>${nav ? `<button data-nav="${nav}">Open ${nav === "apps" ? "Shipyard" : escapeHtml(nav)}</button>` : ""}</div>`; }
function recordText(value: unknown, keys: string[]) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const record = value as Record<string, unknown>; for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string; return undefined; }
function recordNumber(value: unknown, key: string) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const result = (value as Record<string, unknown>)[key]; return typeof result === "number" && Number.isFinite(result) ? result : undefined; }
function recordBoolean(value: unknown, key: string, fallback: boolean) { if (!value || typeof value !== "object" || Array.isArray(value)) return fallback; const result = (value as Record<string, unknown>)[key]; return typeof result === "boolean" ? result : fallback; }
function recordObject(value: unknown, key: string) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const result = (value as Record<string, unknown>)[key]; return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : undefined; }
function sessionHasScope(value: unknown, scope: string) { return recordStrings(value, "scopes").includes(scope); }
function providerLinkKey(value: unknown) { return `${recordText(value, ["provider"]) ?? ""}:${recordText(value, ["providerUserId", "provider_user_id"]) ?? ""}`; }
function themeLogoUrl(theme: string, kind: "hero" | "hero-secondary" | "name" | "spmt") {
  const id = ["solar-flare", "nebula-purple", "oceanic-blue", "aurora-green"].includes(theme) ? theme : "solar-flare";
  return `/assets/product/themes/${id}-${kind}.png`;
}
function themedAppIconUrl(theme: string, appId: string) {
  const themeId = ["solar-flare", "nebula-purple", "oceanic-blue", "aurora-green"].includes(theme) ? theme : "solar-flare";
  const aliases: Record<string, string> = { spacemountain: "mission-control", "spacemountain-web": "mission-control", "discord-stream-hub": "discord-stream-hub", dsh: "discord-stream-hub" };
  const id = aliases[appId] ?? appId;
  const supported = new Set(["stellar-core", "shipyard", "commlink", "mission-control", "mountainview", "discord-stream-hub", "streamweaver", "hearmeout", "nebula-arcade", "companion", "overlay-bay"]);
  return supported.has(id) ? `/assets/product/app-icons/${themeId}/${id}.png` : undefined;
}
function coreNavIcon(theme: string, view: SpaceMountainViewV1) {
  const artwork = view === "apps" ? "shipyard" : view === "workspace" ? "overlay-bay" : undefined;
  if (artwork) return `<span class="spmt-core-nav-icon"><img data-core-nav-art="${artwork}" src="${escapeHtml(themedAppIconUrl(theme, artwork) ?? "")}" alt=""></span>`;
  return `<span class="spmt-core-nav-icon">${icon(view === "settings" ? "settings" : "home")}</span>`;
}
function themedHeaderIcon(theme: string, appId: string) { return `<img class="spmt-header-action-icon" data-themed-app-art="${escapeHtml(appId)}" src="${escapeHtml(themedAppIconUrl(theme, appId) ?? "")}" alt="">`; }
function selectOption(value: string, selected: string, label: string) { return `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`; }
function rangeControl(name: string, label: string, value: number) { return `<label>${escapeHtml(label)} <output>${Math.round(value)}</output><input type="range" name="${escapeHtml(name)}" min="0" max="100" step="1" value="${Math.round(value)}"></label>`; }
function checkControl(name: string, label: string, checked: boolean) { return `<label class="spmt-check"><input type="checkbox" name="${escapeHtml(name)}"${checked ? " checked" : ""}>${escapeHtml(label)}</label>`; }
function workspaceDockSlots(value: unknown): Array<string | null> { if (!value || typeof value !== "object" || Array.isArray(value)) return [null, null, null]; const raw = (value as Record<string, unknown>).dockSlots; if (!Array.isArray(raw)) return [null, null, null]; return [0, 1, 2].map((index) => typeof raw[index] === "string" ? raw[index] as string : null); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }
function initials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "SP"; }
const COMMLINK_MAIL_CSS = `.cosmo-mail-dialog{width:min(580px,calc(100vw - 32px));border:1px solid color-mix(in srgb,var(--accent) 55%,var(--border));border-radius:20px;background:#080a1d;color:#fff;box-shadow:0 28px 90px #000c}.cosmo-mail-dialog::backdrop{background:#01020bc9;backdrop-filter:blur(8px)}.cosmo-mail-dialog form{display:grid;gap:14px}.cosmo-mail-dialog header,.cosmo-mail-dialog footer{display:flex;align-items:center;justify-content:space-between;gap:16px}.cosmo-mail-dialog header span{color:#9da0bd;font-size:8px;font-weight:900;letter-spacing:.16em}.cosmo-mail-dialog h2{margin:4px 0 0}.cosmo-mail-dialog header button{border:0;background:transparent;color:#fff;font-size:24px}.cosmo-mail-dialog label{display:grid;gap:7px;color:#aeb2ca;font-size:10px;font-weight:850}.cosmo-mail-dialog input,.cosmo-mail-dialog select,.cosmo-mail-dialog textarea{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:12px;background:#050715;color:white;padding:11px;font:inherit}.cosmo-mail-dialog select option{padding:6px}.cosmo-mail-dialog footer small{color:#8f94ad}.cosmo-mail-dialog footer button{border:0;border-radius:12px;padding:10px 18px}`;
type IconName = "home" | "grid" | "mail" | "spark" | "pulse" | "layout" | "settings" | "help" | "rocket" | "arrow" | "broadcast";
function icon(name: IconName) { const paths: Record<IconName, string> = { home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', spark: '<path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>', pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>', layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M9 10h12"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.7 1.8c-1 .7-1.5 1.1-1.5 2.2M12 17h.01"/>', rocket: '<path d="M14 4c3-2 5-1 6-1 0 1 1 3-1 6l-5 5-4-1-1-4 5-5Z"/><path d="m9 9-4 1-2 3 5 1M14 14l-1 5-3 2-1-5M8 16l-3 3"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', broadcast: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"/>' }; return `<svg class="spmt-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`; }

const WORKSPACE_SETTINGS_CSS = `.spmt-settings-form{display:grid;gap:16px}.spmt-settings-form>section{border:1px solid var(--border);border-radius:20px;background:var(--panel);padding:18px}.spmt-settings-form header span{font-size:10px;letter-spacing:.18em;font-weight:900;color:var(--accent2)}.spmt-settings-form h2{margin:5px 0 10px}.spmt-appearance-rule{margin:0 0 16px;color:#aeb1c0;font-size:12px;line-height:1.55}.spmt-field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.spmt-field-grid label{display:grid;gap:7px;color:#b7b9c4;font-size:11px;font-weight:800}.spmt-field-grid label small{color:#858795;font-weight:600}.spmt-field-grid label.wide{grid-column:span 2}.spmt-field-grid input,.spmt-field-grid select{width:100%;border:1px solid var(--border);border-radius:11px;background:#080b17;color:white;padding:10px;font:inherit}.spmt-field-grid input[type=color]{min-height:40px;padding:4px}.spmt-settings-form>button{justify-self:start;border:0;border-radius:12px;padding:11px 15px;font-weight:900}.spmt-settings-form>small{color:#8d90a0}@media(max-width:700px){.spmt-field-grid{grid-template-columns:1fr}.spmt-field-grid label.wide{grid-column:auto}}`;
const COMMLINK_FORM_CSS = `.spmt-commlink-search{display:flex;gap:9px;margin-bottom:14px}.spmt-commlink-search label{flex:1;display:grid;gap:5px;color:#9b9eac;font-size:10px;font-weight:800}.spmt-commlink-search input{width:100%;border:1px solid var(--border);border-radius:11px;background:#080b17;color:white;padding:10px;font:inherit}.spmt-commlink-search button{align-self:end;border:1px solid var(--border);border-radius:11px;background:rgba(255,255,255,.05);color:white;padding:10px 14px;font-weight:800}.dialog-reply{display:grid;gap:9px;margin-top:10px;padding-top:14px;border-top:1px solid rgba(255,255,255,.1)}.dialog-reply textarea{min-height:96px;resize:vertical;border:1px solid rgba(255,255,255,.15);border-radius:11px;background:#060b18;color:white;padding:11px;font:inherit}.dialog-reply button{justify-self:end}`;
const COSMO_COMMLINK_CSS = `.cosmo-commlink{min-height:calc(100dvh - var(--spmt-shell-top-inset,124px) - 54px);display:grid;grid-template-columns:260px minmax(0,1fr);overflow:hidden;border:1px solid color-mix(in srgb,var(--accent) 24%,var(--border));border-radius:28px;background:rgba(3,5,14,.9);box-shadow:0 28px 90px #0009}.cosmo-rail{min-height:0;padding:20px 16px;display:flex;flex-direction:column;border-right:1px solid var(--border);background:rgba(3,5,15,.86)}.cosmo-mark{display:flex;align-items:center;gap:11px;padding:2px 4px 18px}.cosmo-mark>span{width:48px;height:48px;display:grid;place-items:center;border:1px solid #a78bfa88;border-radius:50%;color:white;font-size:22px;background:radial-gradient(circle,#ffffff22,transparent 65%);box-shadow:0 0 25px #7c3aed55}.cosmo-mark div{display:grid}.cosmo-mark strong{font-size:20px}.cosmo-mark small{color:#9da0bd;font-size:9px;letter-spacing:.22em;text-transform:uppercase}.cosmo-create{min-height:46px;border:1px solid #8b5cf666;border-radius:16px;background:linear-gradient(90deg,#8b5cf62c,#22d3ee10);color:#fff;font-weight:850}.cosmo-rail>header{display:flex;align-items:center;justify-content:space-between;margin:26px 7px 9px;color:#888da9;font-size:8px;font-weight:900;letter-spacing:.17em}.cosmo-rail>header button{border:0;background:transparent;color:#aeb2ca}.cosmo-rail nav{display:grid;gap:7px}.cosmo-rail nav button{width:100%;min-height:58px;display:flex;align-items:center;gap:10px;border:1px solid transparent;border-radius:14px;background:transparent;color:#c3c6d5;padding:8px;text-align:left}.cosmo-rail nav button>b{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:#8b5cf62a;color:#c4b5fd}.cosmo-rail nav button>span{min-width:0;display:grid}.cosmo-rail nav strong{overflow:hidden;text-overflow:ellipsis}.cosmo-rail nav small{margin-top:3px;color:#737892;font-size:8px}.cosmo-rail nav button:hover,.cosmo-rail nav button.active{border-color:#8b5cf666;background:#8b5cf61c;box-shadow:inset 3px 0 #9f7aea}.cosmo-rail footer{margin-top:auto;display:flex;align-items:center;gap:7px;padding:16px 5px 0;color:#858aa3}.cosmo-rail footer>span{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}.cosmo-rail footer small{font-size:8px}.cosmo-workspace{min-width:0;display:flex;flex-direction:column}.cosmo-topbar{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 22px;border-bottom:1px solid var(--border);background:#080a1dcc}.cosmo-topbar>div:first-child span{color:#8f94b1;font-size:8px;font-weight:900;letter-spacing:.14em}.cosmo-topbar h1{margin:5px 0 0;font-size:19px}.cosmo-actions{display:flex;align-items:center;gap:7px}.cosmo-actions>button,.cosmo-switch button{min-height:36px;border:1px solid var(--border);border-radius:11px;background:#ffffff08;color:#abb0c6;padding:7px 10px;font-weight:800}.cosmo-switch{display:flex;padding:3px;border:1px solid var(--border);border-radius:13px}.cosmo-switch button{border:0;background:transparent}.cosmo-switch button.active{background:#8b5cf635;color:white}.cosmo-sources{display:flex;align-items:center;gap:14px;min-height:66px;padding:9px 20px;border-bottom:1px solid var(--border);background:#10122b}.cosmo-sources>div{display:grid;grid-template-columns:auto auto;gap:2px 7px;white-space:nowrap}.cosmo-sources>div i{grid-row:1/3;width:8px;height:8px;align-self:center;border-radius:50%;background:#44e6a1;box-shadow:0 0 9px #44e6a1}.cosmo-sources>div strong{font-size:10px}.cosmo-sources>div span{color:#8287a2;font-size:8px}.cosmo-sources nav{display:flex;gap:7px;overflow-x:auto}.cosmo-sources nav button{position:relative;display:flex;align-items:center;gap:6px;white-space:nowrap;border:1px solid var(--border);border-radius:12px;background:#ffffff07;color:#888da5;padding:7px 12px}.cosmo-sources nav button>b{width:20px;height:20px;display:grid;place-items:center;border-radius:7px;background:#7c3aed;color:white;font-size:9px}.cosmo-sources nav button.active{border-color:#8b5cf677;background:#8b5cf621;color:white}.cosmo-sources nav button>i{width:6px;height:6px;border-radius:50%;background:currentColor}.cosmo-focus{min-height:0;flex:1;display:grid;grid-template-columns:minmax(0,1fr) 250px}.cosmo-feed-pane{min-width:0;display:flex;flex-direction:column}.cosmo-toolbar{min-height:54px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 18px;border-bottom:1px solid var(--border)}.cosmo-toolbar>nav,.cosmo-toolbar>div{display:flex;gap:5px}.cosmo-toolbar button{border:0;border-radius:10px;background:transparent;color:#9297b2;padding:8px 10px;font-size:9px;font-weight:800}.cosmo-toolbar button.active,.cosmo-toolbar button:hover{background:#8b5cf62b;color:#fff}.cosmo-toolbar form{display:flex}.cosmo-toolbar input{width:130px;border:1px solid var(--border);border-radius:9px 0 0 9px;background:#070918;color:white;padding:7px;font-size:9px}.cosmo-toolbar form button{border:1px solid var(--border);border-radius:0 9px 9px 0}.cosmo-feed{min-height:320px;max-height:calc(100dvh - var(--spmt-shell-top-inset,124px) - 250px);overflow:auto;padding:18px;scrollbar-width:thin;scrollbar-color:#8b5cf666 transparent}.cosmo-message{display:flex;gap:11px;margin-bottom:10px;padding:13px 14px;border:1px solid #ffffff10;border-radius:15px;background:#12142e;cursor:pointer}.cosmo-message:hover{border-color:#8b5cf65c}.cosmo-message.signal{border-color:#22d3ee77;box-shadow:0 0 22px #22d3ee18}.cosmo-message-avatar{width:38px;height:38px;flex:0 0 auto;display:grid;place-items:center;border-radius:12px;background:linear-gradient(135deg,#8b5cf6,#4f46e5);font-weight:900}.cosmo-message>div{min-width:0;flex:1}.cosmo-message header{display:flex;align-items:center;gap:7px}.cosmo-message header strong{font-size:11px}.cosmo-message header b{border-radius:6px;background:#0ea5e933;color:#7dd3fc;padding:3px 5px;font-size:7px;text-transform:uppercase}.cosmo-message header small{margin-left:auto;color:#777d98;font-size:8px}.cosmo-message p{margin:7px 0;color:#e4e5ef;font-size:11px;line-height:1.5}.cosmo-message footer{display:flex;gap:8px;color:#767c97;font-size:7px;text-transform:uppercase}.cosmo-message footer button{margin-left:auto;border:0;background:transparent;color:#67e8f9}.cosmo-message.small{margin:7px;padding:9px}.cosmo-message.small .cosmo-message-avatar{width:28px;height:28px}.cosmo-message.small p{font-size:9px}.cosmo-commlink.compact .cosmo-message{margin-bottom:4px;padding:8px 10px}.cosmo-commlink.compact .cosmo-message-avatar{width:29px;height:29px}.cosmo-composer{display:grid;grid-template-columns:minmax(150px,.35fr) minmax(200px,1fr) auto;gap:9px;padding:12px 18px;border-top:1px solid var(--border);background:#090b1d}.cosmo-composer>div{display:grid}.cosmo-composer span{color:#8f95ae;font-size:7px;font-weight:900;letter-spacing:.14em}.cosmo-composer b{font-size:10px}.cosmo-composer small{color:#747a92;font-size:7px}.cosmo-composer textarea{resize:none;border:1px solid var(--border);border-radius:12px;background:#050715;color:white;padding:12px;font:inherit}.cosmo-composer button{border:0;border-radius:12px;padding:9px 17px}.cosmo-context{padding:26px 20px;border-left:1px solid var(--border);background:#080a1a;display:flex;flex-direction:column;align-items:center;text-align:center}.cosmo-context>span{width:54px;height:54px;display:grid;place-items:center;border:1px solid #8b5cf666;border-radius:50%;font-size:25px;color:#a78bfa}.cosmo-context h2{font-size:15px}.cosmo-context p{color:#8d92aa;font-size:10px;line-height:1.55}.cosmo-context button,.cosmo-context a{width:100%;box-sizing:border-box;margin-top:8px;border:1px solid var(--border);border-radius:10px;background:#ffffff07;color:white;padding:9px;text-decoration:none;font-size:9px}.cosmo-desk-grid{min-height:0;flex:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;padding:12px;overflow:auto}.cosmo-desk-panel{min-height:260px;border:1px solid var(--border);border-radius:16px;background:#090b1d;overflow:hidden}.cosmo-desk-panel>header{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;border-bottom:1px solid var(--border)}.cosmo-desk-panel>header button{border:0;background:transparent;color:#a78bfa}.cosmo-panel-empty{padding:30px;color:#7e849c;text-align:center}@media(max-width:1120px){.cosmo-commlink{grid-template-columns:210px minmax(0,1fr)}.cosmo-context{display:none}.cosmo-focus{grid-template-columns:1fr}.cosmo-actions>button:not([data-commlink-popout]){display:none}}@media(max-width:760px){.cosmo-commlink{display:block;border-radius:20px}.cosmo-rail{max-height:235px;border-right:0;border-bottom:1px solid var(--border);overflow:auto}.cosmo-mark,.cosmo-rail footer{display:none}.cosmo-rail>header{margin-top:12px}.cosmo-rail nav{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.cosmo-topbar{padding:10px 12px}.cosmo-sources{display:block;padding:9px 12px}.cosmo-sources>div{margin-bottom:8px}.cosmo-toolbar{align-items:flex-start;padding:8px;overflow:auto}.cosmo-toolbar>div{display:none}.cosmo-composer{grid-template-columns:1fr auto}.cosmo-composer>div{grid-column:1/-1}.cosmo-feed{max-height:none}}`;

export const SPACE_MOUNTAIN_CSS = `.spmt-space-root{--accent:#ff7a18;--accent2:#ffc857;--panel:rgba(9,12,25,.76);--border:rgba(255,255,255,.1);min-height:100dvh;background:radial-gradient(circle at 15% 10%,rgba(255,122,24,.14),transparent 26%),radial-gradient(circle at 80% 0,rgba(87,54,201,.16),transparent 28%),#050710;color:#f7f7fb;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.spmt-space-shell{min-height:100dvh}.spmt-cosmic-header{position:fixed;top:max(12px,env(safe-area-inset-top));left:clamp(88px,10vw,164px);right:18px;z-index:300;min-height:64px;padding:10px 16px;border:1px solid var(--border);border-radius:20px;background:rgba(5,7,16,.76);backdrop-filter:blur(22px);display:flex;align-items:center;gap:14px;box-shadow:0 14px 40px rgba(0,0,0,.35)}.spmt-brand{border:0;background:none;color:white;display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.12em}.spmt-brand>span{display:grid;place-items:center;width:38px;height:38px;border-radius:13px;background:linear-gradient(145deg,var(--accent),#e24718);color:#111}.spmt-brand em{font-style:normal;color:var(--accent)}.spmt-header-status{margin-left:auto;display:flex;gap:10px;align-items:center;font-size:11px;color:#a6a8b4}.spmt-header-status b{border:1px solid var(--border);border-radius:999px;padding:5px 8px;text-transform:uppercase}.state-ready{color:#5ee6a8}.state-degraded{color:#ffd166}.state-unavailable{color:#ff6b6b}.spmt-header-actions{display:flex;gap:8px}.spmt-header-actions button{position:relative;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.04);color:white;padding:9px 11px}.spmt-icon-button i{position:absolute;right:-5px;top:-7px;background:#ffc857;color:#111;border-radius:99px;font-size:9px;min-width:17px;height:17px;display:grid;place-items:center;font-style:normal}.spmt-rocket-dock{position:fixed;left:16px;top:calc(var(--spmt-shell-top-inset,92px) + 8px);bottom:max(16px,env(safe-area-inset-bottom));z-index:100;width:108px;border:1px solid var(--border);border-radius:26px;background:rgba(7,9,19,.78);backdrop-filter:blur(20px);padding:10px;display:flex;flex-direction:column;gap:10px}.spmt-dock-orbit{height:72px;border:1px solid rgba(255,122,24,.24);border-radius:22px;display:grid;place-items:center;color:var(--accent);font-size:28px}.spmt-rocket-dock nav{display:flex;flex-direction:column;gap:4px}.spmt-rocket-dock nav button{border:1px solid transparent;background:transparent;color:#9799a8;border-radius:14px;padding:9px 7px;display:flex;align-items:center;gap:8px;text-align:left}.spmt-rocket-dock nav button.active{color:white;border-color:rgba(255,122,24,.28);background:rgba(255,122,24,.12)}.spmt-rocket-dock nav label{font-size:10px;font-weight:750}.spmt-rocket-dock footer{margin-top:auto;border-top:1px solid var(--border);padding-top:10px;display:flex;flex-direction:column}.spmt-rocket-dock footer small{font-size:8px;color:#777}.spmt-rocket-dock footer strong{font-size:9px;color:#5ee6a8}.spmt-space-main{padding:calc(var(--spmt-shell-top-inset,92px) + 26px) 24px 48px 148px;min-height:var(--spmt-shell-available-height,calc(100dvh - 110px));box-sizing:border-box}.spmt-hero{border:1px solid var(--border);border-radius:28px;background:linear-gradient(135deg,rgba(11,14,28,.88),rgba(4,6,14,.72));padding:clamp(24px,4vw,46px);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:28px}.kicker,.spmt-page-title>span,.spmt-section header span,.spmt-app-card>span,.spmt-slot-grid span{font-size:10px;letter-spacing:.18em;font-weight:900;color:var(--accent2)}.spmt-hero h1,.spmt-page-title h1{font-size:clamp(34px,5vw,62px);line-height:1.03;margin:12px 0}.spmt-hero p,.spmt-page-title p{max-width:680px;color:#b7b9c4;line-height:1.65}.actions{display:flex;gap:10px;margin-top:24px}.spmt-hero button,.spmt-section button,.spmt-app-card button{border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.05);color:white;padding:10px 14px;font-weight:800}.primary{background:linear-gradient(135deg,var(--accent2),var(--accent))!important;color:#15100a!important;border-color:transparent!important}.spmt-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px}.spmt-metrics>div{min-height:92px;border:1px solid var(--border);border-radius:18px;background:rgba(0,0,0,.25);padding:15px;display:flex;flex-direction:column;justify-content:flex-end}.spmt-metrics strong{font-size:26px}.spmt-metrics span{font-size:10px;color:#858795;text-transform:uppercase}.spmt-operations-metrics{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px}.spmt-section{margin-top:18px;border:1px solid var(--border);border-radius:24px;background:var(--panel);padding:22px}.spmt-section>header{display:flex;justify-content:space-between;align-items:end}.spmt-section h2{margin:4px 0}.spmt-app-grid{margin-top:18px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.spmt-app-grid.wide{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:24px}.spmt-app-card{border:1px solid var(--border);border-radius:20px;background:rgba(4,6,14,.58);padding:16px}.app-icon{width:48px;height:48px;border-radius:14px;background:linear-gradient(145deg,rgba(255,122,24,.22),rgba(87,54,201,.22));display:grid;place-items:center;font-weight:900;margin-bottom:14px}.spmt-app-card h3{margin:5px 0 4px}.spmt-app-card p{font-size:12px;line-height:1.5;color:#9497a6;min-height:36px}.spmt-app-card footer{display:flex;align-items:center;justify-content:space-between;margin-top:14px}.spmt-quick-grid,.spmt-slot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.spmt-quick-grid button,.spmt-slot-grid article{border:1px solid var(--border);border-radius:20px;background:rgba(7,9,19,.74);padding:18px;color:white;text-align:left}.spmt-quick-grid span{display:block;color:#9598a7;font-size:12px;line-height:1.5;margin-top:7px}.spmt-page-title{padding:10px 2px 20px}.spmt-page-title h1{font-size:clamp(32px,4vw,48px)}.spmt-list{display:grid;gap:10px}.spmt-list article{border:1px solid var(--border);border-radius:16px;background:var(--panel);padding:15px;display:flex;justify-content:space-between}.spmt-empty{grid-column:1/-1;border:1px dashed var(--border);border-radius:18px;padding:28px;text-align:center;color:#777}.spmt-tabs{display:flex;gap:8px;overflow-x:auto;margin-bottom:14px;padding-bottom:2px}.spmt-tabs button{white-space:nowrap;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.04);color:#a8aab7;padding:9px 13px;font-weight:800}.spmt-tabs button.active{color:white;background:rgba(255,122,24,.16);border-color:rgba(255,122,24,.4)}.spmt-tabs i{display:inline-grid;place-items:center;min-width:18px;height:18px;margin-left:7px;border-radius:99px;background:rgba(255,255,255,.1);font-size:9px;font-style:normal}.spmt-account-list article{align-items:center;gap:18px}.spmt-account-list article>div{min-width:0;display:grid;gap:5px}.spmt-account-list article.unread{border-color:rgba(255,200,87,.35);box-shadow:inset 3px 0 0 var(--accent2)}.spmt-account-list article.level-warn{border-color:rgba(255,209,102,.35)}.spmt-account-list article.level-error,.spmt-account-list article.level-critical{border-color:rgba(255,107,107,.42);box-shadow:inset 3px 0 0 #ff6b6b}.spmt-account-list button{flex:0 0 auto;border:1px solid var(--border);border-radius:11px;background:rgba(255,255,255,.05);color:white;padding:9px 12px}.spmt-account-list p{margin:0;color:#b7b9c4;font-size:12px;line-height:1.5}.spmt-account-list small,.spmt-context-grid small,.spmt-command-grid small{color:#858795;font-size:10px}.spmt-record-kind{color:var(--accent2);font-size:9px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.spmt-source-notice,.spmt-deferred{border:1px solid var(--border);border-radius:17px;background:rgba(255,255,255,.035);padding:14px 16px;margin-bottom:14px;display:flex;gap:12px;align-items:center}.spmt-source-notice span{color:#b7b9c4;font-size:12px}.spmt-deferred{align-items:flex-start;border-color:rgba(255,200,87,.24)}.spmt-deferred>div{display:grid;min-width:170px}.spmt-deferred>div span,.spmt-account-section header span{font-size:9px;color:var(--accent2);font-weight:900;letter-spacing:.15em}.spmt-deferred p{margin:0;color:#b7b9c4;line-height:1.5;font-size:12px;flex:1}.spmt-deferred small{color:#858795}.spmt-account-section{margin-top:18px}.spmt-account-section h2{margin:4px 0 12px}.spmt-context-grid,.spmt-command-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}.spmt-context-grid article,.spmt-command-grid article{border:1px solid var(--border);border-radius:18px;background:var(--panel);padding:16px}.spmt-context-grid article>span{color:var(--accent2);font-size:9px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.spmt-context-grid p,.spmt-command-grid p{color:#b7b9c4;line-height:1.55;font-size:12px}.spmt-command-grid h3{margin:8px 0}.spmt-command-state{font-size:9px;font-weight:900;letter-spacing:.14em}.spmt-command-state.available{color:#5ee6a8}.spmt-command-state.unavailable{color:#ff9b9b}@media(max-width:900px){.spmt-cosmic-header{left:14px;right:14px}.spmt-brand strong{display:none}.spmt-header-status span{display:none}.spmt-rocket-dock{left:10px;right:10px;top:auto;bottom:max(10px,env(safe-area-inset-bottom));width:auto;height:64px;flex-direction:row;align-items:center}.spmt-dock-orbit,.spmt-rocket-dock footer{display:none}.spmt-rocket-dock nav{width:100%;flex-direction:row;justify-content:space-around}.spmt-rocket-dock nav button{flex-direction:column;gap:2px;padding:5px 7px}.spmt-space-main{padding:calc(var(--spmt-shell-top-inset,88px) + 18px) 14px 92px}.spmt-hero{grid-template-columns:1fr}.spmt-app-grid,.spmt-app-grid.wide{grid-template-columns:repeat(2,minmax(0,1fr))}.spmt-operations-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.spmt-deferred{display:grid}}@media(max-width:560px){.spmt-header-status{display:none}.spmt-hero{padding:22px}.spmt-hero h1{font-size:34px}.spmt-app-grid,.spmt-app-grid.wide,.spmt-quick-grid,.spmt-slot-grid{grid-template-columns:1fr}.spmt-rocket-dock nav label{display:none}.spmt-account-list article{align-items:flex-start}.spmt-account-list article>button{margin-left:auto}}`;
