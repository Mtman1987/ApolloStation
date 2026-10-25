function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function renderNebulaMosaicOverlay(channelValue: unknown): string {
  const channel = escapeHtml(String(channelValue || "").replace(/^#/, "").trim());
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nebula Mosaic</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#050916;color:#edf7ff}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent}body{padding:clamp(8px,2vw,22px);display:grid;place-items:center}
main{width:min(100%,920px);border:1px solid #294766;border-radius:18px;background:linear-gradient(145deg,rgba(8,18,38,.97),rgba(13,28,53,.94));box-shadow:0 20px 60px #0008;padding:clamp(10px,2vw,20px)}
header{display:flex;justify-content:space-between;align-items:start;gap:12px;margin-bottom:12px}.eyebrow{font-size:10px;letter-spacing:.18em;color:#5fe6ff;font-weight:800;text-transform:uppercase}h1{font-size:clamp(18px,3vw,30px);line-height:1.15;margin:5px 0 0;overflow-wrap:anywhere}.meta{text-align:right;font-size:12px;color:#a9c4df;white-space:nowrap}.progress{height:5px;background:#172a43;border-radius:99px;overflow:hidden;margin:0 0 12px}.progress>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#32d5ff,#a78bfa);transition:width .2s}
#board{display:grid;grid-template-columns:repeat(20,minmax(0,1fr));gap:1px;background:#172a43;border:1px solid #294766;border-radius:8px;overflow:hidden;aspect-ratio:4/5;width:min(100%,640px);margin:auto}
.cell{min-width:0;min-height:0;background:#0a1425;aspect-ratio:1}.footer{display:flex;justify-content:space-between;gap:12px;margin-top:10px;color:#8eaac6;font-size:11px}.status{color:#64e6ff;font-weight:700}.empty{display:grid;place-items:center;min-height:180px;color:#a9c4df;text-align:center}
@media(max-width:480px){.meta{font-size:10px}.footer{font-size:10px}main{border-radius:12px}}
</style></head><body data-game="pixelbattle" data-channel="${channel}"><main><header><div><div class="eyebrow">Nebula Arcade · Community Mosaic</div><h1 id="theme">Waiting for the next artwork</h1></div><div class="meta"><div id="progress">0%</div><div id="boardLabel">BOARD 1 / 4</div></div></header><div class="progress"><i id="progressBar"></i></div><div id="board"></div><div class="footer"><span id="status" class="status">Connecting…</span><span id="contributors">40 × 50 pixel canvas</span></div></main><script src="/assets/nebula-arcade/mosaic-overlay.js" defer></script></body></html>`;
}
export const NEBULA_MOSAIC_OVERLAY_JS = String.raw`(() => {
  const channel = document.body.dataset.channel || "";
  const board = document.getElementById("board");
  const theme = document.getElementById("theme");
  const progress = document.getElementById("progress");
  const progressBar = document.getElementById("progressBar");
  const boardLabel = document.getElementById("boardLabel");
  const status = document.getElementById("status");
  const contributors = document.getElementById("contributors");
  const palettes = {
    classic:{R:"#ef4444",B:"#3b82f6",G:"#22c55e",Y:"#eab308",P:"#a855f7",O:"#f97316",PK:"#ec4899",W:"#f8fafc",K:"#111827",C:"#06b6d4"},
    neon:{R:"#ff1744",B:"#2979ff",G:"#00e676",Y:"#ffea00",P:"#d500f9",O:"#ff9100",PK:"#ff4081",W:"#fff",K:"#05070d",C:"#00e5ff"},
    pastel:{R:"#fca5a5",B:"#93c5fd",G:"#86efac",Y:"#fde68a",P:"#d8b4fe",O:"#fdba74",PK:"#f9a8d4",W:"#fffdf5",K:"#475569",C:"#a5f3fc"},
    mono:{R:"#f8fafc",B:"#cbd5e1",G:"#94a3b8",Y:"#e2e8f0",P:"#64748b",O:"#b6c2d1",PK:"#d7dee8",W:"#fff",K:"#0f172a",C:"#a8b4c5"},
    ocean:{R:"#67e8f9",B:"#2563eb",G:"#2dd4bf",Y:"#fef08a",P:"#7c3aed",O:"#fb923c",PK:"#f0abfc",W:"#ecfeff",K:"#082f49",C:"#06b6d4"}
  };
  function render(data) {
    const art = data && data.artwork;
    if (!art) {
      theme.textContent = "Waiting for the next artwork";
      progress.textContent = "0%";
      progressBar.style.width = "0%";
      board.replaceChildren();
      board.style.gridTemplateColumns = "repeat(20,minmax(0,1fr))";
      const note = document.createElement("div"); note.className = "empty"; note.style.gridColumn = "1 / -1"; note.textContent = "A community theme will appear here when generation is ready."; board.appendChild(note);
      boardLabel.textContent = "BOARD 1 / 4"; status.textContent = "Waiting for a theme"; contributors.textContent = (data && data.queueLength || 0) + " queued request(s)";
      return;
    }
    theme.textContent = art.theme || "Community Mosaic";
    progress.textContent = String(art.progressPercent || 0) + "%";
    progressBar.style.width = String(Math.max(0,Math.min(100,Number(art.progressPercent)||0))) + "%";
    boardLabel.textContent = art.viewMode === "all" ? "FULL CANVAS" : "BOARD " + String(art.activeBoard || 1) + " / 4";
    const count = Array.isArray(art.painted) ? art.painted.length : 0;
    const columns = art.viewMode === "all" ? 40 : 20;
    board.style.gridTemplateColumns = "repeat(" + columns + ",minmax(0,1fr))";
    const palette = palettes[art.paletteId] || palettes.classic;
    const showTarget = art.revealing === true || art.status === "completed";
    const cells = document.createDocumentFragment();
    for (let i=0;i<count;i++) {
      const cell = document.createElement("div"); cell.className = "cell";
      const painted = art.painted[i] || "";
      const target = art.target && art.target[i] || "";
      const visible = painted ? painted : (showTarget ? target : "");
      cell.style.backgroundColor = palette[visible] || "#0a1425";
      cells.appendChild(cell);
    }
    board.replaceChildren(cells);
    status.textContent = art.status === "completed" ? "Artwork complete" : art.revealing ? "Target reveal active" : "Community painting live";
    contributors.textContent = count === 2000 ? "40 × 50 · " + String(art.painted.filter((value,index)=>value && value===art.target[index]).length) + " matching cells" : "20 × 25 board · " + String(data.queueLength || 0) + " queued";
  }
  async function refresh() {
    try {
      const response = await fetch("/v1/nebula/mosaic/snapshot?channel=" + encodeURIComponent(channel), {cache:"no-store", credentials:"same-origin"});
      if (!response.ok) throw new Error("snapshot unavailable");
      render(await response.json());
    } catch (_) { status.textContent = "Waiting for Mosaic state"; }
  }
  refresh();
  setInterval(refresh,1500);
})();`;
