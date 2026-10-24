import type { IncomingMessage, ServerResponse } from "node:http";
import { getLoungeMediaLayout } from "./lounge-media-layout.js";
import { buildLoungeCommandMarquee, loungeMarqueeMoment, LOUNGE_THANKS_MESSAGE, type LoungeMarqueeGame } from "./lounge-marquee.js";
import { getLoungeAudioMix } from "./lounge-audio-mix.js";
import { getCommercialBreakState, withSpotlightCommercialBreak } from "./lounge-commercial-break.js";
import { isStreamWeaverLoungeTenant } from "./lounge-chat.js";
import { buildLoungeBrbPlaylist, type LoungeBrbSourcesV1 } from "./lounge-brb.js";

export interface StreamWeaverLoungeWebOptionsV1 {
  /** Active Nebula games to advertise in the marquee. */
  activeGames?: () => Promise<LoungeMarqueeGame[]> | LoungeMarqueeGame[];
  /** Spotlight relay program (for stitched-ad commercial markers). */
  spotlightProgram?: () => Promise<unknown> | unknown;
  /** Public media sources for the commercial-break player. Old fly.dev hosts are retired, so these must be configured. */
  breakGifsUrl?: string; breakThemeMusicUrls?: string[];
  /** BRB fallback media sources; /api/lounge/brb-fallback returns 503 until configured. */
  brb?: LoungeBrbSourcesV1;
  now?: () => number;
}

const json = (response: ServerResponse, body: unknown, status = 200) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" }); response.end(JSON.stringify(body)); return true; };

/** Public, read-only Lounge 24-hour channel surfaces (ported from StreamWeaver /api/lounge/* and /commercial-break-player). */
export function createStreamWeaverLoungeWebHandler(options: StreamWeaverLoungeWebOptionsV1 = {}) {
  const now = options.now ?? Date.now;
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    if (request.method !== "GET" || !(url.pathname.startsWith("/api/lounge/") || url.pathname === "/lounge/commercial-break-player")) return false;
    const tenant = (url.searchParams.get("tenant") ?? "spacemountainlive").toLowerCase();
    if (!isStreamWeaverLoungeTenant(tenant)) return json(response, { error: "Unknown Lounge" }, 404);
    switch (url.pathname) {
      case "/api/lounge/media-layout": return json(response, await getLoungeMediaLayout());
      case "/api/lounge/audio-mix": return json(response, await getLoungeAudioMix());
      case "/api/lounge/marquee": {
        const moment = loungeMarqueeMoment(now());
        const games = options.activeGames ? await options.activeGames() : [];
        return json(response, { ...moment, text: moment.mode === "commands" ? buildLoungeCommandMarquee(games) : LOUNGE_THANKS_MESSAGE });
      }
      case "/api/lounge/commercial-break": {
        const delay = Number(url.searchParams.get("playbackDelayMs") ?? 60000);
        const state = await getCommercialBreakState(tenant);
        return json(response, options.spotlightProgram ? withSpotlightCommercialBreak(state, await options.spotlightProgram(), now(), delay) : state);
      }
      case "/api/lounge/brb-fallback": {
        if (!options.brb) return json(response, { clips: [], gifs: [] }, 503);
        return json(response, await buildLoungeBrbPlaylist(tenant, options.brb));
      }
      case "/lounge/commercial-break-player": {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(commercialBreakPlayerHtml(tenant, options.breakGifsUrl ?? process.env.LOUNGE_BREAK_GIFS_URL ?? "", options.breakThemeMusicUrls ?? (process.env.LOUNGE_BREAK_THEME_URLS ?? "").split(",").filter(Boolean)));
        return true;
      }
      default: return json(response, { error: "Not found" }, 404);
    }
  };
}

/** OBS browser-source page: shows BRB gifs + theme music while a commercial break is ACTIVE. */
export function commercialBreakPlayerHtml(tenant: string, gifsUrl: string, themeUrls: string[]): string {
  const config = JSON.stringify({ tenant, gifsUrl, themeUrls }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Lounge commercial break</title><style>html,body{margin:0;background:transparent;overflow:hidden;font-family:system-ui;color:#fff}#stage{position:fixed;inset:0;display:none;place-items:center;background:#000c}#stage[data-active=true]{display:grid}#gif{max-width:80vw;max-height:70vh}#count{position:fixed;bottom:4vh;width:100%;text-align:center;font-size:4vh;font-weight:800}</style></head><body data-spmt-commercial-ready><div id="stage"><img id="gif" alt=""><div id="count"></div></div><audio id="music" loop></audio><script>
const C=${config},stage=document.getElementById('stage'),gif=document.getElementById('gif'),count=document.getElementById('count'),music=document.getElementById('music');let gifs=[],active=false;
async function loadGifs(){if(!C.gifsUrl)return;try{const r=await fetch(C.gifsUrl,{cache:'no-store'});const b=await r.json();gifs=(Array.isArray(b)?b:b.gifs||[]).map(g=>typeof g==='string'?g:g&&g.url).filter(u=>typeof u==='string'&&u.startsWith('https://'));}catch{}}
async function tick(){try{const r=await fetch('/api/lounge/commercial-break?tenant='+encodeURIComponent(C.tenant),{cache:'no-store'});const s=await r.json();const on=s.phase==='ACTIVE';if(on!==active){active=on;stage.dataset.active=String(on);if(on){if(gifs.length)gif.src=gifs[Math.floor(Math.random()*gifs.length)];if(C.themeUrls.length){music.src=C.themeUrls[Math.floor(Math.random()*C.themeUrls.length)];music.play().catch(()=>{});}}else{music.pause();}}if(on)count.textContent='Back in '+Math.max(0,Math.ceil((s.activeUntil-Date.now())/1000))+'s';}catch{}}
loadGifs();setInterval(loadGifs,600000);tick();setInterval(tick,1000);
</script></body></html>`;
}
