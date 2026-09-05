import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PRODUCT_UI_CSS } from "@spmt/ui";

export type ProductAppSnapshotSourceV1 =
  | "runtime"
  | "events"
  | "jobs"
  | "workers"
  | "operations"
  | "devices"
  | "overlayWidgets"
  | "overlayOutputs"
  | "xpLedger"
  | "xpWallet"
  | "stellarCapabilities"
  | "providerLinks"
  | "workspace"
  | "tenantOutputs";

export interface ProductAppSignalV1 {
  source: ProductAppSnapshotSourceV1;
  label: string;
  keywords?: readonly string[];
  limit?: number;
}

export interface ProductAppCatalogItemV1 {
  title: string;
  detail?: string;
  meta?: string;
  badge?: string;
}

export interface ProductAppCatalogV1 {
  label: string;
  items: readonly ProductAppCatalogItemV1[];
}

export interface ProductAppSectionV1 {
  id: string;
  label: string;
  title: string;
  body: string;
  glyph?: string;
  signals?: readonly ProductAppSignalV1[];
  catalogs?: readonly ProductAppCatalogV1[];
  contractNote?: string;
  emptyTitle?: string;
  emptyBody?: string;
  appOwnedData?: boolean;
}

const BASELINE_SNAPSHOT_SOURCES: readonly ProductAppSnapshotSourceV1[] = ["runtime", "events", "jobs", "workers", "workspace", "tenantOutputs"];

export function productAppSnapshotSources(descriptor: ProductAppWebDescriptorV1): ProductAppSnapshotSourceV1[] {
  return [...new Set([...BASELINE_SNAPSHOT_SOURCES, ...descriptor.sections.flatMap((section) => section.signals?.map((signal) => signal.source) ?? [])])];
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
  port?: number | undefined;
  host?: string | undefined;
  buildSha?: string | undefined;
  renderExtra?: (() => string) | undefined;
  browserJs?: string | undefined;
  extraCss?: string | undefined;
  handleApi?: ((request: IncomingMessage, response: ServerResponse, url: URL) => boolean | Promise<boolean>) | undefined;
  close?: (() => void | Promise<void>) | undefined;
}

export interface ProductAppLiveReadOptionsV1 {
  origin: string;
  protocol?: "green-v1" | "blue-v1";
  fetchImpl?: typeof fetch;
}

