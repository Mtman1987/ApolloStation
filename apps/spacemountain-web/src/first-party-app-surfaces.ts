export type FirstPartyAppSurfaceId = "discord-stream-hub" | "streamweaver" | "hearmeout" | "mountainview" | "companion";
export type FirstPartyAppSurfaceMode = "standalone" | "shell" | "workspace";

interface AppFeatureV1 { id: string; title: string; body: string; }
interface FirstPartyAppSurfaceV1 {
  id: FirstPartyAppSurfaceId;
  name: string;
  shortName: string;
  kicker: string;
  tagline: string;
  description: string;
  runtimeNote: string;
  features: readonly AppFeatureV1[];
}

export const FIRST_PARTY_APP_SURFACES: Readonly<Record<FirstPartyAppSurfaceId, FirstPartyAppSurfaceV1>> = Object.freeze({
  "discord-stream-hub": Object.freeze({
    id: "discord-stream-hub",
    name: "Discord Stream Hub",
    shortName: "Stream Hub",
    kicker: "COMMUNITY ORBIT",
    tagline: "Community discovery, shoutouts, spotlight, moderation, forums, and creator support in one station.",
    description: "Discord Stream Hub is the community operations app. Its canonical module already owns live monitoring, shoutout routing, spotlight rotation, calendar, moderation, forum, and clip workflows.",
    runtimeNote: "Provider connections and outbound Discord actions remain runtime integrations; this surface never fabricates delivery state.",
    features: [
      { id: "live", title: "Live Network", body: "Monitor community creators and feed canonical live presence into SpaceMountain." },
      { id: "spotlight", title: "Shoutouts & Spotlight", body: "Route live transitions into persistent community support and rotating spotlight workflows." },
      { id: "community", title: "Community Tools", body: "Calendar, moderation, forums, clips, announcements, and community administration stay together." },
    ],
  }),
  streamweaver: Object.freeze({
    id: "streamweaver",
    name: "StreamWeaver",
    shortName: "StreamWeaver",
    kicker: "STREAM AUTOMATION",
    tagline: "Personas, commands, redeems, TTS, chat automation, and stream outputs woven through one creator runtime.",
    description: "StreamWeaver owns tenant-configured personas and creator automation while using shared SPMT identity, events, Commlink, Stellar Core, workspace, and overlay contracts.",
    runtimeNote: "Personas and actions execute only when their configured workers/providers are connected; the shell remains truthful when a runtime is unavailable.",
    features: [
      { id: "personas", title: "Personas & TTS", body: "Configure creator-facing personas, speech behavior, and bounded assistant invocation." },
      { id: "automation", title: "Commands & Automation", body: "Commands, redeems, actions, and normalized chat consumption share one routing layer." },
      { id: "outputs", title: "Stream Outputs", body: "Overlay cues and creator outputs use canonical workspace and overlay contracts." },
    ],
  }),
  hearmeout: Object.freeze({
    id: "hearmeout",
    name: "HearMeOut",
    shortName: "HearMeOut",
    kicker: "SHARED MEDIA ROOMS",
    tagline: "Voice rooms, watch parties, music queues, Discord Activity, and OBS media surfaces kept in sync.",
    description: "HearMeOut owns social rooms and synchronized media state. LiveKit grants, room membership, playback lanes, and the DJ worker remain bounded behind the app.",
    runtimeNote: "Media resolution and LiveKit connectivity are attached at runtime; the shared shell does not invent room or playback activity.",
    features: [
      { id: "rooms", title: "Voice Rooms", body: "Create tenant-private rooms with bounded microphone and listener authority." },
      { id: "watch", title: "Watch & Listen", body: "Run synchronized movie and music queues with canonical room playback state." },
      { id: "media", title: "OBS & Activity", body: "Expose now-playing and room surfaces to OBS and Discord Activity without duplicating authority." },
    ],
  }),
  mountainview: Object.freeze({
    id: "mountainview",
    name: "MountainView",
    shortName: "MountainView",
    kicker: "MOBILE RELAY",
    tagline: "Carry voice, camera, images, and approved media controls between your mobile devices and the ecosystem.",
    description: "MountainView is the mobile and wearable relay. Pairing and commands stay tenant-bound while voice and image events move through shared SPMT contracts.",
    runtimeNote: "Hardware access requires an explicitly paired device; this browser surface never claims a phone, headset, or camera is connected when it is not.",
    features: [
      { id: "devices", title: "Device Pairing", body: "Pair approved phones, Bluetooth headsets, glasses, and relay endpoints to one SPMT identity." },
      { id: "voice", title: "Voice & Camera Relay", body: "Move bounded voice and image events into creator tools and Stellar Core workflows." },
      { id: "controls", title: "Media Controls", body: "Send only approved media and operator commands to the device that owns the capability." },
    ],
  }),
  companion: Object.freeze({
    id: "companion",
    name: "SpaceMountain Companion",
    shortName: "Companion",
    kicker: "LOCAL BRIDGE",
    tagline: "OBS, overlays, local media, devices, FFmpeg jobs, and local compute bridged through one paired desktop runtime.",
    description: "Companion is the paired local runtime for capabilities that belong on the creator computer instead of the cloud. The web surface manages and explains that connection without pretending the local worker is present.",
    runtimeNote: "OBS, FFmpeg, local AI, and device execution require the installed paired Companion runtime; cloud code never assumes those capabilities exist.",
    features: [
      { id: "obs", title: "OBS & Overlay Bridge", body: "Control approved OBS workflows and expose the universal overlay through the paired desktop." },
      { id: "media", title: "Local Media", body: "Keep heavy media, FFmpeg, cache, and local file work on the creator machine." },
      { id: "compute", title: "Local Compute", body: "Offer explicitly granted CPU/GPU jobs without turning the desktop into canonical authority." },
    ],
  }),
});

