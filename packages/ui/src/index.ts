import type { SurfaceModeV1 } from "@spmt/contracts";
import { LAYER, SHELL_LAYOUT_VARS } from "@spmt/embed";

export type PortalKindV1 = "floating" | "modal" | "toast" | "emergency";

export type ProductThemeIdV1 = "solar-flare" | "nebula-purple" | "oceanic-blue" | "aurora-green";

export interface ProductThemeV1 {
  id: ProductThemeIdV1;
  name: string;
  accent: string;
  accentSecondary: string;
}

export const PRODUCT_THEME_PRESETS: Readonly<Record<ProductThemeIdV1, ProductThemeV1>> = Object.freeze({
  "solar-flare": Object.freeze({ id: "solar-flare", name: "Solar", accent: "#f97316", accentSecondary: "#38bdf8" }),
  "nebula-purple": Object.freeze({ id: "nebula-purple", name: "Nebula", accent: "#a855f7", accentSecondary: "#2dd4bf" }),
  "oceanic-blue": Object.freeze({ id: "oceanic-blue", name: "Oceanic", accent: "#3b82f6", accentSecondary: "#f59e0b" }),
  "aurora-green": Object.freeze({ id: "aurora-green", name: "Aurora", accent: "#10b981", accentSecondary: "#fbbf24" }),
});

export function resolveProductTheme(theme: unknown, customAccent?: unknown, customSecondary?: unknown): ProductThemeV1 {
  const key = typeof theme === "string" && theme in PRODUCT_THEME_PRESETS ? theme as ProductThemeIdV1 : "solar-flare";
  const preset = PRODUCT_THEME_PRESETS[key];
  const accent = typeof customAccent === "string" && /^#[0-9a-f]{6}$/i.test(customAccent) ? customAccent : preset.accent;
  const accentSecondary = typeof customSecondary === "string" && /^#[0-9a-f]{6}$/i.test(customSecondary) ? customSecondary : preset.accentSecondary;
  return accent === preset.accent && accentSecondary === preset.accentSecondary ? preset : { ...preset, accent, accentSecondary };
}

export interface ProductSceneV1 {
  appId: string;
  imageUrl: string;
  imagePosition?: string;
}

export interface ProductBackdropV1 {
  scene: ProductSceneV1;
  theme: ProductThemeV1;
  imageUrl: string;
  customImage: boolean;
}

export interface ProductNavigationItemV1<Id extends string = string> {
  id: Id;
  label: string;
}

export function isProductImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function resolveProductBackdrop(scene: ProductSceneV1, theme: unknown, customAccent?: unknown, customImageUrl?: unknown, customSecondary?: unknown): ProductBackdropV1 {
  if (!scene.appId.trim()) throw new Error("A product scene requires an appId");
  if (!isProductImageUrl(scene.imageUrl)) throw new Error("A product scene requires a root-relative or HTTPS image URL");
  const override = isProductImageUrl(customImageUrl) ? customImageUrl : undefined;
  return { scene, theme: resolveProductTheme(theme, customAccent, customSecondary), imageUrl: override ?? scene.imageUrl, customImage: Boolean(override) };
}

