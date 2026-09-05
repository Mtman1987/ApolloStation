import test from "node:test";
import assert from "node:assert/strict";
import { SpmtClient } from "../packages/sdk/dist/index.js";

test("SDK default transport keeps the browser fetch receiver for room and workspace requests", async (t) => {
  const seen = [];
  // Native browser fetch rejects a client instance as its receiver; Node fetch
  // and arrow-function test doubles do not enforce that browser requirement.
  t.mock.method(globalThis, "fetch", async function (url, init) {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    seen.push({ url, init });
    const path = new URL(url).pathname;
    if (path === "/v1/session") return Response.json({ tenantIds: ["tenant-1"] });
    if (path === "/v1/workspace/profile") return Response.json({ revision: 1, dockSlots: [null, null, null] });
    if (init.method === "DELETE") return Response.json({ roomId: "builder", deleted: true });
    return Response.json([{ roomId: "builder" }]);
  });
  const client = new SpmtClient({ baseUrl: "https://apollo.test", appId: "spacemountain" });
  assert.deepEqual((await client.getSession()).tenantIds, ["tenant-1"]);
  assert.equal((await client.listSimulationRooms("tenant-1"))[0].roomId, "builder");
  assert.equal((await client.listSimulationRoomEvents("tenant-1", { roomId: "builder" }))[0].roomId, "builder");
  const workspace = await client.getWorkspaceProfile("tenant-1");
  await client.updateWorkspaceProfile("tenant-1", workspace.revision, { dockSlots: ["/simulation-rooms?roomId=builder", null, null] });
  assert.equal((await client.deleteSimulationRoom("tenant-1", "builder", "delete-1")).deleted, true);
  assert.equal(seen.length, 6);
  for (const { init } of seen.slice(1)) assert.equal(new Headers(init.headers).get("x-spmt-tenant"), "tenant-1");
  assert.equal(new Headers(seen.at(-1).init.headers).get("idempotency-key"), "delete-1");
});

test("SDK uses documented app/tenant/correlation headers and bearer auth", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ eventId: "evt-1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new SpmtClient({
    baseUrl: "https://green.spmt.test/",
    appId: "reference-app",
    fetchImpl,
    getAccessToken: () => "test-token",
  });

  const result = await client.publishEvent("tenant-1", "reference.ready", { ready: true }, "idem-1");
  assert.equal(result.eventId, "evt-1");
  assert.equal(seen.length, 1);
  const call = seen[0];
  assert.equal(call.url, "https://green.spmt.test/v1/events");
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get("x-spmt-app"), "reference-app");
  assert.equal(headers.get("x-spmt-tenant"), "tenant-1");
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.equal(headers.get("idempotency-key"), "idem-1");
});

test("SDK event reads use the documented scoped query contract", async () => {
  const seen = [];
  const client = new SpmtClient({
    baseUrl: "https://green.spmt.test",
    appId: "space-mountain",
    getAccessToken: () => "test-token",
    fetchImpl: async (url, init) => { seen.push({ url, init }); return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); },
  });
  await client.listEvents("tenant-1", { type: "app.ready", sourceAppId: "streamweaver", limit: 25 });
  const call = seen[0];
  const url = new URL(call.url);
  assert.equal(url.pathname, "/v1/events");
  assert.equal(url.searchParams.get("type"), "app.ready");
  assert.equal(url.searchParams.get("sourceAppId"), "streamweaver");
  assert.equal(url.searchParams.get("limit"), "25");
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get("x-spmt-tenant"), "tenant-1");
});

test("SDK publishes and reads tenant-scoped Simulation Room events through the shared event API", async () => {
  const seen=[];
  const client=new SpmtClient({baseUrl:"https://green.spmt.test",appId:"overlay-bay",getAccessToken:()=>"test-token",fetchImpl:async(url,init={})=>{
    seen.push({url,init});
    if((init.method??"GET")==="POST")return Response.json({id:"event-1",tenantId:"tenant-1",sourceAppId:"overlay-bay",payload:JSON.parse(init.body).payload});
    return Response.json([
      {id:"event-1",tenantId:"tenant-1",sourceAppId:"overlay-bay",payload:{schemaVersion:1,roomId:"builder",lane:"overlay",direction:"preview",title:"Scene",body:"Rendered",occurredAt:"2026-09-05T00:00:00.000Z"}},
    ]);
  }});
  await client.publishSimulationRoomEvent("tenant-1",{roomId:"builder",lane:"overlay",direction:"preview",title:"Scene",body:"Rendered",data:{sceneId:"scene-1"},occurredAt:"2026-09-05T00:00:00.000Z"},"simulation-1");
  const published=JSON.parse(seen[0].init.body);
  assert.equal(published.roomId,"builder");
  assert.equal(new Headers(seen[0].init.headers).get("x-spmt-tenant"),"tenant-1");
  assert.equal(new URL(seen[0].url).pathname,"/v1/simulation-rooms/events");
  const listed=await client.listSimulationRoomEvents("tenant-1",{roomId:"builder",lane:"overlay"});
  assert.deepEqual(listed.map((event)=>event.id),["event-1"]);
  assert.equal(new URL(seen[1].url).pathname,"/v1/simulation-rooms/events");
  assert.equal(new URL(seen[1].url).searchParams.get("roomId"),"builder");
  assert.equal(new URL(seen[1].url).searchParams.get("lane"),"overlay");
  assert.throws(()=>client.publishSimulationRoomEvent("tenant-1",{roomId:"builder",lane:"app",direction:"preview",title:"Unsafe",body:"No",data:{access_token:"must-not-leak"}},"simulation-unsafe"),/credentials or secrets/);
});

test("deprecated Athena SDK names remain transition aliases for Stellar Core", async () => {
  const seen = [];
  const client = new SpmtClient({
    baseUrl: "https://green.spmt.test",
    appId: "legacy-reference-app",
    getAccessToken: () => "legacy-token",
    fetchImpl: async (url, init) => { seen.push({ url, init }); return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); },
  });
  await client.listAthenaContext("tenant-1", "user-1");
  await client.upsertAthenaContext("tenant-1", { text: "legacy context" });
  await client.listAthenaCommands();
  await client.upsertAthenaCommand({ id: "legacy.command" });
  assert.deepEqual(seen.map((call) => new URL(call.url).pathname), [
    "/v1/athena/context",
    "/v1/athena/context",
    "/v1/athena/commands",
    "/v1/athena/commands",
  ]);
  assert.deepEqual(seen.map((call) => call.init.method ?? "GET"), ["GET", "PUT", "GET", "PUT"]);
});
