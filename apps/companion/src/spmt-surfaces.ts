export const DEFAULT_COMPANION_SPMT_ORIGIN = "https://spmt.live";

export interface CompanionSessionFetchV1 {
  fetch(url: string, options: RequestInit): Promise<Response>;
}

export interface CompanionPlatformSurfaceV1 {
  id: string;
  url?: string;
  path?: string;
  [key: string]: unknown;
}

export function companionSurfaceList(payload: unknown): CompanionPlatformSurfaceV1[] {
  const raw = Array.isArray(payload) ? payload : record(payload).surfaces;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => ({ ...item, id: String(item.id ?? "") }))
    .filter((item) => Boolean(item.id));
}

export function buildCompanionSurfaceUrl(payload: unknown, id: string, appId = "companion", origin = DEFAULT_COMPANION_SPMT_ORIGIN): string {
  const surface = companionSurfaceList(payload).find((item) => item.id === String(id ?? ""));
  const raw = String(surface?.url ?? surface?.path ?? "").trim();
  if (!raw) return "";
  try {
    const base = safeOrigin(origin);
    const url = new URL(raw, base);
    if (url.origin !== base.origin || url.username || url.password) return "";
    url.searchParams.set("app", boundedToken(appId, 120));
    url.searchParams.set("mode", id === "worktray" ? "panel" : "full");
    if (id === "overlays") url.searchParams.set("output", "personal");
    return url.toString();
  } catch {
    return "";
  }
}

export async function resolveCompanionSurfaceUrl(session: CompanionSessionFetchV1, id: string, appId = "companion", origin = DEFAULT_COMPANION_SPMT_ORIGIN): Promise<string> {
  const base = safeOrigin(origin);
  const payload = await fetchSessionJson(session, new URL("/api/platform/surfaces", base).toString());
  return buildCompanionSurfaceUrl(payload, id, appId, base.toString());
}

export async function resolveCompanionPersonalOverlayUrl(session: CompanionSessionFetchV1, origin = DEFAULT_COMPANION_SPMT_ORIGIN): Promise<string> {
  const base = safeOrigin(origin);
  const payload = record(await fetchSessionJson(session, new URL("/api/personal-overlay-launch", base).toString()));
  const raw = String(payload.url ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

async function fetchSessionJson(session: CompanionSessionFetchV1, url: string): Promise<unknown> {
  const response = await session.fetch(url, {
    cache: "no-store",
    credentials: "include",
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const error = new Error(typeof record(payload).error === "string" ? String(record(payload).error).slice(0, 400) : `SPMT request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function safeOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT origin must be a credential-free HTTPS origin");
  return url;
}
function boundedToken(value: unknown, max: number): string { return String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, max) || "companion"; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