export function createProductAppWebServer(options: ProductAppWebServerOptionsV1) {
  const descriptor = validateDescriptor(options.descriptor);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://spmt.app");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === `/apps/${descriptor.appId}`)) {
        headers(response);
        return text(
          response,
          200,
          renderProductAppWebPage(descriptor, options.buildSha ?? "dev", options.renderExtra?.() ?? "", options.extraCss ?? "", options.browserJs ?? ""),
          "text/html; charset=utf-8",
        );
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

export function renderProductAppWebPage(app: ProductAppWebDescriptorV1, buildSha = "dev", extra = "", extraCss = "", browserJs = "") {
  validateDescriptor(app);
  const nav = [{ id: "home", label: "Home", glyph: "◈" }, ...app.sections.map((section) => ({ id: section.id, label: section.label, glyph: section.glyph ?? "◇" }))];
  const pages = app.sections.map((section) => `<section class="app-page" data-page="${esc(section.id)}" hidden><header><span class="spmt-product-kicker">${esc(section.label)}</span><h2>${esc(section.title)}</h2><p>${esc(section.body)}</p></header><div class="live spmt-product-glass" data-spmt-depth="2" data-spmt-live-slot="${esc(section.id)}"${section.appOwnedData ? " data-spmt-app-owned-data=\"true\"" : ""} aria-live="polite"><div class="source-heading"><strong>${section.appOwnedData ? "App-owned data" : "SPMT developer surface"}</strong><span class="source-state" data-source-state>Connecting</span></div><small>Loading current app state…</small></div></section>`).join("");
  const tabs = nav.map((item) => `<button type="button" data-nav="${esc(item.id)}"><i>${esc(item.glyph)}</i><span>${esc(item.label)}</span></button>`).join("");
  const pageJs = PAGE_JS
    .replaceAll("__APP_ID__", scriptJson(app.appId))
    .replaceAll("__SECTIONS__", scriptJson(app.sections));
  const catalogJs = productAppCatalogBrowserJs(Object.fromEntries(app.sections.filter((section) => section.catalogs?.length).map((section) => [section.id, section.catalogs])));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f97316"><title>${esc(app.name)} · SpaceMountain</title><style>${PRODUCT_UI_CSS}${CSS}${WORKSPACE_OVERLAY_CSS}${extraCss}</style></head><body class="spmt-product-surface owned" data-app="${esc(app.appId)}" data-surface="standalone" style="--spmt-app-backdrop-image:url('${safeUrl(app.sceneUrl)}')"><div class="spmt-product-backdrop" aria-hidden="true"><span class="spmt-product-backdrop-image"></span><span class="spmt-product-backdrop-tint"></span><span class="spmt-product-backdrop-shade"></span><span class="spmt-star-layer"><i></i><i></i><i></i></span></div><iframe class="spmt-personal-overlay" data-spmt-personal-overlay title="Personal workspace overlay" aria-hidden="true"></iframe><main><nav class="tabs spmt-product-glass" data-spmt-depth="2">${tabs}</nav><section class="home" data-page="home"><div class="hero"><div class="mark"><img data-logo src="/assets/product/app-icons/solar-flare/${esc(app.appId)}.png" alt=""><span class="spmt-product-kicker">${esc(app.kicker)}</span></div><h1>${esc(app.name)}</h1><p>${esc(app.tagline)}</p><div class="home-summary" data-spmt-home-summary aria-live="polite"><span>Connecting to the SPMT developer surface…</span></div><div class="actions"><button class="button primary" data-first>Open ${esc(app.sections[0]?.label ?? "app")}</button><button class="button" data-refresh>Refresh data</button></div><footer><span class="spmt-product-status" data-runtime>Checking runtime</span><small>Build ${esc(buildSha.slice(0, 12))}</small></footer></div></section>${pages}${extra}</main><aside class="spmt-overlay-footer spmt-product-glass" data-spmt-overlay-footer><strong>Workspace overlay</strong><button type="button" data-spmt-personal-toggle>Personal On</button><button type="button" data-spmt-copy-public>Copy Public URL</button><button type="button" data-spmt-copy-personal>Copy Personal URL</button><button type="button" data-spmt-open-overlay-bay>Overlay Bay</button></aside><script>${FRAME_JS}${pageJs}${SNAPSHOT_MODE_JS}${WORKSPACE_OVERLAY_JS}${browserJs}${catalogJs}</script></body></html>`;
}

export function productAppCatalogBrowserJs(catalogs: Readonly<Record<string, readonly ProductAppCatalogV1[] | undefined>>) {
  return String.raw`;(()=>{const catalogs=${scriptJson(catalogs)};function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function render(){for(const[sectionId,groups]of Object.entries(catalogs)){const slot=document.querySelector('[data-spmt-live-slot="'+CSS.escape(sectionId)+'"]');if(!slot||!Array.isArray(groups))continue;slot.querySelector('[data-spmt-catalogs]')?.remove();const wrapper=document.createElement('div');wrapper.dataset.spmtCatalogs='true';wrapper.className='signal-groups';wrapper.innerHTML=groups.map(group=>{const items=Array.isArray(group.items)?group.items:[];return'<section class="signal-group"><div class="signal-title"><span>'+escapeHtml(group.label||'App catalog')+'</span><span>'+items.length+'</span></div><div class="snapshot-records">'+items.map(item=>'<article class="spmt-snapshot-card"><div class="record-top"><b>'+escapeHtml(item.title)+'</b>'+(item.badge?'<span class="record-badge">'+escapeHtml(item.badge)+'</span>':'')+'</div>'+(item.detail?'<span>'+escapeHtml(item.detail)+'</span>':'')+(item.meta?'<span class="record-meta">'+escapeHtml(item.meta)+'</span>':'')+'</article>').join('')+'</div></section>'}).join('');const note=slot.querySelector('.contract-note');slot.insertBefore(wrapper,note)}}window.addEventListener('spmt:snapshot',render);setTimeout(render,0);setTimeout(render,1000)})();`;
}

export async function fetchAppSessionContext(input: { appId: string; spmtOrigin: string; request: IncomingMessage }) {
  const context = await resolveAppSession(input);
  return { schemaVersion: 1 as const, appId: input.appId, tenantId: context.tenantId, session: sessionIdentity(context.session) };
}

export async function fetchAppPlatformSnapshot(input: { appId: string; spmtOrigin: string; request: IncomingMessage; sources?: readonly ProductAppSnapshotSourceV1[]; liveRead?: ProductAppLiveReadOptionsV1 | null }) {
  const { origin, requestHeaders, tenantId, session } = await resolveAppSession(input);
  const liveRead = input.liveRead === null ? undefined : input.liveRead ?? productAppLiveReadFromEnvironment(process.env);
  const dataOrigin = liveRead ? liveReadOrigin(liveRead.origin) : origin;
  const liveProtocol = liveRead?.protocol ?? "green-v1";
  const dataHeaders = liveRead ? { accept: "application/json", "x-spmt-app": input.appId, "x-spmt-tenant": tenantId, "x-spmt-shadow-read": "1" } : requestHeaders;
  const fetchImpl = liveRead?.fetchImpl ?? fetch;

  const availability: Record<string, { available: boolean; status: number }> = {};
  const read = async <T>(source: string, path: string, fallback: T): Promise<T> => {
    if (!path) { availability[source] = { available: false, status: 501 }; return fallback; }
    try {
      const response = await fetchImpl(`${dataOrigin}${path}`, { method: "GET", headers: dataHeaders, redirect: "manual", signal: AbortSignal.timeout(5_000) });
      availability[source] = { available: response.ok, status: response.status };
      return response.ok ? await response.json() as T : fallback;
    } catch {
      availability[source] = { available: false, status: 0 };
      return fallback;
    }
  };

  const actorId = typeof session.actorId === "string" ? session.actorId : "";
  const appId = encodeURIComponent(input.appId);
  const actor = encodeURIComponent(actorId);
  const values: Record<ProductAppSnapshotSourceV1, unknown> = {
    runtime: [], events: [], jobs: [], workers: [], operations: [], devices: [], overlayWidgets: [], overlayOutputs: [], xpWallet: null, xpLedger: [], stellarCapabilities: [], providerLinks: [], workspace: null, tenantOutputs: null,
  };
  const paths: Record<ProductAppSnapshotSourceV1, string> = {
    runtime: `/v1/runtime/state?appId=${appId}`,
    events: `/v1/events?sourceAppId=${appId}&limit=50`,
    jobs: `/v1/jobs?ownerAppId=${appId}&limit=50`,
    workers: `/v1/jobs/workers?executionOwner=${appId}`,
    operations: `/v1/operations/logs?sourceAppId=${appId}&limit=50`,
    devices: "/v1/devices",
    overlayWidgets: `/v1/overlay/widgets?appId=${appId}`,
    overlayOutputs: `/v1/overlay/outputs?appId=${appId}`,
    xpWallet: `/v1/xp/wallet?userId=${actor}`,
    xpLedger: `/v1/xp/ledger?userId=${actor}&limit=50`,
    stellarCapabilities: "/v1/stellar/capabilities",
    providerLinks: "/v1/identity/providers",
    workspace: "/v1/workspace/profile",
    tenantOutputs: "/v1/overlay/tenant-outputs",
  };
  if (liveRead && liveProtocol === "blue-v1") Object.assign(paths, {
    runtime: "/api/apps",
    events: `/api/platform/events?sourceApp=${appId}`,
    jobs: "",
    workers: "",
    operations: "",
    devices: "",
    overlayWidgets: "/api/overlay-workspace",
    overlayOutputs: "",
    xpWallet: "/api/xp",
    xpLedger: "",
    stellarCapabilities: "/api/athena/os",
    providerLinks: "/api/me",
    workspace: "/api/workspace-profile",
    tenantOutputs: "/api/personal-overlay-launch",
  });
  const requestedSources = [...new Set(input.sources?.length ? input.sources : BASELINE_SNAPSHOT_SOURCES)];
  await Promise.all(requestedSources.map(async (source) => {
    if ((source === "xpWallet" || source === "xpLedger") && !actorId) {
      availability[source] = { available: false, status: 401 };
      return;
    }
    const raw = await read<unknown>(source, paths[source], source === "xpWallet" ? null : []);
    values[source] = liveRead && liveProtocol === "blue-v1" ? unwrapBlueSnapshot(source, raw) : raw;
  }));
  const xpLedger = Array.isArray(values.xpLedger) ? values.xpLedger.filter((entry) => Boolean(entry) && typeof entry === "object" && (entry as Record<string, unknown>).sourceAppId === input.appId) : [];
  return {
    schemaVersion: 1 as const,
    contract: "spmt.public-api.v1" as const,
    dataMode: liveRead ? "live-read" as const : "isolated" as const,
    operationMode: liveRead ? "read-only" as const : "active" as const,
    appId: input.appId,
    tenantId,
    session: sessionIdentity(session),
    availability,
    runtime: values.runtime,
    events: values.events,
    jobs: values.jobs,
    workers: values.workers,
    operations: values.operations,
    devices: values.devices,
    overlayWidgets: values.overlayWidgets,
    overlayOutputs: values.overlayOutputs,
    xpWallet: values.xpWallet,
    xpLedger,
    stellarCapabilities: values.stellarCapabilities,
    providerLinks: values.providerLinks,
    workspace: values.workspace,
    tenantOutputs: values.tenantOutputs,
  };
}

export function productAppSnapshotHandler(options: { appId: string; spmtOrigin: string; path?: string; sources?: readonly ProductAppSnapshotSourceV1[]; liveRead?: ProductAppLiveReadOptionsV1 | null }) {
  const path = options.path ?? `/api/${options.appId}/snapshot`;
  return async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    if (request.method !== "GET" || url.pathname !== path) return false;
    try {
      return sendJson(response, 200, await fetchAppPlatformSnapshot({ appId: options.appId, spmtOrigin: options.spmtOrigin, request, ...(options.sources ? { sources: options.sources } : {}), ...(options.liveRead !== undefined ? { liveRead: options.liveRead } : {}) }));
    } catch (error) {
      return sendJson(response, /sign in|session/i.test(safeError(error)) ? 401 : 502, { error: "snapshot_unavailable", message: safeError(error) });
    }
  };
}

