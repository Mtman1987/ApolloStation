import test from "node:test";
import assert from "node:assert/strict";
import { MOSAIC_CELL_COUNT, MOSAIC_COLORS, MOSAIC_PALETTES, MOSAIC_WIDTH, MOSAIC_HEIGHT, MOSAIC_REVEAL_MS, mosaicPricing, normalizeMosaicTheme, validateMosaicTheme, parseMosaicPaintCommand, parseMosaicBrushCommand, parseMosaicViewCommand, parseMosaicPaletteCommand, parseMosaicRevealCommand, validateMosaicTemplate, paintMosaicCell, createMosaicQueueState, queueMosaicThemeRequest, claimNextMosaicRequest, failMosaicQueueRequest, installMosaicQueueTemplate, removeMosaicQueueRequest, clearMosaicQueue, startMosaicReveal, isMosaicRevealVisible, paintMosaicArtworkCell, paintMosaicBrush, collectCompletedMosaicMilestones, setMosaicView, setMosaicPalette, resetMosaicForReplay, mosaicPublicSnapshot, mosaicTemplate, publishMosaic, sharedMosaicProjects, startMosaicProject, resumeMosaicProject, findMosaicArtwork, mosaicTemplateSvg } from "../apps/nebula-arcade/dist/mosaic-core.js";

test("Mosaic theme normalization and guardrails match the donor contract", () => {
  assert.equal(normalizeMosaicTheme("  owl\n in   space  "), "owl in space");
  assert.equal(validateMosaicTheme("owl in space"), "owl in space");
  assert.throws(() => validateMosaicTheme("x"), /Name an artwork theme/);
  assert.throws(() => validateMosaicTheme("community blood moon"), /cannot be used/);
});

test("Mosaic paint commands parse aliases and reject invalid coordinates", () => {
  assert.deepEqual(parseMosaicPaintCommand("!mosaic paint A1 red"), { coordinate: "A1", column: 0, row: 0, color: "R" });
  assert.deepEqual(parseMosaicPaintCommand("pixelbattle B25 cyan"), { coordinate: "B25", column: 1, row: 24, color: "C" });
  assert.equal(parseMosaicPaintCommand("!mosaic AO1 blue"), null);
  assert.equal(parseMosaicPaintCommand("!mosaic AZ99 blue"), null);
  assert.equal(parseMosaicPaintCommand("!mosaic A1 chartreuse"), null);
  assert.deepEqual(parseMosaicPaintCommand("!spmt pixelbattle paint T25 PK"), { coordinate: "T25", column: 19, row: 24, color: "PK" });
});

