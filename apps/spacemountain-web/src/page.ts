export function renderSpaceMountainPage(nonce: string, buildSha: string, candidateApp = false) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>SpaceMountain Green Sandbox</title>
  <link rel="stylesheet" href="/assets/web/sandbox.css">
  <script type="importmap" nonce="${nonce}">{"imports":{"@spmt/contracts":"/assets/contracts/index.js","@spmt/embed":"/assets/embed/index.js","@spmt/sdk":"/assets/sdk/index.js","@spmt/ui":"/assets/ui/index.js","@spmt/spacemountain":"/assets/spacemountain/index.js","@spmt/spacemountain/ui":"/assets/spacemountain/shell-ui.js"}}</script>
  <script type="module" src="/assets/web/client.js" nonce="${nonce}"></script>
</head>
<body>
  <header class="sandbox-guardrail">
    <div><strong>GREEN SPRITE SANDBOX</strong><span>private · isolated database · outbound actions off</span></div>
    <nav aria-label="Sandbox controls">
      <span id="sandbox-status" class="sandbox-status" role="status" aria-live="polite">Checking SPMT…</span>
      <a href="/docs/developers">Developer docs</a>
      <button id="refresh-shell" type="button" hidden>Refresh</button>
      <button id="open-developer-console" type="button" hidden>Add developer app</button>
      <button id="logout" type="button" hidden>Sign out</button>
    </nav>
  </header>
  <main id="auth-view" class="auth-view" hidden>
    <section class="auth-intro">
      <img class="auth-product-logo" src="/assets/product/space-logo-main.png" alt="SpaceMountain">
      <span>THE UNIVERSE ONLINE · PRIVATE PREVIEW</span>
      <h1>One command bridge for every creator tool.</h1>
      <p>Enter the clean SpaceMountain ecosystem running inside this private Sprite. The visual experience is shared; its data remains fully isolated from Blue.</p>
      <ul>
        <li>Stellar Core provides persona-neutral shared AI.</li>
        <li>Stella is the app-neutral Community Assistant.</li>
        <li>Tenant personas remain in the separate apps that use these developer contracts.</li>
        <li>Shipyard apps come from the SPMT registry.</li>
      </ul>
    </section>
    <section class="auth-panels" aria-label="Sandbox account access">
      <form id="login-form" autocomplete="on">
        <span>RETURNING TEST CAPTAIN</span>
        <h2>Sign in</h2>
        <label>Username<input name="username" autocomplete="username" maxlength="120" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" minlength="12" maxlength="256" required></label>
        <button type="submit">Enter SpaceMountain</button>
      </form>
      <form id="register-form" autocomplete="on">
        <span>FIRST SANDBOX VISIT</span>
        <h2>Create a test captain</h2>
        <label>Display name<input name="displayName" autocomplete="name" maxlength="120" required></label>
        <label>Username<input name="username" autocomplete="username" maxlength="120" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>
        <button type="submit">Create isolated account</button>
      </form>
    </section>
  </main>
  <main id="shell-view" hidden><div id="spacemountain-root"></div></main>
  <dialog id="developer-dialog" aria-labelledby="developer-dialog-title">
    <div class="dialog-heading"><div><span>SPMT APP CATALOG · V1</span><h2 id="developer-dialog-title">Add developer app</h2><p>Supply an app manifest, review the exact catalog record, then register it through the public SDK.</p></div><button id="close-developer-console" type="button" aria-label="Close developer console">Close</button></div>
    <section class="manifest-tools" aria-label="Manifest import tools">
      <label>Manifest URL <input id="developer-manifest-url" type="url" inputmode="url" placeholder="https://app.example.com/.well-known/spmt-app.json"></label>
      <button id="import-developer-manifest" type="button">Import HTTPS manifest</button>
      <label class="wide">Or paste manifest JSON <textarea id="developer-manifest-json" rows="7" spellcheck="false" placeholder='{"appId":"my-app", ...}'></textarea></label>
      <button id="load-developer-json" type="button">Load pasted JSON</button>
      ${candidateApp ? '<button id="load-candidate-example" type="button">Load Nebula Arcade example</button>' : ""}
    </section>
    <form id="developer-form">
      <div class="developer-fields">
        <label>App ID <input name="appId" required maxlength="200" pattern="[A-Za-z0-9._:@/-]+" placeholder="my-community-app"><small>Stable machine identity; do not change between versions.</small></label>
        <label>App name <input name="name" required maxlength="160" placeholder="My Community App"></label>
        <label class="wide">Description <textarea name="description" required maxlength="8000" rows="3" placeholder="What this app does for people in the ecosystem."></textarea></label>
        <label>Version <input name="version" required maxlength="80" value="1.0.0" placeholder="1.0.0"></label>
        <label>Status <select name="status"><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
        <label class="wide">Launch URL <input name="launchUrl" type="url" required maxlength="2048" placeholder="https://app.example.com/spmt"></label>
        <label class="wide">Icon URL <input name="iconUrl" type="url" maxlength="2048" placeholder="https://app.example.com/icon.png (optional)"></label>
        <fieldset class="wide"><legend>Surfaces</legend><label><input type="checkbox" name="surfaces" value="shell"> Shell</label><label><input type="checkbox" name="surfaces" value="standalone" checked> Standalone</label><label><input type="checkbox" name="surfaces" value="overlay"> Overlay</label><label><input type="checkbox" name="surfaces" value="popout"> Popout</label></fieldset>
        <label class="wide">Allowed scopes <textarea name="allowedScopes" rows="3" placeholder="identity:read, xp:read"></textarea><small>Comma or newline separated. A tenant may grant fewer scopes during installation.</small></label>
      </div>
      <section class="manifest-review" aria-labelledby="manifest-review-title"><div><span>REVIEW</span><h3 id="manifest-review-title">Exact registration payload</h3></div><pre id="developer-manifest-preview">Complete the required fields to preview the manifest.</pre></section>
      <label class="developer-ack"><input id="developer-acknowledgement" type="checkbox" required> I reviewed the app identity, launch URL, surfaces, and maximum requested scopes.</label>
      <div class="developer-actions"><button id="reset-developer-form" type="button">Reset</button><button id="register-developer-app" type="submit">Register app through SDK</button></div>
    </form>
    <p class="developer-help">Registration adds or updates the catalog record. It does not install the app for a tenant. <a href="/docs/developers">Read the quickstart and troubleshooting guide.</a></p>
  </dialog>
  <dialog id="record-dialog"><form method="dialog"><button aria-label="Close">Close</button></form><h2 id="record-dialog-title">Commlink</h2><div id="record-dialog-body"></div></dialog>
  <footer class="sandbox-footer">Build ${escapeHtml(buildSha)} · App registration uses the live SPMT SDK · provider actions remain off.</footer>