export function sendJson(response: ServerResponse, status: number, value: unknown): true {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": String(body.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(body);
  return true;
}

export function readJsonBody(request: IncomingMessage, maximumBytes = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((done, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer | string) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += part.byteLength;
      if (total > maximumBytes) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(part);
    });
    request.on("end", () => {
      try {
        const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object");
        done(value as Record<string, unknown>);
      } catch (error) { reject(error); }
    });
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

export function productAppLiveReadFromEnvironment(environment: NodeJS.ProcessEnv): ProductAppLiveReadOptionsV1 | undefined {
  const origin = environment.SPMT_LIVE_READ_ORIGIN;
  if (!origin) return undefined;
  const protocol = environment.SPMT_LIVE_READ_PROTOCOL ?? "green-v1";
  if (protocol !== "green-v1" && protocol !== "blue-v1") throw new Error("SPMT_LIVE_READ_PROTOCOL must be green-v1 or blue-v1");
  return { origin: liveReadOrigin(origin), protocol };
}

async function resolveAppSession(input: { appId: string; spmtOrigin: string; request: IncomingMessage }) {
  const origin = loopback(input.spmtOrigin);
  const requestHeaders: Record<string, string> = { accept: "application/json", "x-spmt-app": input.appId };
  if (input.request.headers.cookie) requestHeaders.cookie = input.request.headers.cookie;
  const sessionResponse = await fetch(`${origin}/v1/session`, { headers: requestHeaders, redirect: "manual" });
  if (!sessionResponse.ok) throw new Error("Sign in to SpaceMountain before using this app");
  const session = await sessionResponse.json() as Record<string, unknown>;
  const tenantId = Array.isArray(session.tenantIds) && typeof session.tenantIds[0] === "string" ? session.tenantIds[0] : "";
  if (!tenantId) throw new Error("SPMT session has no tenant");
  requestHeaders["x-spmt-tenant"] = tenantId;
  return { origin, requestHeaders, tenantId, session };
}

