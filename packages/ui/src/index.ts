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
