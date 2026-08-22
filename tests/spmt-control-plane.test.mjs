import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityService } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { ControlService } from "../packages/control-core/dist/index.js";
import { PlatformOperations } from "../packages/platform-ops/dist/index.js";
import { PlatformApiAdapter } from "../packages/api-adapter/dist/index.js";
import { OutboxDispatcher } from "../packages/outbox-core/dist/index.js";

function env() {
  const dir = mkdtempSync(join(tmpdir(), "spmt-control-")); const path = join(dir, "authority.db"); const store = new SqliteAuthorityStore(path);
  let time = Date.parse("2026-08-22T03:00:00.000Z"); const now = () => new Date(time).toISOString(); const advance = (seconds) => { time += seconds * 1000; };
  const authority = new AuthorityService({ store, now }); authority.ensureUser("owner-1"); authority.getOrCreateWorkspace("tenant-a");
  const control = new ControlService({ store, now }); control.registerTenant({ tenantId: "tenant-a", ownerUserId: "owner-1", displayName: "Tenant A" }); control.registerApp({ appId: "space-mountain", name: "SpaceMountain", description: "Command Bridge", version: "1.0.0", launchUrl: "https://spacemountain.live/", allowedScopes: ["workspace:read"], surfaces: ["shell", "standalone", "overlay"], status: "active" });
  const auth = new AuthService({ store, now, tokenFactory: (() => { let n=0; return (kind) => `${kind}_${++n}_${"x".repeat(32)}`; })() }); auth.registerServiceIdentity({ serviceId: "reference-app", credential: "reference-app-control-secret-12345", scopes: ["apps:read","apps:install","entitlements:read","events:write"], tenantMode: "allow-list", tenantIds: ["tenant-a"] });
  const token = auth.issueServiceAccess("reference-app", "reference-app-control-secret-12345").accessToken;
  const operations = new PlatformOperations(auth, authority, control); const api = new PlatformApiAdapter(operations);
  return { dir, path, store, authority, control, auth, token, operations, api, advance };
}
function cleanup(e) { e.store.close(); rmSync(e.dir, { recursive: true, force: true }); }

test("app registry, install, entitlement and tenant isolation share one durable authority", () => { const e = env(); try { assert.equal(e.api.handle({ method:"GET", path:"/v1/apps", headers:{ authorization:`Bearer ${e.token}` } }).status, 200); const installed=e.api.handle({ method:"POST", path:"/v1/apps/space-mountain/install", headers:{ authorization:`Bearer ${e.token}`, "x-spmt-tenant":"tenant-a" }, body:{} }); assert.equal(installed.status,200); assert.equal(e.control.listInstalls("tenant-a")[0].appId,"space-mountain"); e.control.setEntitlement({ tenantId:"tenant-a", appId:"space-mountain", key:"premium", value:true }); const ent=e.api.handle({ method:"GET", path:"/v1/entitlements?appId=space-mountain", headers:{ authorization:`Bearer ${e.token}`, "x-spmt-tenant":"tenant-a" } }); assert.equal(ent.status,200); assert.equal(ent.body[0].value,true); const denied=e.api.handle({ method:"GET", path:"/v1/apps/installs", headers:{ authorization:`Bearer ${e.token}`, "x-spmt-tenant":"tenant-b" } }); assert.equal(denied.status,403); } finally { cleanup(e); } });

test("platform event and outbox are atomic, leased, retried and completed", async () => { const e=env(); try { const published=e.operations.execute({ name:"events.publish", input:{ tenantId:"tenant-a", type:"workspace.changed", payload:{ revision:2 }, idempotencyKey:"evt-1" } }, { accessToken:e.token }); assert.equal(published.result.duplicate,false); assert.equal(e.authority.listOutbox().length,1); let calls=0; const dispatcher=new OutboxDispatcher({ authority:e.authority, workerId:"worker-1", retrySeconds:1, maxAttempts:3, deliver:async()=>{ calls++; if(calls===1) throw new Error("temporary"); } }); const first=await dispatcher.runOnce(); assert.equal(first.retried,1); assert.equal(e.authority.listOutbox()[0].state,"pending"); e.advance(2); const second=await dispatcher.runOnce(); assert.equal(second.delivered,1); assert.equal(e.authority.listOutbox()[0].state,"delivered"); const duplicate=e.operations.execute({ name:"events.publish", input:{ tenantId:"tenant-a", type:"workspace.changed", payload:{ revision:2 }, idempotencyKey:"evt-1" } }, { accessToken:e.token }); assert.equal(duplicate.result.duplicate,true); assert.equal(e.authority.listOutbox().length,1); } finally { cleanup(e); } });

test("control-plane state survives SQLite reopen", () => { const e=env(); e.control.installApp("tenant-a","space-mountain"); e.control.setEntitlement({ tenantId:"tenant-a", appId:"space-mountain", key:"tier", value:"pro" }); e.store.close(); const reopened=new SqliteAuthorityStore(e.path); try { const control=new ControlService({ store:reopened }); assert.equal(control.getTenant("tenant-a").ownerUserId,"owner-1"); assert.equal(control.getApp("space-mountain").name,"SpaceMountain"); assert.equal(control.listInstalls("tenant-a")[0].enabled,true); assert.equal(control.listEntitlements("tenant-a","space-mountain")[0].value,"pro"); } finally { reopened.close(); rmSync(e.dir,{recursive:true,force:true}); } });