</body>
</html>`;
}

export const SANDBOX_CSS = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#eef5ff;background:#050815;--guard-height:58px}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% -10%,#253b75 0,transparent 42%),radial-gradient(circle at 100% 35%,#321c68 0,transparent 36%),#050815}.sandbox-guardrail{position:fixed;z-index:1000;top:0;left:0;right:0;min-height:var(--guard-height);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 18px;background:#10172ef2;border-bottom:1px solid #6ee7f533;backdrop-filter:blur(18px);box-shadow:0 10px 40px #0008}.sandbox-guardrail div{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.sandbox-guardrail strong{font-size:12px;letter-spacing:.14em;color:#7ee7ff}.sandbox-guardrail span{font-size:12px;color:#a9b8d9}.sandbox-guardrail nav{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.sandbox-guardrail a{color:#c7d8f5;text-decoration:none;font-size:13px;font-weight:750}.sandbox-guardrail button,.auth-panels button,#developer-dialog button{appearance:none;border:1px solid #7ee7ff55;border-radius:10px;background:#152348;color:#eef5ff;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer}.sandbox-guardrail button:hover,.auth-panels button:hover,#developer-dialog button:hover{background:#1f3670}.sandbox-status{max-width:min(38vw,520px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 9px;border:1px solid #7ee7ff33;border-radius:999px;background:#0b1228aa;color:#bcd0f6!important;font-size:10px!important;text-align:center}.sandbox-status[data-kind="error"]{border-color:#ff7b9a88;color:#ffd2dc!important}.sandbox-status[data-kind="ready"]{border-color:#72f1b888;color:#c8ffe5!important}.auth-view{min-height:100vh;padding:140px 28px 90px;display:grid;grid-template-columns:minmax(260px,1fr) minmax(460px,1.35fr);gap:54px;align-items:center;max-width:1220px;margin:auto}.auth-view[hidden],#shell-view[hidden]{display:none}.auth-intro>span,.auth-panels form>span{font-size:12px;letter-spacing:.18em;color:#7ee7ff;font-weight:800}.auth-intro h1{font-size:clamp(38px,6vw,78px);line-height:.96;margin:18px 0 24px;max-width:720px}.auth-intro p{font-size:18px;line-height:1.65;color:#b6c4df;max-width:650px}.auth-intro ul{padding-left:20px;color:#d8e3f7;line-height:1.8}.auth-panels{display:grid;grid-template-columns:1fr 1fr;gap:16px}.auth-panels form{display:flex;flex-direction:column;gap:14px;padding:24px;border:1px solid #8da8dd38;border-radius:20px;background:#0b1228dc;box-shadow:0 24px 60px #0007}.auth-panels h2{margin:0 0 5px;font-size:28px}.auth-panels label{display:grid;gap:7px;color:#b9c7e2;font-size:13px;font-weight:700}.auth-panels input{width:100%;padding:12px;border:1px solid #87a3dc4d;border-radius:10px;background:#060b18;color:#fff;font:inherit;outline:none}.auth-panels input:focus{border-color:#7ee7ff;box-shadow:0 0 0 3px #7ee7ff22}.auth-panels button{margin-top:5px;padding:12px;background:linear-gradient(135deg,#315ed7,#7634c9);border:0}.sandbox-footer{position:fixed;z-index:999;left:16px;bottom:10px;padding:6px 9px;border-radius:7px;background:#050815cc;color:#7586a9;font-size:10px;pointer-events:none}#shell-view{min-height:100vh;padding-top:var(--guard-height)}#developer-dialog{width:min(980px,calc(100vw - 28px));max-height:90vh;padding:clamp(18px,4vw,34px);border:1px solid #8da8dd55;border-radius:22px;background:#080f22;color:#eef5ff;box-shadow:0 30px 100px #000c}#developer-dialog::backdrop,#record-dialog::backdrop{background:#03050ad9;backdrop-filter:blur(5px)}.dialog-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}.dialog-heading span,.manifest-review span{font-size:11px;letter-spacing:.16em;color:#7ee7ff;font-weight:900}.dialog-heading h2{font-size:34px;margin:7px 0}.dialog-heading p{color:#aebfdb;margin:0;max-width:680px}.manifest-tools{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:end;margin:26px 0;padding:18px;border:1px solid #8da8dd30;border-radius:16px;background:#0c1730}.manifest-tools .wide{grid-column:1/-1}.manifest-tools label,.developer-fields label{display:grid;gap:7px;color:#c7d5ec;font-size:13px;font-weight:700}.manifest-tools input,.manifest-tools textarea,.developer-fields input,.developer-fields textarea,.developer-fields select{width:100%;padding:11px 12px;border:1px solid #87a3dc4d;border-radius:9px;background:#040914;color:#fff;font:inherit;outline:none}.manifest-tools textarea,.developer-fields textarea,#developer-manifest-preview{font-family:"SFMono-Regular",Consolas,monospace}.manifest-tools input:focus,.manifest-tools textarea:focus,.developer-fields input:focus,.developer-fields textarea:focus,.developer-fields select:focus{border-color:#7ee7ff;box-shadow:0 0 0 3px #7ee7ff22}.developer-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.developer-fields .wide{grid-column:1/-1}.developer-fields small{color:#8194b6;font-weight:500}.developer-fields fieldset{display:flex;gap:16px;flex-wrap:wrap;padding:13px 15px;border:1px solid #87a3dc4d;border-radius:10px}.developer-fields fieldset label{display:flex;align-items:center;gap:6px}.developer-fields fieldset input{width:auto}.manifest-review{margin-top:22px;padding:18px;border:1px solid #72f1b84d;border-radius:16px;background:#050a16}.manifest-review h3{margin:5px 0 14px}.manifest-review pre{overflow:auto;max-height:330px;margin:0;color:#bcebd8;white-space:pre-wrap}.developer-ack{display:flex;align-items:flex-start;gap:10px;margin:18px 0;color:#d4e1f6;font-weight:700}.developer-ack input{margin-top:4px}.developer-actions{display:flex;justify-content:flex-end;gap:10px}.developer-actions button[type="submit"]{border:0!important;color:#04111a!important;background:linear-gradient(135deg,#72f1b8,#7ee7ff)!important}.developer-help{margin:22px 0 0;color:#93a5c4}.developer-help a{color:#7ee7ff}#record-dialog{width:min(720px,calc(100vw - 32px));max-height:80vh;border:1px solid #8da8dd55;border-radius:18px;background:#0b1228;color:#eef5ff;box-shadow:0 30px 100px #000b}#record-dialog form{float:right}#record-dialog button{border:1px solid #8da8dd55;border-radius:8px;background:#152348;color:#fff;padding:7px 10px}#record-dialog-body{display:grid;gap:10px;clear:both}#record-dialog-body article{padding:12px;border:1px solid #8da8dd30;border-radius:12px;background:#070c1a}#record-dialog-body p{white-space:pre-wrap;color:#c8d5ec}@media(max-width:900px){:root{--guard-height:88px}.sandbox-guardrail{align-items:flex-start}.sandbox-guardrail div{display:grid;gap:3px}.auth-view{grid-template-columns:1fr;padding:155px 16px 85px}.auth-panels{grid-template-columns:1fr}.manifest-tools{grid-template-columns:1fr}.manifest-tools>*{grid-column:1!important}.developer-fields{grid-template-columns:1fr}.developer-fields>*{grid-column:1!important}}@media(max-width:700px){.sandbox-status{order:10;max-width:100%;flex-basis:100%}}@media(max-width:560px){.dialog-heading{display:grid}.developer-actions{display:grid}.sandbox-guardrail a{display:none}}
`;

