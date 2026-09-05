import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthorityService, MemoryAuthorityStore } from "../packages/authority-core/dist/index.js";
import { SqliteAuthorityStore } from "../packages/authority-sqlite/dist/index.js";
import { AuthService } from "../packages/auth-core/dist/index.js";
import { PlatformOperations } from "../packages/platform-ops/dist/index.js";
import { PlatformApiAdapter } from "../packages/api-adapter/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";
import { SpmtMcpServer, SPMT_MCP_PROTOCOL_VERSION } from "../packages/mcp/dist/index.js";
import { SPMT_SIMULATION_ROOM_EVENT, SPMT_SIMULATION_ROOM_DELETED } from "../packages/contracts/dist/index.js";
import { simulationRoomPath, simulationRoomSlot } from "../apps/spacemountain/dist/simulation-rooms-ui.js";

for (const storage of ["memory", "sqlite"]) test(`${storage}: room messages group once, survive other activity, delete durably, and restart cleanly`, () => {
  const dir = mkdtempSync(join(tmpdir(), "simulation-rooms-")), path = join(dir, "authority.db");
  let store = storage === "sqlite" ? new SqliteAuthorityStore(path) : new MemoryAuthorityStore();
  let authority = new AuthorityService({ store, now: () => "2026-09-05T12:00:00.000Z" });
  const publish = (roomId, key, direction = "ingress", tenantId = "tenant-a") => authority.publishEvent({ tenantId, sourceAppId: "streamweaver", type: SPMT_SIMULATION_ROOM_EVENT, payload: { schemaVersion: 1, roomId, roomName: "Flow previews", lane: "chat", direction, title: "Coinflip", body: key, occurredAt: "2026-09-05T12:00:00.000Z" }, idempotencyKey: key });
  try {
    publish("builder", "input"); publish("builder", "output", "egress"); publish("builder", "input", "ingress", "tenant-b");
    for (let i=0;i<220;i++) authority.publishEvent({ tenantId: "tenant-a", sourceAppId: "app", type: "other.event", payload: {}, idempotencyKey: `noise-${i}` });
    assert.deepEqual(authority.listSimulationRooms("tenant-a").map((room) => [room.roomId,room.eventCount]), [["builder",2]]);
    assert.deepEqual(authority.listSimulationRoomEvents("tenant-a", { roomId: "builder", lane: "chat", limit: 1 }).map((event) => event.payload.body), ["output"]);
    const slot = simulationRoomPath("builder");
    authority.getOrCreateWorkspace("tenant-a"); authority.updateWorkspace("tenant-a",1,{dockSlots:[slot,null,null]});
    authority.deleteSimulationRoom("tenant-a","builder","owner","delete-1");
    if (storage === "sqlite") { store.close(); store = new SqliteAuthorityStore(path); authority = new AuthorityService({ store }); }
    assert.deepEqual(authority.listSimulationRooms("tenant-a"),[]);
    assert.deepEqual(authority.listSimulationRoomEvents("tenant-a",{roomId:"builder"}),[]);
    assert.equal(authority.listSimulationRooms("tenant-b")[0].eventCount,1);
    assert.equal(authority.listEvents("tenant-a",{type:SPMT_SIMULATION_ROOM_EVENT}).length,2,"canonical audit events are retained");
    assert.equal(authority.getWorkspace("tenant-a").dockSlots[0],slot,"room slot persists after removing its conversation");
    publish("builder","new-input");
    assert.equal(authority.deleteSimulationRoom("tenant-a","builder","owner","delete-1").duplicate,true);
    assert.equal(authority.listSimulationRooms("tenant-a")[0].eventCount,1,"a replayed delete must not remove a new preview");
    assert.equal(authority.listSimulationRoomEvents("tenant-a",{roomId:"builder"})[0].payload.body,"new-input");
  } finally { store.close?.(); rmSync(dir,{recursive:true,force:true}); }
});

test("room SDK/API/MCP reads are tenant scoped and deletion requires workspace write access", async () => {
  const dir=mkdtempSync(join(tmpdir(),"simulation-access-")),store=new SqliteAuthorityStore(join(dir,"authority.db"));
  try {
    const authority=new AuthorityService({store}),auth=new AuthService({store});
    authority.ensureUser("owner");
    const token=auth.issueHumanSession({userId:"owner",scopes:["events:read","workspace:write"],tenantIds:["tenant-a"]}).accessToken;
    const readToken=auth.issueHumanSession({userId:"owner",scopes:["events:read","events:write"],tenantIds:["tenant-a"]}).accessToken;
    const operations=new PlatformOperations(auth,authority),api=new PlatformApiAdapter(operations);
    const fetchImpl=async(url,init={})=>{const u=new URL(url),response=api.handle({method:init.method??"GET",path:u.pathname+u.search,headers:Object.fromEntries(new Headers(init.headers)),...(init.body?{body:JSON.parse(init.body)}:{})});return Response.json(response.body,{status:response.status});};
    const client=new SpmtClient({baseUrl:"https://apollo.test",appId:"spacemountain",getAccessToken:()=>token,fetchImpl});
    await client.publishSimulationRoomEvent("tenant-a",{roomId:"builder:a/b",lane:"chat",direction:"ingress",title:"Input",body:"!coinflip"},"input");
    assert.equal((await client.listSimulationRooms("tenant-a"))[0].eventCount,1);
    assert.equal((await client.listSimulationRoomEvents("tenant-a",{roomId:"builder:a/b"})).length,1);
    await assert.rejects(client.listSimulationRooms("tenant-b"),{status:403});
    await assert.rejects(client.listSimulationRoomEvents("tenant-b",{roomId:"builder:a/b"}),{status:403});
    await assert.rejects(client.deleteSimulationRoom("tenant-b","builder:a/b","bad-tenant"),{status:403});
    const headers={authorization:`Bearer ${readToken}`,"x-spmt-tenant":"tenant-a","idempotency-key":"unauthorized-delete"};
    assert.equal(api.handle({method:"DELETE",path:"/v1/simulation-rooms?roomId=builder%3Aa%2Fb",headers}).status,403);
    assert.equal(api.handle({method:"POST",path:"/v1/events",headers,body:{type:SPMT_SIMULATION_ROOM_DELETED,payload:{roomId:"builder:a/b"}}}).status,400);
    const mcp=new SpmtMcpServer(operations),result=mcp.handle({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"spmt.simulation-rooms.list",arguments:{tenantId:"tenant-a"}}},{accessToken:token,protocolVersion:SPMT_MCP_PROTOCOL_VERSION});
    assert.equal(result.result.structuredContent[0].roomId,"builder:a/b");
    await client.deleteSimulationRoom("tenant-a","builder:a/b","delete-1");
    assert.deepEqual(await client.listSimulationRooms("tenant-a"),[]);
    assert.ok(store.listAudit("tenant-a").some((row)=>row.action==="simulation-rooms.delete"));
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test("workspace room slots encode room identity and reject external or unrelated destinations", () => {
  assert.deepEqual(simulationRoomSlot(simulationRoomPath("builder:a/b")),{roomId:"builder:a/b"});
  assert.deepEqual(simulationRoomSlot(simulationRoomPath()),{});
  for(const value of ["streamweaver","https://other.test/simulation-rooms","//other.test/simulation-rooms","/simulation-rooms/other","/simulation-rooms?redirect=https://other.test"]){assert.equal(simulationRoomSlot(value),undefined);}
});
