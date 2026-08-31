import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PRODUCT_UI_CSS } from "@spmt/ui";

export interface ProductAppSectionV1 {
  id: string;
  label: string;
  title: string;
  body: string;
  glyph?: string;
}

export interface ProductAppWebDescriptorV1 {
  appId: string;
  name: string;
  kicker: string;
  tagline: string;
  description: string;
  sceneUrl: string;
  sections: readonly ProductAppSectionV1[];
}

export interface ProductAppWebServerOptionsV1 {
  descriptor: ProductAppWebDescriptorV1;
  port?: number;
  host?: string;
  buildSha?: string;
  renderExtra?: () => string;
  browserJs?: string;
  extraCss?: string;
  handleApi?: (request: IncomingMessage, response: ServerResponse, url: URL) => boolean | Promise<boolean>;
  close?: () => void | Promise<void>;
}

export function createProductAppWebServer(options: ProductAppWebServerOptionsV1) {
  const descriptor = validateDescriptor(options.descriptor);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://spmt.app");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === `/apps/${descriptor.appId}`)) {
        applyProductPageHeaders(response);
        return send(response, 200, renderProductAppWebPage(descriptor, options.buildSha ?? "dev", options.renderExtra?.() ?? "", options.extraCss ?? "", options.browserJs ?? ""), "text/html; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/health/ready") return sendJson(response, 200, { schemaVersion: 1, appId: descriptor.appId, state: "ready" });
      if (options.handleApi && await options.handleApi(request, response, url)) return;
      return sendJson(response, 404, { error: "not_found", message: `Unknown ${descriptor.name} route` });
    } catch (error) {
      if (!response.headersSent) return sendJson(response, 500, { error: "app_web_failure", message: safeError(error) });
      response.destroy(error instanceof Error ? error : undefined);
    }
  });
  return {
    server,
    async listen() { await listen(server, options.port ?? 3200, options.host ?? "127.0.0.1"); },
    async close() { if (server.listening) await close(server); await options.close?.(); },
  };
}

