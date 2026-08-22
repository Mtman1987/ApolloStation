import { applyShellLayoutMetrics, observeShellLayout } from "@spmt/embed";
import type { SpaceMountainAppCardV1, SpaceMountainShellSnapshotV1 } from "./index.js";

export type SpaceMountainViewV1 = "home" | "apps" | "inbox" | "workspace" | "settings" | "help";

export interface SpaceMountainUiOptions {
  root: HTMLElement;
  snapshot: SpaceMountainShellSnapshotV1;
  onNavigate?: (view: SpaceMountainViewV1) => void;
  onLaunchApp?: (app: SpaceMountainAppCardV1) => void;
  onInstallApp?: (app: SpaceMountainAppCardV1) => void;
}

const NAV: Array<{ id: SpaceMountainViewV1; label: string; glyph: string }> = [
  { id: "home", label: "Home", glyph: "⌂" },
  { id: "apps", label: "Shipyard", glyph: "◇" },
  { id: "inbox", label: "Commlink", glyph: "✉" },
  { id: "workspace", label: "Workspace", glyph: "▦" },
  { id: "settings", label: "Settings", glyph: "⚙" },
  { id: "help", label: "Help", glyph: "?" },
];

export class SpaceMountainShellUi {
  private readonly root: HTMLElement;
  private snapshot: SpaceMountainShellSnapshotV1;
  private view: SpaceMountainViewV1 = "home";
  private stopLayout?: () => void;
  private readonly options: SpaceMountainUiOptions;

  constructor(options: SpaceMountainUiOptions) {
    this.options = options;
    this.root = options.root;
    this.snapshot = options.snapshot;
  }

  mount() {
    this.root.classList.add("spmt-space-root");
    this.render();
    this.bindLayout();
    return this;
  }

  update(snapshot: SpaceMountainShellSnapshotV1) {
    this.snapshot = snapshot;
    this.render();
    this.bindLayout();
  }

  destroy() {
    this.stopLayout?.();
    this.stopLayout = undefined;
    this.root.replaceChildren();
  }

  private bindLayout() {
    this.stopLayout?.();
    const header = this.root.querySelector<HTMLElement>("[data-spmt-shell-header]");
    if (!header) return;
    this.stopLayout = observeShellLayout({
      header,
      onChange: (layout) => applyShellLayoutMetrics(this.root, "shell", layout),
    });
  }

  private setView(view: SpaceMountainViewV1) {
    this.view = view;
    this.options.onNavigate?.(view);
    this.render();
    this.bindLayout();
  }

  private render() {
    const shell = document.createElement("div");
    shell.className = "spmt-space-shell";
    shell.innerHTML = `${styleTag()}${this.headerHtml()}${this.dockHtml()}<main class="spmt-space-main" data-spmt-main>${this.bodyHtml()}</main>`;
    this.root.replaceChildren(shell);
    this.bindEvents();
  }

  private bindEvents() {
    this.root.querySelectorAll<HTMLElement>("[data-nav]").forEach((node) => {
      node.addEventListener("click", () => this.setView(node.dataset.nav as SpaceMountainViewV1));
    });
    this.root.querySelectorAll<HTMLElement>("[data-launch-app]").forEach((node) => {
      node.addEventListener("click", () => {
        const app = this.snapshot.apps.find((item) => item.appId === node.dataset.launchApp);
        if (app) this.options.onLaunchApp?.(app);
      });
    });
    this.root.querySelectorAll<HTMLElement>("[data-install-app]").forEach((node) => {
      node.addEventListener("click", () => {
        const app = this.snapshot.apps.find((item) => item.appId === node.dataset.installApp);
        if (app) this.options.onInstallApp?.(app);
      });
    });
  }

