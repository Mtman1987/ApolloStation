import type { SurfaceModeV1 } from "@spmt/contracts";
import { LAYER, SHELL_LAYOUT_VARS } from "@spmt/embed";

export type PortalKindV1 = "floating" | "modal" | "toast" | "emergency";

export type ProductThemeIdV1 = "solar-flare" | "nebula-purple" | "oceanic-blue" | "aurora-green";

export interface ProductThemeV1 {
  id: ProductThemeIdV1;
  name: string;
  accent: string;
  accentSecondary: string;
  backgroundUrl: string;
}

export const PRODUCT_THEME_PRESETS: Readonly<Record<ProductThemeIdV1, ProductThemeV1>> = Object.freeze({
  "solar-flare": Object.freeze({ id: "solar-flare", name: "Solar", accent: "#f97316", accentSecondary: "#fbbf24", backgroundUrl: "/assets/product/theme-solar-flare-background.webp" }),
  "nebula-purple": Object.freeze({ id: "nebula-purple", name: "Nebula", accent: "#a855f7", accentSecondary: "#e879f9", backgroundUrl: "/assets/product/theme-nebula-purple-background.webp" }),
  "oceanic-blue": Object.freeze({ id: "oceanic-blue", name: "Oceanic", accent: "#3b82f6", accentSecondary: "#22d3ee", backgroundUrl: "/assets/product/theme-oceanic-blue-background.webp" }),
  "aurora-green": Object.freeze({ id: "aurora-green", name: "Aurora", accent: "#10b981", accentSecondary: "#a3e635", backgroundUrl: "/assets/product/theme-aurora-green-background.webp" }),
});

export function resolveProductTheme(theme: unknown, customAccent?: unknown): ProductThemeV1 {
  const key = typeof theme === "string" && theme in PRODUCT_THEME_PRESETS ? theme as ProductThemeIdV1 : "solar-flare";
  const preset = PRODUCT_THEME_PRESETS[key];
  if (typeof customAccent !== "string" || !/^#[0-9a-f]{6}$/i.test(customAccent)) return preset;
  return { ...preset, accent: customAccent };
}

export const PRODUCT_UI_CSS = `
.spmt-product-surface {
  --spmt-accent: #f97316;
  --spmt-accent-secondary: #fbbf24;
  --spmt-ink: #f8fafc;
  --spmt-muted: #a8adbb;
  --spmt-panel: rgba(8,10,17,.76);
  --spmt-panel-strong: rgba(8,10,17,.9);
  --spmt-border: rgba(255,255,255,.11);
  --spmt-shadow: 0 24px 80px rgba(0,0,0,.42);
  color: var(--spmt-ink);
  font-family: Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing: antialiased;
}
.spmt-product-surface button,.spmt-product-surface input,.spmt-product-surface select,.spmt-product-surface textarea { font: inherit; }
.spmt-product-surface button { cursor: pointer; }
.spmt-product-surface :focus-visible { outline: 2px solid var(--spmt-accent-secondary); outline-offset: 3px; }
.spmt-product-glass { border: 1px solid var(--spmt-border); background: var(--spmt-panel); box-shadow: var(--spmt-shadow); backdrop-filter: blur(24px) saturate(135%); }
.spmt-product-kicker { color: var(--spmt-accent-secondary); font-size: 10px; font-weight: 900; letter-spacing: .19em; text-transform: uppercase; }
.spmt-product-status { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--spmt-border); border-radius: 999px; padding: 5px 9px; font-size: 9px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.spmt-product-status::before { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 14px currentColor; content: ""; }
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
