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
export function parseMosaicPaintCommand(value: unknown): { coordinate: string; column: number; row: number; color: MosaicColorCode } | null {
  const text = String(value ?? "").trim().replace(/^!?(?:mosaic|pixelbattle|pixel)\s+/i, "");
  const match = text.match(/^(?:paint\s+)?([a-z]{1,2}\d{1,2}|\d{1,2}\s*[, ]\s*\d{1,2})\s+([a-z]+)$/i);
  if (!match) return null;
  let column: number, row: number;
  const coordinate = match[1]!.replace(/\s/g, "").toUpperCase();
  const letters = coordinate.match(/^([A-Z]{1,2})(\d{1,2})$/);
  if (letters) {
    column = letters[1]!.split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
    row = Number(letters[2]) - 1;
  } else {
    const parts = coordinate.split(",");
    if (parts.length === 2) { column = Number(parts[0]) - 1; row = Number(parts[1]) - 1; }
    else {
      const numeric = coordinate.match(/^(\d{1,2})(\d{1,2})$/);
      if (!numeric) return null;
      column = Number(numeric[1]) - 1; row = Number(numeric[2]) - 1;
    }
  }
  const color = COLOR_ALIASES[match[2]!.toLowerCase()];
  if (!color || column < 0 || column >= MOSAIC_WIDTH || row < 0 || row >= MOSAIC_HEIGHT) return null;
  return { coordinate, column, row, color };
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
export function paintMosaicCell(paintedValue: unknown, column: number, row: number, color: MosaicColorCode): string[] {
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || column >= MOSAIC_WIDTH || row < 0 || row >= MOSAIC_HEIGHT) throw new Error("Choose a cell inside the Mosaic board.");
  if (!Object.prototype.hasOwnProperty.call(MOSAIC_COLORS, color)) throw new Error("Choose a supported Mosaic color.");
  const painted = Array.isArray(paintedValue) ? paintedValue.map((value) => String(value)) : Array(MOSAIC_CELL_COUNT).fill("");
  if (painted.length !== MOSAIC_CELL_COUNT) throw new Error("Mosaic paint state has invalid dimensions.");
  painted[row * MOSAIC_WIDTH + column] = color;
  return painted;
}