export function installProductBackdrop(root: HTMLElement, backdrop: ProductBackdropV1) {
  root.dataset.spmtApp = backdrop.scene.appId;
  root.dataset.spmtTheme = backdrop.theme.id;
  root.dataset.spmtCustomBackdrop = backdrop.customImage ? "true" : "false";
  root.style.setProperty("--spmt-accent", backdrop.theme.accent);
  root.style.setProperty("--spmt-accent-secondary", backdrop.theme.accentSecondary);
  root.style.setProperty("--spmt-app-backdrop-image", `url(${JSON.stringify(backdrop.imageUrl)})`);
  root.style.setProperty("--spmt-app-backdrop-position", backdrop.scene.imagePosition ?? "center");

  const existing = root.querySelector<HTMLElement>(":scope > .spmt-product-backdrop");
  if (existing) {
    const image = existing.querySelector<HTMLElement>(".spmt-product-backdrop-image");
    if (image) {
      image.style.backgroundImage = `url(${JSON.stringify(backdrop.imageUrl)})`;
      image.style.backgroundPosition = backdrop.scene.imagePosition ?? "center";
    }
    return existing;
  }
  const layer = root.ownerDocument.createElement("div");
  layer.className = "spmt-product-backdrop";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = '<span class="spmt-product-backdrop-image"></span><span class="spmt-product-backdrop-tint"></span><span class="spmt-product-backdrop-shade"></span><span class="spmt-star-layer"><i></i><i></i><i></i></span>';
  root.prepend(layer);
  const image = layer.querySelector<HTMLElement>(".spmt-product-backdrop-image");
  if (image) {
    image.style.backgroundImage = `url(${JSON.stringify(backdrop.imageUrl)})`;
    image.style.backgroundPosition = backdrop.scene.imagePosition ?? "center";
  }
  return layer;
}

export function bindProductRocketNavigation<Id extends string>(root: HTMLElement, items: ReadonlyArray<ProductNavigationItemV1<Id>>, activeId: Id, onNavigate: (id: Id) => void) {
  const allowed = new Set(items.map((item) => item.id));
  const listeners: Array<() => void> = [];
  root.querySelectorAll<HTMLButtonElement>("[data-spmt-product-nav]").forEach((button) => {
    const id = button.dataset.spmtProductNav as Id | undefined;
    if (!id || !allowed.has(id)) return;
    if (id === activeId) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    const navigate = () => onNavigate(id);
    button.addEventListener("click", navigate);
    listeners.push(() => button.removeEventListener("click", navigate));
  });
  return () => listeners.forEach((remove) => remove());
}

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return value / 4_294_967_296;
  };
}

function seededStarShadow(count: number, seed: number, width = 2_000, height = 2_000) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, index) => {
    const colorSlot = index % 20;
    const color = colorSlot < 15 ? "rgba(255,255,255,.94)" : colorSlot < 18 ? "var(--spmt-accent-secondary)" : "var(--spmt-accent)";
    return `${Math.floor(random() * width)}px ${Math.floor(random() * height)}px ${color}`;
  }).join(",");
}

/** The exact deterministic star distribution used by the live Nebula Arcade tag game shell. */
export const PRODUCT_STAR_FIELDS = Object.freeze([
  Object.freeze({ size: 1, count: 700, seed: 11, durationSeconds: 200, shadow: seededStarShadow(700, 11) }),
  Object.freeze({ size: 2, count: 200, seed: 23, durationSeconds: 150, shadow: seededStarShadow(200, 23) }),
  Object.freeze({ size: 3, count: 100, seed: 37, durationSeconds: 100, shadow: seededStarShadow(100, 37) }),
]);

