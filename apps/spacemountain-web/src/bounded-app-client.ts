import { SpmtClient } from "@spmt/sdk";
import { bindProductRocketNavigation, configureSurfaceRoot, installProductBackdrop, resolveProductBackdrop, resolveProductTheme } from "@spmt/ui";

interface AppearanceLike {
  theme?: unknown;
  accent?: unknown;
  accentSecondary?: unknown;
  backgroundUrl?: unknown;
  glassOpacity?: unknown;
  blurStrength?: unknown;
  starDensity?: unknown;
  glowIntensity?: unknown;
  sidebarCollapsed?: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function number(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ratio(value: unknown, fallback: number) {
  const parsed = number(value, fallback);
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
}

function applyAppearance(root: HTMLElement, sceneUrl: string, appearance: AppearanceLike) {
  const themeId = typeof appearance.theme === "string" ? appearance.theme : "solar-flare";
  const accent = typeof appearance.accent === "string" ? appearance.accent : undefined;
  const customBackground = typeof appearance.backgroundUrl === "string" ? appearance.backgroundUrl : undefined;
  const secondary = typeof appearance.accentSecondary === "string" ? appearance.accentSecondary : undefined;
  const theme = resolveProductTheme(themeId, accent, secondary);
  root.style.setProperty("--spmt-accent", theme.accent);
  root.style.setProperty("--spmt-accent-secondary", theme.accentSecondary);
  root.style.setProperty("--spmt-glass-opacity", String(ratio(appearance.glassOpacity, .76)));
  root.style.setProperty("--spmt-blur", `${Math.max(0, Math.min(42, number(appearance.blurStrength, 18)))}px`);
  root.style.setProperty("--spmt-stars", String(ratio(appearance.starDensity, 1)));
  root.style.setProperty("--spmt-glow", String(ratio(appearance.glowIntensity, .78)));
  root.dataset.spmtDock = appearance.sidebarCollapsed === true ? "collapsed" : "expanded";
  root.dataset.spmtTheme = themeId;
  document.querySelectorAll<HTMLImageElement>("[data-themed-app-icon]").forEach((image) => {
    image.src = `/assets/product/app-icons/${themeId}/${root.dataset.spmtAppId ?? "app"}.png`;
  });
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme.accent);
  installProductBackdrop(root, resolveProductBackdrop({ appId: root.dataset.spmtAppId ?? "app", imageUrl: sceneUrl }, themeId, accent, customBackground, secondary));
}

async function loadSharedAppearance(root: HTMLElement, appId: string, sceneUrl: string) {
  const client = new SpmtClient({ baseUrl: window.location.origin, appId, fetchImpl: window.fetch.bind(window) });
  const session = record(await client.getSession());
  const tenantIds = Array.isArray(session?.tenantIds) ? session.tenantIds.filter((value): value is string => typeof value === "string") : [];
  if (!tenantIds.length) return;
  const workspace = record(await client.getWorkspaceProfile(tenantIds[0]!));
  const appearance = record(workspace?.appearance) as AppearanceLike | undefined;
  if (appearance) applyAppearance(root, sceneUrl, appearance);
}

const root = document.body;
const surface = root.dataset.spmtSurface === "shell" ? "shell" : "standalone";
configureSurfaceRoot(root, surface);
const appId = root.dataset.spmtAppId ?? "app";
const sceneUrl = root.dataset.spmtScene ?? "";
if (sceneUrl) {
  applyAppearance(root, sceneUrl, {});
  void loadSharedAppearance(root, appId, sceneUrl).catch(() => undefined);
}

function showPage(target: string) {
  const pages = [...document.querySelectorAll<HTMLElement>("[data-bounded-page]")];
  const page = pages.find((candidate) => candidate.dataset.boundedPage === target) ?? pages[0];
  if (!page) return;
  pages.forEach((candidate) => { candidate.hidden = candidate !== page; });
  const pageId = page.dataset.boundedPage ?? "overview";
  document.querySelector<HTMLElement>("#bounded-app-root")!.dataset.page = pageId;
  page.scrollTo({ top: 0 });
  if (window.location.hash !== `#${pageId}`) window.history.replaceState(null, "", `#${pageId}`);
}

document.querySelectorAll<HTMLElement>("[data-bounded-page-link]").forEach((control) => {
  control.addEventListener("click", () => showPage(control.dataset.boundedPageLink ?? "overview"));
});

if (surface === "standalone") {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-spmt-product-nav]")];
  const items = buttons.flatMap((button) => {
    const id = button.dataset.spmtProductNav;
    return id ? [{ id, label: button.textContent?.trim() || id }] : [];
  });
  bindProductRocketNavigation(root, items, "overview", (target: string) => {
    showPage(target);
  });
}

window.addEventListener("hashchange", () => showPage(window.location.hash.slice(1) || "overview"));
showPage(window.location.hash.slice(1) || "overview");