function sessionIdentity(session: Record<string, unknown>) {
  return {
    actorType: session.actorType,
    actorId: session.actorId,
    displayName: session.displayName,
    username: session.username,
    scopes: Array.isArray(session.scopes) ? session.scopes.filter((item) => typeof item === "string") : [],
    tenantIds: Array.isArray(session.tenantIds) ? session.tenantIds.filter((item) => typeof item === "string") : [],
    tenantRoles: session.tenantRoles && typeof session.tenantRoles === "object" && !Array.isArray(session.tenantRoles) ? session.tenantRoles : {},
  };
}

const CSS = `.snapshot-mode{width:max-content;color:#bbf7d0!important;border-color:color-mix(in srgb,#22c55e 55%,transparent)!important;background:color-mix(in srgb,#16a34a 18%,transparent)!important}:root,html,body{margin:0;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:transparent}.owned[data-surface="shell"]>.spmt-product-backdrop{display:none}.owned main{height:var(--spmt-shell-available-height,100dvh);min-height:0;padding:clamp(10px,1.8vw,24px);display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px}.tabs{align-self:center;display:grid;gap:6px;padding:8px;border-radius:18px}.tabs button{display:flex;gap:8px;align-items:center;border:1px solid transparent;border-radius:12px;background:transparent;color:var(--spmt-muted);padding:9px}.tabs button[aria-current="page"]{color:var(--spmt-ink);border-color:var(--spmt-border);background:var(--spmt-surface-depth-3)}.tabs i{color:var(--spmt-accent-secondary);font-style:normal}.home,.app-page{height:100%;min-height:0;min-width:0}.home{display:grid;place-items:center}.hero{width:min(980px,100%);display:grid;gap:clamp(10px,2vh,18px)}.mark{display:flex;align-items:center;gap:12px}.mark img{width:68px;height:68px;object-fit:contain}.hero h1{margin:0;font-size:clamp(42px,7.5vw,106px);line-height:.9;letter-spacing:-.05em}.hero>p,.app-page header p{color:var(--spmt-muted);max-width:760px;line-height:1.5}.home-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--spmt-muted);font-size:12px}.home-stat{display:grid;gap:2px;min-width:108px;padding:8px 11px;border:1px solid var(--spmt-border);border-radius:13px;background:var(--spmt-surface-depth-3)}.home-stat b{color:var(--spmt-ink);font-size:17px}.actions{display:flex;gap:8px;flex-wrap:wrap}.button{border:1px solid var(--spmt-border);border-radius:14px;background:var(--spmt-surface-depth-3);color:var(--spmt-ink);padding:10px 14px;font-weight:800}.button.primary{background:color-mix(in srgb,var(--spmt-accent) 28%,var(--spmt-surface-depth-2))}.button.danger{color:#fecaca;border-color:color-mix(in srgb,#ef4444 50%,transparent)}.button:disabled{opacity:.55;cursor:not-allowed}.hero footer{display:flex;gap:12px;color:var(--spmt-muted)}.app-page{overflow:auto;padding:12px}.app-page>header,.live{max-width:980px;margin:0 auto 14px}.app-page h2{font-size:clamp(28px,4vw,52px);margin:4px 0}.live{border-radius:20px;padding:15px;display:grid;gap:12px}.source-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}.source-state,.record-badge{border:1px solid var(--spmt-border);border-radius:999px;padding:4px 8px;color:var(--spmt-muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.source-state[data-state="ready"],.record-badge[data-state="ready"],.record-badge[data-state="succeeded"]{color:#bbf7d0;border-color:color-mix(in srgb,#22c55e 45%,transparent)}.source-state[data-state="partial"],.record-badge[data-state="queued"],.record-badge[data-state="running"],.record-badge[data-state="leased"]{color:#fde68a;border-color:color-mix(in srgb,#f59e0b 45%,transparent)}.source-state[data-state="unavailable"],.record-badge[data-state="failed"],.record-badge[data-state="error"],.record-badge[data-state="critical"]{color:#fecaca;border-color:color-mix(in srgb,#ef4444 45%,transparent)}.live>small,.empty-state p,.contract-note,.record-meta{color:var(--spmt-muted);white-space:pre-wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}.card{background:var(--spmt-surface-depth-4);border:1px solid color-mix(in srgb,var(--spmt-border) 72%,transparent);border-radius:12px;padding:9px}.card b{display:block;font-size:20px}.card span{font-size:10px;color:var(--spmt-muted)}.signal-groups{display:grid;gap:12px}.signal-group{display:grid;gap:7px}.signal-title{display:flex;align-items:center;justify-content:space-between;color:var(--spmt-muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.snapshot-records{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.spmt-snapshot-card{display:grid;gap:6px;min-width:0;padding:11px;border:1px solid var(--spmt-border);border-radius:14px;background:var(--spmt-surface-depth-4)}.record-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.spmt-snapshot-card b{overflow-wrap:anywhere}.spmt-snapshot-card>span,.record-meta{font-size:11px}.contract-note,.empty-state{padding:11px;border:1px dashed var(--spmt-border);border-radius:13px;background:color-mix(in srgb,var(--spmt-surface-depth-4) 72%,transparent)}.contract-note{font-size:11px;line-height:1.45}.empty-state{display:grid;gap:3px}.empty-state b,.empty-state p{margin:0}.app-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.app-form label{display:grid;gap:4px;color:var(--spmt-muted);font-size:11px}.app-form input,.app-form select{width:100%;box-sizing:border-box;border:1px solid var(--spmt-border);border-radius:11px;background:var(--spmt-surface-depth-4);color:var(--spmt-ink);padding:9px}.app-form .form-actions{align-self:end}.capability-row{display:flex;gap:8px;flex-wrap:wrap}.capability-row label{display:flex;align-items:center;gap:4px}.capability-row input{width:auto}.local-list{display:grid;gap:8px}.local-record-actions{display:flex;justify-content:flex-end}.owned *{scrollbar-width:thin;scrollbar-color:transparent transparent}.owned *:hover{scrollbar-color:color-mix(in srgb,var(--spmt-accent) 62%,var(--spmt-surface-depth-4)) transparent}.owned *::-webkit-scrollbar{width:4px;height:4px}.owned *::-webkit-scrollbar-track{background:transparent}.owned *::-webkit-scrollbar-thumb{border-radius:99px;background:transparent}.owned *:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--spmt-accent) 62%,transparent)}@media(max-width:760px){.owned main{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);padding:8px}.tabs{display:flex;overflow:auto}.tabs button span{display:none}.hero h1{font-size:clamp(40px,14vw,74px)}.home-stat{min-width:88px;flex:1}.snapshot-records{grid-template-columns:1fr}}`;

