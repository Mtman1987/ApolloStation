type BoundedAppPage = {
  name: string;
  eyebrow: string;
  description: string;
  background: string;
  accent: string;
  capabilities: Array<{ title: string; detail: string }>;
  note: string;
};

const PAGES: Readonly<Record<string, BoundedAppPage>> = Object.freeze({
  "/apps/discord-stream-hub": Object.freeze({
    name: "Discord Stream Hub",
    eyebrow: "COMMUNITY OPERATIONS",
    description: "Live monitoring, shoutout routing, spotlight rotation, moderation and community delivery.",
    background: "/assets/product/theme-nebula-purple-background.webp",
    accent: "#c084fc",
    capabilities: [
      { title: "Live monitoring", detail: "The donor-backed live/offline and spotlight authority is present in ApolloStation." },
      { title: "Shoutout routing", detail: "Community announcements remain tenant-scoped and durable through SPMT events." },
      { title: "Green safety", detail: "Discord provider delivery and external media workers stay disabled in this isolated Sprite." },
    ],
    note: "Browser shell restored. Deeper donor dashboard and provider-output parity remain active porting work.",
  }),
  "/apps/hearmeout": Object.freeze({
    name: "HearMeOut",
    eyebrow: "VOICE + WATCH ROOMS",
    description: "Voice rooms, synchronized watch and music sessions, Discord Activity and OBS media outputs.",
    background: "/assets/product/theme-oceanic-blue-background.webp",
    accent: "#67e8f9",
    capabilities: [
      { title: "Room authority", detail: "Room membership, presence, private-room admission and durable media queues are ported." },
      { title: "LiveKit grants", detail: "Room-scoped microphone, listener and media-publisher authorization remains bounded by SPMT identity." },
      { title: "Green safety", detail: "External LiveKit transport, provider search and DJ-worker delivery are not enabled in this isolated Sprite." },
    ],
    note: "Browser shell restored. Full room controls, search, playback and OBS UI parity remain active porting work.",
  }),
  "/apps/mountainview": Object.freeze({
    name: "MountainView",
    eyebrow: "MOBILE DEVICE BRIDGE",
    description: "Phone, Bluetooth headset or glasses camera, voice, image and media-control relay.",
    background: "/assets/product/theme-aurora-green-background.webp",
    accent: "#86efac",
    capabilities: [
      { title: "Intent routing", detail: "Voice intents route to DSH, Nebula Arcade, HearMeOut, StreamWeaver or the local Companion contract." },
      { title: "Device authority", detail: "Pairing and command permissions stay owned by SPMT instead of direct donor URLs." },
      { title: "Local boundary", detail: "OBS and physical-device actions require an explicitly paired Companion on the local machine." },
    ],
    note: "Browser shell restored. BLE, camera, glasses, QR/profile and complete mobile-control parity remain active porting work.",
  }),
  "/apps/companion": Object.freeze({
    name: "SpaceMountain Companion",
    eyebrow: "LOCAL RELAY",
    description: "Paired local relay for OBS, overlays, media, approved device workflows and local compute.",
    background: "/assets/product/theme-solar-flare-background.webp",
    accent: "#fb923c",
    capabilities: [
      { title: "Paired commands", detail: "Commands are source-, tenant- and capability-bound and completed work is deduplicated." },
      { title: "Local workloads", detail: "The contract reserves OBS, overlays, media, FFmpeg and local-compute work for the paired desktop runtime." },
      { title: "Device required", detail: "This Sprite can show and manage the product surface, but it cannot impersonate a local Companion installation." },
    ],
    note: "Browser surface restored. Desktop relay connection, OBS adapter, local jobs and installer parity remain active porting work.",
  }),
  "/apps/streamweaver": Object.freeze({
    name: "StreamWeaver",
    eyebrow: "STREAM AUTOMATION",
    description: "Tenant-configured personas, commands, automation, TTS, normalized chat consumption and stream outputs.",
    background: "/assets/product/stellar-core-background.webp",
    accent: "#f0abfc",
    capabilities: [
      { title: "Persona routing", detail: "Normalized chat persona routing and bounded owner summons are present in ApolloStation." },
      { title: "Shared contracts", detail: "Identity, events, Commlink, Stellar Core and workspace remain shared SPMT authorities." },
      { title: "Green safety", detail: "Provider output and unported donor automation remain disabled until their bounded adapters are verified." },
    ],
    note: "Browser shell restored defensively so a retained catalog entry cannot open a dead route while parity work continues.",
  }),
});