test("Mosaic brush, board view, and palette commands match the donor vocabulary", () => {
  assert.equal(parseMosaicBrushCommand("!mosaic brush"), "status");
  assert.equal(parseMosaicBrushCommand("!mosaic brush off"), 1);
  assert.equal(parseMosaicBrushCommand("pixelbattle brush 4 left")?.size, 4);
  assert.deepEqual(parseMosaicBrushCommand("mosaic brush 4 left"), { size: 4, direction: "left" });
  assert.equal(parseMosaicBrushCommand("mosaic brush 9"), null);
  assert.equal(parseMosaicViewCommand("!spmt mosaic view all"), "all");
  assert.equal(parseMosaicViewCommand("pixelbattle show 4"), 4);
  assert.equal(parseMosaicViewCommand("mosaic view 5"), null);
  assert.equal(parseMosaicPaletteCommand("mosaic palette ocean"), "ocean");
  assert.equal(parseMosaicPaletteCommand("mosaic palette rainbow"), null);
  assert.equal(parseMosaicRevealCommand("!spmt reveal"), true);
  assert.equal(parseMosaicRevealCommand("!spmt mosaic reveal"), true);
  assert.equal(parseMosaicRevealCommand("!mosaic reveal"), false);
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

test("Mosaic request queue deduplicates themes, retries failures, and installs a validated artwork", () => {
  const state = createMosaicQueueState();
  const queued = queueMosaicThemeRequest(state, { id: "req-1", theme: "owl in space", playerId: "player-1", username: "owl", now: 1000 });
  assert.equal(queued.position, 1);
  assert.equal(queued.request.status, "pending");
  assert.throws(() => queueMosaicThemeRequest(state, { id: "req-2", theme: "OWL IN SPACE", playerId: "player-2", now: 1001 }), /already active or queued/);
  const claimed = claimNextMosaicRequest(state, 2000);
  assert.equal(claimed?.status, "generating");
  assert.equal(claimed?.attempts, 1);
  const failed = failMosaicQueueRequest(state, "req-1", "provider timeout", 3000);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.retryAt, new Date(13000).toISOString());
  const retry = claimNextMosaicRequest(state, 13000);
  assert.equal(retry?.attempts, 2);
  const artwork = installMosaicQueueTemplate(state, "req-1", Array(MOSAIC_CELL_COUNT).fill("B"), { provider: "test" }, 14000);
  assert.equal(artwork.status, "active");
  assert.equal(artwork.target.length, MOSAIC_CELL_COUNT);
  assert.equal(artwork.painted.length, MOSAIC_CELL_COUNT);
  assert.equal(state.queue.length, 0);
  assert.equal(state.current?.theme, "owl in space");
});

test("Mosaic generation lifecycle rejects malformed output and respects active artwork locks", () => {
  const state = createMosaicQueueState();
  queueMosaicThemeRequest(state, { id: "req-a", theme: "first artwork", playerId: "player-1", now: 1000 });
  claimNextMosaicRequest(state, 2000);
  assert.throws(() => installMosaicQueueTemplate(state, "req-a", ["R"]), /2,000/);
  installMosaicQueueTemplate(state, "req-a", Array(MOSAIC_CELL_COUNT).fill("R"), {}, 3000);
  queueMosaicThemeRequest(state, { id: "req-b", theme: "second artwork", playerId: "player-2", now: 4000 });
  assert.equal(claimNextMosaicRequest(state, 5000), null);
});

test("Mosaic reveal is temporary, idempotent while active, and does not mutate the source artwork", () => {
  const state = createMosaicQueueState();
  queueMosaicThemeRequest(state, { id: "reveal-1", theme: "moon garden", playerId: "player-1", now: 1000 });
  claimNextMosaicRequest(state, 2000);
  const artwork = installMosaicQueueTemplate(state, "reveal-1", Array(MOSAIC_CELL_COUNT).fill("G"), {}, 3000);
  const reveal = startMosaicReveal(artwork, 5000);
  assert.equal(Date.parse(reveal.until), 5000 + MOSAIC_REVEAL_MS);
  assert.equal(isMosaicRevealVisible(reveal.artwork, 5001), true);
  assert.equal(isMosaicRevealVisible(reveal.artwork, 5000 + MOSAIC_REVEAL_MS), false);
  assert.equal(artwork.revealUntil, undefined);
  const repeated = startMosaicReveal(reveal.artwork, 6000);
  assert.equal(repeated.alreadyActive, true);
  assert.equal(repeated.until, reveal.until);
  assert.throws(() => startMosaicReveal({ ...artwork, status: "completed" }, 5000), /active, unfinished/);
});

test("Mosaic artwork painting tracks the painter and timestamps without mutating prior state", () => {
  const state = createMosaicQueueState();
  queueMosaicThemeRequest(state, { id: "paint-1", theme: "pixel forest", playerId: "player-1", now: 1000 });
  claimNextMosaicRequest(state, 2000);
  const artwork = installMosaicQueueTemplate(state, "paint-1", Array(MOSAIC_CELL_COUNT).fill("G"), {}, 3000);
  const next = paintMosaicArtworkCell(artwork, 3, 4, "PK", "player-7", 9000);
  assert.equal(next.painted[4 * MOSAIC_WIDTH + 3], "PK");
  assert.equal(next.paintedBy[4 * MOSAIC_WIDTH + 3], "player-7");
  assert.equal(next.lastInteractionAt, new Date(9000).toISOString());
  assert.equal(artwork.painted[4 * MOSAIC_WIDTH + 3], "");
  assert.throws(() => paintMosaicArtworkCell({ ...artwork, status: "archived" }, 3, 4, "PK", "player-7"), /active Mosaic/);
});

test("Mosaic directional brush paints matching cells, stops at mismatches, and respects board edges", () => {
  const state = createMosaicQueueState();
  queueMosaicThemeRequest(state, { id: "brush-1", theme: "sunrise", playerId: "player-1", now: 1000 });
  claimNextMosaicRequest(state, 2000);
  const target = Array(MOSAIC_CELL_COUNT).fill("B");
  target[0] = "R"; target[1] = "R";
  const artwork = installMosaicQueueTemplate(state, "brush-1", target, {}, 3000);
  const result = paintMosaicBrush(artwork, { coordinate: "A1", column: 0, row: 0, color: "R" }, "player-9", { size: 5, direction: "right", now: 4000 });
  assert.equal(result.outcome, "painted");
  assert.deepEqual(result.paintedCoordinates, ["A1", "B1"]);
  assert.equal(result.stoppedAt, "C1");
  assert.equal(result.artwork.paintedBy[0], "player-9");
  assert.equal(artwork.painted[0], "");
  const wrong = paintMosaicBrush(artwork, { coordinate: "A1", column: 0, row: 0, color: "G" }, "player-9", { size: 3 });
  assert.equal(wrong.outcome, "wrong");
  const edge = paintMosaicBrush(artwork, { coordinate: "T1", column: 19, row: 0, color: "B" }, "player-9", { size: 5, direction: "right" });
  assert.equal(edge.paintedCount, 1);
  assert.deepEqual(edge.paintedCoordinates, ["T1"]);
  assert.throws(() => paintMosaicBrush(artwork, { coordinate: "A26", column: 0, row: 25, color: "B" }, "player-9"), /active 20×25 board/);
});

test("Mosaic moderator queue controls remove queued items and safely cancel in-flight work", () => {
  const state = createMosaicQueueState();
  queueMosaicThemeRequest(state, { id: "queued-a", theme: "first theme", playerId: "p1", now: 1000 });
  queueMosaicThemeRequest(state, { id: "queued-b", theme: "second theme", playerId: "p2", now: 2000 });
  assert.equal(removeMosaicQueueRequest(state, "first theme").id, "queued-a");
  assert.equal(state.queue.length, 1);
  assert.throws(() => removeMosaicQueueRequest(state, "missing"), /not found/);
  const claimed = claimNextMosaicRequest(state, 3000);
  assert.equal(claimed?.id, "queued-b");
  assert.equal(removeMosaicQueueRequest(state, 1).status, "cancelled");
  assert.equal(state.queue[0]?.status, "cancelled");
  assert.equal(claimNextMosaicRequest(state, 100000), null);
  queueMosaicThemeRequest(state, { id: "queued-c", theme: "third theme", playerId: "p3", now: 4000 });
  queueMosaicThemeRequest(state, { id: "queued-d", theme: "fourth theme", playerId: "p4", now: 5000 });
  assert.equal(clearMosaicQueue(state), 2);
  assert.equal(state.queue.length, 0);
});

test("Mosaic completion detection awards each milestone once and marks the artwork completed", () => {
  const state = createMosaicQueueState();
  queueMosaicThemeRequest(state, { id: "milestone-1", theme: "solid blue", playerId: "p1", now: 1000 });
  claimNextMosaicRequest(state, 2000);
  const artwork = installMosaicQueueTemplate(state, "milestone-1", Array(MOSAIC_CELL_COUNT).fill("B"), {}, 3000);
  artwork.activeBoard = 4;
  artwork.painted = Array(MOSAIC_CELL_COUNT).fill("B");
  artwork.painted[MOSAIC_CELL_COUNT - 1] = "";
  artwork.paintedBy = Array(MOSAIC_CELL_COUNT).fill("player-a");
  artwork.paintedBy[MOSAIC_CELL_COUNT - 1] = "";
  artwork.awardedMilestones = [];
  for (let sy = 0; sy < 5; sy++) for (let sx = 0; sx < 4; sx++) if (!(sx === 3 && sy === 4)) artwork.awardedMilestones.push(`sector:${sx}:${sy}`);
  artwork.awardedMilestones.push("board:1", "board:2", "board:3");
  const result = paintMosaicBrush(artwork, { coordinate: "T25", column: 19, row: 24, color: "B" }, "player-b", { now: 4000 });
  assert.equal(result.artwork.status, "completed");
  assert.deepEqual(result.milestones.map((item) => item.id).sort(), ["board:4", "color:B", "complete", "sector:3:4"].sort());
  assert.equal(result.milestones.find((item) => item.id === "complete")?.contributors.includes("player-b"), true);
  const again = collectCompletedMosaicMilestones(result.artwork);
  assert.deepEqual(again.milestones, []);
});

test("Mosaic board views, palettes, public snapshots, and replay preserve the project lifecycle", () => {
  const state = createMosaicQueueState();
  queueMosaicThemeRequest(state, { id: "view-1", theme: "coral reef", playerId: "p1", now: 1000 });
  claimNextMosaicRequest(state, 2000);
  const artwork = installMosaicQueueTemplate(state, "view-1", Array(MOSAIC_CELL_COUNT).fill("C"), {}, 3000);
  const board = setMosaicView(artwork, 4, 4000);
  assert.equal(board.activeBoard, 4);
  assert.equal(board.viewMode, "board");
  const overview = setMosaicView(board, "all", 5000);
  assert.equal(overview.viewMode, "all");
  assert.equal(Date.parse(overview.viewUntil), 5000 + 15_000);
  const palette = setMosaicPalette(overview, "ocean", 6000);
  assert.equal(palette.paletteId, "ocean");
  assert.throws(() => setMosaicPalette(palette, "rainbow"), /supported Mosaic palette/);
  state.current = palette;
  const snapshot = mosaicPublicSnapshot(state, 7000);
  assert.equal(snapshot.artwork?.viewMode, "all");
  assert.equal(snapshot.artwork?.target.length, MOSAIC_CELL_COUNT);
  assert.equal(snapshot.artwork?.progressPercent, 0);
  state.current.status = "completed";
  state.current.painted = [...state.current.target];
  state.saves = [structuredClone(state.current)];
  const replay = resetMosaicForReplay(state, 8000);
  assert.equal(replay.status, "active");
  assert.equal(replay.painted.length, MOSAIC_CELL_COUNT);
  assert.equal(replay.painted.every((cell) => cell === ""), true);
  assert.equal(replay.activeBoard, 1);
  assert.equal(state.saves[0]?.status, "completed");
});

test("Mosaic shared projects can be published, started, suspended, and resumed without losing progress", () => {
  const state = createMosaicQueueState();
  queueMosaicThemeRequest(state, { id: "project-1", theme: "blue whale", playerId: "p1", now: 1000 });
  claimNextMosaicRequest(state, 2000);
  const artwork = installMosaicQueueTemplate(state, "project-1", Array(MOSAIC_CELL_COUNT).fill("B"), {}, 3000);
  artwork.painted[0] = "B";
  artwork.paintedBy[0] = "p1";
  const template = mosaicTemplate(artwork);
  assert.equal(template.format, "nebula-mosaic");
  assert.equal(template.target.length, MOSAIC_CELL_COUNT);
  const project = publishMosaic(state, artwork.id, true, 4000);
  assert.equal(project?.artworkId, artwork.id);
  assert.equal(sharedMosaicProjects(state).length, 1);
  assert.equal(findMosaicArtwork(state, artwork.id)?.theme, "blue whale");
  assert.throws(() => startMosaicProject(state, template), /painting is still active/);
  const started = startMosaicProject(state, template, true, 5000);
  assert.equal(started.painted[0], "");
  assert.equal(state.saves[0]?.status, "suspended");
  const resumed = resumeMosaicProject(state, state.saves[0].id, true, 6000);
  assert.equal(resumed.status, "active");
  assert.equal(resumed.painted[0], "B");
  assert.equal(resumed.paintedBy[0], "p1");
  assert.equal(publishMosaic(state, artwork.id, false), null);
  assert.equal(sharedMosaicProjects(state).length, 0);
});

test("Mosaic SVG export renders only validated palette cells and fixed dimensions", () => {
  const template = { format: "nebula-mosaic", version: 1, width: MOSAIC_WIDTH, height: MOSAIC_HEIGHT, theme: "safe <svg> title", paletteId: "neon", target: Array(MOSAIC_CELL_COUNT).fill("PK") };
  const svg = mosaicTemplateSvg(template);
  assert.match(svg, /width="800" height="1000" viewBox="0 0 800 1000"/);
  assert.equal((svg.match(/<rect /g) || []).length, MOSAIC_CELL_COUNT);
  assert.match(svg, /fill="#ff4081"/);
  assert.doesNotMatch(svg, /safe <svg> title/);
  assert.throws(() => mosaicTemplateSvg({ ...template, target: ["bad"] }), /dimensions/);
});
