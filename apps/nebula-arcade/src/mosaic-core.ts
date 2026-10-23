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
  provider?: string; sourceImageUrl?: string; revealUntil?: string; target: MosaicColorCode[];
  painted: string[]; paintedBy: string[]; activeBoard: MosaicBoardNumber;
  viewMode: "board" | "all"; awardedMilestones: string[]; paletteId?: MosaicPaletteId;
};
export type MosaicQueueState = { current?: MosaicArtwork; queue: MosaicQueueRequest[]; saves: MosaicArtwork[] };
export function createMosaicQueueState(): MosaicQueueState { return { queue: [], saves: [] }; }
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
