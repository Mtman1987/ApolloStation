export interface AppSurfacePageV1 {
  id: string;
  label: string;
  description?: string;
  glyph?: string;
  home?: boolean;
}

export interface AppSurfaceShortcutV1 {
  id: string;
  label: string;
  pageId: string;
}

export interface AppSurfaceManifestV1 {
  schemaVersion: 1;
  appId: string;
  scene: {
    imageUrl: string;
    imagePosition?: string;
  };
  pages: AppSurfacePageV1[];
  shortcuts?: AppSurfaceShortcutV1[];
}

export type AppSurfaceMessageV1 =
  | { protocol: "spmt.surface"; version: 1; type: "surface.manifest"; manifest: AppSurfaceManifestV1 }
  | { protocol: "spmt.surface"; version: 1; type: "page.open"; appId: string; pageId: string }
  | { protocol: "spmt.surface"; version: 1; type: "page.changed"; appId: string; pageId: string };

export function assertAppSurfaceManifestV1(value: unknown): AppSurfaceManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("App surface manifest must be an object");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1) throw new Error("App surface manifest version is invalid");
  const appId = text(item.appId, "appId", 200);
  const scene = object(item.scene, "scene");
  const imageUrl = surfaceUrl(scene.imageUrl, "scene.imageUrl");
  const imagePosition = scene.imagePosition === undefined ? undefined : text(scene.imagePosition, "scene.imagePosition", 120);
  if (!Array.isArray(item.pages) || item.pages.length === 0 || item.pages.length > 40) throw new Error("App surface pages are invalid");
  const seen = new Set<string>();
  const pages = item.pages.map((value) => {
    const page = object(value, "page");
    const id = text(page.id, "page.id", 100);
    if (!/^[A-Za-z0-9._:-]+$/.test(id) || seen.has(id)) throw new Error("App surface page id is invalid or duplicated");
    seen.add(id);
    const label = text(page.label, "page.label", 80);
    const description = page.description === undefined ? undefined : text(page.description, "page.description", 240);
    const glyph = page.glyph === undefined ? undefined : text(page.glyph, "page.glyph", 16);
    const home = page.home === true ? true : undefined;
    return { id, label, ...(description ? { description } : {}), ...(glyph ? { glyph } : {}), ...(home ? { home } : {}) };
  });
  const homePages = pages.filter((page) => page.home);
  if (homePages.length !== 1) throw new Error("App surface manifest must declare exactly one home page");
  let shortcuts: AppSurfaceShortcutV1[] | undefined;
  if (item.shortcuts !== undefined) {
    if (!Array.isArray(item.shortcuts) || item.shortcuts.length > 12) throw new Error("App surface shortcuts are invalid");
    shortcuts = item.shortcuts.map((value) => {
      const shortcut = object(value, "shortcut");
      const id = text(shortcut.id, "shortcut.id", 100);
      const label = text(shortcut.label, "shortcut.label", 80);
      const pageId = text(shortcut.pageId, "shortcut.pageId", 100);
      if (!seen.has(pageId)) throw new Error("App surface shortcut references an unknown page");
      return { id, label, pageId };
    });
  }
  return {
    schemaVersion: 1,
    appId,
    scene: { imageUrl, ...(imagePosition ? { imagePosition } : {}) },
    pages,
    ...(shortcuts?.length ? { shortcuts } : {}),
  };
}

export function isAppSurfaceMessageV1(value: unknown): value is AppSurfaceMessageV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.protocol !== "spmt.surface" || item.version !== 1 || typeof item.type !== "string") return false;
  if (item.type === "surface.manifest") {
    try { assertAppSurfaceManifestV1(item.manifest); return true; } catch { return false; }
  }
  if (item.type === "page.open" || item.type === "page.changed") {
    return typeof item.appId === "string" && /^[A-Za-z0-9._:@/-]{1,200}$/.test(item.appId)
      && typeof item.pageId === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(item.pageId);
  }
  return false;
}

function object(value: unknown, name: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > maximum || /[\r\n\0]/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}
function surfaceUrl(value: unknown, name: string) {
  const url = text(value, name, 2048);
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`${name} must be root-relative or HTTPS`);
  return parsed.toString();
}