export const PRODUCT_UI_CSS = `
.spmt-product-surface {
  --spmt-accent: #f97316;
  --spmt-accent-secondary: #38bdf8;
  --spmt-ink: #f8fafc;
  --spmt-muted: #a8adbb;
  --spmt-glass-opacity: .76;
  --spmt-depth-1-alpha: calc(var(--spmt-glass-opacity,.76) * .9);
  --spmt-depth-2-alpha: calc(var(--spmt-glass-opacity,.76) * .68);
  --spmt-depth-3-alpha: calc(var(--spmt-glass-opacity,.76) * .48);
  --spmt-depth-4-alpha: calc(var(--spmt-glass-opacity,.76) * .32);
  --spmt-surface-depth-1: color-mix(in srgb,var(--spmt-accent) 4%,rgb(8 10 17 / var(--spmt-depth-1-alpha)));
  --spmt-surface-depth-2: color-mix(in srgb,var(--spmt-accent) 4%,rgb(8 10 17 / var(--spmt-depth-2-alpha)));
  --spmt-surface-depth-3: color-mix(in srgb,var(--spmt-accent) 4%,rgb(8 10 17 / var(--spmt-depth-3-alpha)));
  --spmt-surface-depth-4: color-mix(in srgb,var(--spmt-accent) 4%,rgb(8 10 17 / var(--spmt-depth-4-alpha)));
  --spmt-panel: var(--spmt-surface-depth-1);
  --spmt-panel-strong: color-mix(in srgb,var(--spmt-accent) 6%,rgb(8 10 17 / min(.94,calc(var(--spmt-glass-opacity,.76) * .98))));
  --spmt-border: rgba(255,255,255,.11);
  --spmt-shadow: -12px 18px 60px color-mix(in srgb,var(--spmt-accent) 11%,transparent),12px 22px 72px color-mix(in srgb,var(--spmt-accent-secondary) 9%,rgba(0,0,0,.42));
  --spmt-layer-base: 0;
  --spmt-layer-sticky: 100;
  --spmt-layer-popover: 700;
  --spmt-layer-shell: 800;
  --spmt-layer-modal: 900;
  --spmt-layer-toast: 950;
  --spmt-layer-blocking: 1000;
  color: var(--spmt-ink);
  position: relative;
  isolation: isolate;
  background: #050710;
  font-family: Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing: antialiased;
}
.spmt-product-backdrop { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; background: #050710; }
.spmt-product-backdrop-image,.spmt-product-backdrop-tint,.spmt-product-backdrop-shade,.spmt-star-layer { position: absolute; inset: 0; }
.spmt-product-backdrop-image { inset: -2%; background-image: var(--spmt-app-backdrop-image); background-position: var(--spmt-app-backdrop-position,center); background-size: cover; filter: grayscale(1) saturate(0) contrast(1.08) brightness(.84); transform: scale(1.025); }
.spmt-product-backdrop-tint { background: var(--spmt-accent); opacity: .56; mix-blend-mode: color; }
.spmt-product-backdrop-shade { background: radial-gradient(circle at 18% 4%,color-mix(in srgb,var(--spmt-accent) 24%,transparent),transparent 42%),radial-gradient(circle at 84% 18%,color-mix(in srgb,var(--spmt-accent-secondary) 12%,transparent),transparent 34%),linear-gradient(rgba(3,4,8,.14),rgba(3,4,8,.58)); }
.spmt-star-layer { overflow: hidden; opacity: var(--spmt-stars,.82); }
.spmt-star-layer i { position: absolute; left: 0; top: 0; display: block; background: transparent; will-change: transform; }
.spmt-star-layer i:nth-child(1) { width: 1px; height: 1px; box-shadow: ${PRODUCT_STAR_FIELDS[0]!.shadow}; animation: spmt-stars-up 200s linear infinite; }
.spmt-star-layer i:nth-child(2) { width: 2px; height: 2px; box-shadow: ${PRODUCT_STAR_FIELDS[1]!.shadow}; animation: spmt-stars-up 150s linear infinite; }
.spmt-star-layer i:nth-child(3) { width: 3px; height: 3px; box-shadow: ${PRODUCT_STAR_FIELDS[2]!.shadow}; animation: spmt-stars-up 100s linear infinite; }
@keyframes spmt-stars-up { from { transform: translateY(0); } to { transform: translateY(-2000px); } }
.spmt-product-surface button,.spmt-product-surface input,.spmt-product-surface select,.spmt-product-surface textarea { font: inherit; }
.spmt-product-surface button { cursor: pointer; }
.spmt-product-surface :focus-visible { outline: 2px solid var(--spmt-accent-secondary); outline-offset: 3px; }
.spmt-product-glass { border: 1px solid var(--spmt-border); background: var(--spmt-surface-depth-1); box-shadow: var(--spmt-shadow); backdrop-filter: blur(24px) saturate(135%); }
.spmt-surface-depth-0,.spmt-product-glass[data-spmt-depth="0"] { border-color: transparent; background: transparent; box-shadow: none; backdrop-filter: none; }
.spmt-surface-depth-1,.spmt-product-glass[data-spmt-depth="1"] { background: var(--spmt-surface-depth-1); }
.spmt-surface-depth-2,.spmt-product-glass[data-spmt-depth="2"] { background: var(--spmt-surface-depth-2); box-shadow: 0 16px 50px rgba(0,0,0,.24),0 0 34px color-mix(in srgb,var(--spmt-accent-secondary) 7%,transparent); }
.spmt-surface-depth-3,.spmt-product-glass[data-spmt-depth="3"] { background: var(--spmt-surface-depth-3); box-shadow: 0 10px 34px rgba(0,0,0,.18),0 0 24px color-mix(in srgb,var(--spmt-accent) 6%,transparent); }
.spmt-surface-depth-4,.spmt-product-glass[data-spmt-depth="4"] { background: var(--spmt-surface-depth-4); box-shadow: none; }
.spmt-product-kicker { color: var(--spmt-accent-secondary); font-size: 10px; font-weight: 900; letter-spacing: .19em; text-transform: uppercase; }
.spmt-product-status { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--spmt-border); border-radius: 999px; padding: 5px 9px; font-size: 9px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.spmt-product-status::before { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 14px currentColor; content: ""; }
.spmt-rocket-dock [data-spmt-product-nav] { touch-action: manipulation; }
.spmt-rocket-dock [data-spmt-product-nav][aria-current="page"] { color: var(--spmt-ink); border-color: color-mix(in srgb,var(--spmt-accent) 34%,transparent); background: color-mix(in srgb,var(--spmt-accent) 14%,transparent); }

/* Shared first-party presentation rules: the same visual grammar must be used by app-owned homes and participant cards. */
.owned[data-app="streamweaver"] .home .hero {
  max-width: 1120px;
  margin: 0 auto;
  border: 1px solid var(--spmt-border);
  border-radius: 26px;
  background: var(--spmt-surface-depth-2);
  box-shadow: 0 18px 54px rgba(0,0,0,.24),0 0 34px color-mix(in srgb,var(--spmt-accent-secondary) 8%,transparent);
  backdrop-filter: none;
}
.owned[data-app="streamweaver"] .home .mark { align-items:center; gap:16px; }
.owned[data-app="streamweaver"] .home .mark img { width:clamp(92px,14vw,150px); height:clamp(92px,14vw,150px); object-fit:contain; }
.owned[data-app="streamweaver"] .home .hero h1 { font-size:clamp(38px,7vw,78px); line-height:.94; letter-spacing:-.045em; }
.owned[data-app="streamweaver"] .home .hero p { max-width:760px; font-size:clamp(14px,2vw,18px); line-height:1.5; }
.owned[data-app="streamweaver"] .home-summary { grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
.owned[data-app="streamweaver"] .home-summary>* { min-height:82px; border:1px solid var(--spmt-border); border-radius:16px; background:var(--spmt-surface-depth-3); }
.owned[data-app="streamweaver"] .actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.owned[data-app="streamweaver"] .actions .button { min-height:48px; }

.spmt-space-root[data-spmt-app="stellar-core"] .spmt-app-page-title,
.spmt-space-root[data-spmt-app="stellar-core"] .spmt-stella-chat,
.spmt-space-root[data-spmt-app="stellar-core"] .spmt-account-section {
  border:1px solid var(--spmt-border);
  border-radius:22px;
  background:var(--spmt-surface-depth-2);
  box-shadow:0 18px 50px rgba(0,0,0,.2),0 0 30px color-mix(in srgb,var(--spmt-accent-secondary) 7%,transparent);
  backdrop-filter:none;
}
.spmt-space-root[data-spmt-app="stellar-core"] .spmt-app-page-title { padding:clamp(18px,3vw,32px); }
.spmt-space-root[data-spmt-app="stellar-core"] .spmt-app-page-title>img { width:clamp(92px,13vw,152px); height:clamp(92px,13vw,152px); }
.spmt-space-root[data-spmt-app="stellar-core"] .spmt-stella-chat,
.spmt-space-root[data-spmt-app="stellar-core"] .spmt-account-section { padding:clamp(16px,2vw,24px); }
.spmt-space-root[data-spmt-app="stellar-core"] .spmt-stella-chat form { gap:10px; }
.spmt-space-root[data-spmt-app="stellar-core"] .spmt-command-grid { grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }

/* HearMeOut uses a neutral orbital lounge scene; the global tint layer supplies the selected theme colors. */
.spmt-product-surface.hmo-app .spmt-product-backdrop-image {
  background-image:
    radial-gradient(ellipse at 68% 20%,rgba(255,255,255,.23) 0 1.5%,transparent 1.7% 9%,rgba(255,255,255,.12) 9.2% 9.7%,transparent 10%),
    radial-gradient(ellipse at 66% 24%,transparent 0 18%,rgba(255,255,255,.16) 18.3% 19%,transparent 19.3% 31%,rgba(255,255,255,.08) 31.2% 31.8%,transparent 32%),
    linear-gradient(118deg,transparent 0 39%,rgba(255,255,255,.08) 39.3% 40.1%,transparent 40.4% 59%,rgba(255,255,255,.06) 59.3% 60.2%,transparent 60.5%),
    radial-gradient(circle at 24% 68%,rgba(255,255,255,.15),transparent 10%),
    radial-gradient(circle at 82% 74%,rgba(255,255,255,.1),transparent 12%),
    linear-gradient(180deg,#20232a 0%,#0e1118 44%,#05070b 100%) !important;
  background-size:cover !important;
  background-position:center !important;
  filter:grayscale(1) saturate(0) contrast(1.16) brightness(.9) !important;
}
.spmt-product-surface.hmo-app .spmt-product-backdrop-shade {
  background:radial-gradient(circle at 68% 22%,color-mix(in srgb,var(--spmt-accent-secondary) 16%,transparent),transparent 35%),radial-gradient(circle at 20% 72%,color-mix(in srgb,var(--spmt-accent) 15%,transparent),transparent 38%),linear-gradient(rgba(2,4,8,.08),rgba(2,4,8,.48)) !important;
}
.spmt-product-surface.hmo-app .hmo-console-head,
.spmt-product-surface.hmo-app .hmo-room-card,
.spmt-product-surface.hmo-app .hmo-pane,
.spmt-product-surface.hmo-app .hmo-lobby,
.spmt-product-surface.hmo-app .hmo-person {
  background:var(--spmt-surface-depth-3) !important;
  box-shadow:none !important;
  backdrop-filter:none !important;
}
.spmt-product-surface.hmo-app .hmo-people-pane { background:transparent !important; border:0 !important; }
.spmt-product-surface.hmo-app .hmo-person-list {
  align-items:start !important;
  gap:12px !important;
  grid-auto-flow:row dense !important;
  grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr)) !important;
}
.spmt-product-surface.hmo-app .hmo-person-list>.hmo-person {
  min-width:0 !important;
  min-height:148px;
  height:148px;
  margin:0 !important;
  border:1px solid var(--spmt-border) !important;
  border-radius:16px !important;
  padding:12px !important;
  align-content:start;
}
.spmt-product-surface.hmo-app .hmo-person-list>.hmo-person:has(.hmo-person-menu:not([hidden])),
.spmt-product-surface.hmo-app .hmo-person-list>.hmo-person:has(.hmo-audio-settings:not([hidden])),
.spmt-product-surface.hmo-app .hmo-person-list>.hmo-person:has(.hmo-persona-compose:not([hidden])),
.spmt-product-surface.hmo-app .hmo-person-list>.hmo-person:has(.hmo-dj-panel:not([hidden])) { height:auto; min-height:148px; }
.spmt-product-surface.hmo-app .hmo-person[data-hmo-user-id] { grid-template-columns:50px minmax(0,1fr); column-gap:10px; }
.spmt-product-surface.hmo-app .hmo-person[data-hmo-user-id]::before {
  content:"👤";
  grid-column:1;
  grid-row:1 / span 2;
  width:48px;
  height:48px;
  box-sizing:border-box;
  display:grid;
  place-items:center;
  border-radius:50%;
  border:1px solid var(--spmt-border);
  background:color-mix(in srgb,var(--spmt-accent) 14%,var(--spmt-surface-depth-4));
  font-size:23px;
  box-shadow:0 0 0 2px color-mix(in srgb,var(--spmt-accent-secondary) 22%,transparent);
}
.spmt-product-surface.hmo-app .hmo-person[data-hmo-user-id] .hmo-person-main { grid-column:2; }
.spmt-product-surface.hmo-app .hmo-person[data-hmo-user-id] .hmo-person-icons,
.spmt-product-surface.hmo-app .hmo-person[data-hmo-user-id] .hmo-volume,
.spmt-product-surface.hmo-app .hmo-person[data-hmo-user-id] .hmo-person-menu,
.spmt-product-surface.hmo-app .hmo-person[data-hmo-user-id] .hmo-audio-settings { grid-column:1 / -1; }
.spmt-product-surface.hmo-app .hmo-mic-meter { display:none !important; }
.spmt-product-surface.hmo-app .hmo-person[data-speaking]::before,
.spmt-product-surface.hmo-app .hmo-persona-card[data-speaking] .hmo-persona-avatar,
.spmt-product-surface.hmo-app .hmo-persona-card[data-speaking] .hmo-persona-fallback {
  border-color:color-mix(in srgb,var(--spmt-accent-secondary) 65%,var(--spmt-accent)) !important;
  box-shadow:0 0 0 2px color-mix(in srgb,var(--spmt-accent) 55%,transparent),0 0 24px color-mix(in srgb,var(--spmt-accent-secondary) 62%,transparent) !important;
}
.spmt-product-surface.hmo-app .hmo-persona-avatar,
.spmt-product-surface.hmo-app .hmo-persona-fallback,
.spmt-product-surface.hmo-app .hmo-dj-avatar { width:48px !important; height:48px !important; }
@supports (grid-template-rows:masonry) {
  .spmt-product-surface.hmo-app .hmo-person-list { grid-template-rows:masonry !important; }
}
@supports not (grid-template-rows:masonry) {
  .spmt-product-surface.hmo-app .hmo-person-list { display:block !important; columns:240px; column-gap:12px; }
  .spmt-product-surface.hmo-app .hmo-person-list>.hmo-person { width:100% !important; break-inside:avoid; margin:0 0 12px !important; }
}
@media(max-width:700px) {
  .owned[data-app="streamweaver"] .home-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .owned[data-app="streamweaver"] .actions { grid-template-columns:1fr; }
}
@media(max-width:520px) {
  .spmt-product-surface.hmo-app .hmo-person-list { columns:1 !important; grid-template-columns:1fr !important; }
}
@media (prefers-reduced-motion: reduce) { .spmt-product-surface * { scroll-behavior: auto !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; } }
`;