export const SANDBOX_POLISH_CSS = `
:root{--guard-height:40px;color:#f7f7fb;background:#030407}
body{background:linear-gradient(rgba(3,4,8,.3),rgba(3,4,8,.78)),url('/assets/product/theme-solar-flare-background.webp') center/cover fixed no-repeat,#030407}
body::before{position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 9% 20%,#f9731626,transparent 31%);content:""}
.sandbox-guardrail{min-height:var(--guard-height);padding:5px 16px;background:#050609e8;border-bottom-color:#ffffff17;box-shadow:0 6px 28px #0009}
.sandbox-guardrail div{gap:9px}.sandbox-guardrail strong{font-size:8px;color:#fbbf24}.sandbox-guardrail span{font-size:9px;color:#858894}.sandbox-guardrail nav{gap:4px}.sandbox-guardrail a{font-size:10px;padding:6px 7px}.sandbox-guardrail button{min-height:28px;padding:5px 9px;border-color:#ffffff17;border-radius:9px;background:#ffffff0a;font-size:10px}.sandbox-guardrail button:hover{background:#f973161c;border-color:#f9731666}
.sandbox-status{background:#06070baa;border-color:#ffffff20;color:#b9bbc4;box-shadow:none;font-size:9px}
.auth-view{position:relative;min-height:100vh;max-width:1420px;padding:110px 42px 78px;grid-template-columns:minmax(360px,1.1fr) minmax(520px,.9fr);gap:70px}
.auth-intro{display:flex;flex-direction:column;align-items:flex-start}.auth-product-logo{width:min(530px,80vw);height:165px;margin:0 0 -20px -38px;object-fit:contain;object-position:left center;filter:drop-shadow(0 12px 28px #000b)}
.auth-intro>span,.auth-panels form>span{font-size:9px;color:#fbbf24}.auth-intro h1{max-width:760px;margin:16px 0 22px;font-size:clamp(48px,6vw,84px);letter-spacing:-.045em;line-height:.96;text-wrap:balance}.auth-intro p{font-size:15px;color:#b6b8c1;max-width:650px}.auth-intro ul{display:grid;grid-template-columns:1fr 1fr;gap:5px 22px;margin-top:19px;padding-left:18px;color:#a8aab4;font-size:11px;line-height:1.55}
.auth-panels{grid-template-columns:1fr 1fr;align-items:stretch}.auth-panels form{position:relative;padding:24px;border-color:#ffffff18;border-radius:24px;background:linear-gradient(145deg,#0a0b12e8,#05060bdb);box-shadow:0 28px 80px #0009;backdrop-filter:blur(24px)}.auth-panels form::before{position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(135deg,#f9731612,transparent 34%);content:""}.auth-panels form>*{position:relative}.auth-panels h2{font-size:25px}.auth-panels label{color:#b8bac3;font-size:11px}.auth-panels input{border-color:#ffffff1f;border-radius:12px;background:#030409cc;padding:12px}.auth-panels input:focus{border-color:#f97316;box-shadow:0 0 0 3px #f9731622}.auth-panels button{border:0;border-radius:13px;background:linear-gradient(135deg,#fbbf24,#f97316);color:#1b1005;padding:12px;font-weight:900;box-shadow:0 14px 34px #f9731625}.auth-panels button:hover{background:linear-gradient(135deg,#ffd45a,#ff8a31)}
#developer-dialog,#record-dialog{border-color:#ffffff1f;background:linear-gradient(145deg,#0a0b12f5,#05060bf5);border-radius:26px}.dialog-heading span,.manifest-review span{color:#fbbf24}.manifest-tools{border-color:#ffffff17;background:#ffffff08}.manifest-tools input,.manifest-tools textarea,.developer-fields input,.developer-fields textarea,.developer-fields select{border-color:#ffffff20;background:#030409}.manifest-tools input:focus,.manifest-tools textarea:focus,.developer-fields input:focus,.developer-fields textarea:focus,.developer-fields select:focus{border-color:#f97316;box-shadow:0 0 0 3px #f9731622}.manifest-review{border-color:#f9731645;background:#030409}.manifest-review pre{color:#f7c881}.developer-actions button[type="submit"]{color:#1b1005!important;background:linear-gradient(135deg,#fbbf24,#f97316)!important}.developer-help a{color:#fbbf24}
.sandbox-footer{background:#030407d9;color:#666976}
@media(max-width:1000px){.auth-view{grid-template-columns:1fr;padding:115px 20px 84px}.auth-panels{max-width:760px}.auth-intro ul{max-width:700px}}
@media(max-width:700px){:root{--guard-height:68px}.sandbox-guardrail{align-items:flex-start}.auth-view{padding-top:130px}.auth-panels{grid-template-columns:1fr}.auth-product-logo{height:120px}.auth-intro h1{font-size:48px}.auth-intro ul{grid-template-columns:1fr}}
@media(max-width:560px){.sandbox-guardrail a{display:none}.auth-view{padding-inline:14px}.auth-intro h1{font-size:42px}.auth-intro p{font-size:13px}}
`;

export const SANDBOX_BEACON_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Orbit Beacon</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050815;color:#eef5ff;font:18px system-ui}.card{max-width:620px;padding:42px;border:1px solid #72f1b855;border-radius:24px;background:#0b1228;box-shadow:0 25px 80px #000}.dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:#72f1b8;box-shadow:0 0 22px #72f1b8}small{color:#9fb0d1}</style></head><body><main class="card"><span class="dot"></span><h1>Orbit Beacon is ready.</h1><p>This inert fixture came from the SPMT app registry. SpaceMountain discovered and launched it without a hardcoded app tile.</p><small>No provider account, bot, webhook, worker, or queue is connected.</small></main></body></html>`;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