  private headerHtml() {
    const unread = this.snapshot.notifications.filter((item) => !item.readAt && !item.read_at).length;
    const xp = this.snapshot.xp?.balance ?? 0;
    const user = recordText(this.snapshot.session, ["displayName", "display_name", "username"]) ?? "Captain";
    return `<header class="spmt-cosmic-header" data-spmt-shell-header>
      <button class="spmt-brand" data-nav="home" aria-label="SpaceMountain home"><span class="spmt-brand-mark">▲</span><span>SPACEMOUNTAIN<em>.LIVE</em></span></button>
      <div class="spmt-header-status"><span class="spmt-state spmt-state-${this.snapshot.state}">${escapeHtml(this.snapshot.state)}</span><span>${xp.toLocaleString()} XP</span></div>
      <div class="spmt-header-actions"><button data-nav="inbox" class="spmt-icon-button" aria-label="Commlink">✉${unread ? `<b>${Math.min(unread, 9)}${unread > 9 ? "+" : ""}</b>` : ""}</button><button data-nav="settings" class="spmt-account">${escapeHtml(user)}</button></div>
    </header>`;
  }

  private dockHtml() {
    return `<aside class="spmt-rocket-dock" data-spmt-dock aria-label="SpaceMountain navigation">
      <div class="spmt-dock-orbit"><span>▲</span></div>
      <nav>${NAV.map((item) => `<button data-nav="${item.id}" class="${this.view === item.id ? "active" : ""}"><span>${item.glyph}</span><label>${item.label}</label></button>`).join("")}</nav>
      <div class="spmt-dock-footer"><small>SPMT</small><strong>${this.snapshot.state.toUpperCase()}</strong></div>
    </aside>`;
  }

  private bodyHtml() {
    switch (this.view) {
      case "apps": return this.shipyardHtml();
      case "inbox": return this.commlinkHtml();
      case "workspace": return this.workspaceHtml();
      case "settings": return panel("Settings", "Canonical theme, background, dock slots, and app mappings live in the SPMT workspace profile.");
      case "help": return panel("Help", "Developer docs, capability explorer, and diagnostics will plug into this shell without creating a second data path.");
      default: return this.homeHtml();
    }
  }

  private homeHtml() {
    const installed = this.snapshot.apps.filter((app) => app.installed && app.enabled);
    const unread = this.snapshot.notifications.filter((item) => !item.readAt && !item.read_at).length;
    const dockSlots = workspaceDockSlots(this.snapshot.workspace);
    return `<section class="spmt-hero">
      <div class="spmt-hero-copy"><span class="spmt-kicker">THE UNIVERSE ONLINE</span><h1>One station for your creator ecosystem.</h1><p>Launch apps, check Commlink, and continue the same portable workspace from one canonical SPMT identity.</p><div class="spmt-hero-actions"><button data-nav="apps" class="primary">Open Shipyard</button><button data-nav="inbox">Open Commlink</button></div></div>
      <div class="spmt-metrics">${metric("Apps ready", `${installed.length}/${this.snapshot.apps.length}`)}${metric("Unread", String(unread))}${metric("Dock slots", `${dockSlots.filter(Boolean).length}/3`)}${metric("Runtime", this.snapshot.state)}</div>
    </section>
    <section class="spmt-section"><div class="spmt-section-head"><div><span>YOUR APP SUITE</span><h2>Launch what you use most</h2></div><button data-nav="apps">View all</button></div><div class="spmt-app-grid">${installed.slice(0, 4).map((app) => appCard(app, true)).join("") || emptyState("Installed apps will appear here after Shipyard loads.")}</div></section>
    <section class="spmt-quick-grid">${quick("Shipyard", "Install, launch, and manage ecosystem apps.", "apps")}${quick("Commlink", "Shared mail, notifications, and app events.", "inbox")}${quick("Workspace", "Three canonical dock slots and overlays.", "workspace")}</section>`;
  }

  private shipyardHtml() {
    return `<section class="spmt-page-title"><span>SHIPYARD</span><h1>Apps and capabilities</h1><p>Registry, install state, granted scopes, and entitlements come directly from SPMT.</p></section><div class="spmt-app-grid spmt-app-grid-wide">${this.snapshot.apps.map((app) => appCard(app, false)).join("") || emptyState("No registered apps are available yet.")}</div>`;
  }