export function renderProductAppWebPage(descriptor: ProductAppWebDescriptorV1, buildSha = "dev", extra = "", extraCss = "", browserJs = "") {
  const app = validateDescriptor(descriptor);
  const nav = [{ id: "home", label: "Home", glyph: "◈" }, ...app.sections.map((section) => ({ id: section.id, label: section.label, glyph: section.glyph ?? "◇" }))];
  const sectionHtml = app.sections.map((section) => `<section class="spmt-app-page" data-spmt-app-page="${escapeHtml(section.id)}" hidden><header><span class="spmt-product-kicker">${escapeHtml(section.label)}</span><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></header><div class="spmt-app-live-slot spmt-product-glass" data-spmt-depth="2" data-spmt-live-slot="${escapeHtml(section.id)}"><strong>Green backend</strong><small>Loading current app state…</small></div></section>`).join("");
  const navHtml = nav.map((item) => `<button type="button" data-spmt-local-nav="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.label)}"><i>${escapeHtml(item.glyph)}</i><span>${escapeHtml(item.label)}</span></button>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f97316"><title>${escapeHtml(app.name)} · SpaceMountain</title><style>${PRODUCT_UI_CSS}${PRODUCT_APP_WEB_CSS}${extraCss}</style></head><body class="spmt-product-surface spmt-owned-app" data-app="${escapeHtml(app.appId)}" data-surface="standalone" data-spmt-page="home" style="--spmt-app-backdrop-image:url('${escapeAttributeUrl(app.sceneUrl)}')"><div class="spmt-product-backdrop" aria-hidden="true"><span class="spmt-product-backdrop-image"></span><span class="spmt-product-backdrop-tint"></span><span class="spmt-product-backdrop-shade"></span><span class="spmt-star-layer"><i></i><i></i><i></i></span></div><main class="spmt-owned-stage"><nav class="spmt-owned-tabs spmt-product-glass" data-spmt-depth="2" aria-label="${escapeHtml(app.name)}">${navHtml}</nav><section class="spmt-app-home" data-spmt-app-page="home"><div class="spmt-owned-hero"><div class="spmt-owned-mark"><img data-spmt-app-logo src="/assets/product/app-icons/solar-flare/${escapeHtml(app.appId)}.png" alt=""><span class="spmt-product-kicker">${escapeHtml(app.kicker)}</span></div><h1>${escapeHtml(app.name)}</h1><p>${escapeHtml(app.tagline)}</p><div class="spmt-owned-actions"><button type="button" class="spmt-owned-button primary" data-spmt-open-first>Open ${escapeHtml(app.sections[0]?.label ?? "app")}</button><button type="button" class="spmt-owned-button" data-spmt-refresh>Refresh backend</button></div><footer><span class="spmt-product-status" data-spmt-runtime-state>Green runtime</span><small>Build ${escapeHtml(buildSha.slice(0, 12))}</small></footer></div></section>${sectionHtml}${extra}</main><script>${PRODUCT_APP_FRAME_CLIENT_JS}${PRODUCT_APP_PAGE_JS.replaceAll("__APP_ID__", JSON.stringify(app.appId))}${browserJs}</script></body></html>`;
}

export async function fetchAppPlatformSnapshot(input: { appId: string; spmtOrigin: string; request: IncomingMessage }) {
  const origin = loopbackOrigin(input.spmtOrigin);
  const cookie = input.request.headers.cookie;
  const headers: Record<string, string> = { accept: "application/json", "x-spmt-app": input.appId };
  if (cookie) headers.cookie = cookie;
  const sessionResponse = await fetch(`${origin}/v1/session`, { headers, redirect: "manual" });
  if (!sessionResponse.ok) throw new Error("Sign in to SpaceMountain before using this app");
  const session = await sessionResponse.json() as Record<string, unknown>;
  const tenantId = Array.isArray(session.tenantIds) && typeof session.tenantIds[0] === "string" ? session.tenantIds[0] : "";
  if (!tenantId) throw new Error("SPMT session has no tenant");
  headers["x-spmt-tenant"] = tenantId;
  const read = async (path: string) => {
    const response = await fetch(`${origin}${path}`, { headers, redirect: "manual" });
    if (!response.ok) return [];
    return await response.json();
  };
  const [runtime, events, jobs, workers] = await Promise.all([
    read(`/v1/runtime/state?appId=${encodeURIComponent(input.appId)}`),
    read(`/v1/events?sourceAppId=${encodeURIComponent(input.appId)}&limit=20`),
    read(`/v1/jobs?ownerAppId=${encodeURIComponent(input.appId)}&limit=20`),
    read(`/v1/jobs/workers?executionOwner=${encodeURIComponent(input.appId)}`),
  ]);
  return { schemaVersion: 1 as const, appId: input.appId, tenantId, session: { actorId: session.actorId, displayName: session.displayName, username: session.username }, runtime, events, jobs, workers };
}

export function productAppSnapshotHandler(options: { appId: string; spmtOrigin: string; path?: string }) {
  const path = options.path ?? `/api/${options.appId}/snapshot`;
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    if (request.method !== "GET" || url.pathname !== path) return false;
    try { return sendJson(response, 200, await fetchAppPlatformSnapshot({ appId: options.appId, spmtOrigin: options.spmtOrigin, request })), true; }
    catch (error) { return sendJson(response, /sign in|session/i.test(safeError(error)) ? 401 : 502, { error: "snapshot_unavailable", message: safeError(error) }), true; }
  };
}

export function sendJson(response: ServerResponse, status: number, value: unknown, handled = true): true {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": String(body.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(body);
  return handled;
}

