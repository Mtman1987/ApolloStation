from pathlib import Path

server = Path('apps/spacemountain-web/src/server.ts')
s = server.read_text()
route = '      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/first-time-setup" || SHELL_APP_PATHS.has(url.pathname))) {'
replacement = '''      if (request.method === "GET" && url.pathname === "/apps/commlink") {
        await requireVerifiedCommlinkSession(request, spmtOrigin, fetchImpl);
      }
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/first-time-setup" || SHELL_APP_PATHS.has(url.pathname))) {'''
assert route in s, 'Commlink shell route not found'
s = s.replace(route, replacement, 1)

marker = 'async function requireCatalogPublisher(request: IncomingMessage, origin: string, fetchImpl: typeof fetch) {'
helper = '''async function requireVerifiedCommlinkSession(request: IncomingMessage, origin: string, fetchImpl: typeof fetch) {
  if (!request.headers.cookie) throw new WebHostError(401, "A verified SPMT session is required to open Commlink");
  let upstream: Response;
  try {
    upstream = await fetchImpl(`${origin}/v1/session`, {
      headers: { accept: "application/json", cookie: request.headers.cookie, "x-spmt-app": "spacemountain" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new WebHostError(503, "Commlink cannot verify the SPMT tenant session");
  }
  const encoded = await limitedResponseBody(upstream);
  if (!upstream.ok) {
    if (upstream.status === 401) throw new WebHostError(401, "A verified SPMT session is required to open Commlink");
    if (upstream.status === 403) throw new WebHostError(403, "The SPMT session is not authorized for Commlink");
    throw new WebHostError(503, "Commlink cannot verify the SPMT tenant session");
  }
  const principal = record(parseJson(encoded));
  const actorId = typeof principal?.actorId === "string" ? principal.actorId.trim() : "";
  const tenantIds = Array.isArray(principal?.tenantIds)
    ? principal.tenantIds.filter((tenantId): tenantId is string => typeof tenantId === "string" && tenantId.trim().length > 0)
    : [];
  if (!actorId || tenantIds.length === 0) throw new WebHostError(403, "Commlink requires a verified user and tenant");
  return { actorId, tenantIds };
}

'''
assert marker in s, 'publisher auth helper marker not found'
s = s.replace(marker, helper + marker, 1)
server.write_text(s)

webtest = Path('tests/spacemountain-web.test.mjs')
t = webtest.read_text()
old = '''    assert.equal((await fetch(`${base}/apps/nebula-arcade`)).status, 200);
    assert.equal((await fetch(`${base}/apps/commlink`)).status, 200);
    assert.equal((await fetch(`${base}/apps/stellar-core`)).status, 200);'''
new = '''    assert.equal((await fetch(`${base}/apps/nebula-arcade`)).status, 200);
    assert.equal((await fetch(`${base}/apps/commlink`)).status, 401, "Commlink must fail closed without a verified SPMT tenant");
    assert.equal((await fetch(`${base}/apps/stellar-core`)).status, 200);'''
assert old in t, 'candidate app unauthenticated Commlink assertion not found'
t = t.replace(old, new, 1)
old = '''    const cookie = (registration.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(cookie);
    const client = new SpmtClient'''
new = '''    const cookie = (registration.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(cookie);
    assert.equal((await fetch(`${base}/apps/commlink`, { headers: { cookie } })).status, 200, "verified tenants may render Commlink");
    const client = new SpmtClient'''
assert old in t, 'candidate app authenticated cookie block not found'
t = t.replace(old, new, 1)
webtest.write_text(t)

workspace = Path('tests/workspace-consolidation.test.mjs')
w = workspace.read_text()
old = '''  for(const path of ['/?surface=workspace-service&view=workspace','/apps/commlink?surface=workspace-service','/workspace/overlay']) {
   const r=await fetch(base(host)+path);assert.equal(r.status,200);assert.equal(r.headers.get('x-frame-options'),null);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  }'''
new = '''  for(const path of ['/?surface=workspace-service&view=workspace','/workspace/overlay']) {
   const r=await fetch(base(host)+path);assert.equal(r.status,200);assert.equal(r.headers.get('x-frame-options'),null);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  }
  const commlink=await fetch(base(host)+'/apps/commlink?surface=workspace-service');
  assert.equal(commlink.status,401,'Commlink workspace service must not render when tenant verification fails');'''
assert old in w, 'workspace Commlink frame assertion not found'
w = w.replace(old, new, 1)
workspace.write_text(w)

print('Commlink auth hardening patch applied')
