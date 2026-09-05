import { PRODUCT_UI_CSS } from "@spmt/ui";

interface BoundedAppPage {
  id: string;
  path: string;
  scene: string;
  name: string;
  eyebrow: string;
  description: string;
  status: string;
  note: string;
  features: readonly { title: string; detail: string }[];
}

export type BoundedAppSurface = "shell" | "standalone";

const PAGES: readonly BoundedAppPage[] = [
  {
    id: "discord-stream-hub",
    path: "/apps/discord-stream-hub",
    scene: "/assets/product/discord-stream-hub-background.webp",
    name: "Discord Stream Hub",
    eyebrow: "Community Operations",
    description: "Live stream monitoring, shoutout routing, spotlight rotation, calendar, moderation, member linking, and the Discord-facing community surface.",
    status: "Green donor surface",
    note: "Live provider delivery remains gated by the donor parity and sandbox proof tracked in the Apollo parity ledger.",
    features: [
      { title: "Live directory", detail: "Track community creators and preserve truthful live/offline state." },
      { title: "Shoutout routes", detail: "Route member support through the existing group and spotlight rules." },
      { title: "Community tools", detail: "Calendar, moderation, onboarding, and member-linking controls stay in one product." },
      { title: "XP producer", detail: "Publish idempotent support outcomes to canonical SPMT XP instead of a private balance." },
    ],
  },
  {
    id: "hearmeout",
    path: "/apps/hearmeout",
    scene: "/assets/product/hearmeout-background.webp",
    name: "HearMeOut",
    eyebrow: "Voice & Media Rooms",
    description: "Persistent rooms, LiveKit voice sessions, Bot Hub and watch queues, Discord Activity entry, provider identity, and focused media output.",
    status: "Green donor surface",
    note: "The room authority and transport contracts stay truthful while live provider/media adapters complete sandbox proof.",
    features: [
      { title: "Rooms", detail: "Tenant-private room state, invitations, passwords, presence, and restart-safe membership." },
      { title: "Voice", detail: "LiveKit participation and publishing remain scoped to admitted room members." },
      { title: "Bot Hub / Watch", detail: "Bridge, music bot, persona controls, queue playback, and synchronized watch state stay compact and room-scoped." },
      { title: "OBS output", detail: "Focused controls-free room/media output stays separate from the general workspace editor." },
    ],
  },
  {
    id: "mountainview",
    path: "/apps/mountainview",
    scene: "/assets/product/mountainview-background.webp",
    name: "MountainView",
    eyebrow: "Mobile Device Bridge",
    description: "Phone, Bluetooth, camera, voice, media, and paired-device control using the SPMT device authority and Companion relay.",
    status: "Green donor surface",
    note: "Hardware actions remain local and capability-scoped; complete device and visual parity still requires real-device proof.",
    features: [
      { title: "Pairing", detail: "SPMT owns device grants, revocation, tenant boundaries, and declared capabilities." },
      { title: "Voice routing", detail: "Route community, media, streaming, and OBS intents to the app that actually owns them." },
      { title: "Capture", detail: "Camera and phone media stay permissioned and local unless a user explicitly starts a remote flow." },
      { title: "Relay", detail: "BLE and hardware commands travel through the paired Companion instead of leaking provider credentials." },
    ],
  },
  {
    id: "companion",
    path: "/apps/companion",
    scene: "/assets/product/companion-background.webp",
    name: "SpaceMountain Companion",
    eyebrow: "Local Compute & Control",
    description: "The paired desktop/mobile relay for OBS control, local overlays and popouts, media jobs, device capabilities, and approved local AI work.",
    status: "Green donor surface",
    note: "Local adapters stay capability-scoped and tenant-bound; signed desktop/mobile release proof remains a separate release gate.",
    features: [
      { title: "OBS control", detail: "Only allowlisted scene actions from paired, authorized device grants reach the local adapter." },
      { title: "Overlay windows", detail: "Keep desktop and multi-monitor window state local while consuming canonical overlay grants." },
      { title: "Local media", detail: "Bounded FFmpeg and media-library work remains owned by the Companion machine." },
      { title: "Local AI", detail: "Approved local CPU/GPU capabilities can satisfy Stellar Core jobs before hosted fallbacks." },
    ],
  },
  {
    id: "streamweaver",
    path: "/apps/streamweaver",
    scene: "/assets/product/streamweaver-background.webp",
    name: "StreamWeaver",
    eyebrow: "Creator Automation",
    description: "Tenant-configured personas, commands, redeems, overlays, research, TTS, chat consumption, cards, queues, and creator automation.",
    status: "Green donor surface",
    note: "Stella remains the ecosystem assistant and Athena remains the owner persona; StreamWeaver consumes the shared Chat Gateway and Stellar Core contracts.",
    features: [
      { title: "Personas", detail: "Each tenant owns its configured bot identity, voice, memory policy, aliases, and summon behavior." },
      { title: "Commands", detail: "Preserve commands, actions, redeems, queues, featured messages, and donor behavior route by route." },
      { title: "Overlays", detail: "Publish focused widgets and browser-source renderers through canonical overlay grants." },
      { title: "Research / TTS", detail: "Use public Stellar Core jobs for research and speech instead of private provider execution." },
    ],
  },
];