export function readJsonBody(request: IncomingMessage, maximumBytes = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer | string) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += part.byteLength;
      if (total > maximumBytes) { reject(new Error("Request body is too large")); request.destroy(); return; }
      chunks.push(part);
    });
    request.on("end", () => { try { const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object"); resolveBody(value as Record<string, unknown>); } catch (error) { reject(error); } });
    request.on("error", reject);
  });
}

export function requireSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  if (!host || new URL(origin).host !== host) throw new Error("Request origin is invalid");
}

export function safeError(error: unknown) { return error instanceof Error ? error.message : String(error ?? "Request failed"); }

const PRODUCT_APP_WEB_CSS = `
:root,html,body{margin:0;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:transparent}.spmt-owned-app[data-surface="shell"]{background:transparent}.spmt-owned-app[data-surface="shell"]>.spmt-product-backdrop{display:none}.spmt-owned-stage{height:var(--spmt-shell-available-height,100dvh);min-height:0;padding:clamp(12px,1.8vw,24px);display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;overflow:hidden}.spmt-owned-tabs{align-self:center;display:grid;gap:7px;padding:9px;border-radius:20px}.spmt-owned-tabs button{display:flex;align-items:center;gap:9px;min-width:132px;border:1px solid transparent;border-radius:13px;background:transparent;color:var(--spmt-muted);padding:9px 10px;text-align:left}.spmt-owned-tabs button[aria-current="page"]{border-color:color-mix(in srgb,var(--spmt-accent-secondary) 32%,transparent);background:color-mix(in srgb,var(--spmt-accent) 12%,transparent);color:var(--spmt-ink)}.spmt-owned-tabs i{width:22px;height:22px;display:grid;place-items:center;font-style:normal;color:var(--spmt-accent-secondary)}.spmt-app-home,.spmt-app-page{min-width:0;min-height:0;height:100%;overflow:hidden}.spmt-app-home{display:grid;place-items:center}.spmt-owned-hero{width:min(980px,100%);display:grid;gap:18px;align-content:center;padding:clamp(18px,3vw,42px);background:transparent}.spmt-owned-mark{display:flex;align-items:center;gap:14px}.spmt-owned-mark img{width:70px;height:70px;object-fit:contain;filter:drop-shadow(0 0 16px color-mix(in srgb,var(--spmt-accent-secondary) 45%,transparent))}.spmt-owned-hero h1{margin:0;font-size:clamp(42px,7.5vw,106px);line-height:.9;letter-spacing:-.055em}.spmt-owned-hero>p{max-width:720px;margin:0;color:var(--spmt-muted);font-size:clamp(15px,1.8vw,21px);line-height:1.5}.spmt-owned-actions{display:flex;flex-wrap:wrap;gap:8px}.spmt-owned-button{appearance:none;border:1px solid var(--spmt-border);border-radius:14px;background:var(--spmt-surface-depth-3);color:var(--spmt-ink);padding:10px 14px;font-weight:850}.spmt-owned-button.primary{background:color-mix(in srgb,var(--spmt-accent) 28%,var(--spmt-surface-depth-2));border-color:color-mix(in srgb,var(--spmt-accent) 70%,transparent)}.spmt-owned-hero footer{display:flex;align-items:center;gap:12px;color:var(--spmt-muted)}.spmt-app-page{overflow:auto;scrollbar-gutter:stable;padding:clamp(8px,1vw,14px)}.spmt-app-page>header{max-width:850px;margin:0 auto 14px}.spmt-app-page h2{margin:4px 0 8px;font-size:clamp(28px,4vw,52px)}.spmt-app-page header p{margin:0;color:var(--spmt-muted);line-height:1.5}.spmt-app-live-slot{max-width:850px;margin:0 auto;border-radius:20px;padding:15px;display:grid;gap:8px}.spmt-app-live-slot strong{font-size:16px}.spmt-app-live-slot small{color:var(--spmt-muted);white-space:pre-wrap}.spmt-app-live-slot .spmt-snapshot-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.spmt-snapshot-card{border-radius:13px;background:var(--spmt-surface-depth-4);padding:10px}.spmt-snapshot-card b{display:block;font-size:20px}.spmt-snapshot-card span{color:var(--spmt-muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}@media(max-width:760px){.spmt-owned-stage{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);padding:9px}.spmt-owned-tabs{align-self:auto;display:flex;overflow:auto;padding:7px}.spmt-owned-tabs button{min-width:auto;flex:0 0 auto}.spmt-owned-tabs button span{display:none}.spmt-app-live-slot .spmt-snapshot-grid{grid-template-columns:1fr 1fr}}`;