const FRAME_JS = String.raw`;(()=>{const body=document.body,appId=body.dataset.app||'';let origin='*',mode='standalone';const send=m=>window.parent!==window&&window.parent.postMessage(m,origin);window.addEventListener('message',event=>{const m=event.data;if(!m||m.protocol!=='spmt.embed'||m.version!==1)return;origin=event.origin||origin;if(m.type==='host.hello'&&m.launch?.appId===appId){mode=m.launch.surfaceMode||'standalone';body.dataset.surface=mode}else if(m.type==='theme.changed'){const t=m.theme||{};if(t.accent)body.style.setProperty('--spmt-accent',t.accent);if(t.accentSecondary)body.style.setProperty('--spmt-accent-secondary',t.accentSecondary);const logo=document.querySelector('[data-logo]');if(logo)logo.src='/assets/product/app-icons/'+(t.themeId||'solar-flare')+'/'+appId+'.png'}else if(m.type==='layout.changed'){const l=m.layout||{},top=mode==='shell'?Number(l.headerHeight||0)+Number(l.safeTop||0):Number(l.safeTop||0),height=Math.max(0,Number(l.availableHeight||0)-top-Number(l.safeBottom||0));body.style.setProperty('--spmt-shell-available-height',height+'px')}else if(m.type==='runtime.changed'){const node=document.querySelector('[data-runtime]');if(node)node.textContent=m.state==='ready'?'Runtime ready':String(m.state||'runtime')}});if(window.parent!==window)send({protocol:'spmt.embed',version:1,type:'child.ready',appId})})();`;

