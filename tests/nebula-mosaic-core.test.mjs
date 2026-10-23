import test from "node:test";
import assert from "node:assert/strict";
import { MOSAIC_CELL_COUNT, MOSAIC_COLORS, MOSAIC_PALETTES, MOSAIC_WIDTH, MOSAIC_HEIGHT, mosaicPricing, normalizeMosaicTheme, validateMosaicTheme, parseMosaicPaintCommand, validateMosaicTemplate, paintMosaicCell } from "../apps/nebula-arcade/dist/mosaic-core.js";

test("Mosaic theme normalization and guardrails match the donor contract", () => {
  assert.equal(normalizeMosaicTheme("  owl\n in   space  "), "owl in space");
  assert.equal(validateMosaicTheme("owl in space"), "owl in space");
  assert.throws(() => validateMosaicTheme("x"), /Name an artwork theme/);
  assert.throws(() => validateMosaicTheme("community blood moon"), /cannot be used/);
});

test("Mosaic paint commands parse aliases and reject invalid coordinates", () => {
  assert.deepEqual(parseMosaicPaintCommand("!mosaic paint A1 red"), { coordinate: "A1", column: 0, row: 0, color: "R" });
  assert.deepEqual(parseMosaicPaintCommand("pixelbattle B25 cyan"), { coordinate: "B25", column: 1, row: 24, color: "C" });
  assert.equal(parseMosaicPaintCommand("!mosaic AN1 blue"), null);
  assert.equal(parseMosaicPaintCommand("!mosaic AZ99 blue"), null);
  assert.equal(parseMosaicPaintCommand("!mosaic A1 chartreuse"), null);
});

test("Mosaic template validation enforces dimensions, palette, and every cell color", () => {
  const template = { format: "nebula-mosaic", version: 1, width: MOSAIC_WIDTH, height: MOSAIC_HEIGHT, theme: "owl", paletteId: "neon", target: Array(MOSAIC_CELL_COUNT).fill("R") };
  assert.equal(validateMosaicTemplate(template).paletteId, "neon");
  assert.equal(validateMosaicTemplate(template).target.length, 2000);
  assert.throws(() => validateMosaicTemplate({ ...template, width: 20 }), /dimensions/);
  assert.throws(() => validateMosaicTemplate({ ...template, paletteId: "made-up" }), /palette/);
  assert.throws(() => validateMosaicTemplate({ ...template, target: ["bad", ...template.target.slice(1)] }), /unsupported color/);
});

test("painting is immutable, indexed row-major, and bounds checked", () => {
  const initial = Array(MOSAIC_CELL_COUNT).fill("");
  const next = paintMosaicCell(initial, 39, 49, "PK");
  assert.equal(initial[1999], "");
  assert.equal(next[49 * 40 + 39], "PK");
  assert.equal(next.length, 2000);
  assert.throws(() => paintMosaicCell(initial, 40, 0, "R"), /inside/);
  assert.throws(() => paintMosaicCell(initial, 0, 50, "R"), /inside/);
});

test("Mosaic palettes cover the same color contract and remain free until XP integration", () => {
  assert.deepEqual(Object.keys(MOSAIC_PALETTES), ["classic", "neon", "pastel", "mono", "ocean"]);
  for (const palette of Object.values(MOSAIC_PALETTES)) assert.deepEqual(Object.keys(palette).sort(), Object.keys(MOSAIC_COLORS).sort());
  assert.deepEqual(mosaicPricing(), { testingFree: false, controlsCost: 0, brushCost: 0, revealCost: 0 });
});