const PRODUCT_APP_FRAME_CLIENT_JS = String.raw`;(()=>{const body=document.body,appId=body.dataset.app||'';let hostOrigin='*',mode='standalone';function send(message){if(window.parent!==window)window.parent.postMessage(message,hostOrigin)}function applyTheme(theme={}){if(theme.accent)body.style.setProperty('--spmt-accent',theme.accent);if(theme.accentSecondary)body.style.setProperty('--spmt-accent-secondary',theme.accentSecondary);if(theme.glassOpacity!==undefined)body.style.setProperty('--spmt-glass-opacity',String(Number(theme.glassOpacity)/100));if(theme.blurStrength!==undefined)body.style.setProperty('--spmt-blur',Number(theme.blurStrength)+'px');if(theme.starDensity!==undefined)body.style.setProperty('--spmt-stars',String(Number(theme.starDensity)/100));const id=theme.themeId||'solar-flare',logo=document.querySelector('[data-spmt-app-logo]');if(logo)logo.src='/assets/product/app-icons/'+id+'/'+appId+'.png';document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme.accent||'#f97316')}function applyLayout(layout={}){const top=mode==='shell'?Number(layout.headerHeight||0)+Number(layout.safeTop||0):Number(layout.safeTop||0),height=Math.max(0,Number(layout.availableHeight||0)-top-Number(layout.safeBottom||0)),width=Math.max(0,Number(layout.availableWidth||0)-Number(layout.safeLeft||0)-Number(layout.safeRight||0));body.style.setProperty('--spmt-header-height',Number(layout.headerHeight||0)+'px');body.style.setProperty('--spmt-safe-top',Number(layout.safeTop||0)+'px');body.style.setProperty('--spmt-safe-right',Number(layout.safeRight||0)+'px');body.style.setProperty('--spmt-safe-bottom',Number(layout.safeBottom||0)+'px');body.style.setProperty('--spmt-safe-left',Number(layout.safeLeft||0)+'px');body.style.setProperty('--spmt-shell-top-inset',top+'px');body.style.setProperty('--spmt-shell-available-height',height+'px');body.style.setProperty('--spmt-shell-available-width',width+'px')}window.addEventListener('message',event=>{const message=event.data;if(!message||message.protocol!=='spmt.embed'||message.version!==1)return;hostOrigin=event.origin||hostOrigin;if(message.type==='host.hello'&&message.launch?.appId===appId){mode=message.launch.surfaceMode||'standalone';body.dataset.surface=mode}else if(message.type==='theme.changed')applyTheme(message.theme);else if(message.type==='layout.changed')applyLayout(message.layout);else if(message.type==='runtime.changed'){const node=document.querySelector('[data-spmt-runtime-state]');if(node){node.textContent=message.state==='ready'?'Green runtime':String(message.state||'runtime');node.dataset.state=message.state||''}}});if(window.parent!==window)send({protocol:'spmt.embed',version:1,type:'child.ready',appId})})();`;