export function isFirstPartyAppSurfaceId(value: string): value is FirstPartyAppSurfaceId {
  return Object.prototype.hasOwnProperty.call(FIRST_PARTY_APP_SURFACES, value);
}

export function renderFirstPartyAppSurface(appId: FirstPartyAppSurfaceId, nonce: string, mode: FirstPartyAppSurfaceMode, buildSha: string): string {
  const app = FIRST_PARTY_APP_SURFACES[appId];
  const compact = mode !== "standalone";
  const header = compact ? "" : `<header class="app-header"><a href="/" aria-label="Return to SpaceMountain">SPACEMOUNTAIN<span>.LIVE</span></a><nav><a href="#capabilities">Capabilities</a><a href="#about">About</a><a href="/?view=workspace">Workspace</a></nav></header>`;
  const cards = app.features.map((feature, index) => `<article id="${feature.id}" class="feature-card"><span>0${index + 1}</span><h2>${escapeHtml(feature.title)}</h2><p>${escapeHtml(feature.body)}</p></article>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(app.name)} · SpaceMountain</title><link rel="stylesheet" href="/assets/web/first-party-apps.css"><script src="/assets/web/first-party-apps.js" defer nonce="${nonce}"></script></head><body class="first-party-app" data-app="${app.id}" data-surface="${mode}"><div class="app-scene" aria-hidden="true"><span class="scene-art"></span><span class="scene-tint"></span><span class="stars stars-a"></span><span class="stars stars-b"></span></div>${header}<main><section class="app-hero"><div class="hero-copy"><p class="kicker">${escapeHtml(app.kicker)}</p><h1>${escapeHtml(app.shortName)}</h1><p class="tagline">${escapeHtml(app.tagline)}</p><div class="hero-links"><a href="#capabilities">Explore capabilities</a><a href="/?view=workspace">Open Workspace</a></div></div><aside class="runtime-card"><span>APP CONTRACT</span><strong>Registered first-party module</strong><p>${escapeHtml(app.runtimeNote)}</p><small data-build>Build ${escapeHtml(buildSha.slice(0, 12))}</small></aside></section><section id="capabilities" class="feature-grid">${cards}</section><section id="about" class="about-strip"><div><span>ABOUT</span><strong>${escapeHtml(app.name)}</strong></div><p>${escapeHtml(app.description)}</p><small>Attributions, screenshots, social links, and source links can be added here as the donor UI is ported.</small></section></main></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export const FIRST_PARTY_APP_CSS = `
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:transparent;color:#f7f7fb}*{box-sizing:border-box}html,body{margin:0;min-width:0;min-height:100%;background:transparent}body{--accent:#a855f7;--accent2:#e879f9;--glass:.76;--blur:18px;--border:color-mix(in srgb,var(--accent) 28%,rgba(255,255,255,.13));--depth1:rgb(8 10 20 / calc(var(--glass) * .9));--depth2:rgb(10 12 24 / calc(var(--glass) * .62));--depth3:rgb(12 14 28 / calc(var(--glass) * .42));position:relative;overflow-x:hidden;color:#f7f7fb}.app-scene{position:fixed;inset:0;z-index:-2;overflow:hidden;background:#03050d}.scene-art,.scene-tint,.stars{position:absolute;inset:0}.scene-tint{background:var(--accent);opacity:.44;mix-blend-mode:color}.stars{opacity:.55;background-repeat:repeat;animation:stars-up 120s linear infinite}.stars-a{background-image:radial-gradient(circle,#fff 0 1px,transparent 1.4px);background-size:73px 83px}.stars-b{background-image:radial-gradient(circle,color-mix(in srgb,var(--accent2) 70%,white) 0 1px,transparent 1.6px);background-size:131px 151px;animation-duration:180s;opacity:.35}@keyframes stars-up{to{transform:translateY(-2000px)}}
body[data-app="discord-stream-hub"] .scene-art{background:radial-gradient(circle at 76% 28%,rgba(255,255,255,.22) 0 1.5%,transparent 1.7%),radial-gradient(circle at 76% 28%,color-mix(in srgb,var(--accent) 55%,transparent) 0 12%,transparent 28%),linear-gradient(145deg,#03040a 0 38%,#0a1220 68%,#020308)}body[data-app="streamweaver"] .scene-art{background:radial-gradient(ellipse at 72% 25%,color-mix(in srgb,var(--accent2) 30%,transparent),transparent 30%),repeating-radial-gradient(ellipse at 72% 25%,transparent 0 34px,color-mix(in srgb,var(--accent) 18%,transparent) 36px 38px,transparent 40px 70px),linear-gradient(145deg,#03040a,#090516 58%,#02030a)}body[data-app="hearmeout"] .scene-art{background:radial-gradient(circle at 75% 42%,rgba(255,255,255,.16) 0 7%,transparent 7.5%),radial-gradient(circle at 75% 42%,color-mix(in srgb,var(--accent) 26%,#3b82f6) 0 25%,transparent 48%),linear-gradient(160deg,#02040b,#061426 65%,#020309)}body[data-app="mountainview"] .scene-art{background:linear-gradient(165deg,transparent 0 52%,color-mix(in srgb,var(--accent) 25%,#17301f) 53% 67%,#020409 68%),radial-gradient(ellipse at 72% 16%,color-mix(in srgb,var(--accent2) 28%,transparent),transparent 38%),linear-gradient(145deg,#03050a,#07120c 70%,#020309)}body[data-app="companion"] .scene-art{background:radial-gradient(circle at 74% 34%,color-mix(in srgb,var(--accent2) 34%,white) 0 4%,transparent 4.5%),radial-gradient(circle at 74% 34%,color-mix(in srgb,var(--accent) 24%,transparent) 0 25%,transparent 46%),linear-gradient(145deg,#04040a,#130a05 58%,#020309)}
.app-header{position:sticky;top:0;z-index:10;min-height:70px;padding:12px 4vw;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--border);background:var(--depth1);backdrop-filter:blur(var(--blur))}.app-header>a{color:white;text-decoration:none;font-weight:950;letter-spacing:.15em}.app-header>a span{color:var(--accent2)}.app-header nav{display:flex;gap:8px;flex-wrap:wrap}.app-header nav a,.hero-links a{border:1px solid var(--border);border-radius:14px;background:var(--depth3);color:white;padding:10px 14px;text-decoration:none;font-size:12px;font-weight:850}
main{position:relative;width:min(1500px,100%);min-height:calc(100dvh - 70px);margin:0 auto;padding:clamp(20px,3vw,42px);display:grid;grid-template-rows:minmax(0,1fr) auto auto;gap:14px}.app-hero{min-height:0;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(260px,.7fr);align-items:center;gap:22px;padding:clamp(26px,4vw,58px);border:1px solid var(--border);border-radius:30px;background:var(--depth1);backdrop-filter:blur(var(--blur))}.hero-copy{min-width:0}.kicker,.runtime-card>span,.about-strip span,.feature-card>span{color:var(--accent2);font-size:10px;font-weight:900;letter-spacing:.18em}.app-hero h1{margin:10px 0 14px;font-size:clamp(46px,7vw,96px);line-height:.88;letter-spacing:-.055em}.tagline{max-width:760px;margin:0;color:#c5c7d2;font-size:clamp(14px,1.5vw,19px);line-height:1.55}.hero-links{display:flex;gap:9px;flex-wrap:wrap;margin-top:22px}.runtime-card{align-self:stretch;display:flex;flex-direction:column;justify-content:flex-end;padding:20px;border:1px solid var(--border);border-radius:22px;background:var(--depth2);backdrop-filter:blur(calc(var(--blur)*.75))}.runtime-card strong{margin:6px 0 8px;font-size:20px}.runtime-card p{margin:0;color:#aeb1bf;font-size:12px;line-height:1.55}.runtime-card small{margin-top:14px;color:#767988}
.feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.feature-card{min-height:126px;padding:17px;border:1px solid var(--border);border-radius:20px;background:var(--depth2);backdrop-filter:blur(calc(var(--blur)*.72))}.feature-card h2{margin:8px 0;font-size:17px}.feature-card p{margin:0;color:#a9acba;font-size:11px;line-height:1.5}.about-strip{display:grid;grid-template-columns:minmax(180px,.3fr) minmax(0,1.2fr) minmax(180px,.5fr);align-items:center;gap:16px;padding:15px 18px;border:1px solid var(--border);border-radius:18px;background:var(--depth2)}.about-strip>div{display:grid;gap:3px}.about-strip p,.about-strip small{margin:0;color:#a5a8b5;font-size:10px;line-height:1.45}
body[data-surface="shell"],body[data-surface="workspace"]{height:100dvh;min-height:0;overflow:hidden}.first-party-app[data-surface="shell"] main,.first-party-app[data-surface="workspace"] main{height:100%;min-height:0;min-height:0;padding:clamp(10px,1.6vw,20px);overflow:hidden}.first-party-app[data-surface="workspace"] main{padding:10px}.first-party-app[data-surface="workspace"] .app-hero{padding:18px 22px}.first-party-app[data-surface="workspace"] .app-hero h1{font-size:clamp(34px,6vw,68px)}.first-party-app[data-surface="workspace"] .tagline{font-size:12px}.first-party-app[data-surface="workspace"] .feature-card{min-height:96px;padding:13px}.first-party-app[data-surface="workspace"] .about-strip{padding:10px 14px}
@media(max-width:900px){main{grid-template-rows:auto auto auto;overflow-y:auto}.app-hero{grid-template-columns:1fr}.feature-grid{grid-template-columns:1fr}.about-strip{grid-template-columns:1fr}.first-party-app[data-surface="shell"],.first-party-app[data-surface="workspace"]{overflow:hidden}.first-party-app[data-surface="shell"] main,.first-party-app[data-surface="workspace"] main{overflow-y:auto}.app-header{align-items:flex-start;flex-direction:column}}
@media(prefers-reduced-motion:reduce){.stars{animation:none}}
`;

export const FIRST_PARTY_APP_BROWSER_JS = `(()=>{'use strict';const body=document.body,themes={'solar-flare':['#f97316','#fbbf24'],'nebula-purple':['#a855f7','#e879f9'],'oceanic-blue':['#3b82f6','#22d3ee'],'aurora-green':['#10b981','#a3e635']};function apply(value={}){const pair=themes[value.theme]||themes['nebula-purple'];body.style.setProperty('--accent',value.accent||pair[0]);body.style.setProperty('--accent2',pair[1]);body.style.setProperty('--glass',String((value.glassOpacity??76)/100));body.style.setProperty('--blur',(value.blurStrength??18)+'px');const stars=(value.starDensity??70)/100;document.querySelectorAll('.stars').forEach(node=>node.style.opacity=String(Math.max(0,Math.min(1,stars))*.65));}async function load(){try{const sessionResponse=await fetch('/v1/session',{credentials:'same-origin',cache:'no-store'});if(!sessionResponse.ok)return apply();const session=await sessionResponse.json(),tenantId=session.tenantIds?.[0];if(!tenantId)return apply();const response=await fetch('/v1/workspace/profile',{credentials:'same-origin',cache:'no-store',headers:{'x-spmt-tenant':tenantId}});if(!response.ok)return apply();const workspace=await response.json();apply(workspace.appearance||{});}catch{apply();}}load();})();`;
