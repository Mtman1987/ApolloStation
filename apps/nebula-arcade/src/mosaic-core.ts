/** Provider-neutral domain primitives ported from Chat-Tag's Nebula Mosaic.
 * Kept free of framework, storage, network, and provider dependencies so the
 * Apollo runtime, widget, and test harness can share the same contract.
 */
export const MOSAIC_WIDTH = 40;
export const MOSAIC_HEIGHT = 50;
export const MOSAIC_CELL_COUNT = MOSAIC_WIDTH * MOSAIC_HEIGHT;
export const MOSAIC_BOARD_WIDTH = 20;
export const MOSAIC_BOARD_HEIGHT = 25;
export const MOSAIC_GENERATION_MAX_ATTEMPTS = 3;
export const MOSAIC_GENERATION_RETRY_MS = 10_000;
export const MOSAIC_GENERATION_STALE_MS = 3 * 60_000;
export const MOSAIC_REVEAL_MS = 15_000;
export const MOSAIC_OVERVIEW_MS = 15_000;
export const MOSAIC_XP_COST = Math.max(0, Math.floor(Number(process.env.MOSAIC_REQUEST_XP_COST || 0)));

export const MOSAIC_COLORS = {
  R: { name: "red", hex: "#ef4444" },
  B: { name: "blue", hex: "#3b82f6" },
  G: { name: "green", hex: "#22c55e" },
  Y: { name: "yellow", hex: "#eab308" },
  P: { name: "purple", hex: "#a855f7" },
  O: { name: "orange", hex: "#f97316" },
  PK: { name: "pink", hex: "#ec4899" },
  W: { name: "white", hex: "#f8fafc" },
  K: { name: "black", hex: "#111827" },
  C: { name: "cyan", hex: "#06b6d4" },
} as const;
export type MosaicColorCode = keyof typeof MOSAIC_COLORS;
export type MosaicPaletteId = "classic" | "neon" | "pastel" | "mono" | "ocean";
export type MosaicBoardNumber = 1 | 2 | 3 | 4;
export type MosaicBrushDirection = "right" | "left" | "down" | "up";
export type MosaicBrushCommand = 1 | 2 | 3 | 4 | 5 | "status" | MosaicBrushDirection | { size: 1 | 2 | 3 | 4 | 5; direction: MosaicBrushDirection };
export type MosaicViewCommand = "all" | MosaicBoardNumber;
export type MosaicPaintCommand = { coordinate: string; column: number; row: number; color: MosaicColorCode };

export const MOSAIC_PALETTES = {
  classic: { R:"#ef4444", B:"#3b82f6", G:"#22c55e", Y:"#eab308", P:"#a855f7", O:"#f97316", PK:"#ec4899", W:"#f8fafc", K:"#111827", C:"#06b6d4" },
  neon: { R:"#ff1744", B:"#2979ff", G:"#00e676", Y:"#ffea00", P:"#d500f9", O:"#ff9100", PK:"#ff4081", W:"#ffffff", K:"#05070d", C:"#00e5ff" },
  pastel: { R:"#fca5a5", B:"#93c5fd", G:"#86efac", Y:"#fde68a", P:"#d8b4fe", O:"#fdba74", PK:"#f9a8d4", W:"#fffdf5", K:"#475569", C:"#a5f3fc" },
  mono: { R:"#f8fafc", B:"#cbd5e1", G:"#94a3b8", Y:"#e2e8f0", P:"#64748b", O:"#b6c2d1", PK:"#d7dee8", W:"#ffffff", K:"#0f172a", C:"#a8b4c5" },
  ocean: { R:"#67e8f9", B:"#2563eb", G:"#2dd4bf", Y:"#fef08a", P:"#7c3aed", O:"#fb923c", PK:"#f0abfc", W:"#ecfeff", K:"#082f49", C:"#06b6d4" },
} as const satisfies Record<MosaicPaletteId, Record<MosaicColorCode, string>>;

const COLOR_ALIASES: Record<string, MosaicColorCode> = {
  r:"R", red:"R", b:"B", blue:"B", g:"G", green:"G", y:"Y", yellow:"Y",
  p:"P", purple:"P", o:"O", orange:"O", pk:"PK", pink:"PK", w:"W", white:"W",
  k:"K", black:"K", c:"C", cyan:"C",
};