const PRODUCT_APP_PAGE_JS = String.raw`;(()=>{const appId=__APP_ID__,body=document.body,buttons=[...document.querySelectorAll('[data-spmt-local-nav]')],pages=[...document.querySelectorAll('[data-spmt-app-page]')];function show(id){const page=pages.find(node=>node.getAttribute('data-spmt-app-page')===id)||pages[0];if(!page)return;for(const node of pages)node.hidden=node!==page;for(const button of buttons)button.setAttribute('aria-current',button.getAttribute('data-spmt-local-nav')===page.getAttribute('data-spmt-app-page')?'page':'false');body.dataset.spmtPage=page.getAttribute('data-spmt-app-page')||'home'}for(const button of buttons)button.addEventListener('click',()=>show(button.getAttribute('data-spmt-local-nav')||'home'));document.querySelector('[data-spmt-open-first]')?.addEventListener('click',()=>show(buttons[1]?.getAttribute('data-spmt-local-nav')||'home'));async function refresh(){for(const slot of document.querySelectorAll('[data-spmt-live-slot]')){const small=slot.querySelector('small');if(small)small.textContent='Loading current app state…'}try{const response=await fetch('/api/'+encodeURIComponent(appId)+'/snapshot',{credentials:'same-origin',cache:'no-store'}),value=await response.json();if(!response.ok)throw new Error(value.message||value.error||'Snapshot failed');const runtime=Array.isArray(value.runtime)?value.runtime:[],events=Array.isArray(value.events)?value.events:[],jobs=Array.isArray(value.jobs)?value.jobs:[],workers=Array.isArray(value.workers)?value.workers:[];const grid='<div class="spmt-snapshot-grid"><div class="spmt-snapshot-card"><b>'+runtime.length+'</b><span>runtime records</span></div><div class="spmt-snapshot-card"><b>'+events.length+'</b><span>recent events</span></div><div class="spmt-snapshot-card"><b>'+jobs.length+'</b><span>jobs</span></div><div class="spmt-snapshot-card"><b>'+workers.length+'</b><span>workers</span></div></div>';for(const slot of document.querySelectorAll('[data-spmt-live-slot]')){slot.innerHTML='<strong>Green backend</strong>'+grid+'<small>'+escapeHtml(runtime.map(item=>(item.state||'unknown')+(item.detail?' · '+item.detail:'')).join('\n')||'No runtime projection has reported yet.')+'</small>'}}catch(error){for(const slot of document.querySelectorAll('[data-spmt-live-slot]')){const small=slot.querySelector('small');if(small)small.textContent=error instanceof Error?error.message:String(error)}}}function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}document.querySelector('[data-spmt-refresh]')?.addEventListener('click',()=>void refresh());show('home');void refresh()})();`;

function validateDescriptor(value: ProductAppWebDescriptorV1) {
  for (const field of [value.appId, value.name, value.kicker, value.tagline, value.description, value.sceneUrl]) if (!field?.trim()) throw new Error("Product app web descriptor is incomplete");
  if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(value.appId)) throw new Error("Product app id is invalid");
  if (!value.sceneUrl.startsWith("/") && !value.sceneUrl.startsWith("https://")) throw new Error("Product app scene must be root-relative or HTTPS");
  if (!value.sections.length || new Set(value.sections.map((item) => item.id)).size !== value.sections.length) throw new Error("Product app sections are empty or duplicated");
  return value;
}
function loopbackOrigin(value: string) { const url = new URL(value); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT origin must be a credential-free loopback HTTP origin"); return url.origin; }
function applyProductPageHeaders(response: ServerResponse) { response.setHeader("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; object-src 'none'"); response.setHeader("permissions-policy", "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()"); response.setHeader("referrer-policy", "no-referrer"); response.setHeader("x-frame-options", "SAMEORIGIN"); }
function send(response: ServerResponse, status: number, body: string, type: string) { const encoded = Buffer.from(body); response.writeHead(status, { "content-type": type, "content-length": String(encoded.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(encoded); }
function listen(server: ReturnType<typeof createServer>, port: number, host: string) { return new Promise<void>((done, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); done(); }); }); }
function close(server: ReturnType<typeof createServer>) { return new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function escapeAttributeUrl(value: string) { return value.replace(/["'()\\]/g, ""); }