export function installProductUiStyles(doc: Document, styleId = "spmt-product-ui-v1") {
  const existing = doc.getElementById(styleId);
  if (existing) return existing as HTMLStyleElement;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = PRODUCT_UI_CSS;
  doc.head.append(style);
  return style;
}

const layerForPortal: Record<PortalKindV1, number> = {
  floating: LAYER.floating,
  modal: LAYER.modal,
  toast: LAYER.toast,
  emergency: LAYER.emergency,
};

export const SHARED_SURFACE_CSS = `
:root {
  ${SHELL_LAYOUT_VARS.headerHeight}: 0px;
  ${SHELL_LAYOUT_VARS.safeTop}: 0px;
  ${SHELL_LAYOUT_VARS.safeRight}: 0px;
  ${SHELL_LAYOUT_VARS.safeBottom}: 0px;
  ${SHELL_LAYOUT_VARS.safeLeft}: 0px;
  ${SHELL_LAYOUT_VARS.shellTopInset}: 0px;
  ${SHELL_LAYOUT_VARS.availableHeight}: 100dvh;
  ${SHELL_LAYOUT_VARS.availableWidth}: 100vw;
}
[data-spmt-surface="shell"] .spmt-page,
[data-spmt-surface="shell"] .spmt-sidebar,
[data-spmt-surface="shell"] .spmt-drawer,
[data-spmt-surface="shell"] .spmt-floating-safe {
  max-block-size: ${`var(${SHELL_LAYOUT_VARS.availableHeight})`};
}
.spmt-sidebar,
.spmt-drawer,
.spmt-floating-safe {
  position: fixed;
  inset-block-start: ${`var(${SHELL_LAYOUT_VARS.shellTopInset})`};
  inset-block-end: ${`var(${SHELL_LAYOUT_VARS.safeBottom})`};
}
.spmt-sidebar,
.spmt-drawer {
  z-index: ${LAYER.sticky};
}
.spmt-portal-root {
  position: fixed;
  inset-block-start: ${`var(${SHELL_LAYOUT_VARS.shellTopInset})`};
  inset-inline-end: ${`var(${SHELL_LAYOUT_VARS.safeRight})`};
  inset-block-end: ${`var(${SHELL_LAYOUT_VARS.safeBottom})`};
  inset-inline-start: ${`var(${SHELL_LAYOUT_VARS.safeLeft})`};
  pointer-events: none;
  overflow: visible;
}
.spmt-portal-root > * { pointer-events: auto; }
.spmt-shell-header { z-index: ${LAYER.shellHeader}; }
[data-spmt-portal="floating"] { z-index: ${LAYER.floating}; }
[data-spmt-portal="modal"] { z-index: ${LAYER.modal}; }
[data-spmt-portal="toast"] { z-index: ${LAYER.toast}; }
[data-spmt-portal="emergency"] {
  z-index: ${LAYER.emergency};
  inset-block-start: ${`var(${SHELL_LAYOUT_VARS.safeTop})`};
}
`;