const PAGE_JS = String.raw`;(()=>{const appId=__APP_ID__,sections=__SECTIONS__,buttons=[...document.querySelectorAll('[data-nav]')],pages=[...document.querySelectorAll('[data-page]')];const labels={runtime:'Runtime',events:'Events',jobs:'Jobs',workers:'Workers',operations:'Operations',devices:'Devices',overlayWidgets:'Widgets',overlayOutputs:'Outputs',xpLedger:'XP activity',xpWallet:'XP wallet',stellarCapabilities:'Stellar capabilities',providerLinks:'Provider links'};function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function asArray(value){return Array.isArray(value)?value:value&&typeof value==='object'?[value]:[]}function text(value){return String(value??'').replace(/[._-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}function scalarSummary(value){if(!value||typeof value!=='object')return'';const pairs=Object.entries(value).filter(([,item])=>['string','number','boolean'].includes(typeof item)).slice(0,3);return pairs.map(([key,item])=>text(key)+': '+String(item)).join(' · ').slice(0,180)}function searchable(item){try{return JSON.stringify(item).toLowerCase()}catch{return String(item).toLowerCase()}}function filtered(value,signal){const items=asArray(value),keywords=Array.isArray(signal.keywords)?signal.keywords.map(item=>String(item).toLowerCase()).filter(Boolean):[];const matches=keywords.length?items.filter(item=>keywords.some(keyword=>searchable(item).includes(keyword))):items;return matches.slice(0,Math.max(1,Math.min(12,Number(signal.limit||6))))}function timeOf(item){return item.updatedAt||item.occurredAt||item.createdAt||item.lastHeartbeatAt||item.completedAt||item.pairedAt||''}function record(item,source){const manifest=item.manifest&&typeof item.manifest==='object'?item.manifest:{},progress=item.progress&&typeof item.progress==='object'?item.progress:{},error=item.error&&typeof item.error==='object'?item.error:{};let title=labels[source]||text(source),detail='',state=String(item.state||item.level||'');if(source==='runtime'){title='Runtime '+text(item.state||'unknown');detail=String(item.detail||'No runtime detail was published.')}else if(source==='events'){title=text(item.type||'Platform event');detail=scalarSummary(item.payload)}else if(source==='jobs'){title=text(item.capabilityId||'Execution job');detail=[text(item.executionTarget||''),progress.percent===undefined?'':String(progress.percent)+'%',progress.message||error.message||''].filter(Boolean).join(' · ')}else if(source==='workers'){title=text(item.executionTarget||'Execution')+' worker';detail=[item.providerHealthy===false?'Provider unhealthy':text(item.state||''),asArray(item.capabilityIds).map(text).join(', ')].filter(Boolean).join(' · ')}else if(source==='operations'){title=text(item.kind||'Operations log');detail=String(item.summary||item.detail||'')}else if(source==='devices'){title=String(item.name||item.deviceId||'Paired device');detail=[text(item.kind||''),asArray(item.capabilities).map(text).join(', ')].filter(Boolean).join(' · ')}else if(source==='overlayWidgets'){title=String(manifest.title||manifest.widgetId||'Overlay widget');detail=[text(manifest.kind||''),manifest.supportsAudio?'Audio':'',manifest.supportsInteraction?'Interactive':''].filter(Boolean).join(' · ')}else if(source==='overlayOutputs'){title=text(item.widgetId||'Overlay output');detail=item.revokedAt?'Revoked':'Expires '+String(item.expiresAt||'unknown')}else if(source==='xpLedger'){const delta=Number(item.delta||0);title=(delta>0?'+':'')+delta+' XP · '+String(item.reason||text(item.eventType||'Activity'));detail=text(item.eventType||'Canonical XP ledger')}else if(source==='xpWallet'){title=String(item.spendableXp??item.currentXp??0)+' spendable XP';detail=['Level '+String(item.level??0),'Rank '+String(item.rank??0),'Lifetime '+String(item.lifetimeXp??item.totalXp??0)].join(' · ')}else if(source==='stellarCapabilities'){title=String(item.displayName||item.name||item.capabilityId||item.id||'Stellar capability');detail=String(item.description||scalarSummary(item))}else if(source==='providerLinks'){title=text(item.provider||'Provider')+' linked';detail=String(item.displayName||item.username||item.providerUserId||'Authorized identity')}else{detail=scalarSummary(item)}const occurred=timeOf(item);return'<article class="spmt-snapshot-card"><div class="record-top"><b>'+escapeHtml(title)+'</b>'+(state?'<span class="record-badge" data-state="'+escapeHtml(state.toLowerCase())+'">'+escapeHtml(text(state))+'</span>':'')+'</div>'+(detail?'<span>'+escapeHtml(detail)+'</span>':'')+(occurred?'<span class="record-meta">'+escapeHtml(new Date(occurred).toLocaleString())+'</span>':'')+'</article>'}function sourceAvailable(snapshot,source){return snapshot.availability?.[source]?.available!==false}function renderSection(section,snapshot){if(section.appOwnedData)return;const slot=document.querySelector('[data-spmt-live-slot="'+CSS.escape(section.id)+'"]');if(!slot)return;const signals=Array.isArray(section.signals)&&section.signals.length?section.signals:[{source:'runtime',label:'Runtime'},{source:'events',label:'Events'},{source:'jobs',label:'Jobs'},{source:'workers',label:'Workers'}],views=signals.map(signal=>({signal,items:filtered(snapshot[signal.source],signal),available:sourceAvailable(snapshot,signal.source)})),availableCount=views.filter(view=>view.available).length,total=views.reduce((sum,view)=>sum+view.items.length,0),state=availableCount===views.length?'ready':availableCount?'partial':'unavailable';const metrics='<div class="grid">'+views.map(view=>'<div class="card"><b>'+escapeHtml(view.available?view.items.length:'—')+'</b><span>'+escapeHtml(view.signal.label||labels[view.signal.source]||text(view.signal.source))+(view.available?'':' · unavailable')+'</span></div>').join('')+'</div>';const groups=views.filter(view=>view.items.length).map(view=>'<section class="signal-group"><div class="signal-title"><span>'+escapeHtml(view.signal.label||labels[view.signal.source])+'</span><span>'+view.items.length+'</span></div><div class="snapshot-records">'+view.items.map(item=>record(item,view.signal.source)).join('')+'</div></section>').join('');const empty=total?'':'<div class="empty-state"><b>'+escapeHtml(section.emptyTitle||'No published activity yet')+'</b><p>'+escapeHtml(section.emptyBody||'The public SPMT contract is available, but it has no matching records for this section.')+'</p></div>';const note=section.contractNote?'<div class="contract-note">'+escapeHtml(section.contractNote)+'</div>':'';slot.innerHTML='<div class="source-heading"><strong>SPMT developer surface</strong><span class="source-state" data-state="'+state+'">'+(state==='ready'?'Synchronized':state==='partial'?'Partial access':'Unavailable')+'</span></div>'+metrics+'<div class="signal-groups">'+groups+'</div>'+empty+note}function renderHome(snapshot){const runtime=asArray(snapshot.runtime),jobs=asArray(snapshot.jobs),workers=asArray(snapshot.workers),events=asArray(snapshot.events),latest=runtime[0],pending=jobs.filter(item=>['queued','leased','running'].includes(item.state)).length,healthy=workers.filter(item=>item.state==='ready'&&item.providerHealthy!==false).length,summary=document.querySelector('[data-spmt-home-summary]');if(summary)summary.innerHTML=[['Runtime',latest?text(latest.state):'No report'],['Recent activity',events.length],['Active jobs',pending],['Ready workers',healthy]].map(([label,value])=>'<span class="home-stat"><b>'+escapeHtml(value)+'</b><span>'+escapeHtml(label)+'</span></span>').join('');const runtimeNode=document.querySelector('[data-runtime]');if(runtimeNode)runtimeNode.textContent=latest?'Runtime '+String(latest.state||'unknown'):'No runtime report'}function show(id){const page=pages.find(node=>node.dataset.page===id)||pages[0];if(!page)return;for(const node of pages)node.hidden=node!==page;for(const button of buttons)button.setAttribute('aria-current',button.dataset.nav===page.dataset.page?'page':'false')}for(const button of buttons)button.addEventListener('click',()=>show(button.dataset.nav||'home'));document.querySelector('[data-first]')?.addEventListener('click',()=>show(buttons[1]?.dataset.nav||'home'));async function refresh(){const refreshButton=document.querySelector('[data-refresh]');if(refreshButton)refreshButton.disabled=true;try{const response=await fetch('/api/'+encodeURIComponent(appId)+'/snapshot',{credentials:'same-origin',cache:'no-store'}),value=await response.json();if(!response.ok)throw new Error(value.message||value.error||'Snapshot failed');renderHome(value);for(const section of sections)renderSection(section,value);window.dispatchEvent(new CustomEvent('spmt:snapshot',{detail:value}))}catch(error){const message=error instanceof Error?error.message:String(error);const summary=document.querySelector('[data-spmt-home-summary]');if(summary)summary.innerHTML='<span class="contract-note">'+escapeHtml(message)+'</span>';for(const slot of document.querySelectorAll('[data-spmt-live-slot]:not([data-spmt-app-owned-data])'))slot.innerHTML='<div class="source-heading"><strong>SPMT developer surface</strong><span class="source-state" data-state="unavailable">Unavailable</span></div><div class="empty-state"><b>Live data could not be read</b><p>'+escapeHtml(message)+'</p></div>'}finally{if(refreshButton)refreshButton.disabled=false}}document.querySelector('[data-refresh]')?.addEventListener('click',()=>void refresh());show('home');void refresh()})();`;

