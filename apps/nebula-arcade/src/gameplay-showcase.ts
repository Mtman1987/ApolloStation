import { NEBULA_ARCADE_GAMES, type NebulaGameV1 } from "./game-hub.js";
import type { NebulaGameActionV1 } from "./game-actions.js";

export const NEBULA_GAMEPLAY_REVISION = "2026-08-30-gameplay-2";
export const NEBULA_GAMEPLAY_CAPTURE_SECONDS = 60;
export const NEBULA_GAMEPLAY_ROTATION_SECONDS = 10 * 60;
export const NEBULA_GAMEPLAY_WIDTH = 800;
export const NEBULA_GAMEPLAY_HEIGHT = 450;
export const NEBULA_GAMEPLAY_FPS = 10;

export interface NebulaGameplayManifestGameV1 {
  id: string;
  name: string;
  order: number;
  revision: string;
  captureSeconds: number;
  captureUrl: string;
}

export interface NebulaGameplayManifestV1 {
  schemaVersion: 1;
  revision: string;
  captureSeconds: number;
  rotationSeconds: number;
  width: number;
  height: number;
  fps: number;
  publicOrigin: string;
  fallbackImageUrl: string;
  games: NebulaGameplayManifestGameV1[];
}

export function buildNebulaGameplayManifest(publicOrigin: string): NebulaGameplayManifestV1 {
  const origin = gameplayOrigin(publicOrigin);
  return {
    schemaVersion: 1,
    revision: NEBULA_GAMEPLAY_REVISION,
    captureSeconds: NEBULA_GAMEPLAY_CAPTURE_SECONDS,
    rotationSeconds: NEBULA_GAMEPLAY_ROTATION_SECONDS,
    width: NEBULA_GAMEPLAY_WIDTH,
    height: NEBULA_GAMEPLAY_HEIGHT,
    fps: NEBULA_GAMEPLAY_FPS,
    publicOrigin: origin.origin,
    fallbackImageUrl: new URL("/assets/nebula-arcade/games-showcase.gif?v=3", origin).toString(),
    games: NEBULA_ARCADE_GAMES.map((game, order) => ({
      id: game.id,
      name: game.name,
      order,
      revision: NEBULA_GAMEPLAY_REVISION,
      captureSeconds: NEBULA_GAMEPLAY_CAPTURE_SECONDS,
      captureUrl: new URL(`/overlay/game-hub/showcase/${encodeURIComponent(game.id)}`, origin).toString(),
    })),
  };
}

