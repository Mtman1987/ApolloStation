import { SpmtClient } from "@spmt/sdk";
import { SimulationRoomsUi, simulationRoomPath, simulationRoomSlot } from "./simulation-rooms-ui.js";
import { applyShellLayoutMetrics, observeShellLayout } from "@spmt/embed";
import type { MeteredResourceV1, OperationsLogV1, PersonalUsageResourceV1 } from "@spmt/contracts";
import { bindProductRocketNavigation, installProductBackdrop, PRODUCT_UI_CSS, resolveProductBackdrop, resolveProductTheme, type ProductSceneV1 } from "@spmt/ui";
import { DEFERRED_RUNTIME_SOURCES, type SourceStateV1, type SpaceMountainAppCardV1, type SpaceMountainShellSnapshotV1 } from "./index.js";
import { POLISHED_SPACE_MOUNTAIN_CSS } from "./product-shell-css.js";
import { THEMED_SURFACE_CSS } from "./themed-surface-css.js";

const VISUAL_FINISH_CSS = `.spmt-header-action-icon{display:block;width:28px;height:28px;object-fit:contain;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--accent2) 55%,transparent))}.spmt-core-nav-icon{width:30px;height:30px;display:grid;place-items:center;flex:0 0 auto}.spmt-core-nav-icon img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--accent2) 55%,transparent))}.spmt-core-nav-icon .spmt-svg{width:24px;height:24px;color:var(--accent2);filter:drop-shadow(0 0 7px color-mix(in srgb,var(--accent2) 45%,transparent))}.spmt-rocket-dock .spmt-core-nav-icon{width:27px;height:27px}.spmt-header-actions .spmt-core-nav-icon{width:28px;height:28px}.spmt-account-summary{display:flex;align-items:center;gap:8px;padding:0 3px;cursor:pointer;border-radius:12px}.spmt-account-summary:hover,.spmt-account-summary:focus-visible{background:color-mix(in srgb,var(--accent) 12%,transparent);outline:1px solid var(--theme-border)}.spmt-space-root[data-spmt-view="home"] .spmt-hero-logo-large{width:min(820px,100%)!important;height:clamp(180px,48cqh,390px)!important;max-height:66%!important;margin:0!important;object-fit:contain!important;object-position:left center!important;filter:drop-shadow(0 0 26px color-mix(in srgb,var(--accent2) 36%,transparent))}.spmt-theme-native{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important}.spmt-theme-picker{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.spmt-theme-picker button{min-height:104px;display:grid;place-items:center;gap:4px;padding:10px;border:1px solid var(--border);border-radius:16px;background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 10%,#050713),#050713);color:white}.spmt-theme-picker button:hover,.spmt-theme-picker button[aria-pressed="true"]{border-color:var(--accent2);box-shadow:0 0 24px color-mix(in srgb,var(--accent2) 30%,transparent);transform:translateY(-2px)}.spmt-theme-picker img{width:100%;height:58px;object-fit:contain}.spmt-theme-picker span{font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}@media(max-width:1040px){.spmt-account-summary .spmt-account-copy{display:none}}@media(max-width:800px){.spmt-theme-picker{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
const PERSONAL_OVERLAY_CSS = `.spmt-workspace-panel{height:100%;box-sizing:border-box;padding:18px;overflow:auto;background:var(--panel,#080d18);color:var(--spmt-ink,#eff4ff)}.spmt-workspace-panel[hidden]{display:none}.spmt-workspace-panel h2{margin:0}.spmt-workspace-panel p{font-size:12px;color:var(--spmt-muted,#aeb8ce);line-height:1.5}.spmt-workspace-panel details{border:1px solid var(--border,#ffffff25);border-radius:12px;margin-top:10px}.spmt-workspace-panel summary{cursor:pointer;padding:12px;font-weight:800;min-height:20px}.spmt-workspace-panel-body{display:grid;gap:12px;padding:0 12px 12px}.spmt-workspace-panel-actions{display:flex;flex-wrap:wrap;gap:8px;padding:12px}.spmt-workspace-panel button,.spmt-workspace-launcher{border:1px solid var(--border,#ffffff25);border-radius:10px;padding:9px 12px;background:var(--panel,#101828);color:var(--spmt-ink,#eff4ff);cursor:pointer}.spmt-workspace-panel .spmt-overlay-selector{display:grid;gap:7px;white-space:normal}.spmt-workspace-panel select{max-width:none;width:100%;min-height:40px;color-scheme:dark}.spmt-workspace-switch{display:flex;align-items:center;gap:9px}.spmt-workspace-switch input{width:20px;height:20px;accent-color:var(--accent)}.spmt-workspace-switch strong{margin-left:auto;color:var(--accent2)}.spmt-workspace-launcher{display:flex;align-items:center;gap:6px;font-weight:800;min-height:40px}.spmt-workspace-launcher svg{width:18px;height:18px}.spmt-workspace-tray>footer{min-height:56px;flex-wrap:nowrap!important}.spmt-workspace-frames iframe{background:transparent;color-scheme:only light}.spmt-workspace-panel :focus-visible,.spmt-workspace-launcher:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}@media(max-width:620px){.spmt-workspace-tray>footer{gap:4px;padding:6px}.spmt-workspace-tray>footer nav{flex:1;min-width:0;overflow:auto}.spmt-workspace-tray>footer nav button{min-width:42px;padding:5px}.spmt-workspace-tray>footer nav button small{max-width:70px;overflow:hidden;text-overflow:ellipsis}.spmt-workspace-launcher{padding:8px;font-size:11px}.spmt-workspace-controls{gap:2px}.spmt-workspace-controls>button{width:30px;min-width:30px}.spmt-workspace-controls [data-workspace-maximize],.spmt-workspace-controls [data-workspace-close]{display:none}.spmt-workspace-panel{padding:12px}}.spmt-workspace-tray>footer{flex-wrap:wrap}.spmt-workspace-tray .spmt-workspace-surfaces{display:flex!important;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}.spmt-space-root:not([data-workspace-surface="popout"]) .spmt-workspace-tray.maximized .spmt-workspace-frames{bottom:calc(var(--workspace-footer-height,64px) + 24px)!important}.spmt-space-root:not([data-workspace-surface="popout"]) .spmt-workspace-frames{max-height:calc(100dvh - var(--spmt-shell-top-inset,124px) - var(--workspace-footer-height,64px) - 30px)}@media(max-width:900px){.spmt-workspace-tray .spmt-workspace-surfaces{flex:1 1 100%;order:3}.spmt-workspace-surfaces button{min-height:36px;font-size:11px}}.spmt-overlay-selector{display:flex;align-items:center;gap:6px;font-size:11px;white-space:nowrap}.spmt-overlay-selector select{max-width:180px;min-height:32px;background:var(--panel);color:var(--spmt-ink,#fff);border:1px solid var(--border);border-radius:8px}.spmt-device-downloads a{padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:800}[data-workspace-surface="popout"]>.spmt-space-shell{display:none}[data-workspace-surface="popout"] .spmt-workspace-tray{inset:0!important;width:auto!important;border-radius:0;display:flex;flex-direction:column}[data-workspace-surface="popout"] .spmt-workspace-frames{position:relative!important;inset:auto!important;flex:1;min-height:0;height:auto!important}[data-workspace-surface="popout"] .spmt-workspace-tray>footer{flex-wrap:wrap;flex:none}[data-workspace-surface="popout"] [data-workspace-close],[data-workspace-surface="popout"] [data-workspace-minimize]{display:none}[data-workspace-surface="service"] .spmt-shell-header-stack,[data-workspace-surface="service"] .spmt-rocket-dock,[data-workspace-surface="service"] .spmt-workspace-tray{display:none!important}[data-workspace-surface="service"] .spmt-space-main{inset:0!important;padding:12px!important;overflow:auto!important}[data-workspace-surface="service"] .cosmo-page{height:calc(100dvh - 24px)!important;min-height:0!important}[data-workspace-surface="service"]:not([data-workspace-tool="settings"]) [data-workspace-settings]{display:none}[data-workspace-surface="service"][data-workspace-tool="settings"] [data-overlay-bay]{display:none!important}[data-workspace-surface="service"] .spmt-page-title{display:none}[data-workspace-service-panel]{height:100%}[data-workspace-service-panel] iframe{width:100%;height:100%;border:0}.spmt-shell-personal-overlay{position:fixed;inset:0;width:100%;height:100%;border:0;z-index:850;clip-path:inset(0 0 var(--workspace-overlay-bottom,0px) 0);pointer-events:none;background:transparent;color-scheme:only light}.spmt-shell-personal-overlay[hidden]{display:none}.spmt-workspace-surfaces button.active{color:#bbf7d0;border-color:color-mix(in srgb,#22c55e 55%,transparent)}.spmt-simulation-rooms{height:100%;overflow:auto;padding:14px;background:rgba(4,6,14,.96)}.spmt-simulation-rooms>header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--border);border-radius:14px;background:rgba(8,10,20,.96)}.spmt-simulation-rooms h2,.spmt-simulation-rooms p{margin:0}.spmt-simulation-rooms p{color:#a8aab7;font-size:11px}.spmt-simulation-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:9px;margin-top:10px}.spmt-simulation-event{display:grid;gap:6px;padding:11px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.035)}.spmt-simulation-event>span{color:var(--accent2);font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.spmt-simulation-event small{color:#858795}.spmt-simulation-empty{padding:24px;border:1px dashed var(--border);border-radius:14px;color:#858795;text-align:center}`;

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
  onSendCommlinkMessage?: (conversation: Record<string, unknown>, text: string) => void | Promise<void>;
  onComposeCommlinkMail?: (recipientUserIds: string[], subject: string, text: string) => void | Promise<void>;
  onMarkAllCommlinkRead?: () => void;
  onInvokeStella?: (message: string, conversationId: string, routingPreference: "automatic" | "hosted" | "companion", remember: boolean) => void;
  onExportStellarData?: () => void;
  onDeleteStellarData?: () => void;
  onMarkNotificationRead?: (notification: Record<string, unknown>) => void;
  onUnlinkProvider?: (link: Record<string, unknown>) => void;
  onSaveWorkspace?: (expectedRevision: number, patch: Record<string, unknown>) => void | Promise<boolean>;
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
// Runtime registrations remain intact; only user-facing products belong in Shipyard.
const SHARED_SERVICES = new Set(["commlink", "chat-gateway", "overlay-bay", "mission-control", "companion", "mountainview", "spacemountain", "spacemountain-web", "spmt-service", "reference-app"]);
export function isListedApplication(app: { appId: string }) { return !SHARED_SERVICES.has(app.appId); }
const SHELL_APP_RENDERERS = new Set(["commlink", "stellar-core", "mission-control"]);
interface AppDockItemV1 { label: string; description: string; icon: IconName; target: string; }
const APP_DOCK_NAVIGATION: Readonly<Record<string, readonly AppDockItemV1[]>> = {
  commlink: [
    { label: "Spaces", description: "Open chat spaces, desks, and shadow rooms.", icon: "mail", target: "[data-commlink-toggle-views]" },
    { label: "Feed", description: "The active canonical message and event feed.", icon: "pulse", target: ".cosmo-feed" },
    { label: "Compose", description: "Write new private account mail or reply to a conversation.", icon: "arrow", target: "[data-commlink-new-mail]" },
  ],
  "stellar-core": [
    { label: "Stella", description: "Talk with the ecosystem assistant.", icon: "spark", target: "[data-stella-form]" },
    { label: "Models", description: "Owner-visible inference platform and model controls.", icon: "grid", target: ".spmt-command-grid" },
    { label: "Mission Control", description: "Operations and Coder.", icon: "pulse", target: "[data-mission-control]" },
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
  private footerResizeObserver: ResizeObserver | undefined;
  private personalOverlay: HTMLIFrameElement | undefined;
  private personalOverlayVisible = true;
  private workspaceService: "commlink" | "overlay-bay" | "settings" | undefined;
  private readonly workspacePopout = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("surface") === "workspace-popout";
  private readonly serviceEmbed = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("surface") === "workspace-service";
  private overlaySaving = false;
  private workspaceOpen = false;
  private workspaceExpanded = false;
  private workspaceControlsOpen = false;
  private workspaceMaximized = false;
  private workspaceClickThrough = false;
  private workspaceOpacity = 92;
  private workspaceTarget = 0;
  private simulationRoomsOpen = false;
  private simulationRoomsUi: SimulationRoomsUi | undefined;
  private dockCollapsed = false;
  private commlinkDraft: CommlinkWorkspaceUiV1 | undefined;
  private commlinkConversationId = "";
  private commlinkSidebarOpen = false;
  private commlinkRoomTimer: number | undefined;
  private commlinkRoomsLoading = false;
  private commlinkSending = false;
  private commlinkMailSending = false;
  private commlinkSendStatus = "";
  private commlinkMailStatus = "";
  private commlinkLocal = new Map<string, { values: Array<{ name: string; value: string; selected?: string[] }>; scrollTop: number; open?: boolean }>();

  constructor(private readonly options: SpaceMountainUiOptions) {
    this.snapshot = options.snapshot;
    if (typeof window !== "undefined") {
      const requested = new URLSearchParams(window.location.search).get("view");
      if (requested === "account" || NAV.some((item) => item.id === requested)) this.view = requested as SpaceMountainViewV1;
      if (new URLSearchParams(window.location.search).get("surface") === "simulation") { this.workspaceOpen = true; this.workspaceExpanded = true; this.simulationRoomsOpen = true; }
      const requestedAppRaw = new URLSearchParams(window.location.search).get("app");
      const requestedApp = requestedAppRaw === "mission-control" ? "stellar-core" : requestedAppRaw;
      if (requestedApp && this.shellApp(requestedApp)) this.activeAppId = requestedApp;
      const matchedApp = window.location.pathname.match(/^\/apps\/([^/]+)$/)?.[1];
      if (!this.activeAppId && matchedApp && SHELL_APP_RENDERERS.has(decodeURIComponent(matchedApp))) this.activeAppId = decodeURIComponent(matchedApp);
      if (this.activeAppId === "mission-control") this.activeAppId = "stellar-core";
      if (this.workspacePopout) {
        const query = new URLSearchParams(window.location.search);
        this.workspaceOpen = true; this.workspaceExpanded = true; this.workspaceMaximized = true;
        this.workspaceTarget = Math.max(0, Math.min(2, Number(query.get("slot")) || 0));
        const service = query.get("tool");
        if (service === "commlink" || service === "overlay-bay" || service === "settings") this.workspaceService = service;
        if (service === "simulation") this.simulationRoomsOpen = true;
        this.workspaceControlsOpen = !service || service === "workspace";
      }
    }
  }

  mount() { this.commlinkRoomTimer = window.setInterval(() => void this.refreshCommlinkRooms(), 3000); this.options.root.classList.add("spmt-space-root", "spmt-product-surface"); this.render(); if (this.simulationRoomsOpen) this.openSimulationRooms(new URLSearchParams(window.location.search).get("roomId") ?? undefined); return this; }
  openSimulationRooms(roomId?: string) {
    if (this.serviceEmbed && window.parent !== window) {
      window.parent.postMessage({protocol:"spmt.surface",version:1,type:"simulation.open",appId:"commlink",...(roomId ? {roomId} : {})},window.location.origin);
      return;
    }
    this.workspaceControlsOpen = false;
    this.workspaceService = undefined;
    const pinned = workspaceDockSlots(this.snapshot.workspace).findIndex((slot) => {
      const target = simulationRoomSlot(slot); return target !== undefined && (roomId ? target.roomId === roomId : !target.roomId);
    });
    this.workspaceOpen = true; this.workspaceExpanded = true; this.workspaceClickThrough = false;
    if (pinned >= 0) { this.workspaceTarget = pinned; this.simulationRoomsOpen = false; }
    else { this.simulationRoomsOpen = true; this.ensureSimulationRooms().open(roomId); }
    this.syncWorkspaceTray();
  }
  update(snapshot: SpaceMountainShellSnapshotV1) { if (snapshot.tenantId !== this.snapshot.tenantId) { this.commlinkLocal.clear(); this.commlinkConversationId = ""; this.simulationRoomsUi?.destroy(); this.simulationRoomsUi = undefined; } this.snapshot = snapshot; this.commlinkDraft = undefined; if (this.activeAppId && !this.shellApp(this.activeAppId)) this.activeAppId = undefined; this.render(); }
  updateWorkspace(workspace: Record<string, unknown>, tenantOutputs: SpaceMountainShellSnapshotV1["tenantOutputs"]) {
    this.snapshot = { ...this.snapshot, workspace, ...(tenantOutputs ? { tenantOutputs } : {}) };
    this.personalOverlayVisible = recordBoolean(workspace, "personalOverlayEnabled", true);
    this.syncPersonalOverlay(); this.syncWorkspaceTray();
  }
  updatePersonalUsage(usage: SpaceMountainShellSnapshotV1["usage"]) { this.snapshot = { ...this.snapshot, ...(usage ? { usage } : {}) }; if (!this.activeAppId && this.view === "account") this.render(); }
  destroy() { window.clearInterval(this.commlinkRoomTimer); this.commlinkRoomTimer = undefined; this.footerResizeObserver?.disconnect(); this.simulationRoomsUi?.destroy(); this.simulationRoomsUi = undefined; this.stopLayout?.(); this.stopLayout = undefined; if (this.clockTimer !== undefined) window.clearInterval(this.clockTimer); this.clockTimer = undefined; this.options.root.replaceChildren(); this.workspaceTray = undefined; this.personalOverlay = undefined; }

  private async refreshCommlinkRooms() {
    if (this.commlinkRoomsLoading || document.hidden || !this.options.root.querySelector(".cosmo-page")) return;
    this.commlinkRoomsLoading = true;
    const tenantId = this.snapshot.tenantId, userId = this.snapshot.userId;
    try {
      const client = new SpmtClient({baseUrl:window.location.origin,appId:"spacemountain"});
      const [simulationRooms, simulationMessages] = await Promise.all([client.listSimulationRooms(tenantId,200),client.listSimulationRoomEvents(tenantId,{lane:"chat",limit:200})]);
      if (this.commlinkRoomTimer === undefined || tenantId !== this.snapshot.tenantId || userId !== this.snapshot.userId) return;
      if (JSON.stringify([simulationRooms,simulationMessages]) === JSON.stringify([this.snapshot.simulationRooms,this.snapshot.simulationMessages])) return;
      this.snapshot = {...this.snapshot,simulationRooms,simulationMessages};
      this.render();
    } catch { /* Keep the last readable history and the user's draft during a brief disconnect. */ }
    finally { this.commlinkRoomsLoading = false; }
  }

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
    if (app.appId === "mission-control") { const stellar = this.shellApp("stellar-core"); if (stellar) { this.openApp(stellar); const panel = this.options.root.querySelector<HTMLDetailsElement>("[data-mission-control]"); if (panel) panel.open = true; } return; }
    if (app.appId === "commlink" && !this.serviceEmbed) { this.openWorkspaceService("commlink"); return; }
    if (app.appId === "companion" || app.appId === "mountainview") { window.location.assign(`/downloads/${app.appId}`); return; }
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
    const focused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : undefined;
    const focusKey = focused?.closest<HTMLElement>("[data-commlink-local]")?.dataset.commlinkLocal;
    const focusState = focusKey && root.contains(focused!) ? {key:focusKey,name:focused!.name,start:focused!.selectionStart,end:focused!.selectionEnd} : undefined;
    root.dataset.workspaceTool = new URLSearchParams(window.location.search).get("tool") ?? "";
    root.dataset.workspaceSurface = this.workspacePopout ? "popout" : this.serviceEmbed ? "service" : "shell";
    this.personalOverlayVisible = recordBoolean(this.snapshot.workspace, "personalOverlayEnabled", true);
    this.captureCommlink();
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
    // Keep persistent embeds attached while replacing only the app shell. Removing
    // and re-appending an iframe unloads its document even when its node is reused.
    let style = root.querySelector<HTMLStyleElement>(":scope > style[data-spmt-space-style]");
    if (!style) { style = document.createElement("style"); style.dataset.spmtSpaceStyle = ""; root.prepend(style); }
    style.textContent = `${PRODUCT_UI_CSS}${SPACE_MOUNTAIN_CSS}${POLISHED_SPACE_MOUNTAIN_CSS}${WORKSPACE_SETTINGS_CSS}${VISUAL_FINISH_CSS}${PERSONAL_OVERLAY_CSS}${COMMLINK_FORM_CSS}${COMMLINK_MAIL_CSS}${THEMED_SURFACE_CSS}${COMMLINK_LAYOUT_CSS}`;
    let shell = root.querySelector<HTMLDivElement>(":scope > .spmt-space-shell");
    if (!shell) { shell = document.createElement("div"); shell.className = "spmt-space-shell"; root.append(shell); }
    shell.innerHTML = `${this.header()}${this.dock()}<main class="spmt-space-main">${this.body()}</main>`;
    this.restoreCommlink();
    if (focusState) {
      const input = root.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[data-commlink-local="${CSS.escape(focusState.key)}"] [name="${CSS.escape(focusState.name)}"]`);
      input?.focus({preventScroll:true});
      if (input && focusState.start !== null && focusState.end !== null) input.setSelectionRange(focusState.start,focusState.end);
    }
    if (new URLSearchParams(window.location.search).get("panel") === "mission-control") { const panel = root.querySelector<HTMLDetailsElement>("[data-mission-control]"); if (panel) panel.open = true; }
    if (!this.personalOverlay) { this.personalOverlay = this.createPersonalOverlay(); root.append(this.personalOverlay); }
    if (!this.workspaceTray) { this.workspaceTray = this.createWorkspaceTray(); root.append(this.workspaceTray); }
    this.syncPersonalOverlay();
    this.syncWorkspaceTray();
    installProductBackdrop(root, backdrop);
    bindProductRocketNavigation(root, NAV, this.view, (view) => this.navigate(view));
    root.querySelectorAll<HTMLElement>("[data-nav]").forEach((node) => node.addEventListener("click", () => this.navigate(node.dataset.nav as SpaceMountainViewV1)));
    root.querySelector<HTMLElement>(".spmt-account-summary")?.addEventListener("click", () => this.navigate("account"));
    root.querySelectorAll<HTMLElement>("[data-launch-app]").forEach((node) => node.addEventListener("click", () => { const app = this.snapshot.apps.find((item) => item.appId === node.dataset.launchApp); if (app) this.openApp(app); }));
    root.querySelectorAll<HTMLElement>("[data-app-dock-target]").forEach((node) => node.addEventListener("click", () => this.openAppDockTarget(node.dataset.appDockTarget ?? "")));
    root.querySelectorAll<HTMLElement>("[data-install-app]").forEach((node) => node.addEventListener("click", () => { const app = this.snapshot.apps.find((item) => item.appId === node.dataset.installApp); if (app) this.options.onInstallApp?.(app); }));
    root.querySelectorAll<HTMLElement>("[data-commlink-space]").forEach((node) => node.addEventListener("click", () => { this.commlinkConversationId = ""; this.commlinkSidebarOpen = false; this.updateCommlink({ activeChatSpaceId: node.dataset.commlinkSpace ?? "", view: "focus" }); }));
    root.querySelectorAll<HTMLElement>("[data-commlink-desk]").forEach((node) => node.addEventListener("click", () => { this.commlinkSidebarOpen = false; this.updateCommlink({ activeDeskId: node.dataset.commlinkDesk ?? "", view: "desk" }); }));
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
    root.querySelector<HTMLElement>("[data-commlink-popout]")?.addEventListener("click", () => window.open(`/?surface=workspace-popout&tool=commlink`, "spmt-commlink", "popup,width=1440,height=920"));
    root.querySelectorAll<HTMLButtonElement>("[data-commlink-new-mail]").forEach((node) => node.addEventListener("click", () => root.querySelector<HTMLDialogElement>("[data-commlink-mail-dialog]")?.showModal()));
    root.querySelector<HTMLButtonElement>("[data-commlink-mail-cancel]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("[data-commlink-mail-dialog]")?.close());
    root.querySelector<HTMLButtonElement>("[data-commlink-read-all]")?.addEventListener("click", () => this.options.onMarkAllCommlinkRead?.());
    root.querySelectorAll<HTMLButtonElement>("[data-commlink-toggle-views], [data-commlink-sidebar-dismiss]").forEach((node) => node.addEventListener("click", () => { this.commlinkSidebarOpen = !this.commlinkSidebarOpen; this.render(); }));
    root.querySelectorAll<HTMLButtonElement>("[data-commlink-room]").forEach(node => node.addEventListener("click", () => { this.commlinkConversationId = `shadow:${node.dataset.commlinkRoom}`; this.commlinkSidebarOpen = false; this.updateCommlink({view:"focus", filter:"all"}); }));
    root.querySelectorAll<HTMLButtonElement>("[data-commlink-open-room]").forEach(node => node.addEventListener("click", () => this.openSimulationRooms(node.dataset.commlinkOpenRoom || undefined)));
    root.querySelector<HTMLSelectElement>("[data-commlink-destination]")?.addEventListener("change", (event) => {
      this.commlinkConversationId = (event.currentTarget as HTMLSelectElement).value;
      this.commlinkSendStatus = "";
      this.render();
    });
    root.querySelector<HTMLFormElement>("[data-commlink-mail-form]")?.addEventListener("submit", (event) => { event.preventDefault(); void this.submitCommlink(true); });
    root.querySelector<HTMLFormElement>("[data-commlink-compose]")?.addEventListener("submit", (event) => { event.preventDefault(); void this.submitCommlink(false); });
    root.querySelectorAll<HTMLElement>("[data-open-conversation]").forEach((node) => node.addEventListener("click", () => { const item = this.snapshot.conversations.find((conversation) => conversation.id === node.dataset.openConversation); if (item) this.options.onOpenConversation?.(item); }));
    root.querySelector<HTMLFormElement>("[data-commlink-search]")?.addEventListener("submit", (event) => { event.preventDefault(); const query = String(new FormData(event.currentTarget as HTMLFormElement).get("query") ?? "").trim(); if (query) this.options.onSearchCommlink?.(query); });
    root.querySelector<HTMLFormElement>("[data-stella-form]")?.addEventListener("submit", (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const values = new FormData(form); const message = String(values.get("message") ?? "").trim(); const rawRoute = String(values.get("routingPreference") ?? "automatic"); const route = rawRoute === "companion" || rawRoute === "hosted" ? rawRoute : "automatic"; const remember = values.get("remember") === "on"; if (message) { this.options.onInvokeStella?.(message, `stella-${this.snapshot.userId}`, route, remember); form.reset(); } });
    root.querySelector<HTMLElement>("[data-stellar-export]")?.addEventListener("click", () => this.options.onExportStellarData?.());
    root.querySelector<HTMLElement>("[data-stellar-delete]")?.addEventListener("click", () => this.options.onDeleteStellarData?.());
    root.querySelectorAll<HTMLElement>("[data-notification-read]").forEach((node) => node.addEventListener("click", () => { const item = this.snapshot.notifications.find((notification) => notification.id === node.dataset.notificationRead); if (item) this.options.onMarkNotificationRead?.(item); }));
    root.querySelectorAll<HTMLElement>("[data-provider-unlink]").forEach((node) => node.addEventListener("click", () => { const item = this.snapshot.providerLinks.find((link) => providerLinkKey(link) === node.dataset.providerUnlink); if (item) this.options.onUnlinkProvider?.(item); }));
    root.querySelectorAll<HTMLElement>("[data-provider-link]").forEach((node) => node.addEventListener("click", () => {
      const provider = node.dataset.providerLink;
      if (provider !== "twitch" && provider !== "discord" && provider !== "youtube") return;
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
    root.querySelector<HTMLElement>("[data-open-workspace-rooms]")?.addEventListener("click", () => this.openSimulationRooms());
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
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    return frame;
  }

  private syncPersonalOverlay() {
    const frame = this.personalOverlay;
    if (!frame) return;
    const rawUrl = this.snapshot.tenantOutputs?.personal.url ?? "";
    const url = rawUrl && !this.serviceEmbed ? new URL(new URL(rawUrl, window.location.origin).pathname, window.location.origin).toString() : "";
    const sceneId = String(this.snapshot.workspace?.activePersonalOverlaySceneId ?? this.snapshot.tenantOutputs?.personal.sceneId ?? "");
    if (url && frame.dataset.sceneRevision !== String(this.snapshot.workspace?.revision ?? "")) {
      frame.src = url; frame.dataset.sceneRevision = String(this.snapshot.workspace?.revision ?? "");
    }
    if (url && frame.src !== url) frame.src = url;
    if (!url && frame.getAttribute("src")) frame.removeAttribute("src");
    frame.hidden = this.serviceEmbed || !this.personalOverlayVisible || !url || !sceneId;
    const footer = this.workspaceOpen ? this.workspaceTray?.querySelector("footer")?.getBoundingClientRect() : undefined;
    this.workspaceTray?.style.setProperty("--workspace-footer-height", `${footer?.height ?? 64}px`);
    frame.style.setProperty("--workspace-overlay-bottom", footer?.height ? `${Math.max(0, window.innerHeight - footer.top)}px` : "0px");
    const select = this.workspaceTray?.querySelector<HTMLSelectElement>("[data-personal-overlay-scene]");
    if (select) {
      const scenes = Array.isArray(this.snapshot.workspace?.overlayScenes) ? this.snapshot.workspace.overlayScenes : [];
      select.innerHTML = scenes.map((scene: Record<string, unknown>) => selectOption(String(scene.id), sceneId, String(scene.name ?? "Overlay group"))).join("") || `<option value="">No saved overlay groups</option>`;
      select.disabled = this.overlaySaving || !scenes.length || !this.options.onSaveWorkspace || !sessionHasScope(this.snapshot.session, "workspace:write");
    }
    const toggle = this.workspaceTray?.querySelector<HTMLInputElement>("[data-personal-overlay-toggle]");
    if (toggle) { toggle.checked = this.personalOverlayVisible; toggle.disabled = this.overlaySaving || !this.options.onSaveWorkspace || !sessionHasScope(this.snapshot.session, "workspace:write"); }
    const state = this.workspaceTray?.querySelector<HTMLElement>("[data-personal-overlay-state]");
    if (state) state.textContent = this.personalOverlayVisible ? "On" : "Off";
  }

  private async savePersonalOverlay(patch: Record<string, unknown>) {
    if (this.overlaySaving || !this.options.onSaveWorkspace || !sessionHasScope(this.snapshot.session, "workspace:write")) return;
    this.overlaySaving = true; this.syncPersonalOverlay();
    try {
      await this.options.onSaveWorkspace(Number(this.snapshot.workspace?.revision), patch);
    } finally { this.overlaySaving = false; this.syncPersonalOverlay(); }
  }

  private openWorkspaceService(service: "commlink" | "overlay-bay" | "settings") {
    this.workspaceControlsOpen = false;
    this.workspaceService = service; this.simulationRoomsOpen = false; this.workspaceOpen = true; this.workspaceExpanded = true; this.workspaceClickThrough = false; this.syncWorkspaceTray();
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
    tray.innerHTML = `<div class="spmt-workspace-frames" aria-live="polite">${[0, 1, 2].map((index) => `<div data-workspace-frame="${index}"><iframe title="Workspace slot ${index + 1}" allow="autoplay; microphone; camera; fullscreen; clipboard-write"></iframe><p>This workspace slot is empty. Assign an installed app in Workspace.</p></div>`).join("")}${["commlink", "overlay-bay", "settings"].map((tool) => `<div data-workspace-service-panel="${tool}" hidden><iframe title="${tool === "commlink" ? "Commlink" : tool === "overlay-bay" ? "Overlay Bay" : "Workspace settings"}" allow="autoplay; microphone; camera; fullscreen; clipboard-write"></iframe></div>`).join("")}<section class="spmt-simulation-rooms" data-simulation-rooms hidden></section><section class="spmt-workspace-panel" id="spmt-workspace-panel" data-workspace-panel hidden><header><h2>Workspace</h2><p>Choose what appears across your apps and companions.</p></header><details open><summary>Personal overlays</summary><div class="spmt-workspace-panel-body"><label class="spmt-overlay-selector">Overlay group<select data-personal-overlay-scene aria-label="Personal overlay group"></select></label><label class="spmt-workspace-switch"><input type="checkbox" role="switch" data-personal-overlay-toggle checked>Show selected overlay <strong data-personal-overlay-state>On</strong></label><p>Your saved group and visibility follow this workspace into apps, pop-outs, and companions.</p><details><summary>Overlay links</summary><div class="spmt-workspace-panel-actions"><button type="button" data-copy-tenant-output="public">Copy Public URL</button><button type="button" data-copy-tenant-output="personal">Copy Personal URL</button></div></details></div></details><details open><summary>Shared tools</summary><div class="spmt-workspace-panel-actions"><button type="button" data-workspace-tool="commlink">Commlink</button><button type="button" data-workspace-tool="overlay-bay">Overlay Bay</button><button type="button" data-simulation-rooms-toggle>Simulation Rooms</button><button type="button" data-workspace-tool="settings">Settings</button></div></details><details><summary>Window appearance</summary><div class="spmt-workspace-panel-body"><button type="button" data-workspace-clickthrough aria-pressed="false">Click-through</button><label>Opacity<input type="range" min="35" max="100" value="92" data-workspace-opacity><output>92%</output></label></div></details></section></div><footer><button type="button" class="spmt-workspace-launcher" data-workspace-panel-toggle aria-expanded="false" aria-controls="spmt-workspace-panel">${icon("layout")}<span>Workspace</span><span aria-hidden="true">⌃</span></button><nav aria-label="Persistent app slots">${[0, 1, 2].map((index) => `<button type="button" data-workspace-slot="${index}"><span>Slot ${index + 1}</span><small>Empty</small></button>`).join("")}</nav><div class="spmt-workspace-controls"><button type="button" data-workspace-minimize aria-label="Minimize workspace frame" title="Minimize">−</button><button type="button" data-workspace-maximize aria-label="Maximize workspace frame" title="Maximize">□</button><button type="button" data-workspace-popout aria-label="Pop out workspace with overlays" title="Pop out">↗</button><button type="button" data-workspace-close aria-label="Close workspace footer" title="Close">×</button></div></footer>`;
    tray.querySelectorAll<HTMLElement>("[data-workspace-slot]").forEach((node) => node.addEventListener("click", () => { this.workspaceControlsOpen = false; this.workspaceService = undefined; this.workspaceTarget = Number(node.dataset.workspaceSlot); if (simulationRoomSlot(workspaceDockSlots(this.snapshot.workspace)[this.workspaceTarget])) this.workspaceClickThrough = false; this.simulationRoomsOpen = false; this.workspaceOpen = true; this.workspaceExpanded = true; this.syncWorkspaceTray(); }));
    tray.querySelector<HTMLElement>("[data-simulation-rooms-toggle]")?.addEventListener("click", () => this.openSimulationRooms());
    tray.querySelectorAll<HTMLElement>("[data-workspace-surface]").forEach((node) => node.addEventListener("click", () => { this.workspaceExpanded = false; this.navigate(node.dataset.workspaceSurface as SpaceMountainViewV1); }));
    tray.querySelectorAll<HTMLElement>("[data-workspace-tool]").forEach((node) => node.addEventListener("click", () => this.openWorkspaceService(node.dataset.workspaceTool as "commlink" | "overlay-bay" | "settings")));
    tray.querySelector<HTMLSelectElement>("[data-personal-overlay-scene]")?.addEventListener("change", (event) => void this.savePersonalOverlay({ activePersonalOverlaySceneId: (event.currentTarget as HTMLSelectElement).value }));
    tray.querySelector<HTMLInputElement>("[data-personal-overlay-toggle]")?.addEventListener("change", (event) => void this.savePersonalOverlay({ personalOverlayEnabled: (event.currentTarget as HTMLInputElement).checked }));
    tray.querySelectorAll<HTMLElement>("[data-copy-tenant-output]").forEach((node) => node.addEventListener("click", () => this.copyTenantOutput(node.dataset.copyTenantOutput === "personal" ? "personal" : "public")));
    tray.querySelector<HTMLElement>("[data-workspace-panel-toggle]")?.addEventListener("click", () => {
      if (this.workspaceControlsOpen && this.workspaceExpanded) this.workspaceExpanded = false;
      else { this.workspaceControlsOpen = true; this.workspaceExpanded = true; this.workspaceClickThrough = false; }
      this.syncWorkspaceTray();
    });
    tray.querySelector<HTMLElement>("[data-workspace-minimize]")?.addEventListener("click", () => { this.workspaceExpanded = false; this.workspaceMaximized = false; this.syncWorkspaceTray(); });
    tray.querySelector<HTMLElement>("[data-workspace-maximize]")?.addEventListener("click", () => { this.workspaceExpanded = true; this.workspaceMaximized = !this.workspaceMaximized; this.syncWorkspaceTray(); });
    tray.querySelector<HTMLElement>("[data-workspace-popout]")?.addEventListener("click", () => {
      const query = new URLSearchParams({ surface: "workspace-popout", slot: String(this.workspaceTarget) });
      if (this.workspaceControlsOpen) query.set("tool", "workspace");
      else if (this.simulationRoomsOpen) query.set("tool", "simulation");
      else if (this.workspaceService) query.set("tool", this.workspaceService);
      window.open(`/?${query}`, "spmt-workspace", "popup,width=1440,height=920");
    });
    tray.querySelector<HTMLElement>("[data-workspace-clickthrough]")?.addEventListener("click", () => { this.workspaceClickThrough = !this.workspaceClickThrough; this.syncWorkspaceTray(); });
    tray.querySelector<HTMLInputElement>("[data-workspace-opacity]")?.addEventListener("input", (event) => { this.workspaceOpacity = Number((event.currentTarget as HTMLInputElement).value); this.syncWorkspaceTray(); });
    tray.querySelector<HTMLElement>("[data-workspace-close]")?.addEventListener("click", () => { this.workspaceOpen = false; this.workspaceExpanded = false; this.workspaceMaximized = false; this.syncWorkspaceTray(); });
    tray.querySelectorAll<HTMLIFrameElement>("[data-workspace-frame] iframe").forEach((frame) => frame.addEventListener("load", () => this.syncWorkspaceRoomVisibility(frame)));
    if (typeof ResizeObserver !== "undefined") { this.footerResizeObserver = new ResizeObserver(() => this.syncPersonalOverlay()); this.footerResizeObserver.observe(tray.querySelector("footer")!); }
    return tray;
  }

  private toggleWorkspaceTray() { this.workspaceOpen = !this.workspaceOpen; if (!this.workspaceOpen) { this.workspaceExpanded = false; this.workspaceMaximized = false; } this.syncWorkspaceTray(); }

  private syncWorkspaceTray() {
    const tray = this.workspaceTray;
    if (!tray) return;
    tray.classList.toggle("open", this.workspaceOpen);
    tray.classList.toggle("expanded", this.workspaceExpanded);
    tray.classList.toggle("maximized", this.workspaceMaximized);
    tray.classList.toggle("click-through", this.workspaceClickThrough && !this.workspaceControlsOpen);
    tray.hidden = this.serviceEmbed || !this.workspaceOpen;
    // Shared service documents must never mount another copy of the dock.
    if (this.serviceEmbed) return;
    tray.style.setProperty("--workspace-opacity", String(this.workspaceOpacity / 100));
    const opacity = tray.querySelector<HTMLInputElement>("[data-workspace-opacity]");
    if (opacity && Number(opacity.value) !== this.workspaceOpacity) opacity.value = String(this.workspaceOpacity);
    const opacityOutput = opacity?.parentElement?.querySelector<HTMLOutputElement>("output");
    if (opacityOutput) opacityOutput.value = `${this.workspaceOpacity}%`;
    tray.querySelector<HTMLElement>("[data-workspace-clickthrough]")?.classList.toggle("active", this.workspaceClickThrough);
    tray.querySelector<HTMLElement>("[data-workspace-maximize]")?.classList.toggle("active", this.workspaceMaximized);
    tray.querySelector<HTMLElement>("[data-simulation-rooms-toggle]")?.classList.toggle("active", this.simulationRoomsOpen);
    const controlsPanel = tray.querySelector<HTMLElement>("[data-workspace-panel]");
    if (controlsPanel) controlsPanel.hidden = !this.workspaceExpanded || !this.workspaceControlsOpen;
    tray.querySelector("[data-workspace-panel-toggle]")?.setAttribute("aria-expanded", String(this.workspaceExpanded && this.workspaceControlsOpen));
    tray.querySelector("[data-workspace-clickthrough]")?.setAttribute("aria-pressed", String(this.workspaceClickThrough));
    const simulationPanel=tray.querySelector<HTMLElement>("[data-simulation-rooms]");
    if(simulationPanel) simulationPanel.hidden=!this.workspaceExpanded||!this.simulationRoomsOpen||this.workspaceControlsOpen;
    this.ensureSimulationRooms().setVisible(this.workspaceOpen && this.workspaceExpanded && this.simulationRoomsOpen && !this.workspaceControlsOpen);
    tray.querySelectorAll<HTMLElement>("[data-workspace-service-panel]").forEach((panel) => {
      const tool = panel.dataset.workspaceServicePanel;
      const frame = panel.querySelector<HTMLIFrameElement>("iframe");
      panel.hidden = this.workspaceControlsOpen || this.workspaceService !== tool || !this.workspaceExpanded || this.simulationRoomsOpen;
      const path = tool === "commlink" ? "/apps/commlink?surface=workspace-service" : `/?view=workspace&surface=workspace-service${tool === "settings" ? "&tool=settings" : ""}`;
      if (frame && this.workspaceService === tool && frame.getAttribute("src") !== path) frame.src = path;
    });
    tray.querySelectorAll<HTMLElement>("[data-workspace-tool]").forEach((button) => button.classList.toggle("active", button.dataset.workspaceTool === this.workspaceService && !this.simulationRoomsOpen));
    const slots = workspaceDockSlots(this.snapshot.workspace);
    slots.forEach((appId, index) => {
      const roomSlot = simulationRoomSlot(appId);
      const app = this.snapshot.apps.find((item) => item.appId === appId && item.installed && item.enabled);
      const button = tray.querySelector<HTMLElement>(`[data-workspace-slot="${index}"]`);
      if (button) { button.innerHTML = `<span>Slot ${index + 1}</span><small>${escapeHtml(roomSlot ? (roomSlot.roomId ? "Simulation room" : "Simulation Rooms") : appId === "overlay-bay" ? "Overlay Bay" : app?.name ?? "Empty")}</small>`; button.classList.toggle("active", index === this.workspaceTarget); }
      const panel = tray.querySelector<HTMLElement>(`[data-workspace-frame="${index}"]`);
      const frame = panel?.querySelector<HTMLIFrameElement>("iframe");
      if (!panel || !frame) return;
      panel.hidden = this.workspaceControlsOpen || !this.workspaceExpanded || this.simulationRoomsOpen || Boolean(this.workspaceService) || index !== this.workspaceTarget;
      const nextUrl = roomSlot ? simulationRoomPath(roomSlot.roomId) : appId === "overlay-bay" ? "/?view=workspace&surface=workspace-service" : appId === "commlink" ? "/apps/commlink?surface=workspace-service" : app && isListedApplication(app) ? SHELL_APP_RENDERERS.has(app.appId) ? `/apps/${encodeURIComponent(app.appId)}?surface=workspace-service` : this.shellLaunchUrl(app) : "";
      if (nextUrl && frame.dataset.appId !== appId) { frame.src = nextUrl; frame.dataset.appId = appId ?? ""; frame.title = roomSlot ? "Simulation room" : app?.name ?? "Workspace app"; }
      if (!nextUrl && frame.dataset.appId) { frame.removeAttribute("src"); delete frame.dataset.appId; }
      frame.hidden = !nextUrl;
      this.syncWorkspaceRoomVisibility(frame);
      const emptyState = panel.querySelector<HTMLElement>("p");
      if (emptyState) emptyState.hidden = Boolean(nextUrl);
    });
    this.syncPersonalOverlay();
  }

  private syncWorkspaceRoomVisibility(frame: HTMLIFrameElement) {
    if (!simulationRoomSlot(frame.dataset.appId)) return;
    const visible = this.workspaceOpen && this.workspaceExpanded && !this.simulationRoomsOpen && !this.workspaceControlsOpen && !frame.parentElement?.hidden;
    frame.contentWindow?.postMessage({ protocol: "spmt.workspace", version: 1, type: "simulation.visibility", visible }, window.location.origin);
  }

  private ensureSimulationRooms() {
    if (!this.simulationRoomsUi) {
      const panel = this.workspaceTray!.querySelector<HTMLElement>("[data-simulation-rooms]")!;
      const scopes = recordStrings(this.snapshot.session, "scopes");
      this.simulationRoomsUi = new SimulationRoomsUi(panel, new SpmtClient({ baseUrl: window.location.origin, appId: "spacemountain" }), this.snapshot.tenantId, {
        canDelete: scopes.includes("workspace:write") || scopes.includes("workspace:*") || scopes.includes("*"),
        ...(this.options.onSaveWorkspace ? { onPin: async (roomId: string, slot: number) => {
          const client = new SpmtClient({ baseUrl: window.location.origin, appId: "spacemountain" });
          const workspace = await client.getWorkspaceProfile(this.snapshot.tenantId);
          const slots = workspaceDockSlots(workspace); slots[slot] = simulationRoomPath(roomId);
          const saved = await this.options.onSaveWorkspace!(Number(workspace.revision), { dockSlots: slots });
          if (saved === false) throw new Error("The room could not be saved to Workspace. Try again.");
          this.workspaceTarget = slot; this.workspaceOpen = true; this.workspaceExpanded = true; this.workspaceClickThrough = false; this.simulationRoomsOpen = false;
          this.syncWorkspaceTray();
        } } : {}),
      });
    }
    return this.simulationRoomsUi;
  }

  private appVisible(app: SpaceMountainAppCardV1) {
    return isListedApplication(app);
  }

  private sidebarApps() {
    return this.snapshot.apps.filter((app) => app.installed && app.enabled && this.appVisible(app));
  }

  private shellApp(appId: string) {
    return this.snapshot.apps.find((app) => app.appId === appId && app.installed && app.enabled && app.surfaces.includes("shell") && (this.appVisible(app) || app.appId === "commlink" || (app.appId === "mission-control" && (this.snapshot.operations.canReadLogs || this.snapshot.operations.canReadCoder))));
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
    const control = this.options.root.querySelector<HTMLElement>(target);
    if (control?.tagName === "DETAILS") { (control as HTMLDetailsElement).open = true; control.scrollIntoView({ behavior: "smooth", block: "start" }); }
    else if (control?.tagName === "BUTTON") control.click();
    else control?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private header() {
    const unread = this.snapshot.notifications.filter((item) => !item.readAt && !item.read_at).length;
    const user = recordText(this.snapshot.session, ["displayName", "display_name", "username"]) ?? "Captain";
    const live = ecosystemPresence(this.snapshot.events, this.snapshot.apps.filter(isListedApplication));
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
    const appOwnedButtons = appNav?.filter((item) => item.target !== "[data-mission-control]" || this.snapshot.operations.canReadLogs || this.snapshot.operations.canReadCoder).map((item) => `<button data-app-dock-target="${escapeHtml(item.target)}" title="${escapeHtml(`${item.label} — ${item.description}`)}" aria-label="${escapeHtml(`${item.label}: ${item.description}`)}">${icon(item.icon)}<label>${escapeHtml(item.label)}</label></button>`).join("");
    const activeIcon = activeApp ? themedAppIconUrl(theme.id, activeApp.appId) : undefined;
    const middle = appOwnedButtons ? `<section class="spmt-dock-apps spmt-dock-owned" aria-label="${escapeHtml(activeApp?.name ?? "App")} navigation"><header>${activeIcon ? `<img src="${escapeHtml(activeIcon)}" alt="">` : ""}<strong>${escapeHtml(activeApp?.name ?? "App")}</strong></header>${appOwnedButtons}</section>` : `<section class="spmt-dock-apps" aria-label="Installed applications">${appButtons}</section>`;
    return `<aside class="spmt-rocket-dock spmt-product-glass" data-dock-owner="${escapeHtml(this.activeAppId ?? "spacemountain")}"><div id="rocketLauncher" class="spmt-dock-orbit docked" data-spmt-rocket-trigger role="button" tabindex="0" aria-label="Open or close app navigation; double-click to launch the rocket" title="Click to open or close navigation · Double-click to launch"><span></span><img src="/assets/product/model-rocket.png" alt="SpaceMountain rocket"></div><nav class="spmt-dock-nav"><section class="spmt-dock-core" aria-label="SpaceMountain">${navButtons(core)}</section>${middle}<section class="spmt-dock-account" aria-label="Workspace and account">${navButtons(account)}</section></nav></aside>`;
  }

  private body() {
    if (this.activeAppId === "commlink" && this.shellApp("commlink")) return this.commlink();
    if (this.activeAppId === "stellar-core" && this.shellApp("stellar-core")) return this.stellar();

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
    const installed = this.sidebarApps();
    const unread = this.snapshot.notifications.filter((item) => !item.readAt && !item.read_at).length;
    const appearance = recordObject(this.snapshot.workspace, "appearance");
    const theme = resolveProductTheme(recordText(appearance, ["theme"]), recordText(appearance, ["accent"]));
    return `<section class="spmt-hero spmt-product-glass"><div class="spmt-hero-copy"><img class="spmt-hero-logo spmt-hero-logo-large" data-theme-logo="hero-secondary" src="${themeLogoUrl(theme.id, "hero-secondary")}" alt="SpaceMountain"><div class="actions"><button data-nav="apps" class="primary">${icon("rocket")}Open Shipyard</button><button data-launch-app="commlink">${icon("mail")}Open Commlink</button></div></div><div class="spmt-metrics">${metric("Apps online", `${installed.length}/${this.snapshot.apps.filter(isListedApplication).length}`)}${metric("Unread", String(unread))}${metric("Active apps", String((this.snapshot.runtimeStates ?? []).filter((item) => recordText(item, ["state"]) === "ready" && isListedApplication({ appId: recordText(item, ["appId", "app_id"]) ?? "" })).length))}${metric("Theme", theme.name)}</div></section>`;
  }

  private shipyard() { const apps = this.snapshot.apps.filter((app) => this.appVisible(app)); const appearance = recordObject(this.snapshot.workspace, "appearance"); const theme = resolveProductTheme(recordText(appearance, ["theme"])).id; return `${page("Apps", "Your creator apps. Shared tools live in Workspace; companions run on your devices.", "SHIPYARD")}<div class="spmt-app-grid wide">${apps.map((app) => appCard(app, theme)).join("")}</div>${this.downloads()}`; }
  private downloads() {
    return `<section class="spmt-section spmt-device-downloads"><header><div><span>ON YOUR DEVICES</span><h2>Download companions</h2></div></header><p>Install the Windows companion on your PC or MountainView on Android.</p><div class="actions"><a class="primary" href="/downloads/companion">Download for Windows</a><a class="primary" href="/downloads/mountainview">Download for Android</a></div></section>`;
  }
  private commlink() {
    const state = this.commlinkWorkspace();
    const sources = commlinkSources(this.snapshot);
    const activeSpace = state.chatSpaces.find((item) => item.id === state.activeChatSpaceId) ?? state.chatSpaces[0]!;
    const activeDesk = state.desks.find((item) => item.id === state.activeDeskId) ?? state.desks[0]!;
    const sourceIds = new Set(activeSpace.sourceIds);
    const writable = this.activeCommlinkConversation();
    const shadowRoomId = recordText(writable, ["shadowRoomId"]);
    const visible = this.commlinkRecords(shadowRoomId ? {sourceIds:[`shadow:${shadowRoomId}`]} : activeSpace, state.filter);
    const feed = visible.map((item) => commlinkCard(item)).join("") || `<div class="cosmo-empty"><h2>No messages yet</h2><p>${shadowRoomId ? "Send a message below, then open the room to reply." : "Choose a chat space or shadow room, or start a private message."}</p>${shadowRoomId ? `<button data-commlink-open-room="${escapeHtml(shadowRoomId)}">Open room</button>` : `<button data-commlink-new-mail>New message</button>`}</div>`;
    const panels = activeDesk.chatSpaceIds.map((id) => state.chatSpaces.find((item) => item.id === id)).filter((item) => Boolean(item)).map((space) => `<section class="cosmo-desk-panel"><header><strong>${escapeHtml(space!.name)}</strong><button data-commlink-space="${escapeHtml(space!.id)}">Open feed</button></header><div data-commlink-local="panel:${escapeHtml(space!.id)}">${this.commlinkRecords(space!, "all").map((item) => commlinkCard(item, true)).join("") || `<p class="cosmo-panel-empty">No messages yet</p>`}</div></section>`).join("");
    const destinations = this.writableCommlinkConversations();
    const destinationId = recordText(writable, ["id"]) ?? "";
    const queuedCount = this.commlinkRecords(activeSpace, "queued").length;
    return `<section class="cosmo-page ${this.commlinkSidebarOpen ? "views-open" : ""}" data-tenant="${escapeHtml(this.snapshot.tenantId)}">${sourceNotice("Commlink", this.snapshot.sources.commlink)}<section class="cosmo-commlink ${state.compact ? "compact" : ""}">
      <button class="cosmo-sidebar-backdrop" data-commlink-sidebar-dismiss aria-label="Close spaces"></button>
      <aside class="cosmo-rail" data-commlink-local="views" aria-label="Chat spaces and desks">
        <header><strong>Chat spaces</strong><button data-commlink-toggle-views aria-expanded="${this.commlinkSidebarOpen}" class="cosmo-mobile-views" aria-label="Close spaces">×</button></header>
        <nav aria-label="Chat spaces">${state.chatSpaces.map((space) => `<button data-commlink-space="${escapeHtml(space.id)}" class="${!shadowRoomId && state.view === "focus" && space.id === activeSpace.id ? "active" : ""}"><b>${escapeHtml(initials(space.name))}</b><span><strong>${escapeHtml(space.name)}</strong></span></button>`).join("")}</nav>
        <button class="cosmo-create" data-commlink-new-space>＋ New chat space</button>
        <header><strong>Desks</strong><button data-commlink-new-desk aria-label="Create desk">＋</button></header>
        <nav aria-label="Desks">${state.desks.map((desk) => `<button data-commlink-desk="${escapeHtml(desk.id)}" class="${state.view === "desk" && desk.id === activeDesk.id ? "active" : ""}"><b>▦</b><span><strong>${escapeHtml(desk.name)}</strong><small>${desk.chatSpaceIds.length} chat spaces</small></span></button>`).join("")}</nav>
        <header><strong>Shadow rooms</strong><button data-commlink-open-room aria-label="Manage shadow rooms">＋</button></header>
        <nav aria-label="Shadow rooms">${(this.snapshot.simulationRooms ?? []).map(room => `<button data-commlink-room="${escapeHtml(room.roomId)}" class="${shadowRoomId === room.roomId ? "active" : ""}"><b>#</b><span><strong>${escapeHtml(room.name)}</strong><small>Discord test chat</small></span></button>`).join("") || `<p class="cosmo-help">Create a room to test messages and embeds.</p>`}</nav>
        <details class="cosmo-sidebar-settings" data-commlink-local="space-settings"><summary>Chat space settings</summary>
          <p class="cosmo-help">${escapeHtml(activeSpace.name)}</p>
          <details class="cosmo-sources" data-commlink-local="sidebar-sources"><summary>Message sources · ${sourceIds.size ? sourceIds.size : "All"}</summary><nav>${sources.map((source) => `<button data-commlink-source="${escapeHtml(source.id)}" aria-pressed="${sourceIds.has(source.id)}" title="${escapeHtml(source.detail)}">${escapeHtml(source.label)}</button>`).join("")}</nav><p class="cosmo-help">With none selected, all sources appear.</p></details>
          <nav aria-label="Message filters">${(["all", "chat", "events", "streamweaver", "queued"] as CommlinkFilterV1[]).map(filter => `<button data-commlink-filter="${filter}" class="${state.filter === filter ? "active" : ""}">${filter === "all" ? "All messages" : filter === "streamweaver" ? "StreamWeaver" : filter[0]!.toUpperCase() + filter.slice(1)}${filter === "queued" ? ` (${queuedCount})` : ""}</button>`).join("")}</nav>
          <div class="cosmo-sidebar-buttons"><button data-commlink-edit-space>Rename space</button><button data-commlink-delete-space ${state.chatSpaces.length === 1 ? "disabled" : ""}>Delete space</button><button data-commlink-edit-desk>Rename desk</button><button data-commlink-delete-desk ${state.desks.length === 1 ? "disabled" : ""}>Delete desk</button><button data-commlink-compact>${state.compact ? "Comfortable spacing" : "Compact spacing"}</button></div>
        </details>
        <form class="cosmo-search" data-commlink-search data-commlink-local="search"><input name="query" type="search" minlength="2" maxlength="200" required placeholder="Search messages" aria-label="Search message history"><button aria-label="Search messages">Search</button></form>
        <footer><button data-commlink-read-all>Mark all read</button><button data-commlink-popout>Pop out</button></footer>
      </aside>
      <div class="cosmo-workspace"><header class="cosmo-topbar"><div><span>${shadowRoomId ? "SHADOW ROOM · DISCORD" : state.view === "desk" ? "DESK" : "COMMLINK"}</span><h1>${escapeHtml(state.view === "desk" ? activeDesk.name : shadowRoomId ? String(writable!.title) : activeSpace.name)}</h1></div><div class="cosmo-actions"><button data-commlink-toggle-views aria-expanded="${this.commlinkSidebarOpen}" class="cosmo-mobile-views">Spaces</button>${shadowRoomId ? `<button data-commlink-open-room="${escapeHtml(shadowRoomId)}">Open room</button>` : ""}<button class="primary" data-commlink-new-mail>New message</button></div></header>
      ${state.view === "desk" ? `<section class="cosmo-desk-grid">${panels}</section>` : `<section class="cosmo-focus"><div class="cosmo-feed-pane"><div class="cosmo-feed" data-commlink-local="feed:${escapeHtml(shadowRoomId ?? activeSpace.id)}:${state.filter}" aria-label="Message history" tabindex="0">${feed}</div><form class="cosmo-composer" data-commlink-compose data-commlink-local="reply:${escapeHtml(destinationId)}"><label>${shadowRoomId ? "Send to" : "Reply to"}<select data-commlink-destination aria-label="Message destination">${destinations.length ? `${!destinationId ? `<option value="" selected disabled>Choose a conversation or shadow room</option>` : ""}` + destinations.map((conversation) => `<option value="${escapeHtml(String(conversation.id))}" ${conversation.id === destinationId ? "selected" : ""}>${conversation.shadowRoomId ? "Shadow · " : ""}${escapeHtml(recordText(conversation, ["title"]) ?? "Private conversation")}</option>`).join("") : `<option value="">No conversations yet</option>`}</select></label><div class="cosmo-message-input"><textarea name="message" maxlength="8000" rows="2" ${writable ? "required" : "disabled"} placeholder="${shadowRoomId ? "Message this shadow room…" : writable ? "Write a reply…" : "Start a private message or choose a shadow room"}"></textarea><button class="primary" ${writable && !this.commlinkSending ? "" : "disabled"}>${this.commlinkSending ? "Sending…" : "Send"}</button></div><p data-commlink-send-status role="status">${escapeHtml(this.commlinkSendStatus)}</p></form></div></section>`}
      <dialog class="cosmo-mail-dialog" data-commlink-mail-dialog data-commlink-local="mail-dialog"><form data-commlink-mail-form data-commlink-local="mail"><header><h2>New message</h2><button type="button" data-commlink-mail-cancel aria-label="Close">×</button></header><label>Recipients<select name="recipientUserIds" multiple required size="${Math.min(6, Math.max(2, this.snapshot.commlinkRecipients.length))}">${this.snapshot.commlinkRecipients.map((recipient) => `<option value="${escapeHtml(recipient.userId)}">${escapeHtml(recipient.displayName)} · @${escapeHtml(recipient.username)}</option>`).join("")}</select></label><label>Subject<input name="subject" maxlength="200" placeholder="Optional subject"></label><label>Message<textarea name="message" maxlength="8000" rows="7" required placeholder="Write a private message…"></textarea></label><p data-commlink-mail-status role="status">${escapeHtml(this.commlinkMailStatus)}</p><footer><small>${this.snapshot.commlinkRecipients.length ? "Select people in this workspace." : "No other workspace members are available."}</small><button class="primary" ${this.snapshot.commlinkRecipients.length && !this.commlinkMailSending ? "" : "disabled"}>${this.commlinkMailSending ? "Sending…" : "Send message"}</button></footer></form></dialog>
      </div></section></section>`;
  }

  private commlinkWorkspace(): CommlinkWorkspaceUiV1 {
    if (this.commlinkDraft) return this.commlinkDraft;
    const stored = recordObject(this.snapshot.workspace, "commlink");
    if (isCommlinkWorkspace(stored)) return stored as unknown as CommlinkWorkspaceUiV1;
    const sources: string[] = [];
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
    const name = window.prompt("Name this chat space")?.trim();
    if (!name) return;
    const state = this.commlinkWorkspace();
    const id = `space-${crypto.randomUUID()}`;
    this.updateCommlink({ chatSpaces: [...state.chatSpaces, { id, name: name.slice(0, 60), sourceIds: [] }], activeChatSpaceId: id, view: "focus" });
  }

  private createDesk() {
    const name = window.prompt("Name this desk")?.trim();
    if (!name) return;
    const state = this.commlinkWorkspace();
    const id = `desk-${crypto.randomUUID()}`;
    this.updateCommlink({ desks: [...state.desks, { id, name: name.slice(0, 60), chatSpaceIds: state.chatSpaces.slice(0, 6).map((space) => space.id) }], activeDeskId: id, view: "desk" });
  }

  private renameChatSpace() {
    const state = this.commlinkWorkspace(); const active = state.chatSpaces.find((space) => space.id === state.activeChatSpaceId); if (!active) return;
    const name = window.prompt("Rename this chat space", active.name)?.trim(); if (!name) return;
    this.updateCommlink({ chatSpaces: state.chatSpaces.map((space) => space.id === active.id ? { ...space, name: name.slice(0, 60) } : space) });
  }

  private renameDesk() {
    const state = this.commlinkWorkspace(); const active = state.desks.find((desk) => desk.id === state.activeDeskId); if (!active) return;
    const name = window.prompt("Rename this desk", active.name)?.trim(); if (!name) return;
    this.updateCommlink({ desks: state.desks.map((desk) => desk.id === active.id ? { ...desk, name: name.slice(0, 60) } : desk) });
  }

  private deleteChatSpace() {
    const state = this.commlinkWorkspace(); if (state.chatSpaces.length === 1) return;
    const active = state.chatSpaces.find((space) => space.id === state.activeChatSpaceId); if (!active || !window.confirm(`Delete chat space “${active.name}”? Connected accounts will not be disconnected.`)) return;
    const chatSpaces = state.chatSpaces.filter((space) => space.id !== active.id); const first = chatSpaces[0]!;
    const desks = state.desks.map((desk) => ({ ...desk, chatSpaceIds: desk.chatSpaceIds.filter((id) => id !== active.id) })).map((desk) => desk.chatSpaceIds.length ? desk : { ...desk, chatSpaceIds: [first.id] });
    this.updateCommlink({ chatSpaces, desks, activeChatSpaceId: first.id });
  }

  private deleteDesk() {
    const state = this.commlinkWorkspace(); if (state.desks.length === 1) return;
    const active = state.desks.find((desk) => desk.id === state.activeDeskId); if (!active || !window.confirm(`Delete desk “${active.name}”? Its chat spaces will remain saved.`)) return;
    const desks = state.desks.filter((desk) => desk.id !== active.id); this.updateCommlink({ desks, activeDeskId: desks[0]!.id, view: "focus" });
  }

  private writableCommlinkConversations() {
    const state = this.commlinkWorkspace();
    const space = state.chatSpaces.find((item) => item.id === state.activeChatSpaceId);
    const privateConversations = this.snapshot.conversations.filter((conversation) => {
      const members = conversation.participantUserIds;
      return Array.isArray(members) && members.includes(this.snapshot.userId) && members.some((id) => id !== this.snapshot.userId)
        && (!space?.sourceIds.length || space.sourceIds.includes(commlinkRecordSource(conversation)) || space.sourceIds.includes(`conversation:${recordText(conversation, ["id"]) ?? ""}`));
    });
    return [...privateConversations, ...(this.snapshot.simulationRooms ?? []).map(room => ({ id:`shadow:${room.roomId}`, title:room.name, shadowRoomId:room.roomId } as Record<string,unknown>))];
  }

  private activeCommlinkConversation() {
    const conversations = this.writableCommlinkConversations();
    return this.commlinkConversationId ? conversations.find((item) => item.id === this.commlinkConversationId) : conversations.find(item => !item.shadowRoomId);
  }

  private captureCommlink() {
    if (this.options.root.querySelector<HTMLElement>(".cosmo-page")?.dataset.tenant !== this.snapshot.tenantId) return;
    this.options.root.querySelectorAll<HTMLElement>("[data-commlink-local]").forEach((node) => {
      const values = [...node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name]")].map((input) => ({ name: input.name, value: input.value, ...(input.tagName === "SELECT" ? { selected: [...(input as HTMLSelectElement).options].filter((option) => option.selected).map((option) => option.value) } : {}) }));
      this.commlinkLocal.set(node.dataset.commlinkLocal!, { values, scrollTop: node.scrollTop, ...(node.tagName === "DIALOG" || node.tagName === "DETAILS" ? { open: node.hasAttribute("open") } : {}) });
    });
  }

  private restoreCommlink() {
    this.options.root.querySelectorAll<HTMLElement>("[data-commlink-local]").forEach((node) => {
      const stored = this.commlinkLocal.get(node.dataset.commlinkLocal!);
      if (!stored) return;
      for (const input of node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name]")) {
        const value = stored.values.find((value) => value.name === input.name);
        if (!value) continue;
        if (value.selected && input.tagName === "SELECT") for (const option of (input as HTMLSelectElement).options) option.selected = value.selected.includes(option.value);
        else input.value = value.value;
      }
      node.scrollTop = stored.scrollTop;
      if (stored.open && node.tagName === "DIALOG") (node as HTMLDialogElement).showModal();
      else if (stored.open && node.tagName === "DETAILS") node.setAttribute("open", "");
    });
  }

  private async submitCommlink(mail: boolean) {
    if (mail ? this.commlinkMailSending : this.commlinkSending) return;
    const selector = mail ? "[data-commlink-mail-form]" : "[data-commlink-compose]";
    const form = this.options.root.querySelector<HTMLFormElement>(selector);
    const textarea = form?.querySelector<HTMLTextAreaElement>("textarea[name=message]");
    const text = textarea?.value.trim() ?? "";
    if (!form || !text) return;
    const conversation = this.activeCommlinkConversation();
    const recipients = [...form.querySelectorAll<HTMLOptionElement>("select[name=recipientUserIds] option")].filter((option) => option.selected).map((option) => option.value);
    const subject = form.querySelector<HTMLInputElement>("input[name=subject]")?.value.trim() ?? "";
    if (mail ? !recipients.length : !conversation) return;
    const key = form.dataset.commlinkLocal!;
    const original = textarea!.value;
    if (mail) { this.commlinkMailSending = true; this.commlinkMailStatus = "Sending…"; }
    else { this.commlinkSending = true; this.commlinkSendStatus = "Sending…"; }
    this.render();
    try {
      if (mail) {
        if (!this.options.onComposeCommlinkMail) throw new Error("Message service is unavailable. Your draft is saved.");
        await this.options.onComposeCommlinkMail(recipients, subject, text);
      } else {
        if (!this.options.onSendCommlinkMessage) throw new Error("Message service is unavailable. Your draft is saved.");
        await this.options.onSendCommlinkMessage(conversation!, text);
      }
      this.captureCommlink();
      const stored = this.commlinkLocal.get(key);
      const draft = stored?.values.find((value) => value.name === "message");
      if (draft?.value === original) draft.value = "";
      const current = this.options.root.querySelector<HTMLFormElement>(selector);
      const currentMessage = current?.querySelector<HTMLTextAreaElement>("textarea[name=message]");
      if (current?.dataset.commlinkLocal === key && currentMessage?.value === original) currentMessage.value = "";
      if (mail) this.commlinkMailStatus = "Message sent."; else this.commlinkSendStatus = "Message sent.";
    } catch (error) {
      const status = error instanceof Error ? error.message : "Could not send. Your draft is saved.";
      if (mail) this.commlinkMailStatus = status; else this.commlinkSendStatus = status;
    } finally {
      if (mail) this.commlinkMailSending = false; else this.commlinkSending = false;
      this.render();
    }
  }

  private commlinkRecords(space: { sourceIds: string[] }, filter: CommlinkFilterV1) {
    const sourceIds = new Set(space.sourceIds);
    const signalMessageIds = new Set(this.snapshot.events.filter((event) => (recordText(event, ["type"]) ?? "").includes("lost-signal-message.requested")).map((event) => recordText(recordObject(event, "payload"), ["targetMessageId", "target_message_id"])).filter((id): id is string => Boolean(id)));
    const messages = (this.snapshot.messages ?? []).map((item) => ({ ...item, __recordType: "chat", ...(signalMessageIds.has(recordText(item, ["messageId", "message_id", "id"]) ?? "") ? { hiddenSignal: true } : {}) }));
    const liveChat = (this.snapshot.liveChat ?? []).map((item) => ({ ...item, __recordType: "chat" }));
    const conversations = this.snapshot.conversations.map((item) => ({ ...item, __recordType: "chat" }));
    const shadowMessages = (this.snapshot.simulationMessages ?? []).flatMap(event => {
      const payload = recordObject(event,"payload");
      if (!payload || payload.lane !== "chat") return [];
      const data = recordObject(payload,"data"), discord = recordObject(data,"payload");
      const embeds = Array.isArray(discord?.embeds) ? discord.embeds : [];
      return [{...event, __recordType:"chat", sourceAppId:`shadow:${payload.roomId}`, title:payload.title, text:payload.body || embeds.map(embed => recordText(embed,["title","description"]) ?? "").join("\n"), occurredAt:payload.occurredAt, shadowRoomId:payload.roomId, direction:payload.direction, shadowAppId:recordText(data,["appId"]) ?? event.sourceAppId }];
    });
    const events = this.snapshot.events.filter(item => !String(item.type).startsWith("spmt.simulation-room")).map((item) => ({ ...item, __recordType: "event" }));
    const notifications = this.snapshot.notifications.map((item) => ({ ...item, __recordType: "event" }));
    return [...shadowMessages, ...liveChat, ...messages, ...conversations, ...events, ...notifications]
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
    return `${page("Speak with Stella", "Stellar Core is the ecosystem AI layer; Stella is its default assistant.", "STELLA CORE")}${sourceNotice("Stellar Core catalog", this.snapshot.sources.stellar)}<section class="spmt-stella-chat"><header><span>STELLA</span><h2>Community Assistant</h2></header><div class="spmt-stella-history" data-stella-history><p>Ask Stella about the ecosystem, your workspace, or creator tools.</p></div><form data-stella-form>${routeControl}<input name="message" maxlength="4000" required placeholder="Speak to Stella…"><label class="spmt-check"><input type="checkbox" name="remember" checked> Remember this conversation</label><button class="primary" type="submit">Send</button></form></section>${ownerControls}${this.snapshot.operations.canReadLogs || this.snapshot.operations.canReadCoder ? `<details class="spmt-account-section" data-mission-control><summary>Mission Control · operations and Coder</summary>${this.operations()}</details>` : ""}<section class="spmt-account-section"><header><span>CAPABILITY CATALOG</span><h2>What Stella can use</h2></header><div class="spmt-command-grid">${capabilities.map((item) => { const available = recordText(item, ["availability"]) === "available"; return `<article><div><span class="spmt-command-state ${available ? "available" : "unavailable"}">${available ? "AVAILABLE" : "UNAVAILABLE"}</span><h3>${escapeHtml(recordText(item, ["title", "id"]) ?? "System capability")}</h3></div><p>${escapeHtml(recordText(item, ["description"]) ?? "")}</p><small>${available ? escapeHtml(recordStrings(item, "requiredScopes").join(", ") || "Ready") : escapeHtml(recordText(item, ["unavailableReason", "unavailable_reason"]) ?? "Runtime unavailable")}</small></article>`; }).join("") || empty("No Stellar Core capabilities have been declared yet.")}</div></section>`;
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
    const appOptions = [{ value: "overlay-bay", label: "Overlay Bay" }, { value: simulationRoomPath(), label: "Simulation Rooms" }, ...this.snapshot.apps.filter((app) => app.installed && app.enabled && (isListedApplication(app) || app.appId === "commlink")).map((app) => ({ value: app.appId, label: app.name }))];
    return `${page("Portable station layout", "One canonical workspace profile, shared overlays, and three persistent app slots.", "WORKSPACE")}${sourceNotice("Workspace", this.snapshot.sources.workspace)}<form class="spmt-settings-form" data-workspace-settings><section><header><span>APPEARANCE</span><h2>One color language, a unique scene in every app</h2></header><p class="spmt-appearance-rule">Your theme recolors each app's own cosmic scene. The shared stars, glass, and navigation remain familiar everywhere.</p><div class="spmt-field-grid"><label>Theme<select name="theme" data-workspace-theme>${selectOption("solar-flare", theme, "Solar flare")}${selectOption("nebula-purple", theme, "Nebula purple")}${selectOption("oceanic-blue", theme, "Oceanic blue")}${selectOption("aurora-green", theme, "Aurora green")}${!theme.includes("-") ? selectOption(theme, theme, `Existing: ${theme}`) : ""}</select></label><label>Accent<input name="accent" data-workspace-accent type="color" value="${escapeHtml(accent)}"></label><label class="wide">Custom scene override <small>Optional; leave blank to use each app's artwork.</small><input name="backgroundUrl" type="url" inputmode="url" placeholder="https://…" value="${escapeHtml(backgroundUrl)}"></label></div><div class="spmt-slider-grid">${rangeControl("glowIntensity", "Glow", recordNumber(appearance, "glowIntensity") ?? 55)}${rangeControl("starDensity", "Stars", recordNumber(appearance, "starDensity") ?? 70)}${rangeControl("glassOpacity", "Glass", recordNumber(appearance, "glassOpacity") ?? 76)}${rangeControl("blurStrength", "Blur", recordNumber(appearance, "blurStrength") ?? 18)}${rangeControl("nebulaIntensity", "Nebula", recordNumber(appearance, "nebulaIntensity") ?? 55)}${rangeControl("parallaxDepth", "Parallax", recordNumber(appearance, "parallaxDepth") ?? 35)}${rangeControl("borderStrength", "Borders", recordNumber(appearance, "borderStrength") ?? 35)}${rangeControl("chatTransparency", "Chat transparency", recordNumber(appearance, "chatTransparency") ?? 15)}${rangeControl("animationSpeed", "Animation speed", recordNumber(animation, "speed") ?? 50)}</div></section><section><header><span>LAYOUT & MOTION</span><h2>Shared interface behavior</h2></header><div class="spmt-field-grid"><label>Density<select name="density">${selectOption("compact", recordText(appearance, ["density"]) ?? "comfortable", "Compact")}${selectOption("comfortable", recordText(appearance, ["density"]) ?? "comfortable", "Comfortable")}${selectOption("spacious", recordText(appearance, ["density"]) ?? "comfortable", "Spacious")}</select></label><label>Sidebar style<select name="sidebarStyle">${selectOption("glass", recordText(appearance, ["sidebarStyle"]) ?? "glass", "Glass")}${selectOption("solid", recordText(appearance, ["sidebarStyle"]) ?? "glass", "Solid")}${selectOption("minimal", recordText(appearance, ["sidebarStyle"]) ?? "glass", "Minimal")}</select></label><label>Sidebar position<select name="sidebarPosition">${selectOption("left", recordText(appearance, ["sidebarPosition"]) ?? "left", "Left")}${selectOption("right", recordText(appearance, ["sidebarPosition"]) ?? "left", "Right")}</select></label><label>Topbar style<select name="topbarStyle">${selectOption("glass", recordText(appearance, ["topbarStyle"]) ?? "glass", "Glass")}${selectOption("solid", recordText(appearance, ["topbarStyle"]) ?? "glass", "Solid")}${selectOption("minimal", recordText(appearance, ["topbarStyle"]) ?? "glass", "Minimal")}</select></label><label>Tab style<select name="tabStyle">${selectOption("pills", recordText(appearance, ["tabStyle"]) ?? "pills", "Pills")}${selectOption("underline", recordText(appearance, ["tabStyle"]) ?? "pills", "Underline")}${selectOption("cards", recordText(appearance, ["tabStyle"]) ?? "pills", "Cards")}</select></label><label>Tab position<select name="tabPosition">${selectOption("top", recordText(appearance, ["tabPosition"]) ?? "top", "Top")}${selectOption("bottom", recordText(appearance, ["tabPosition"]) ?? "top", "Bottom")}</select></label></div><div class="spmt-toggle-grid">${checkControl("sidebarCollapsed", "Collapse sidebar", recordBoolean(appearance, "sidebarCollapsed", false))}${checkControl("showAvatars", "Show avatars", recordBoolean(appearance, "showAvatars", true))}${checkControl("smoothTransitions", "Smooth transitions", recordBoolean(appearance, "smoothTransitions", true))}${checkControl("pushToTalk", "Push to talk", recordBoolean(appearance, "pushToTalk", false))}${checkControl("particles", "Particles", recordBoolean(animation, "particles", true))}${checkControl("shootingStars", "Shooting stars", recordBoolean(animation, "shootingStars", true))}</div></section><section><header><span>DOCK</span><h2>Three persistent workspace embeds</h2></header><p>Keep apps or Simulation Rooms open while you work in any app.</p><button type="button" data-open-workspace-rooms>Open Simulation Rooms</button><div class="spmt-field-grid">${slots.map((slot, index) => `<label>Slot ${index + 1}<select name="dockSlot${index}">${selectOption("", slot ?? "", "Empty")}${slot && !appOptions.some((option) => option.value === slot) ? selectOption(slot, slot, simulationRoomSlot(slot) ? "Pinned simulation room" : `Existing: ${slot}`) : ""}${appOptions.map((option) => selectOption(option.value, slot ?? "", option.label)).join("")}</select></label>`).join("")}</div></section><button type="submit" class="primary">Save canonical workspace</button><small>Revision ${recordNumber(profile, "revision") ?? "unavailable"} · changes are written once to SPMT and read by every authorized app.</small></form>`;
  }
  private account() {
    const links = this.snapshot.providerLinks.slice().sort((left, right) => providerLinkKey(left).localeCompare(providerLinkKey(right)));
    const linkedProviders = new Set(links.map((item) => recordText(item, ["provider"])).filter((item): item is string => Boolean(item)));
    const usage = this.snapshot.usage;
    const ai = usage?.resources.filter((item) => ["ai-chat-requests", "ai-coding-requests", "image-generations"].includes(item.resource)) ?? [];
    const services = usage?.resources.filter((item) => !["ai-chat-requests", "ai-coding-requests", "image-generations"].includes(item.resource)) ?? [];
    const plan = usage ? `<section class="spmt-account-plan"><div><span>CURRENT PLAN</span><h2>${escapeHtml(usage.plan.name)}</h2><p>${usage.plan.monthlyPriceUsd ? `$${usage.plan.monthlyPriceUsd}/month` : "Free"} · ${escapeHtml(usage.period)}</p></div><strong>${usage.plan.companionLocalProcessing === "unmetered-local" ? "Companion local processing included" : "Companion fair use"}</strong></section>` : "";
    return `${page("Your account", "Your plan, personal usage, linked identities, and XP in one private view.", "ACCOUNT")}${sourceNotice("Usage", this.snapshot.sources.usage)}${plan}<section class="spmt-account-section spmt-usage-section"><header><span>PERSONAL USAGE</span><h2>AI and creation</h2><p>Only usage assigned to your signed-in SPMT identity appears here.</p></header><div class="spmt-usage-grid">${ai.map(usageBar).join("") || empty("Personal AI usage is temporarily unavailable.")}</div></section><section class="spmt-account-section spmt-usage-section"><header><span>PLAN RESOURCES</span><h2>Hosted services and storage</h2></header><div class="spmt-usage-grid">${services.map(usageBar).join("") || empty("Personal service usage is temporarily unavailable.")}</div></section><section class="spmt-account-section"><header><span>STELLA DATA</span><h2>Your AI privacy controls</h2><p>Raw remembered prompts and answers are retained for seven days, content-minimized metadata for 30 days, and do-not-remember turns for at most one hour.</p></header><div class="actions"><button type="button" data-stellar-export>Export my Stella data</button><button type="button" data-stellar-delete>Delete my Stella data</button></div></section>${sourceNotice("Linked accounts", this.snapshot.sources.identity)}<section class="spmt-account-section"><header><span>LINKED IDENTITIES</span><h2>Your sign-in providers</h2><p>Verify Twitch, Discord or YouTube here once. App-owned bot connections and channel delivery are configured separately inside StreamWeaver or Discord Stream Hub.</p></header><div class="actions"><button type="button" class="primary" data-provider-link="twitch">${linkedProviders.has("twitch") ? "Re-verify" : "Link"} Twitch</button><button type="button" class="primary" data-provider-link="discord">${linkedProviders.has("discord") ? "Re-verify" : "Link"} Discord</button><button type="button" class="primary" data-provider-link="youtube">${linkedProviders.has("youtube") ? "Re-verify" : "Link"} YouTube</button></div><div class="spmt-list spmt-account-list">${links.map((item) => { const provider = recordText(item, ["provider"]) ?? "provider"; const providerUserId = recordText(item, ["providerUserId", "provider_user_id"]) ?? "unknown"; return `<article><div><span class="spmt-record-kind">${escapeHtml(provider)}</span><strong>${escapeHtml(providerUserId)}</strong><p>This verified account signs into the same SPMT user identity.</p></div><button data-provider-unlink="${escapeHtml(providerLinkKey(item))}">Unlink</button></article>`; }).join("") || empty("No provider accounts are linked to this SPMT identity.")}</div></section>`;
  }

  private settings() {
    const installed = this.sidebarApps();
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
  snapshot.apps.filter((app) => app.installed && app.enabled && isListedApplication(app)).forEach((app) => add(app.appId, app.name, app.appId === "streamweaver" ? snapshot.sources.commlink.state : "ready", `${app.name} app messages and typed events`));
  (snapshot.simulationRooms ?? []).forEach(room => add(`shadow:${room.roomId}`, `Shadow · ${room.name}`, "ready", "Test messages and embeds in this room"));
  snapshot.conversations.forEach((conversation) => { const id = commlinkRecordSource(conversation); if (id && id !== "spacemountain") add(id, sourceLabel(id), snapshot.sources.commlink.state, `${sourceLabel(id)} canonical conversation source`); });
  snapshot.events.filter(event => !String(event.type).startsWith("spmt.simulation-room")).forEach((event) => { const id = commlinkRecordSource(event); if (id && id !== "spacemountain") add(id, sourceLabel(id), snapshot.sources.events.state, `${sourceLabel(id)} typed app events`); });
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
  return `<article class="cosmo-message ${small ? "small" : ""} ${signal ? "signal" : ""}" ${conversationId ? `data-open-conversation="${escapeHtml(conversationId)}"` : ""} ${signal ? "data-spmt-signal-trigger" : ""}><span class="cosmo-message-avatar">${escapeHtml(initials(title))}</span><div><header><strong>${escapeHtml(title)}</strong><b>${escapeHtml(item.shadowRoomId ? (item.direction === "ingress" ? "Received · Shadow" : "Sent · Shadow") : sourceLabel(source))}</b><small>${escapeHtml(formatRecordTime(recordText(item, ["occurredAt", "occurred_at", "createdAt", "created_at", "updatedAt", "updated_at"])))}</small></header><p>${escapeHtml(body)}</p><footer><span>${escapeHtml(kind)}</span>${signal ? "<button type=\"button\" data-spmt-signal-trigger>Trace signal</button>" : ""}</footer></div></article>`;
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

function metric(label: string, value: string) { return `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`; }
function quick(title: string, body: string, nav: SpaceMountainViewV1, iconName: IconName = "pulse") { return `<button data-nav="${nav}"><i>${icon(iconName)}</i><strong>${title}</strong><span>${body}</span><em>${icon("arrow")}</em></button>`; }
function page(title: string, body: string, kicker = "SPACEMOUNTAIN") { return `<section class="spmt-page-title"><span>${kicker}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></section>`; }
function empty(message: string, nav?: SpaceMountainViewV1) { return `<div class="spmt-empty"><i>${icon("spark")}</i><strong>Clear orbit</strong><span>${escapeHtml(message)}</span>${nav ? `<button data-nav="${nav}">Open ${nav === "apps" ? "Shipyard" : escapeHtml(nav)}</button>` : ""}</div>`; }
function recordText(value: unknown, keys: string[]) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const record = value as Record<string, unknown>; for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string; return undefined; }
function recordNumber(value: unknown, key: string) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const result = (value as Record<string, unknown>)[key]; return typeof result === "number" && Number.isFinite(result) ? result : undefined; }
function recordBoolean(value: unknown, key: string, fallback: boolean) { if (!value || typeof value !== "object" || Array.isArray(value)) return fallback; const result = (value as Record<string, unknown>)[key]; return typeof result === "boolean" ? result : fallback; }
function recordObject(value: unknown, key: string) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const result = (value as Record<string, unknown>)[key]; return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : undefined; }
function sessionHasScope(value: unknown, scope: string) { const scopes = recordStrings(value, "scopes"); return scopes.includes("*") || scopes.includes(scope) || scopes.some((item) => item.endsWith(":*") && scope.startsWith(item.slice(0, -1))); }
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
  if (view === "home") return `<span class="spmt-core-nav-icon"><img data-theme-logo="spmt" src="${themeLogoUrl(theme, "spmt")}" alt=""></span>`;
  const artwork = view === "apps" ? "shipyard" : view === "workspace" ? "overlay-bay" : view === "settings" ? "mission-control" : undefined;
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


export const SPACE_MOUNTAIN_CSS = `.spmt-space-root{--accent:#ff7a18;--accent2:#ffc857;--panel:rgba(9,12,25,.76);--border:rgba(255,255,255,.1);min-height:100dvh;background:radial-gradient(circle at 15% 10%,rgba(255,122,24,.14),transparent 26%),radial-gradient(circle at 80% 0,rgba(87,54,201,.16),transparent 28%),#050710;color:#f7f7fb;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.spmt-space-shell{min-height:100dvh}.spmt-cosmic-header{position:fixed;top:max(12px,env(safe-area-inset-top));left:clamp(88px,10vw,164px);right:18px;z-index:300;min-height:64px;padding:10px 16px;border:1px solid var(--border);border-radius:20px;background:rgba(5,7,16,.76);backdrop-filter:blur(22px);display:flex;align-items:center;gap:14px;box-shadow:0 14px 40px rgba(0,0,0,.35)}.spmt-brand{border:0;background:none;color:white;display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.12em}.spmt-brand>span{display:grid;place-items:center;width:38px;height:38px;border-radius:13px;background:linear-gradient(145deg,var(--accent),#e24718);color:#111}.spmt-brand em{font-style:normal;color:var(--accent)}.spmt-header-status{margin-left:auto;display:flex;gap:10px;align-items:center;font-size:11px;color:#a6a8b4}.spmt-header-status b{border:1px solid var(--border);border-radius:999px;padding:5px 8px;text-transform:uppercase}.state-ready{color:#5ee6a8}.state-degraded{color:#ffd166}.state-unavailable{color:#ff6b6b}.spmt-header-actions{display:flex;gap:8px}.spmt-header-actions button{position:relative;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.04);color:white;padding:9px 11px}.spmt-icon-button i{position:absolute;right:-5px;top:-7px;background:#ffc857;color:#111;border-radius:99px;font-size:9px;min-width:17px;height:17px;display:grid;place-items:center;font-style:normal}.spmt-rocket-dock{position:fixed;left:16px;top:calc(var(--spmt-shell-top-inset,92px) + 8px);bottom:max(16px,env(safe-area-inset-bottom));z-index:100;width:108px;border:1px solid var(--border);border-radius:26px;background:rgba(7,9,19,.78);backdrop-filter:blur(20px);padding:10px;display:flex;flex-direction:column;gap:10px}.spmt-dock-orbit{height:72px;border:1px solid rgba(255,122,24,.24);border-radius:22px;display:grid;place-items:center;color:var(--accent);font-size:28px}.spmt-rocket-dock nav{display:flex;flex-direction:column;gap:4px}.spmt-rocket-dock nav button{border:1px solid transparent;background:transparent;color:#9799a8;border-radius:14px;padding:9px 7px;display:flex;align-items:center;gap:8px;text-align:left}.spmt-rocket-dock nav button.active{color:white;border-color:rgba(255,122,24,.28);background:rgba(255,122,24,.12)}.spmt-rocket-dock nav label{font-size:10px;font-weight:750}.spmt-rocket-dock footer{margin-top:auto;border-top:1px solid var(--border);padding-top:10px;display:flex;flex-direction:column}.spmt-rocket-dock footer small{font-size:8px;color:#777}.spmt-rocket-dock footer strong{font-size:9px;color:#5ee6a8}.spmt-space-main{padding:calc(var(--spmt-shell-top-inset,92px) + 26px) 24px 48px 148px;min-height:var(--spmt-shell-available-height,calc(100dvh - 110px));box-sizing:border-box}.spmt-hero{border:1px solid var(--border);border-radius:28px;background:linear-gradient(135deg,rgba(11,14,28,.88),rgba(4,6,14,.72));padding:clamp(24px,4vw,46px);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:28px}.kicker,.spmt-page-title>span,.spmt-section header span,.spmt-app-card>span,.spmt-slot-grid span{font-size:10px;letter-spacing:.18em;font-weight:900;color:var(--accent2)}.spmt-hero h1,.spmt-page-title h1{font-size:clamp(34px,5vw,62px);line-height:1.03;margin:12px 0}.spmt-hero p,.spmt-page-title p{max-width:680px;color:#b7b9c4;line-height:1.65}.actions{display:flex;gap:10px;margin-top:24px}.spmt-hero button,.spmt-section button,.spmt-app-card button{border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.05);color:white;padding:10px 14px;font-weight:800}.primary{background:linear-gradient(135deg,var(--accent2),var(--accent))!important;color:#15100a!important;border-color:transparent!important}.spmt-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px}.spmt-metrics>div{min-height:92px;border:1px solid var(--border);border-radius:18px;background:rgba(0,0,0,.25);padding:15px;display:flex;flex-direction:column;justify-content:flex-end}.spmt-metrics strong{font-size:26px}.spmt-metrics span{font-size:10px;color:#858795;text-transform:uppercase}.spmt-operations-metrics{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px}.spmt-section{margin-top:18px;border:1px solid var(--border);border-radius:24px;background:var(--panel);padding:22px}.spmt-section>header{display:flex;justify-content:space-between;align-items:end}.spmt-section h2{margin:4px 0}.spmt-app-grid{margin-top:18px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.spmt-app-grid.wide{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:24px}.spmt-app-card{border:1px solid var(--border);border-radius:20px;background:rgba(4,6,14,.58);padding:16px}.app-icon{width:48px;height:48px;border-radius:14px;background:linear-gradient(145deg,rgba(255,122,24,.22),rgba(87,54,201,.22));display:grid;place-items:center;font-weight:900;margin-bottom:14px}.spmt-app-card h3{margin:5px 0 4px}.spmt-app-card p{font-size:12px;line-height:1.5;color:#9497a6;min-height:36px}.spmt-app-card footer{display:flex;align-items:center;justify-content:space-between;margin-top:14px}.spmt-quick-grid,.spmt-slot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.spmt-quick-grid button,.spmt-slot-grid article{border:1px solid var(--border);border-radius:20px;background:rgba(7,9,19,.74);padding:18px;color:white;text-align:left}.spmt-quick-grid span{display:block;color:#9598a7;font-size:12px;line-height:1.5;margin-top:7px}.spmt-page-title{padding:10px 2px 20px}.spmt-page-title h1{font-size:clamp(32px,4vw,48px)}.spmt-list{display:grid;gap:10px}.spmt-list article{border:1px solid var(--border);border-radius:16px;background:var(--panel);padding:15px;display:flex;justify-content:space-between}.spmt-empty{grid-column:1/-1;border:1px dashed var(--border);border-radius:18px;padding:28px;text-align:center;color:#777}.spmt-tabs{display:flex;gap:8px;overflow-x:auto;margin-bottom:14px;padding-bottom:2px}.spmt-tabs button{white-space:nowrap;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.04);color:#a8aab7;padding:9px 13px;font-weight:800}.spmt-tabs button.active{color:white;background:rgba(255,122,24,.16);border-color:rgba(255,122,24,.4)}.spmt-tabs i{display:inline-grid;place-items:center;min-width:18px;height:18px;margin-left:7px;border-radius:99px;background:rgba(255,255,255,.1);font-size:9px;font-style:normal}.spmt-account-list article{align-items:center;gap:18px}.spmt-account-list article>div{min-width:0;display:grid;gap:5px}.spmt-account-list article.unread{border-color:rgba(255,200,87,.35);box-shadow:inset 3px 0 0 var(--accent2)}.spmt-account-list article.level-warn{border-color:rgba(255,209,102,.35)}.spmt-account-list article.level-error,.spmt-account-list article.level-critical{border-color:rgba(255,107,107,.42);box-shadow:inset 3px 0 0 #ff6b6b}.spmt-account-list button{flex:0 0 auto;border:1px solid var(--border);border-radius:11px;background:rgba(255,255,255,.05);color:white;padding:9px 12px}.spmt-account-list p{margin:0;color:#b7b9c4;font-size:12px;line-height:1.5}.spmt-account-list small,.spmt-context-grid small,.spmt-command-grid small{color:#858795;font-size:10px}.spmt-record-kind{color:var(--accent2);font-size:9px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.spmt-source-notice,.spmt-deferred{border:1px solid var(--border);border-radius:17px;background:rgba(255,255,255,.035);padding:14px 16px;margin-bottom:14px;display:flex;gap:12px;align-items:center}.spmt-source-notice span{color:#b7b9c4;font-size:12px}.spmt-deferred{align-items:flex-start;border-color:rgba(255,200,87,.24)}.spmt-deferred>div{display:grid;min-width:170px}.spmt-deferred>div span,.spmt-account-section header span{font-size:9px;color:var(--accent2);font-weight:900;letter-spacing:.15em}.spmt-deferred p{margin:0;color:#b7b9c4;line-height:1.5;font-size:12px;flex:1}.spmt-deferred small{color:#858795}.spmt-account-section{margin-top:18px}.spmt-account-section h2{margin:4px 0 12px}.spmt-context-grid,.spmt-command-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}.spmt-context-grid article,.spmt-command-grid article{border:1px solid var(--border);border-radius:18px;background:var(--panel);padding:16px}.spmt-context-grid article>span{color:var(--accent2);font-size:9px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.spmt-context-grid p,.spmt-command-grid p{color:#b7b9c4;line-height:1.55;font-size:12px}.spmt-command-grid h3{margin:8px 0}.spmt-command-state{font-size:9px;font-weight:900;letter-spacing:.14em}.spmt-command-state.available{color:#5ee6a8}.spmt-command-state.unavailable{color:#ff9b9b}@media(max-width:900px){.spmt-cosmic-header{left:14px;right:14px}.spmt-brand strong{display:none}.spmt-header-status span{display:none}.spmt-rocket-dock{left:10px;right:10px;top:auto;bottom:max(10px,env(safe-area-inset-bottom));width:auto;height:64px;flex-direction:row;align-items:center}.spmt-dock-orbit,.spmt-rocket-dock footer{display:none}.spmt-rocket-dock nav{width:100%;flex-direction:row;justify-content:space-around}.spmt-rocket-dock nav button{flex-direction:column;gap:2px;padding:5px 7px}.spmt-space-main{padding:calc(var(--spmt-shell-top-inset,88px) + 18px) 14px 92px}.spmt-hero{grid-template-columns:1fr}.spmt-app-grid,.spmt-app-grid.wide{grid-template-columns:repeat(2,minmax(0,1fr))}.spmt-operations-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.spmt-deferred{display:grid}}@media(max-width:560px){.spmt-header-status{display:none}.spmt-hero{padding:22px}.spmt-hero h1{font-size:34px}.spmt-app-grid,.spmt-app-grid.wide,.spmt-quick-grid,.spmt-slot-grid{grid-template-columns:1fr}.spmt-rocket-dock nav label{display:none}.spmt-account-list article{align-items:flex-start}.spmt-account-list article>button{margin-left:auto}}`;

// Commlink owns one bounded app panel. Every nested grid permits its message
// area to shrink; only the feed, saved views and dialogs scroll.
const COMMLINK_LAYOUT_CSS = `
.cosmo-page{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;gap:8px;container:commlink / inline-size;color:#e5edf7}
.cosmo-page *{box-sizing:border-box}
.cosmo-page>.spmt-source-notice{flex:none;margin:0;padding:10px 14px}
.cosmo-page .cosmo-commlink{position:relative;flex:1;display:grid;grid-template-columns:260px minmax(0,1fr);min-height:0;min-width:0;overflow:hidden;border:1px solid #ffffff1c;border-radius:20px;background:#0b1220}
.cosmo-page button,.cosmo-page summary{min-height:40px;padding:9px 12px;font:inherit;font-size:14px;line-height:1.4;color:inherit;cursor:pointer;white-space:normal}
.cosmo-page button{border:1px solid #ffffff18;border-radius:10px;background:#ffffff06;box-shadow:none}
.cosmo-page button:hover{background:#ffffff0e}
.cosmo-page button.active,.cosmo-page button[aria-pressed=true]{border-color:color-mix(in srgb,var(--accent2) 28%,transparent);background:color-mix(in srgb,var(--accent2) 10%,#101a28);box-shadow:none;color:#f4f8ff}
.cosmo-page button:disabled{opacity:.45;cursor:default}
.cosmo-page :is(button,summary,textarea,select,input):focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
.cosmo-page .primary{background:color-mix(in srgb,var(--accent2) 75%,#bce7ee);color:#07151e;border:0;font-weight:700;box-shadow:none}
.cosmo-page .cosmo-rail{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;overscroll-behavior:contain;padding:18px 14px;background:#101a28;border-right:1px solid #ffffff12}
.cosmo-page .cosmo-rail>header{display:flex;justify-content:space-between;align-items:center;margin:12px 4px 0;color:#becade;font-size:14px}
.cosmo-page .cosmo-rail>header:first-child{margin-top:0}
.cosmo-page .cosmo-rail>header button{border:0;padding:5px 10px}
.cosmo-page .cosmo-rail nav{display:grid;gap:5px}
.cosmo-page .cosmo-rail nav button{display:flex;gap:10px;align-items:center;text-align:left;width:100%;min-width:0;padding:9px;border-color:transparent;background:transparent}
.cosmo-page .cosmo-rail nav button.active{background:color-mix(in srgb,var(--accent2) 10%,#101a28);border-color:color-mix(in srgb,var(--accent2) 25%,transparent)}
.cosmo-page .cosmo-rail nav button>b{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;background:#ffffff07;color:#afc6d9;border-radius:8px;font-size:14px}
.cosmo-page .cosmo-rail nav button>span{min-width:0;display:grid;gap:3px}
.cosmo-page .cosmo-rail strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.cosmo-page .cosmo-rail small{font-size:12px;color:#94a6bc}
.cosmo-page .cosmo-create{width:100%;text-align:left;color:#a6bbce}
.cosmo-page .cosmo-help{font-size:13px;line-height:1.5;color:#94a6bc;margin:0 4px}
.cosmo-page .cosmo-sidebar-settings{border-top:1px solid #ffffff12;padding-top:8px}
.cosmo-page .cosmo-sidebar-settings summary{font-size:14px;color:#b2c1d3}
.cosmo-page .cosmo-sidebar-settings:not([open])>:not(summary),.cosmo-page .cosmo-sources:not([open])>:not(summary){display:none}
.cosmo-page .cosmo-sources{margin:8px 0;max-height:none;overflow:visible;background:transparent;padding:0;border:0}
.cosmo-page .cosmo-sources nav{padding:4px;max-height:260px;overflow:auto}
.cosmo-page .cosmo-sources nav button{font-size:14px;border:1px solid #ffffff14;min-height:40px}
.cosmo-page .cosmo-sidebar-buttons{display:grid;gap:6px;padding:10px 0}
.cosmo-page .cosmo-search{display:flex;gap:6px;margin-top:8px}
.cosmo-page .cosmo-search input{min-width:0;width:100%;border:1px solid #ffffff20;border-radius:9px;padding:10px;background:#0b1220;color:inherit;font:inherit;font-size:14px}
.cosmo-page .cosmo-rail footer{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:10px}
.cosmo-page .cosmo-rail footer button{flex:1;font-size:13px}
.cosmo-page .cosmo-workspace{min-height:0;min-width:0;display:grid;grid-template-rows:auto minmax(0,1fr)}
.cosmo-page .cosmo-topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:20px 24px;border-bottom:1px solid #ffffff12;background:#0e1825}
.cosmo-page .cosmo-topbar h1{margin:4px 0 0;font-size:22px;font-weight:650;line-height:1.3;overflow-wrap:anywhere}
.cosmo-page .cosmo-topbar span{font-size:12px;letter-spacing:.08em;color:#93a8bd}
.cosmo-page .cosmo-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cosmo-page .cosmo-focus{min-height:0;min-width:0;overflow:hidden}
.cosmo-page .cosmo-feed-pane{height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto;min-height:0;min-width:0}
.cosmo-page .cosmo-feed{min-height:0;max-height:none;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:20px;display:flex;flex-direction:column;gap:8px}
.cosmo-page .cosmo-message{display:flex;gap:12px;flex:none;min-width:0;padding:14px 10px;border:0;border-bottom:1px solid #ffffff0c;background:transparent;border-radius:0;cursor:default}
.cosmo-page .cosmo-message[data-open-conversation]{cursor:pointer}
.cosmo-page .cosmo-message.signal{border:1px solid var(--accent2);border-radius:12px}
.cosmo-page .cosmo-message>div{min-width:0;flex:1}
.cosmo-page .cosmo-message header{display:flex;align-items:baseline;flex-wrap:wrap;gap:7px}
.cosmo-page .cosmo-message header strong{font-size:15px;font-weight:650}
.cosmo-page .cosmo-message header b{font-size:12px;font-weight:400;color:#9eafc4}
.cosmo-page .cosmo-message header small{margin-left:auto;font-size:12px;color:#8598ae}
.cosmo-page .cosmo-message p{font-size:16px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0;color:#dce6f3}
.cosmo-page .cosmo-message footer{font-size:12px;color:#8598ae}
.cosmo-page .cosmo-message-avatar{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border-radius:10px;background:#213346;color:#bdcfdf;font-size:12px;font-weight:650}
.cosmo-page .compact .cosmo-message{padding:7px 8px}
.cosmo-page .cosmo-empty{margin:auto;text-align:center;max-width:390px;padding:24px;color:#92a6bc;font-size:16px;line-height:1.5}
.cosmo-page .cosmo-empty h2{color:#e5edf7;font-size:21px;font-weight:600}
.cosmo-page .cosmo-composer{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:14px 20px;background:#0e1825;border-top:1px solid #ffffff12}
.cosmo-page .cosmo-composer label{display:flex;align-items:center;gap:10px;font-size:14px;color:#a2b4c8}
.cosmo-page .cosmo-composer select{flex:1;min-width:0;border:1px solid #ffffff1a;border-radius:9px;padding:9px;background:#0b1220;color:#e5edf7;font-size:14px}
.cosmo-page .cosmo-message-input{display:flex;align-items:stretch;gap:8px;min-width:0}
.cosmo-page .cosmo-composer textarea{width:100%;min-width:0;min-height:52px;max-height:150px;resize:vertical;border:1px solid #ffffff20;border-radius:12px;background:#0b1220;color:#e5edf7;padding:12px;font:inherit;font-size:16px}
.cosmo-page [role=status]{margin:0;color:#c8d8e6;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.cosmo-page [role=status]:empty{display:none}
.cosmo-page .cosmo-desk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));grid-auto-rows:minmax(280px,1fr);gap:14px;min-height:0;overflow:auto;padding:18px}
.cosmo-page .cosmo-desk-panel{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);background:#0e1825;border:1px solid #ffffff18;border-radius:14px;overflow:hidden}
.cosmo-page .cosmo-desk-panel>header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #ffffff12}
.cosmo-page .cosmo-desk-panel>div{overflow:auto;min-height:0;padding:8px}
.cosmo-page .cosmo-panel-empty{padding:24px;color:#92a6bc;text-align:center}
.cosmo-page .cosmo-mail-dialog{max-height:90dvh;overflow:auto;padding:20px;background:#101a28;color:#e5edf7}
.cosmo-page .cosmo-mail-dialog label,.cosmo-page .cosmo-mail-dialog input,.cosmo-page .cosmo-mail-dialog select,.cosmo-page .cosmo-mail-dialog textarea{font-size:16px}
.cosmo-page .cosmo-mail-dialog footer{flex-wrap:wrap}
.cosmo-page .cosmo-mobile-views,.cosmo-page .cosmo-sidebar-backdrop{display:none}
@container commlink (max-width:720px){
 .cosmo-page .cosmo-commlink{grid-template-columns:minmax(0,1fr)}
 .cosmo-page .cosmo-rail{display:none}
 .cosmo-page.views-open .cosmo-rail{position:absolute;inset:0 auto 0 0;z-index:8;width:min(310px,calc(100% - 40px));display:flex;box-shadow:15px 0 40px #0007}
 .cosmo-page.views-open .cosmo-sidebar-backdrop{display:block;position:absolute;inset:0;width:100%;height:100%;z-index:7;border:0;border-radius:0;background:#0007}
 .cosmo-page .cosmo-mobile-views{display:block}
 .cosmo-page .cosmo-topbar{padding:14px}
 .cosmo-page .cosmo-topbar h1{font-size:20px}
 .cosmo-page .cosmo-feed{padding:12px}
 .cosmo-page .cosmo-composer{padding:12px}
}
`;