export function installSharedSurfaceStyles(doc: Document, styleId = "spmt-shared-surface-v1") {
  const existing = doc.getElementById(styleId);
  if (existing) return existing as HTMLStyleElement;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = SHARED_SURFACE_CSS;
  doc.head.append(style);
  return style;
}

export function configureSurfaceRoot(root: HTMLElement, mode: SurfaceModeV1) {
  root.dataset.spmtSurface = mode;
  root.style.setProperty("min-block-size", `var(${SHELL_LAYOUT_VARS.availableHeight})`);
  return root;
}

export function ensurePortalRoot(doc: Document, kind: PortalKindV1) {
  const id = `spmt-portal-${kind}`;
  const existing = doc.getElementById(id);
  if (existing) return existing as HTMLDivElement;
  const root = doc.createElement("div");
  root.id = id;
  root.className = "spmt-portal-root";
  root.dataset.spmtPortal = kind;
  root.style.zIndex = String(layerForPortal[kind]);
  doc.body.append(root);
  return root;
}

export function installDefaultPortalRoots(doc: Document) {
  return {
    floating: ensurePortalRoot(doc, "floating"),
    modal: ensurePortalRoot(doc, "modal"),
    toast: ensurePortalRoot(doc, "toast"),
  };
}

export function portalLayer(kind: PortalKindV1) {
  return layerForPortal[kind];
}

export * from "./community-calendar.js";