export const BOUNDED_APP_PATHS = new Set(Object.keys(PAGES));

export function renderBoundedAppPage(pathname: string, buildSha: string) {
  const page = PAGES[pathname];
  if (!page) throw new Error(`Unknown bounded app path: ${pathname}`);
  const cards = page.capabilities.map((item) => `<article><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>${escapeHtml(page.name)} · SpaceMountain Green</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f8f8fc;background:#030407;--accent:${page.accent}}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#030407}body{min-height:100dvh;background:linear-gradient(135deg,rgba(3,4,7,.36),rgba(3,4,7,.88)),url('${page.background}') center/cover fixed no-repeat;overflow:auto}
    body::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 14% 16%,color-mix(in srgb,var(--accent) 26%,transparent),transparent 34%),linear-gradient(90deg,rgba(0,0,0,.05),rgba(0,0,0,.42))}
    main{position:relative;z-index:1;width:min(1120px,calc(100% - 28px));min-height:100dvh;margin:auto;padding:clamp(24px,6vw,72px) 0;display:grid;align-content:center;gap:18px}
    header{padding:clamp(20px,4vw,42px);border:1px solid color-mix(in srgb,var(--accent) 42%,rgba(255,255,255,.14));border-radius:28px;background:rgba(7,8,13,.68);backdrop-filter:blur(20px);box-shadow:0 28px 80px rgba(0,0,0,.45)}
    header span{font-size:10px;letter-spacing:.2em;font-weight:900;color:var(--accent)}h1{margin:8px 0 10px;font-size:clamp(38px,7vw,76px);line-height:.94;letter-spacing:-.04em}header p{max-width:760px;margin:0;color:#c6c7cf;font-size:clamp(13px,2vw,17px);line-height:1.6}
    section{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}article{min-height:150px;padding:20px;border:1px solid rgba(255,255,255,.14);border-radius:22px;background:rgba(8,9,15,.56);backdrop-filter:blur(16px)}article strong{font-size:15px}article p{margin:9px 0 0;color:#b9bbc5;font-size:12px;line-height:1.55}
    footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:rgba(5,6,10,.55);color:#92949e;font-size:10px;backdrop-filter:blur(14px)}footer b{color:var(--accent)}
    @media(max-width:720px){main{width:min(100% - 18px,760px);padding:18px 0 24px;align-content:start}header{border-radius:22px;padding:22px 18px}h1{font-size:clamp(36px,12vw,58px)}section{grid-template-columns:1fr}article{min-height:0;padding:16px;border-radius:18px}footer{align-items:flex-start;flex-direction:column}}
    @media(orientation:landscape) and (max-height:560px){main{padding:10px 0;gap:9px;align-content:start}header{padding:14px 18px;border-radius:18px}h1{font-size:clamp(30px,7vw,48px);margin:5px 0 6px}header p{font-size:11px;line-height:1.4}section{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}article{min-height:0;padding:11px;border-radius:15px}article p{font-size:9px;line-height:1.35;margin-top:5px}footer{padding:8px 12px;flex-direction:row}}
  </style>
</head>
<body>
  <main>
    <header><span>${escapeHtml(page.eyebrow)} · GREEN SPRITE</span><h1>${escapeHtml(page.name)}</h1><p>${escapeHtml(page.description)}</p></header>
    <section aria-label="Ported capabilities">${cards}</section>
    <footer><span>${escapeHtml(page.note)}</span><b>Build ${escapeHtml(buildSha.slice(0, 12))}</b></footer>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