  private commlinkHtml() {
    const conversations = this.snapshot.conversations.slice(0, 12);
    return `<section class="spmt-page-title"><span>COMMLINK</span><h1>Shared account communications</h1><p>Mail, notifications, and app events are canonical SPMT data. Live chat remains a separate StreamWeaver-owned runtime source.</p></section><div class="spmt-list">${conversations.map((item) => `<article><strong>${escapeHtml(recordText(item, ["title", "kind"]) ?? "Conversation")}</strong><span>${escapeHtml(recordText(item, ["kind"]) ?? "message")}</span></article>`).join("") || emptyState("No conversations yet.")}</div>`;
  }

  private workspaceHtml() {
    const slots = workspaceDockSlots(this.snapshot.workspace);
    return `<section class="spmt-page-title"><span>WORKSPACE</span><h1>Portable station layout</h1><p>One workspace profile. Three persistent dock slots. No per-app copies.</p></section><div class="spmt-slot-grid">${slots.map((slot, index) => `<article><span>SLOT ${index + 1}</span><strong>${escapeHtml(slot ?? "Empty")}</strong></article>`).join("")}</div>`;
  }
}

function appCard(app: SpaceMountainAppCardV1, compact: boolean) {
  const action = app.installed && app.enabled
    ? `<button class="primary" data-launch-app="${escapeAttr(app.appId)}">Launch</button>`
    : `<button data-install-app="${escapeAttr(app.appId)}">Install</button>`;
  return `<article class="spmt-app-card ${compact ? "compact" : ""}"><div class="spmt-app-icon">${escapeHtml(app.name.slice(0, 2).toUpperCase())}</div><div><span>${app.installed ? (app.enabled ? "INSTALLED" : "DISABLED") : "AVAILABLE"}</span><h3>${escapeHtml(app.name)}</h3><p>${escapeHtml(app.description || "SpaceMountain ecosystem application")}</p></div><footer>${action}<small>${escapeHtml(app.version || "unversioned")}</small></footer></article>`;
}

function styleTag() {
  return `<style data-spmt-space-style>${SPACE_MOUNTAIN_CSS}</style>`;
}

function metric(label: string, value: string) { return `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`; }
function quick(title: string, body: string, nav: SpaceMountainViewV1) { return `<button data-nav="${nav}"><strong>${title}</strong><span>${body}</span></button>`; }
function panel(title: string, body: string) { return `<section class="spmt-page-title"><span>SPACEMOUNTAIN</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></section>`; }
function emptyState(message: string) { return `<div class="spmt-empty">${escapeHtml(message)}</div>`; }
function recordText(value: unknown, keys: string[]) { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const record = value as Record<string, unknown>; for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string; return undefined; }
function workspaceDockSlots(value: unknown): Array<string | null> { if (!value || typeof value !== "object" || Array.isArray(value)) return [null, null, null]; const raw = (value as Record<string, unknown>).dockSlots; if (!Array.isArray(raw)) return [null, null, null]; return [0, 1, 2].map((index) => typeof raw[index] === "string" ? raw[index] as string : null); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }
function escapeAttr(value: string) { return escapeHtml(value); }

