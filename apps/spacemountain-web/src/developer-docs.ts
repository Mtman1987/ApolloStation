export const DEVELOPER_MANIFEST_EXAMPLE = Object.freeze({
  appId: "my-community-app",
  name: "My Community App",
  description: "A developer-owned app registered through the SPMT catalog.",
  version: "1.0.0",
  launchUrl: "https://app.example.com/spmt",
  iconUrl: "https://app.example.com/icon.png",
  allowedScopes: ["identity:read", "xp:read"],
  surfaces: ["shell", "standalone"],
  status: "active",
});

export function renderDeveloperDocsPage(buildSha: string) {
  const manifest = JSON.stringify(DEVELOPER_MANIFEST_EXAMPLE, null, 2);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>SPMT Developer App Quickstart</title>
  <link rel="stylesheet" href="/assets/web/developer-docs.css">
</head>
<body>
  <header class="docs-header">
    <a href="/">← ApolloStation</a>
    <span>SPMT DEVELOPER DOCS</span>
    <small>Build ${escapeHtml(buildSha)}</small>
  </header>
  <main>
    <section class="hero">
      <span>APP CATALOG · V1</span>
      <h1>Bring an app into the ecosystem without a hardcoded tile.</h1>
      <p>A developer supplies the identity, launch URL, surfaces, and requested scopes. ApolloStation validates that manifest and the public SPMT SDK registers it. Registration creates the catalog record; tenant installation and permission grants remain a separate human decision.</p>
      <div class="actions"><a class="primary" href="/#developer-console">Open Add Developer App</a><a href="/docs/examples/app-manifest.json">View example manifest</a></div>
    </section>

    <nav class="toc" aria-label="Developer documentation">
      <a href="#quickstart">UI quickstart</a><a href="#manifest">Manifest</a><a href="#sdk">SDK</a><a href="#lifecycle">Lifecycle</a><a href="#troubleshooting">Troubleshooting</a>
    </nav>

    <section id="quickstart">
      <span>QUICKSTART</span><h2>Register through the human-facing UI</h2>
      <ol>
        <li>Sign into ApolloStation with a developer or catalog-publisher account.</li>
        <li>Select <strong>Add developer app</strong>.</li>
        <li>Enter the fields manually, paste manifest JSON, or import an HTTPS manifest URL.</li>
        <li>Review the exact manifest preview and acknowledge the requested scopes.</li>
        <li>Select <strong>Register app through SDK</strong>. The UI calls <code>SpmtClient.registerApp()</code>; it does not inject a card locally.</li>
        <li>Refresh Shipyard and install the registered app for a tenant. Installation is where the tenant approves scopes.</li>
      </ol>
      <aside>Green sandbox tip: use <strong>Load Chat Tag example</strong> to load its editable manifest into the generic form. Nothing is registered until you review the form and submit it.</aside>
    </section>

    <section id="manifest">
      <span>MANIFEST</span><h2>Host or paste one JSON document</h2>
      <p>Host the document at an HTTPS URL such as <code>https://app.example.com/.well-known/spmt-app.json</code>, or paste the same JSON into the Developer Console.</p>
      <pre><code>${escapeHtml(manifest)}</code></pre>
      <h3>Field reference</h3>
      <div class="table-wrap"><table><thead><tr><th>Field</th><th>Purpose</th><th>Rules</th></tr></thead><tbody>
        <tr><td><code>appId</code></td><td>Stable catalog identity</td><td>Never change it for later versions.</td></tr>
        <tr><td><code>name</code></td><td>Human-facing app name</td><td>Shown in Shipyard.</td></tr>
        <tr><td><code>description</code></td><td>Short capability summary</td><td>No secrets or credentials.</td></tr>
        <tr><td><code>version</code></td><td>Developer release version</td><td>Update when behavior changes.</td></tr>
        <tr><td><code>launchUrl</code></td><td>App entry point</td><td>HTTPS outside localhost.</td></tr>
        <tr><td><code>iconUrl</code></td><td>Optional catalog art</td><td>HTTPS; omit instead of using an empty value.</td></tr>
        <tr><td><code>allowedScopes</code></td><td>Maximum permissions the app may request</td><td>Installation may grant fewer, never more.</td></tr>
        <tr><td><code>surfaces</code></td><td>Supported presentation modes</td><td><code>shell</code>, <code>standalone</code>, <code>overlay</code>, or <code>popout</code>.</td></tr>
        <tr><td><code>status</code></td><td>Catalog visibility</td><td><code>active</code> is visible; <code>disabled</code> is retained but hidden.</td></tr>
      </tbody></table></div>
    </section>

    <section id="sdk">
      <span>SDK QUICKSTART</span><h2>The UI and code use the same operation</h2>
      <pre><code>import { SpmtClient } from "@spmt/sdk";

const spmt = new SpmtClient({
  baseUrl: "https://spmt.example.com",
  appId: "developer-console",
  getAccessToken: () =&gt; developerSessionToken,
});

const manifest = ${escapeHtml(manifest)};
await spmt.registerApp(manifest);</code></pre>
      <p>The authenticated caller needs <code>apps:register</code>. Browser sessions use an HttpOnly cookie; do not put user tokens, provider secrets, OAuth client secrets, or webhook secrets in a manifest.</p>
    </section>

    <section id="lifecycle">
      <span>LIFECYCLE</span><h2>Registration is not installation</h2>
      <div class="steps">
        <article><strong>1 · Register</strong><p>Developer publishes the catalog identity and maximum scope request.</p></article>
        <article><strong>2 · Review</strong><p>SPMT validates URLs, surfaces, scopes, and the publisher's permission.</p></article>
        <article><strong>3 · Install</strong><p>A tenant explicitly grants allowed scopes and enables the app.</p></article>
        <article><strong>4 · Launch</strong><p>SpaceMountain opens only a registered, installed, enabled surface.</p></article>
      </div>
      <p>Submitting the same <code>appId</code> updates the existing catalog record while preserving its original creation time. Use that path for new versions; do not create a new identity for every release.</p>
    </section>

    <section id="troubleshooting">
      <span>TROUBLESHOOTING</span><h2>Common registration failures</h2>
      <div class="trouble">
        <details open><summary>“Only an authorized catalog publisher may register an app”</summary><p>Sign in with an account carrying <code>apps:register</code>. Ordinary tenant members can browse and install approved apps but cannot publish catalog records.</p></details>
        <details><summary>The manifest URL cannot be imported</summary><p>Use HTTPS, remove embedded credentials, return JSON directly without a redirect, and keep the response small. The Green Sprite additionally permits only hosts allowed by its deny-by-default network policy. Paste JSON or use the form when a development host is not allowlisted.</p></details>
        <details><summary>“launchUrl must use HTTPS”</summary><p>Production apps must use HTTPS. Plain HTTP is accepted only for localhost development inside an isolated environment.</p></details>
        <details><summary>The app registered but does not appear</summary><p>Confirm <code>status</code> is <code>active</code>, refresh Shipyard, and verify the current session can read the catalog. A disabled record remains stored but is intentionally hidden.</p></details>
        <details><summary>The app appears but cannot launch</summary><p>Registration alone is not enough. Install it for the current tenant, approve a subset of <code>allowedScopes</code>, and confirm its chosen surface is listed in <code>surfaces</code>.</p></details>
        <details><summary>A scope is rejected</summary><p>Use letters, numbers, dots, asterisks, colons, underscores, or hyphens. Remove duplicates. Installation cannot grant a scope absent from <code>allowedScopes</code>.</p></details>
        <details><summary>Provider calls fail in Green</summary><p>That is expected. Green keeps Discord, Twitch, Kick, LiveKit, webhooks, workers, and production databases disconnected. Registration and UI testing must work without those providers.</p></details>
      </div>
    </section>
  </main>
</body>
</html>`;
}

export const DEVELOPER_DOCS_CSS = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#edf5ff;background:#050815;--panel:#0b1228;--line:#8da8dd38;--cyan:#7ee7ff;--green:#72f1b8}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 15% -5%,#213b74 0,transparent 35%),radial-gradient(circle at 100% 28%,#351d68 0,transparent 34%),#050815;line-height:1.6}.docs-header{position:sticky;z-index:5;top:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px max(18px,calc((100vw - 1050px)/2));background:#0b1228ee;border-bottom:1px solid var(--line);backdrop-filter:blur(16px)}.docs-header a,.actions a,.toc a{color:#d8e7ff;text-decoration:none}.docs-header span,section>span{font-size:11px;letter-spacing:.18em;font-weight:900;color:var(--cyan)}.docs-header small{color:#7f91b3}main{width:min(1050px,calc(100% - 32px));margin:auto;padding:64px 0 100px}.hero{padding:clamp(24px,5vw,56px);border:1px solid var(--line);border-radius:28px;background:linear-gradient(145deg,#0d1731e8,#080d1dde);box-shadow:0 35px 100px #0008}.hero h1{font-size:clamp(38px,7vw,76px);line-height:1;margin:18px 0 24px;max-width:900px}.hero p,section>p{color:#b8c6df;max-width:850px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}.actions a{border:1px solid var(--line);border-radius:12px;padding:11px 15px;font-weight:800;background:#ffffff08}.actions .primary{color:#06101a;background:linear-gradient(135deg,var(--green),var(--cyan));border:0}.toc{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 50px}.toc a{padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:#0b1228aa;font-size:13px}section:not(.hero){scroll-margin-top:90px;margin-top:58px}h2{font-size:clamp(28px,4vw,44px);line-height:1.1;margin:8px 0 20px}h3{margin-top:30px}li{margin:9px 0;color:#ccd8ec}aside{margin-top:22px;padding:16px 18px;border:1px solid #72f1b855;border-radius:14px;background:#72f1b80d;color:#c9fbe3}code{font-family:"SFMono-Regular",Consolas,monospace;color:#a9eeff}pre{overflow:auto;padding:20px;border:1px solid var(--line);border-radius:18px;background:#030712;color:#dce8ff;line-height:1.5}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:18px}table{width:100%;border-collapse:collapse;background:#081022}th,td{padding:13px 15px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--cyan);font-size:11px;letter-spacing:.1em;text-transform:uppercase}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.steps article{padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}.steps p{font-size:13px;color:#aebbd3}.trouble{display:grid;gap:10px}.trouble details{border:1px solid var(--line);border-radius:15px;background:var(--panel);padding:14px 17px}.trouble summary{cursor:pointer;font-weight:800}.trouble p{color:#b8c6df;margin-bottom:4px}@media(max-width:760px){.docs-header span{display:none}main{padding-top:34px}.steps{grid-template-columns:1fr 1fr}}@media(max-width:480px){.steps{grid-template-columns:1fr}.hero h1{font-size:39px}}
`;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
