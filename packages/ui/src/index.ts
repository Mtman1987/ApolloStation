import type { SurfaceModeV1 } from "@spmt/contracts";
import { LAYER, SHELL_LAYOUT_VARS } from "@spmt/embed";

export type PortalKindV1 = "floating" | "modal" | "toast" | "emergency";

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