export const SPACE_MOUNTAIN_CSS = `
.spmt-space-root{--space-accent:#ff7a18;--space-accent-2:#ffc857;--space-bg:#050710;--space-panel:rgba(9,12,25,.76);--space-border:rgba(255,255,255,.10);min-height:100dvh;background:radial-gradient(circle at 15% 10%,rgba(255,122,24,.14),transparent 26%),radial-gradient(circle at 80% 0,rgba(87,54,201,.16),transparent 28%),#050710;color:#f7f7fb;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.spmt-space-shell{min-height:100dvh}.spmt-cosmic-header{position:fixed;top:max(12px,env(safe-area-inset-top));left:clamp(88px,10vw,164px);right:18px;z-index:300;min-height:64px;padding:10px 16px;border:1px solid var(--space-border);border-radius:20px;background:rgba(5,7,16,.76);backdrop-filter:blur(22px);display:flex;align-items:center;gap:14px;box-shadow:0 14px 40px rgba(0,0,0,.35)}.spmt-brand,.spmt-header-actions button,.spmt-header-actions .spmt-account{border:0;background:none;color:inherit}.spmt-brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.12em;font-size:12px}.spmt-brand em{font-style:normal;color:var(--space-accent)}.spmt-brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:13px;background:linear-gradient(145deg,var(--space-accent),#e24718);box-shadow:0 0 22px rgba(255,122,24,.35);color:#090909}.spmt-header-status{margin-left:auto;display:flex;gap:10px;align-items:center;font-size:11px;color:#a6a8b4}.spmt-state{border:1px solid var(--space-border);border-radius:999px;padding:5px 8px;text-transform:uppercase;font-weight:800;letter-spacing:.08em}.spmt-state-ready{color:#5ee6a8}.spmt-state-degraded{color:#ffd166}.spmt-state-unavailable{color:#ff6b6b}.spmt-header-actions{display:flex;gap:8px}.spmt-icon-button,.spmt-account{position:relative;border:1px solid var(--space-border)!important;border-radius:12px!important;background:rgba(255,255,255,.04)!important;padding:9px 11px!important}.spmt-icon-button b{position:absolute;right:-5px;top:-7px;background:#ffc857;color:#111;border-radius:999px;font-size:9px;min-width:17px;height:17px;display:grid;place-items:center}.spmt-rocket-dock{position:fixed;left:16px;top:calc(var(--spmt-shell-top-inset,92px) + 8px);bottom:max(16px,env(safe-area-inset-bottom));z-index:100;width:108px;border:1px solid var(--space-border);border-radius:26px;background:rgba(7,9,19,.78);backdrop-filter:blur(20px);padding:10px;display:flex;flex-direction:column;gap:10px;box-shadow:0 18px 48px rgba(0,0,0,.35)}.spmt-dock-orbit{height:72px;border:1px solid rgba(255,122,24,.24);border-radius:22px;display:grid;place-items:center;background:radial-gradient(circle,rgba(255,122,24,.18),transparent 64%);color:var(--space-accent);font-size:28px}.spmt-rocket-dock nav{display:flex;flex-direction:column;gap:4px}.spmt-rocket-dock nav button{border:1px solid transparent;background:transparent;color:#9799a8;border-radius:14px;padding:9px 7px;display:flex;align-items:center;gap:8px;text-align:left}.spmt-rocket-dock nav button label{font-size:10px;font-weight:750}.spmt-rocket-dock nav button.active{color:white;border-color:rgba(255,122,24,.28);background:linear-gradient(90deg,rgba(255,122,24,.20),rgba(255,122,24,.04))}.spmt-dock-footer{margin-top:auto;border-top:1px solid var(--space-border);padding-top:10px;display:flex;flex-direction:column}.spmt-dock-footer small{font-size:8px;letter-spacing:.12em;color:#777a88}.spmt-dock-footer strong{font-size:9px;color:#5ee6a8}.spmt-space-main{padding:calc(var(--spmt-shell-top-inset,92px) + 26px) 24px 48px 148px;min-height:var(--spmt-shell-available-height,calc(100dvh - 110px));box-sizing:border-box}.spmt-hero{border:1px solid var(--space-border);border-radius:28px;background:linear-gradient(135deg,rgba(11,14,28,.88),rgba(4,6,14,.72));padding:clamp(24px,4vw,46px);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:28px;overflow:hidden;box-shadow:0 22px 65px rgba(0,0,0,.30)}.spmt-kicker,.spmt-page-title>span,.spmt-section-head>div>span,.spmt-app-card>div>span,.spmt-slot-grid span{font-size:10px;letter-spacing:.18em;font-weight:900;color:var(--space-accent-2)}.spmt-hero h1,.spmt-page-title h1{font-size:clamp(34px,5vw,62px);line-height:1.03;margin:12px 0;color:white}.spmt-hero p,.spmt-page-title p{max-width:680px;color:#b7b9c4;line-height:1.65}.spmt-hero-actions{display:flex;gap:10px;margin-top:24px}.spmt-hero button,.spmt-section button,.spmt-app-card button{border:1px solid var(--space-border);border-radius:12px;background:rgba(255,255,255,.05);color:white;padding:10px 14px;font-weight:800}.spmt-hero button.primary,.spmt-app-card button.primary{background:linear-gradient(135deg,var(--space-accent-2),var(--space-accent));color:#15100a;border-color:transparent}.spmt-metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px}.spmt-metrics>div{min-height:92px;border:1px solid var(--space-border);border-radius:18px;background:rgba(0,0,0,.25);padding:15px;display:flex;flex-direction:column;justify-content:flex-end}.spmt-metrics strong{font-size:26px}.spmt-metrics span{font-size:10px;color:#858795;text-transform:uppercase;letter-spacing:.08em}.spmt-section{margin-top:18px;border:1px solid var(--space-border);border-radius:24px;background:var(--space-panel);padding:22px}.spmt-section-head{display:flex;justify-content:space-between;gap:20px;align-items:end}.spmt-section-head h2{margin:4px 0 0}.spmt-app-grid{margin-top:18px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.spmt-app-grid-wide{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:24px}.spmt-app-card{border:1px solid var(--space-border);border-radius:20px;background:rgba(4,6,14,.58);padding:16px;min-width:0}.spmt-app-icon{width:48px;height:48px;border-radius:14px;background:linear-gradient(145deg,rgba(255,122,24,.22),rgba(87,54,201,.22));display:grid;place-items:center;font-weight:900;color:white;margin-bottom:14px}.spmt-app-card h3{margin:5px 0 4px}.spmt-app-card p{font-size:12px;line-height:1.5;color:#9497a6;min-height:36px}.spmt-app-card footer{display:flex;align-items:center;justify-content:space-between;margin-top:14px}.spmt-app-card footer small{color:#737685}.spmt-quick-grid,.spmt-slot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.spmt-quick-grid button,.spmt-slot-grid article{border:1px solid var(--space-border);border-radius:20px;background:rgba(7,9,19,.74);padding:18px;color:white;text-align:left}.spmt-quick-grid span{display:block;color:#9598a7;font-size:12px;line-height:1.5;margin-top:7px}.spmt-page-title{padding:10px 2px 20px}.spmt-page-title h1{font-size:clamp(32px,4vw,48px)}.spmt-list{display:grid;gap:10px}.spmt-list article{border:1px solid var(--space-border);border-radius:16px;background:var(--space-panel);padding:15px;display:flex;justify-content:space-between}.spmt-list span{color:#858795}.spmt-empty{grid-column:1/-1;border:1px dashed var(--space-border);border-radius:18px;padding:28px;text-align:center;color:#777a88}@media(max-width:900px){.spmt-cosmic-header{left:14px;right:14px}.spmt-brand>span:last-child{display:none}.spmt-header-status span:last-child{display:none}.spmt-rocket-dock{left:10px;right:10px;top:auto;bottom:max(10px,env(safe-area-inset-bottom));width:auto;height:64px;flex-direction:row;align-items:center;border-radius:20px;padding:7px 10px}.spmt-dock-orbit,.spmt-dock-footer{display:none}.spmt-rocket-dock nav{width:100%;flex-direction:row;justify-content:space-around}.spmt-rocket-dock nav button{flex-direction:column;gap:2px;padding:5px 7px}.spmt-rocket-dock nav button label{font-size:8px}.spmt-space-main{padding:calc(var(--spmt-shell-top-inset,88px) + 18px) 14px 92px}.spmt-hero{grid-template-columns:1fr}.spmt-app-grid,.spmt-app-grid-wide{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.spmt-account{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.spmt-header-status{display:none}.spmt-hero{padding:22px}.spmt-hero h1{font-size:34px}.spmt-metrics{grid-template-columns:1fr 1fr}.spmt-app-grid,.spmt-app-grid-wide,.spmt-quick-grid,.spmt-slot-grid{grid-template-columns:1fr}.spmt-rocket-dock nav button label{display:none}}
`;