const SNAPSHOT_MODE_JS = String.raw`;(()=>{window.addEventListener('spmt:snapshot',event=>{const snapshot=event.detail||{},live=snapshot.dataMode==='live-read';document.body.dataset.dataMode=live?'live-read':'isolated';for(const old of document.querySelectorAll('[data-spmt-snapshot-mode]'))old.remove();if(!live)return;const badge=document.createElement('span');badge.className='source-state snapshot-mode';badge.dataset.spmtSnapshotMode='';badge.dataset.state='ready';badge.textContent='Live data · read only';document.querySelector('.mark')?.append(badge);for(const heading of document.querySelectorAll('.source-heading strong'))heading.textContent='Live SPMT data'})})();`;

const WORKSPACE_OVERLAY_CSS = `.spmt-personal-overlay{position:fixed;inset:0;width:100%;height:100%;border:0;z-index:8;pointer-events:none;background:transparent}.spmt-personal-overlay[hidden]{display:none}.spmt-overlay-footer{position:fixed;z-index:20;left:50%;bottom:max(8px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:6px;max-width:calc(100vw - 16px);padding:6px 8px;border-radius:14px}.spmt-overlay-footer strong{padding:0 5px;font-size:10px;white-space:nowrap;color:var(--spmt-muted)}.spmt-overlay-footer button{min-height:32px;padding:6px 9px;border:1px solid var(--spmt-border);border-radius:10px;background:var(--spmt-surface-depth-3);color:var(--spmt-ink);font-size:10px;font-weight:800;white-space:nowrap}.owned[data-surface="shell"]>.spmt-overlay-footer,.owned[data-surface="shell"]>.spmt-personal-overlay{display:none!important}@media(max-width:620px){.spmt-overlay-footer{left:8px;right:8px;transform:none;overflow:auto}.spmt-overlay-footer strong{display:none}.owned main{padding-bottom:58px}}`;