export function renderNebulaGameplayCapturePage(input: {
  gameId: string;
  playerCount: number;
  leaderboard: Array<{ displayName: string; score: number }>;
  actions: NebulaGameActionV1[];
}): string {
  const game = NEBULA_ARCADE_GAMES.find((candidate) => candidate.id === input.gameId);
  if (!game) throw new Error("Unknown Nebula gameplay capture game");
  const actionCards = input.actions.slice(-8).reverse().map((action) => `<li><strong>${escapeHtml(action.displayName)}</strong><span>${escapeHtml(action.action)}${action.args.length ? ` · ${escapeHtml(action.args.join(" "))}` : ""}</span></li>`).join("");
  const leaders = input.leaderboard.slice(0, 5).map((player, index) => `<li><span>#${index + 1} ${escapeHtml(player.displayName)}</span><strong>${player.score}</strong></li>`).join("");
  const commands = game.commands.slice(0, 6).map((command) => `<b>spmt ${escapeHtml(game.id)} ${escapeHtml(command)}</b>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(game.name)} · Nebula Arcade Gameplay</title><link rel="stylesheet" href="/assets/nebula-arcade/gameplay-showcase.css"></head><body data-nebula-gameplay-capture="${escapeHtml(game.id)}"><main><header><div><small>NEBULA ARCADE · LIVE GAMEPLAY</small><h1>${escapeHtml(game.name)}</h1><p>${escapeHtml(game.summary)}</p></div><aside><strong>${input.playerCount}</strong><span>players</span></aside></header><section class="playfield">${gameVisual(game)}<div class="activity"><h2>${actionCards ? "Recent live actions" : "Attract mode"}</h2><ul>${actionCards || `<li><strong>${escapeHtml(game.name)}</strong><span>waiting for the next community action</span></li>`}</ul></div><div class="score"><h2>Leaderboard</h2><ol>${leaders || "<li><span>Be the first player</span><strong>0</strong></li>"}</ol></div></section><footer><div>${commands}</div><span>60-second capture · rotates every 10 minutes</span></footer></main></body></html>`;
}

export const NEBULA_GAMEPLAY_SHOWCASE_CSS = `
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#020617;color:#f8fbff;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{background:radial-gradient(circle at 18% 8%,rgba(34,211,238,.24),transparent 34%),radial-gradient(circle at 85% 82%,rgba(168,85,247,.26),transparent 38%),linear-gradient(145deg,#020617,#111827)}body:before{content:"";position:absolute;inset:-20%;background-image:radial-gradient(circle,#fff 0 1px,transparent 1.5px);background-size:42px 42px;opacity:.18;animation:stars 18s linear infinite}main{position:relative;width:100%;height:100%;padding:22px;display:grid;grid-template-rows:auto 1fr auto;gap:14px}header,footer,.activity,.score,.arena{border:1px solid rgba(103,232,249,.26);background:rgba(3,9,28,.78);box-shadow:0 22px 70px rgba(0,0,0,.42);backdrop-filter:blur(12px)}header{border-radius:20px;padding:16px 19px;display:flex;align-items:center;justify-content:space-between;gap:20px}small{color:#67e8f9;font-weight:800;letter-spacing:.18em}h1{margin:.2rem 0 0;font-size:30px;line-height:1}p{margin:.4rem 0 0;color:#bdd3e7;font-size:13px}header aside{min-width:88px;text-align:center}header aside strong{display:block;font-size:28px;color:#fde68a}header aside span{font-size:11px;text-transform:uppercase;letter-spacing:.12em}.playfield{min-height:0;display:grid;grid-template-columns:1.25fr .9fr .75fr;gap:14px}.arena,.activity,.score{border-radius:18px;min-width:0;overflow:hidden}.arena{position:relative;display:grid;place-items:center;background:radial-gradient(circle at center,rgba(34,211,238,.16),rgba(3,9,28,.88))}.orbit{width:150px;height:150px;border:1px solid rgba(103,232,249,.42);border-radius:50%;animation:spin 8s linear infinite}.orbit:before,.orbit:after{content:"";position:absolute;width:28px;height:28px;border-radius:50%;background:linear-gradient(145deg,#67e8f9,#a855f7);box-shadow:0 0 24px #67e8f9}.orbit:before{left:10px;top:18px}.orbit:after{right:10px;bottom:18px}.pulse{position:absolute;width:70px;height:70px;border-radius:20px;display:grid;place-items:center;background:linear-gradient(145deg,#f97316,#ec4899);font-size:32px;animation:pulse 1.8s ease-in-out infinite}.activity,.score{padding:15px}.activity h2,.score h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:#a5f3fc;margin:0 0 10px}.activity ul,.score ol{list-style:none;margin:0;padding:0;display:grid;gap:7px}.activity li,.score li{display:flex;justify-content:space-between;gap:8px;padding:8px 9px;border-radius:10px;background:rgba(36,52,83,.56);font-size:11px}.activity li{flex-direction:column}.activity span{color:#c6d8e8}.score strong{color:#fde68a}footer{border-radius:16px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px}footer div{display:flex;gap:6px;flex-wrap:wrap}footer b{padding:5px 8px;border-radius:8px;background:rgba(103,232,249,.12);color:#a5f3fc;font-size:10px}footer span{font-size:10px;color:#9fb4ca}@keyframes stars{to{transform:translateY(-42px)}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{transform:scale(1.12) rotate(6deg);filter:brightness(1.25)}}
`;

function gameVisual(game: NebulaGameV1): string {
  const icon = game.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return `<div class="arena" aria-label="${escapeHtml(game.name)} live playfield"><div class="orbit"></div><div class="pulse">${escapeHtml(icon)}</div></div>`;
}

function gameplayOrigin(value: string): URL {
  const url = new URL(value);
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if ((!loopback && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Nebula gameplay public origin must be credential-free HTTPS or loopback HTTP");
  return url;
}

function escapeHtml(value: string): string { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