export function normalizeMosaicTheme(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
export function validateMosaicTheme(value: unknown): string {
  const theme = normalizeMosaicTheme(value);
  if (theme.length < 2) throw new Error("Name an artwork theme, such as !mosaic owl.");
  if (!/[a-z0-9]/i.test(theme)) throw new Error("The Mosaic theme needs letters or numbers.");
  if (/\b(nude|naked|porn|sex|blood|gore|hate|swastika)\b/i.test(theme)) throw new Error("That theme cannot be used for a community Mosaic.");
  return theme;
}
export function mosaicPricing() {
  // Keep theme requests free until the shared SPMT XP redemption contract is wired.
  return { testingFree: false, controlsCost: 0, brushCost: 0, revealCost: 0 };
}
function mosaicCommandBody(value: unknown): string {
  return String(value ?? "").trim().toLowerCase()
    .replace(/^!?@?spmt(?:\s+|$)/i, "").trim()
    .replace(/^!?pixel(?:battle)?\s+|^!?mosaic\s+/i, "").trim();
}
export function parseMosaicPaintCommand(value: unknown): { coordinate: string; column: number; row: number; color: MosaicColorCode } | null {
  const source = mosaicCommandBody(value).replace(/^play\s+|^paint\s+/i, "").trim();
  const compact = source.replace(/[^a-z0-9]/g, "");
  const compactMatch = compact.match(/^([a-t])(2[0-5]|1\d|[1-9])([a-z]{1,6})$/i);
  if (compactMatch) {
    const color = COLOR_ALIASES[compactMatch[3]!.toLowerCase()];
    if (color) return { coordinate: `${compactMatch[1]!.toUpperCase()}${Number(compactMatch[2])}`, column: compactMatch[1]!.toLowerCase().charCodeAt(0) - 97, row: Number(compactMatch[2]) - 1, color };
  }
  const coordinateMatch = source.match(/\b([a-t])\s*(2[0-5]|1\d|[1-9])\b/i);
  if (!coordinateMatch) return null;
  const remainder = source.replace(coordinateMatch[0], " ").replace(/[^a-z]+/g, " ").trim();
  const color = remainder.split(/\s+/).map((token) => COLOR_ALIASES[token]).find(Boolean);
  if (!color) return null;
  return { coordinate: `${coordinateMatch[1]!.toUpperCase()}${Number(coordinateMatch[2])}`, column: coordinateMatch[1]!.toLowerCase().charCodeAt(0) - 97, row: Number(coordinateMatch[2]) - 1, color };
}
export function parseMosaicBrushCommand(value: unknown): MosaicBrushCommand | null {
  const source = mosaicCommandBody(value);
  const match = source.match(/^brush(?:\s+(.*))?$/);
  if (!match) return null;
  const args = String(match[1] || "").trim().split(/\s+/).filter(Boolean);
  if (!args.length) return "status";
  if (args.length === 1 && args[0] === "off") return 1;
  const direction = args.find((item) => ["right", "left", "down", "up"].includes(item)) as MosaicBrushDirection | undefined;
  const sizeToken = args.find((item) => /^[1-5]$/.test(item));
  if (args.length === 1 && direction) return direction;
  if (args.length === 1 && sizeToken) return Number(sizeToken) as 1 | 2 | 3 | 4 | 5;
  if (direction && sizeToken && args.length === 2) return { size: Number(sizeToken) as 1 | 2 | 3 | 4 | 5, direction };
  return null;
}
export function parseMosaicViewCommand(value: unknown): MosaicViewCommand | null {
  const match = mosaicCommandBody(value).match(/^(?:view|show)\s+(all|[1-4])$/);
  if (!match) return null;
  return match[1] === "all" ? "all" : Number(match[1]) as MosaicBoardNumber;
}
export function parseMosaicRevealCommand(value: unknown): boolean {
  return /^!?@?spmt\s+(?:mosaic\s+)?reveal$/i.test(String(value ?? "").trim());
}
export function parseMosaicPaletteCommand(value: unknown): MosaicPaletteId | null {
  const match = mosaicCommandBody(value).match(/^palette\s+(classic|neon|pastel|mono|ocean)$/);
  return match ? match[1] as MosaicPaletteId : null;
}
export function validateMosaicTemplate(value: unknown): { theme: string; paletteId: MosaicPaletteId; target: MosaicColorCode[] } {
  if (!value || typeof value !== "object") throw new Error("Invalid Mosaic template.");
  const item = value as Record<string, unknown>;
  if (item.format !== "nebula-mosaic" || item.version !== 1 || item.width !== MOSAIC_WIDTH || item.height !== MOSAIC_HEIGHT || !Array.isArray(item.target) || item.target.length !== MOSAIC_CELL_COUNT) {
    throw new Error("Invalid Mosaic template dimensions or format.");
  }
  const target = item.target.map((color) => String(color)) as MosaicColorCode[];
  if (!target.every((color) => Object.prototype.hasOwnProperty.call(MOSAIC_COLORS, color))) throw new Error("Mosaic template contains an unsupported color.");
  const paletteId = String(item.paletteId || "classic") as MosaicPaletteId;
  if (!Object.prototype.hasOwnProperty.call(MOSAIC_PALETTES, paletteId)) throw new Error("Choose a supported Mosaic palette.");
  return { theme: validateMosaicTheme(item.theme), paletteId, target };
}
export type MosaicQueueStatus = "pending" | "generating" | "failed" | "cancelled";
export type MosaicQueueRequest = {
  id: string; theme: string; playerId: string; username: string; displayName: string;
  requestedAt: string; xpCost: number; status: MosaicQueueStatus; error?: string;
  attempts?: number; lastAttemptAt?: string; retryAt?: string; recoveryVersion?: number;
};
export type MosaicArtwork = {
  id: string; theme: string; requestedBy: string; requestedByPlayerId: string;
  createdAt: string; updatedAt: string; lastInteractionAt: string;
  status: "active" | "suspended" | "completed" | "archived";
  provider?: string; sourceImageUrl?: string; revealUntil?: string; viewUntil?: string; target: MosaicColorCode[];
  painted: string[]; paintedBy: string[]; activeBoard: MosaicBoardNumber;
  viewMode: "board" | "all"; awardedMilestones: string[]; paletteId?: MosaicPaletteId;
};
export type MosaicTemplateV1 = { format: "nebula-mosaic"; version: 1; width: 40; height: 50; theme: string; paletteId: MosaicPaletteId; target: MosaicColorCode[] };
export type MosaicSharedProject = { id: string; artworkId: string; template: MosaicTemplateV1; publishedAt: string };
export type MosaicQueueState = { current?: MosaicArtwork; queue: MosaicQueueRequest[]; saves: MosaicArtwork[]; sharedProjects: MosaicSharedProject[] };
export function createMosaicQueueState(): MosaicQueueState { return { queue: [], saves: [], sharedProjects: [] }; }
export function queueMosaicThemeRequest(state: MosaicQueueState, input: { id: string; theme: unknown; playerId: string; username?: string; displayName?: string; xpCost?: number; now?: number }): { request: MosaicQueueRequest; position: number } {
  const theme = validateMosaicTheme(input.theme);
  const now = Math.max(0, Math.floor(Number(input.now ?? Date.now())));
  state.queue = Array.isArray(state.queue) ? state.queue : [];
  state.saves = Array.isArray(state.saves) ? state.saves : [];
  const duplicate = state.queue.some((item) => ["pending", "generating"].includes(item.status) && item.theme.toLowerCase() === theme.toLowerCase());
  if (duplicate || state.current?.theme.toLowerCase() === theme.toLowerCase()) throw new Error(`“${theme}” is already active or queued.`);
  const request: MosaicQueueRequest = { id: String(input.id), theme, playerId: String(input.playerId), username: String(input.username || input.playerId), displayName: String(input.displayName || input.username || input.playerId), requestedAt: new Date(now).toISOString(), xpCost: Math.max(0, Math.floor(Number(input.xpCost || 0))), status: "pending" };
  state.queue = [...state.queue, request].slice(-20);
  return { request: structuredClone(request), position: state.queue.filter((item) => !["failed", "cancelled"].includes(item.status)).length };
}
export function findMosaicArtwork(state: MosaicQueueState, id?: string): MosaicArtwork | undefined {
  return [state.current, ...state.saves].find((art) => art && (!id || art.id === id));
}
export function mosaicTemplate(artwork: MosaicArtwork): MosaicTemplateV1 {
  return { format: "nebula-mosaic", version: 1, width: MOSAIC_WIDTH, height: MOSAIC_HEIGHT, theme: artwork.theme, paletteId: artwork.paletteId || "classic", target: [...artwork.target] };
}
export function sharedMosaicProjects(state: MosaicQueueState): MosaicSharedProject[] {
  return (state.sharedProjects || []).map((project) => structuredClone(project));
}
export function publishMosaic(state: MosaicQueueState, artworkId: string, publish: boolean, now = Date.now()): MosaicSharedProject | null {
  state.sharedProjects = Array.isArray(state.sharedProjects) ? state.sharedProjects : [];
  const existing = state.sharedProjects.find((item) => item.artworkId === artworkId);
  if (!publish) { state.sharedProjects = state.sharedProjects.filter((item) => item.artworkId !== artworkId); return null; }
  const artwork = findMosaicArtwork(state, artworkId);
  if (!artwork) throw new Error("That saved painting was not found.");
  const project: MosaicSharedProject = { id: existing?.id || "mosaic-project:" + artworkId, artworkId, template: mosaicTemplate(artwork), publishedAt: new Date(now).toISOString() };
  state.sharedProjects = [project, ...state.sharedProjects.filter((item) => item.artworkId !== artworkId)].slice(0, 20);
  return structuredClone(project);
}
export function startMosaicProject(state: MosaicQueueState, templateValue: unknown, replace = false, now = Date.now()): MosaicArtwork {
  const template = validateMosaicTemplate(templateValue);
  if (state.current?.status === "active" && !replace) throw new Error("Your painting is still active. Save it and switch to start this one.");
  if (state.current) { const previous = structuredClone(state.current); if (previous.status === "active") previous.status = "suspended"; state.saves = [previous, ...state.saves.filter((art) => art.id !== previous.id)].slice(0, 20); }
  for (const request of state.queue) if (request.status === "generating") { request.status = "cancelled"; request.error = "Cancelled to load a saved project."; delete request.retryAt; }
  const timestamp = new Date(now).toISOString();
  const artwork: MosaicArtwork = { id: "mosaic:project:" + now, theme: template.theme, requestedBy: "shared project", requestedByPlayerId: "", createdAt: timestamp, updatedAt: timestamp, lastInteractionAt: timestamp, status: "active", target: [...template.target], painted: Array(MOSAIC_CELL_COUNT).fill(""), paintedBy: Array(MOSAIC_CELL_COUNT).fill(""), activeBoard: 1, viewMode: "board", awardedMilestones: [], paletteId: template.paletteId };
  state.current = artwork; return structuredClone(artwork);
}
export function resumeMosaicProject(state: MosaicQueueState, id: string, replace = false, now = Date.now()): MosaicArtwork {
  const saved = findMosaicArtwork(state, id);
  if (!saved || !["active", "suspended"].includes(saved.status)) throw new Error("Choose an unfinished saved painting.");
  if (state.current?.id !== id && state.current?.status === "active" && !replace) throw new Error("Save your active painting and switch first.");
  if (state.current && state.current.id !== id) { const previous = structuredClone(state.current); if (previous.status === "active") previous.status = "suspended"; state.saves = [previous, ...state.saves.filter((art) => art.id !== previous.id)].slice(0, 20); }
  const resumed = structuredClone(saved); resumed.status = "active"; resumed.updatedAt = resumed.lastInteractionAt = new Date(now).toISOString(); delete resumed.viewUntil; delete resumed.revealUntil;
  for (const request of state.queue) if (request.status === "generating") { request.status = "cancelled"; request.error = "Cancelled to resume a saved project."; delete request.retryAt; }
  state.current = resumed; return structuredClone(resumed);
}
export function removeMosaicQueueRequest(state: MosaicQueueState, selector: number | string): MosaicQueueRequest {
  const visible = state.queue.filter((item) => item.status !== "cancelled");
  let request: MosaicQueueRequest | undefined;
  if (typeof selector === "number" && Number.isInteger(selector) && selector > 0) request = visible[selector - 1];
  else {
    const value = String(selector || "").trim().toLowerCase();
    request = visible.find((item) => item.id.toLowerCase() === value || item.theme.toLowerCase() === value);
  }
  if (!request) throw new Error("That Mosaic queue item was not found.");
  if (request.status === "generating") {
    request.status = "cancelled";
    request.error = "Removed by a streamer or moderator.";
    delete request.retryAt;
  } else state.queue = state.queue.filter((item) => item.id !== request!.id);
  return structuredClone(request);
}
export function clearMosaicQueue(state: MosaicQueueState): number {
  const active = state.queue.filter((item) => item.status !== "cancelled");
  const generating = new Set<string>();
  for (const item of active) {
    if (item.status === "generating") {
      item.status = "cancelled";
      item.error = "Removed by a streamer or moderator.";
      delete item.retryAt;
      generating.add(item.id);
    }
  }
  state.queue = state.queue.filter((item) => generating.has(item.id));
  return active.length;
}
export function claimNextMosaicRequest(state: MosaicQueueState, now = Date.now()): MosaicQueueRequest | null {
  if (state.current && !["completed", "archived"].includes(state.current.status)) return null;
  if (state.queue.some((item) => item.status === "generating" && item.lastAttemptAt && now - Date.parse(item.lastAttemptAt) < MOSAIC_GENERATION_STALE_MS)) return null;
  for (const item of state.queue) {
    if (item.status === "failed" && Math.max(0, Number(item.attempts || 0)) >= MOSAIC_GENERATION_MAX_ATTEMPTS && Math.max(0, Number(item.recoveryVersion || 0)) < 1) {
      item.status = "pending"; item.attempts = 0; item.recoveryVersion = 1; delete item.retryAt; delete item.error; break;
    }
  }
  const request = state.queue.find((item) => {
    const attempts = Math.max(0, Number(item.attempts || 0));
    if (attempts >= MOSAIC_GENERATION_MAX_ATTEMPTS) return false;
    if (item.status === "pending") return true;
    if (item.status === "failed") return !item.retryAt || Date.parse(item.retryAt) <= now;
    return item.status === "generating" && (!item.lastAttemptAt || now - Date.parse(item.lastAttemptAt) >= MOSAIC_GENERATION_STALE_MS);
  });
  if (!request) return null;
  request.status = "generating"; request.attempts = Math.max(0, Number(request.attempts || 0)) + 1; request.lastAttemptAt = new Date(now).toISOString(); delete request.retryAt; delete request.error;
  return structuredClone(request);
}
export function failMosaicQueueRequest(state: MosaicQueueState, requestId: string, error: unknown, now = Date.now()): MosaicQueueRequest | null {
  const request = state.queue.find((item) => item.id === requestId);
  if (!request || request.status === "cancelled") return request || null;
  request.status = "failed"; request.error = String(error || "Mosaic generation failed.").slice(0, 240);
  if (Math.max(0, Number(request.attempts || 0)) < MOSAIC_GENERATION_MAX_ATTEMPTS) request.retryAt = new Date(now + MOSAIC_GENERATION_RETRY_MS).toISOString();
  else delete request.retryAt;
  return structuredClone(request);
}
export function installMosaicQueueTemplate(state: MosaicQueueState, requestId: string, targetValue: unknown, generation: { provider?: string; sourceImageUrl?: string } = {}, now = Date.now()): MosaicArtwork {
  const request = state.queue.find((item) => item.id === requestId);
  if (!request) throw new Error("Mosaic request was not found.");
  if (state.current && !["completed", "archived"].includes(state.current.status)) throw new Error("Another Mosaic is already active.");
  if (request.status === "cancelled") throw new Error("Mosaic request was cancelled by a streamer or moderator.");
  if (!Array.isArray(targetValue)) throw new Error("Generated Mosaic template must contain 2,000 cells.");
  const target = targetValue.map((color) => String(color || "").toUpperCase()) as MosaicColorCode[];
  if (target.length !== MOSAIC_CELL_COUNT || !target.every((color) => Object.prototype.hasOwnProperty.call(MOSAIC_COLORS, color))) throw new Error("Generated Mosaic did not contain exactly 2,000 supported cells.");
  if (state.current) state.saves = [structuredClone(state.current), ...state.saves.filter((item) => item.id !== state.current!.id)].slice(0, 20);
  const createdAt = new Date(now).toISOString();
  const artwork: MosaicArtwork = { id: `mosaic:${now}`, theme: request.theme, requestedBy: request.displayName, requestedByPlayerId: request.playerId, createdAt, updatedAt: createdAt, lastInteractionAt: createdAt, status: "active", ...(generation.provider ? { provider: generation.provider } : {}), ...(generation.sourceImageUrl ? { sourceImageUrl: generation.sourceImageUrl } : {}), target, painted: Array(MOSAIC_CELL_COUNT).fill(""), paintedBy: Array(MOSAIC_CELL_COUNT).fill(""), activeBoard: 1, viewMode: "board", awardedMilestones: [] };
  state.current = artwork; state.queue = state.queue.filter((item) => item.id !== requestId);
  return structuredClone(artwork);
}
export function setMosaicView(artwork: MosaicArtwork, view: MosaicViewCommand, now = Date.now()): MosaicArtwork {
  if (!artwork || !["active", "suspended", "completed", "archived"].includes(artwork.status)) throw new Error("No saved Nebula Mosaic is ready yet.");
  const timestamp = new Date(now).toISOString();
  if (view === "all") return { ...structuredClone(artwork), viewMode: "all", viewUntil: new Date(now + MOSAIC_OVERVIEW_MS).toISOString(), updatedAt: timestamp, lastInteractionAt: timestamp };
  const next = { ...structuredClone(artwork), activeBoard: view, viewMode: "board" as const, updatedAt: timestamp, lastInteractionAt: timestamp };
  delete next.viewUntil;
  return next;
}
export function setMosaicPalette(artwork: MosaicArtwork, paletteValue: unknown, now = Date.now()): MosaicArtwork {
  const paletteId = String(paletteValue || "").trim().toLowerCase() as MosaicPaletteId;
  if (!Object.prototype.hasOwnProperty.call(MOSAIC_PALETTES, paletteId)) throw new Error("Choose a supported Mosaic palette.");
  const timestamp = new Date(now).toISOString();
  return { ...structuredClone(artwork), paletteId, updatedAt: timestamp, lastInteractionAt: timestamp };
}
export function resetMosaicForReplay(state: MosaicQueueState, now = Date.now()): MosaicArtwork {
  const current = state.current || state.saves[0];
  if (!current) throw new Error("No saved Nebula Mosaic is ready to replay.");
  if (current.status === "completed") state.saves = [structuredClone(current), ...state.saves.filter((item) => item.id !== current.id)].slice(0, 20);
  const timestamp = new Date(now).toISOString();
  const replay: MosaicArtwork = {
    ...structuredClone(current), id: `mosaic:${now}`, painted: Array(MOSAIC_CELL_COUNT).fill(""), paintedBy: Array(MOSAIC_CELL_COUNT).fill(""),
    status: "active", activeBoard: 1, viewMode: "board", awardedMilestones: [], createdAt: timestamp, updatedAt: timestamp, lastInteractionAt: timestamp,
  };
  delete replay.viewUntil;
  delete replay.revealUntil;
  state.current = replay;
  return structuredClone(replay);
}
export function mosaicPublicSnapshot(state: MosaicQueueState, now = Date.now()) {
  const queue = state.queue.filter((item) => item.status !== "cancelled");
  const queueLength = queue.filter((item) => item.status !== "failed" || Math.max(0, Number(item.attempts || 0)) < MOSAIC_GENERATION_MAX_ATTEMPTS || Math.max(0, Number(item.recoveryVersion || 0)) < 1).length;
  const latestRequest = queue.at(-1);
  const generation = latestRequest ? { theme: latestRequest.theme, status: latestRequest.status, error: latestRequest.error || "", attempts: Math.max(0, Number(latestRequest.attempts || 0)), maxAttempts: MOSAIC_GENERATION_MAX_ATTEMPTS, retryAt: latestRequest.retryAt || "" } : null;
  const saves = state.saves.slice(0, 20).map((item) => ({ id: item.id, theme: item.theme, status: item.status, updatedAt: item.updatedAt, createdAt: item.createdAt, paletteId: item.paletteId || "classic", requestedBy: item.requestedBy }));
  const artwork = state.current;
  if (!artwork) return { artwork: null, queueLength, queue: queue.map((item, index) => ({ position: index + 1, id: item.id, theme: item.theme, displayName: item.displayName, status: item.status, attempts: Math.max(0, Number(item.attempts || 0)) })), generation, saves, pricing: mosaicPricing() };
  const revealing = artwork.status !== "completed" && isMosaicRevealVisible(artwork, now);
  const viewMode = artwork.status === "completed" || revealing || (artwork.viewMode === "all" && Date.parse(String(artwork.viewUntil || "")) > now) ? "all" : "board";
  const originX = artwork.activeBoard === 2 || artwork.activeBoard === 4 ? MOSAIC_BOARD_WIDTH : 0;
  const originY = artwork.activeBoard === 3 || artwork.activeBoard === 4 ? MOSAIC_BOARD_HEIGHT : 0;
  const boardTarget: MosaicColorCode[] = [];
  const boardPainted: string[] = [];
  for (let row = 0; row < MOSAIC_BOARD_HEIGHT; row++) for (let column = 0; column < MOSAIC_BOARD_WIDTH; column++) {
    const index = (originY + row) * MOSAIC_WIDTH + originX + column;
    boardTarget.push(artwork.target[index]!); boardPainted.push(artwork.painted[index] || "");
  }
  const progress = artwork.painted.reduce((count, color, index) => count + (color === artwork.target[index] ? 1 : 0), 0);
  return {
    artwork: { id: artwork.id, theme: artwork.theme, requestedBy: artwork.requestedBy, status: artwork.status, activeBoard: artwork.activeBoard, viewMode, revealing, revealUntil: revealing ? artwork.revealUntil : undefined,
      target: viewMode === "all" ? artwork.target : boardTarget, painted: viewMode === "all" ? artwork.painted : boardPainted,
      paintedBy: viewMode === "all" ? artwork.paintedBy : boardPainted.map((_, index) => artwork.paintedBy[(originY + Math.floor(index / MOSAIC_BOARD_WIDTH)) * MOSAIC_WIDTH + originX + index % MOSAIC_BOARD_WIDTH] || ""),
      progress, total: MOSAIC_CELL_COUNT, progressPercent: Math.round(progress / MOSAIC_CELL_COUNT * 100), paletteId: artwork.paletteId || "classic", createdAt: artwork.createdAt, updatedAt: artwork.updatedAt, sourceImageUrl: artwork.sourceImageUrl },
    queueLength, queue: queue.map((item, index) => ({ position: index + 1, id: item.id, theme: item.theme, displayName: item.displayName, status: item.status, attempts: Math.max(0, Number(item.attempts || 0)) })), generation, saves, pricing: mosaicPricing(),
  };
}
export function startMosaicReveal(artwork: MosaicArtwork, now = Date.now()): { artwork: MosaicArtwork; until: string; alreadyActive: boolean } {
  if (artwork.status !== "active") throw new Error("An active, unfinished Mosaic is needed for a reveal.");
  if (Date.parse(String(artwork.revealUntil || "")) > now) return { artwork: structuredClone(artwork), until: artwork.revealUntil!, alreadyActive: true };
  const until = new Date(now + MOSAIC_REVEAL_MS).toISOString();
  const next = { ...structuredClone(artwork), revealUntil: until, updatedAt: new Date(now).toISOString() };
  return { artwork: next, until, alreadyActive: false };
}
export function isMosaicRevealVisible(artwork: Pick<MosaicArtwork, "revealUntil">, now = Date.now()): boolean {
  return Date.parse(String(artwork.revealUntil || "")) > now;
}
export function collectCompletedMosaicMilestones(artwork: MosaicArtwork): { artwork: MosaicArtwork; milestones: Array<{ id: string; contributors: string[] }> } {
  const next = structuredClone(artwork);
  const milestones: Array<{ id: string; contributors: string[] }> = [];
  const paintedBy = Array.isArray(next.paintedBy) ? next.paintedBy : [];
  const checks: Array<{ id: string; indices: number[] }> = [];
  for (let sy = 0; sy < 5; sy++) for (let sx = 0; sx < 4; sx++) {
    const indices: number[] = [];
    for (let y = sy * 10; y < sy * 10 + 10; y++) for (let x = sx * 10; x < sx * 10 + 10; x++) indices.push(y * MOSAIC_WIDTH + x);
    checks.push({ id: `sector:${sx}:${sy}`, indices });
  }
  for (let board = 1; board <= 4; board++) {
    const ox = board === 2 || board === 4 ? MOSAIC_BOARD_WIDTH : 0;
    const oy = board === 3 || board === 4 ? MOSAIC_BOARD_HEIGHT : 0;
    const indices: number[] = [];
    for (let y = oy; y < oy + MOSAIC_BOARD_HEIGHT; y++) for (let x = ox; x < ox + MOSAIC_BOARD_WIDTH; x++) indices.push(y * MOSAIC_WIDTH + x);
    checks.push({ id: `board:${board}`, indices });
  }
  for (const color of Object.keys(MOSAIC_COLORS) as MosaicColorCode[]) {
    const indices = next.target.map((value, index) => value === color ? index : -1).filter((index) => index >= 0);
    if (indices.length) checks.push({ id: `color:${color}`, indices });
  }
  checks.push({ id: "complete", indices: Array.from({ length: MOSAIC_CELL_COUNT }, (_, index) => index) });
  const awarded = new Set(next.awardedMilestones || []);
  for (const check of checks) {
    if (awarded.has(check.id) || !check.indices.length) continue;
    if (!check.indices.every((index) => next.painted[index] === next.target[index])) continue;
    const contributors = [...new Set(check.indices.map((index) => paintedBy[index]).filter((id): id is string => Boolean(id)))];
    if (!contributors.length) continue;
    next.awardedMilestones = [...(next.awardedMilestones || []), check.id];
    awarded.add(check.id);
    milestones.push({ id: check.id, contributors });
  }
  if (awarded.has("complete")) next.status = "completed";
  return { artwork: next, milestones };
}
export function paintMosaicBrush(artwork: MosaicArtwork, command: MosaicPaintCommand, playerId: string, options: { size?: number; direction?: MosaicBrushDirection; now?: number } = {}): { artwork: MosaicArtwork; outcome: "wrong" | "already-painted" | "painted"; expected: MosaicColorCode; paintedCoordinates: string[]; paintedCount: number; brush: number; direction: MosaicBrushDirection; stoppedAt: string; milestones: Array<{ id: string; contributors: string[] }> } {
  if (artwork.status !== "active") throw new Error("Only an active Mosaic can be painted.");
  if (!Number.isInteger(command.column) || command.column < 0 || command.column >= MOSAIC_BOARD_WIDTH || !Number.isInteger(command.row) || command.row < 0 || command.row >= MOSAIC_BOARD_HEIGHT) throw new Error("The paint coordinate must be inside the active 20×25 board.");
  const size = Math.min(5, Math.max(1, Math.floor(Number(options.size || 1))));
  const direction = options.direction || "right";
  const originX = artwork.activeBoard === 2 || artwork.activeBoard === 4 ? MOSAIC_BOARD_WIDTH : 0;
  const originY = artwork.activeBoard === 3 || artwork.activeBoard === 4 ? MOSAIC_BOARD_HEIGHT : 0;
  const globalX = originX + command.column;
  const globalY = originY + command.row;
  const startIndex = globalY * MOSAIC_WIDTH + globalX;
  const expected = artwork.target[startIndex]!;
  const timestamp = new Date(options.now ?? Date.now()).toISOString();
  const base = { ...structuredClone(artwork), updatedAt: timestamp, lastInteractionAt: timestamp, viewMode: "board" as const };
  if (command.color !== expected) return { artwork: base, outcome: "wrong", expected, paintedCoordinates: [], paintedCount: 0, brush: size, direction, stoppedAt: "", milestones: [] };
  const painted = [...base.painted];
  const paintedBy = [...base.paintedBy];
  const paintedCoordinates: string[] = [];
  let stoppedAt = "";
  for (let offset = 0; offset < size; offset++) {
    const dx = direction === "left" ? -offset : direction === "right" ? offset : 0;
    const dy = direction === "up" ? -offset : direction === "down" ? offset : 0;
    const localColumn = command.column + dx;
    const localRow = command.row + dy;
    if (localColumn < 0 || localColumn >= MOSAIC_BOARD_WIDTH || localRow < 0 || localRow >= MOSAIC_BOARD_HEIGHT) break;
    const index = (originY + localRow) * MOSAIC_WIDTH + originX + localColumn;
    const coordinate = `${String.fromCharCode(65 + localColumn)}${localRow + 1}`;
    if (base.target[index] !== command.color) { stoppedAt = coordinate; break; }
    if (painted[index] === command.color) continue;
    painted[index] = command.color;
    paintedBy[index] = String(playerId);
    paintedCoordinates.push(coordinate);
  }
  if (!paintedCoordinates.length) return { artwork: base, outcome: "already-painted", expected, paintedCoordinates, paintedCount: 0, brush: size, direction, stoppedAt, milestones: [] };
  const collected = collectCompletedMosaicMilestones({ ...base, painted, paintedBy });
  return { artwork: collected.artwork, outcome: "painted", expected, paintedCoordinates, paintedCount: paintedCoordinates.length, brush: size, direction, stoppedAt, milestones: collected.milestones };
}
export function paintMosaicArtworkCell(artwork: MosaicArtwork, column: number, row: number, color: MosaicColorCode, playerId: string, now = Date.now()): MosaicArtwork {
  if (artwork.status !== "active") throw new Error("Only an active Mosaic can be painted.");
  const painted = paintMosaicCell(artwork.painted, column, row, color);
  const index = row * MOSAIC_WIDTH + column;
  const paintedBy = Array.isArray(artwork.paintedBy) ? [...artwork.paintedBy] : Array(MOSAIC_CELL_COUNT).fill("");
  paintedBy[index] = String(playerId);
  const timestamp = new Date(now).toISOString();
  return { ...structuredClone(artwork), painted, paintedBy, updatedAt: timestamp, lastInteractionAt: timestamp };
}
export function paintMosaicCell(paintedValue: unknown, column: number, row: number, color: MosaicColorCode): string[] {
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || column >= MOSAIC_WIDTH || row < 0 || row >= MOSAIC_HEIGHT) throw new Error("Choose a cell inside the Mosaic board.");
  if (!Object.prototype.hasOwnProperty.call(MOSAIC_COLORS, color)) throw new Error("Choose a supported Mosaic color.");
  const painted = Array.isArray(paintedValue) ? paintedValue.map((value) => String(value)) : Array(MOSAIC_CELL_COUNT).fill("");
  if (painted.length !== MOSAIC_CELL_COUNT) throw new Error("Mosaic paint state has invalid dimensions.");
  painted[row * MOSAIC_WIDTH + column] = color;
  return painted;
}