const WORKSPACE_OVERLAY_JS = String.raw`;(()=>{const key='spmt:personal-overlay-visible',frame=document.querySelector('[data-spmt-personal-overlay]'),footer=document.querySelector('[data-spmt-overlay-footer]'),toggle=footer?.querySelector('[data-spmt-personal-toggle]');let outputs=null,visible=true;try{visible=localStorage.getItem(key)!=='off'}catch{}function sync(){if(frame)frame.hidden=!visible;if(toggle)toggle.textContent='Personal '+(visible?'On':'Off')}async function copy(name){const url=outputs?.[name]?.url;if(!url)return;if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);else window.prompt('Copy '+name+' overlay URL',url)}toggle?.addEventListener('click',()=>{visible=!visible;try{localStorage.setItem(key,visible?'on':'off')}catch{}sync()});footer?.querySelector('[data-spmt-copy-public]')?.addEventListener('click',()=>void copy('public'));footer?.querySelector('[data-spmt-copy-personal]')?.addEventListener('click',()=>void copy('personal'));footer?.querySelector('[data-spmt-open-overlay-bay]')?.addEventListener('click',()=>{if(window.parent!==window)window.parent.postMessage({protocol:'spmt.surface',version:1,type:'shell.navigate',appId:document.body.dataset.app||'',view:'workspace'},'*');else if(outputs?.editorUrl)location.assign(outputs.editorUrl)});window.addEventListener('spmt:snapshot',event=>{const next=event.detail?.tenantOutputs;if(!next||typeof next!=='object')return;outputs=next;if(frame&&next.personal?.url&&frame.src!==next.personal.url)frame.src=next.personal.url;sync()});sync()})();`;

function validateDescriptor(value: ProductAppWebDescriptorV1) {
  if (!value.appId || !value.name || !value.sceneUrl || !value.sections.length) throw new Error("Product app web descriptor is incomplete");
  const ids = new Set<string>();
  for (const section of value.sections) {
    if (!section.id || !section.label || !section.title || !section.body || ids.has(section.id)) throw new Error("Product app section descriptor is invalid");
    ids.add(section.id);
  }
  return value;
}

function loopback(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT origin must be a credential-free loopback HTTP origin");
  return url.origin;
}

function headers(response: ServerResponse) {
  response.setHeader("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' https:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; object-src 'none'");
  response.setHeader("x-frame-options", "SAMEORIGIN");
  response.setHeader("referrer-policy", "no-referrer");
}

function text(response: ServerResponse, status: number, body: string, type: string) {
  const data = Buffer.from(body);
  response.writeHead(status, { "content-type": type, "content-length": String(data.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(data);
}

function listen(server: ReturnType<typeof createServer>, port: number, host: string) {
  return new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); done(); });
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
}

function esc(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function safeUrl(value: string) { return value.replace(/["'()\\]/g, ""); }
function scriptJson(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }
function liveReadOrigin(value: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_LIVE_READ_ORIGIN must be a credential-free HTTPS origin"); return url.origin; }
function unwrapBlueSnapshot(source: ProductAppSnapshotSourceV1, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const keys: Partial<Record<ProductAppSnapshotSourceV1, string[]>> = { runtime: ["apps", "data"], events: ["events", "data"], overlayWidgets: ["widgets", "overlays", "data"], xpWallet: ["xp", "wallet", "data"], stellarCapabilities: ["capabilities", "commands", "data"], providerLinks: ["providers", "identities", "user", "data"] };
  for (const key of keys[source] ?? []) if (record[key] !== undefined) return record[key];
  return value;
}