export const BOUNDED_APP_PATHS = new Set(PAGES.map((page) => page.path));

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '\"': "&quot;",
  })[character] ?? character);
}

function pageForPath(pathname: string) {
  return PAGES.find((page) => pathname === page.path || pathname === `${page.path}/`);
}

function nav(page: BoundedAppPage, surface: BoundedAppSurface) {
  if (surface !== "standalone") return "";
  return `<aside class="bounded-rocket-dock spmt-product-glass" data-spmt-depth="1" aria-label="${escapeHtml(page.name)} navigation">
    <div class="bounded-app-mark"><img data-themed-app-icon src="/assets/product/app-icons/solar-flare/${escapeHtml(page.id)}.png" alt="${escapeHtml(page.name)}"></div>
    <nav>
      <button type="button" data-spmt-product-nav="overview"><span>Overview</span></button>
      <button type="button" data-spmt-product-nav="capabilities"><span>Capabilities</span></button>
      <button type="button" data-spmt-product-nav="status"><span>Status</span></button>
      <a href="/" aria-label="Back to SpaceMountain"><span>SpaceMountain</span></a>
    </nav>
  </aside>`;
}

export function renderBoundedAppPage(pathname: string, buildSha: string, nonce: string, surface: BoundedAppSurface = "standalone") {
  const page = pageForPath(pathname);
  if (!page) return undefined;
  const featureCards = page.features.map((feature) => `<article class="bounded-feature spmt-product-glass" data-spmt-depth="1">
    <span class="spmt-product-kicker">${escapeHtml(feature.title)}</span>
    <p>${escapeHtml(feature.detail)}</p>
  </article>`).join("");
  const build = escapeHtml(buildSha);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f97316">
  <title>${escapeHtml(page.name)} · SpaceMountain</title>
  <style>${PRODUCT_UI_CSS}
    :root{color-scheme:dark;--spmt-accent:#ff8a1f;--spmt-accent-2:#ffbf69;--spmt-glass-opacity:.76;--spmt-blur:18px;--spmt-stars:1;--spmt-glow:.78;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{color:#f8fafc;background:#050710;overflow:hidden}button,a{font:inherit}
    body[data-spmt-surface="shell"]{background:transparent}
    .bounded-app-root{position:relative;z-index:2;width:100%;height:100%;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:clamp(10px,1.4vw,16px);padding:clamp(14px,2vw,28px);overflow:hidden}
    body[data-spmt-surface="standalone"] .bounded-app-root{min-height:100dvh;height:auto;padding-left:clamp(88px,9vw,126px);overflow-y:auto;overscroll-behavior:contain}
    .bounded-hero{display:grid;grid-template-columns:1fr;gap:24px;align-items:center;padding:clamp(18px,2.5vw,34px);border:1px solid var(--spmt-border);border-radius:28px;min-height:clamp(170px,25vh,250px);box-shadow:0 24px 60px rgba(0,0,0,.28),0 0 calc(28px * var(--spmt-glow)) color-mix(in srgb,var(--spmt-accent) 18%,transparent)}
    .bounded-app-identity{display:flex;align-items:center;gap:clamp(18px,3vw,36px)}.bounded-app-identity>img{width:clamp(96px,13vw,176px);height:clamp(96px,13vw,176px);flex:0 0 auto;object-fit:contain;filter:drop-shadow(0 18px 34px rgba(0,0,0,.55))}.bounded-app-identity>div{min-width:0}.bounded-hero h1{margin:8px 0 10px;font-size:clamp(34px,5vw,72px);line-height:.96;letter-spacing:-.045em}.bounded-hero p{max-width:760px;margin:0;color:#c4c7d2;font-size:clamp(11px,1.15vw,14px);line-height:1.65}
    .bounded-feature-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(9px,1.2vw,14px);min-height:0;align-items:stretch}.bounded-feature{min-width:0;padding:clamp(14px,1.6vw,20px);border:1px solid var(--spmt-border);border-radius:20px;display:flex;flex-direction:column;justify-content:flex-end;box-shadow:0 18px 44px rgba(0,0,0,.2),0 0 calc(18px * var(--spmt-glow)) color-mix(in srgb,var(--spmt-accent) 12%,transparent)}.bounded-feature p{margin:9px 0 0;color:#b5b8c3;font-size:11px;line-height:1.55}.bounded-feature .spmt-product-kicker{color:var(--spmt-accent)}
    .bounded-runtime{display:flex;justify-content:flex-end;align-items:center;padding:13px 16px;border:1px solid var(--spmt-border);border-radius:18px}.bounded-runtime code{color:var(--spmt-accent);font-size:9px;white-space:nowrap}
    [data-bounded-page][hidden]{display:none!important}.bounded-app-root{display:block}.bounded-app-root[data-page="overview"]{overflow:hidden}.bounded-app-root[data-page="overview"] .bounded-hero{height:100%}.bounded-page{height:100%;min-height:0;overflow-y:auto;scrollbar-gutter:stable;overscroll-behavior:contain}.bounded-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.bounded-actions button,.bounded-actions a{padding:10px 14px;border:1px solid var(--spmt-border);border-radius:14px;background:color-mix(in srgb,var(--spmt-accent) 11%,transparent);color:#fff;text-decoration:none;cursor:pointer}.bounded-feature-grid{align-content:start;padding:4px}.bounded-runtime{align-content:center;justify-content:center}.bounded-runtime code{font-size:12px}
    .bounded-rocket-dock{position:fixed;z-index:20;left:16px;top:50%;width:86px;transform:translateY(-50%);padding:9px 7px;border:1px solid var(--spmt-border);border-radius:34px;box-shadow:0 24px 70px rgba(0,0,0,.42)}.bounded-app-mark{width:66px;height:66px;margin:0 auto 6px;display:grid;place-items:center}.bounded-app-mark img{width:62px;height:62px;object-fit:contain;filter:drop-shadow(0 0 12px color-mix(in srgb,var(--spmt-accent) 55%,transparent))}.bounded-rocket-dock nav{display:grid;gap:4px}.bounded-rocket-dock nav button,.bounded-rocket-dock nav a{min-height:42px;border:1px solid transparent;border-radius:13px;background:transparent;color:#9498a5;text-decoration:none;display:grid;place-items:center;padding:7px 4px;text-align:center;cursor:pointer}.bounded-rocket-dock nav button:hover,.bounded-rocket-dock nav button.active,.bounded-rocket-dock nav a:hover{color:#fff;border-color:color-mix(in srgb,var(--spmt-accent) 38%,transparent);background:color-mix(in srgb,var(--spmt-accent) 13%,transparent)}.bounded-rocket-dock nav span{font-size:8px;font-weight:850;line-height:1.05}
    body[data-spmt-surface="standalone"][data-spmt-dock="collapsed"] .bounded-rocket-dock{width:68px;padding:5px;border-radius:34px}body[data-spmt-surface="standalone"][data-spmt-dock="collapsed"] .bounded-rocket-dock nav{display:none}body[data-spmt-surface="standalone"][data-spmt-dock="collapsed"] .bounded-app-mark{width:56px;height:56px;margin:0}
    @media(max-width:980px){.bounded-feature-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bounded-app-root{overflow-y:auto;overscroll-behavior:contain}.bounded-hero{grid-template-columns:1fr}.bounded-hero-side{grid-template-columns:1fr 1fr}}
    @media(max-width:640px){.bounded-app-root,body[data-spmt-surface="standalone"] .bounded-app-root{padding:12px 12px calc(92px + env(safe-area-inset-bottom));overflow-y:auto}.bounded-feature-grid{grid-template-columns:1fr}.bounded-app-identity{align-items:flex-start;flex-direction:column;gap:10px}.bounded-app-identity>img{width:clamp(84px,24vw,128px);height:clamp(84px,24vw,128px)}.bounded-rocket-dock{left:50%;top:auto;bottom:max(10px,env(safe-area-inset-bottom));width:min(94vw,440px);transform:translateX(-50%);border-radius:22px}.bounded-app-mark{display:none}.bounded-rocket-dock nav{grid-template-columns:repeat(4,1fr)}.bounded-hero{min-height:0;padding:18px}.bounded-hero h1{font-size:clamp(31px,12vw,52px)}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
  <script type="importmap" nonce="${nonce}">{"imports":{"@spmt/contracts":"/assets/contracts/index.js","@spmt/embed":"/assets/embed/index.js","@spmt/sdk":"/assets/sdk/index.js","@spmt/ui":"/assets/ui/index.js"}}</script>
  <script type="module" nonce="${nonce}" src="/assets/web/bounded-app-client.js"></script>
</head>
<body class="spmt-product-surface" data-spmt-surface="${surface}" data-spmt-app-id="${escapeHtml(page.id)}" data-spmt-scene="${escapeHtml(page.scene)}">
  ${nav(page, surface)}
  <main id="bounded-app-root" class="bounded-app-root" tabindex="-1">
    <header id="overview" class="bounded-hero spmt-product-glass" data-bounded-page="overview" data-spmt-depth="1">
      <div class="bounded-app-identity">
        <img data-themed-app-icon src="/assets/product/app-icons/solar-flare/${escapeHtml(page.id)}.png" alt="${escapeHtml(page.name)}">
        <div>
          <span class="spmt-product-kicker">${escapeHtml(page.eyebrow)}</span>
          <h1>${escapeHtml(page.name)}</h1>
          <p>${escapeHtml(page.description)}</p>
          <div class="bounded-actions"><button type="button" data-bounded-page-link="capabilities">Capabilities</button><button type="button" data-bounded-page-link="status">Runtime status</button><a href="/?view=workspace">Workspace</a></div>
        </div>
      </div>
    </header>
    <section id="capabilities" class="bounded-feature-grid bounded-page" data-bounded-page="capabilities" aria-label="${escapeHtml(page.name)} capabilities" hidden>${featureCards}</section>
    <footer id="status" class="bounded-runtime bounded-page spmt-product-glass" data-bounded-page="status" data-spmt-depth="2" hidden>
      <code>build ${build}</code>
    </footer>
  </main>
</body>
</html>`;
}
