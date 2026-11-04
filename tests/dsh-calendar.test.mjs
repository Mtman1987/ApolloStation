import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteDshCalendarStore, renderDshCalendarDiscordSummary } from "../apps/discord-stream-hub/dist/index.js";

const member={userId:"user-1",username:"Captain",avatarUrl:"https://cdn.example/captain.png"};

test("DSH Captain's Log preserves one claimant per server day and donor points intent",()=>{
  const dir=mkdtempSync(join(tmpdir(),"dsh-calendar-")),store=new SqliteDshCalendarStore(join(dir,"dsh.sqlite"));
  const first=store.scheduleCaptainsLog({tenantId:"tenant-a",serverId:"guild-a",member,selectedDate:"2026-08-30",now:"2026-08-26T12:00:00Z"});
  assert.equal(first.event.type,"captains-log");assert.equal(first.event.eventDateTime,"2026-08-30T12:00:00.000Z");assert.equal(first.points.eventType,"admin_captains_log");assert.equal(first.refreshDiscordCalendar,true);
  assert.throws(()=>store.scheduleCaptainsLog({tenantId:"tenant-a",serverId:"guild-a",member:{...member,userId:"user-2"},selectedDate:"2026-08-30"}),/already claimed/);
  store.scheduleCaptainsLog({tenantId:"tenant-b",serverId:"guild-a",member,selectedDate:"2026-08-30"});
  assert.equal(store.list("tenant-a","guild-a").length,1);assert.equal(store.list("tenant-b","guild-a").length,1);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("DSH missions preserve optional clock, member attribution, CRUD and restart",()=>{
  const dir=mkdtempSync(join(tmpdir(),"dsh-calendar-mission-")),db=join(dir,"dsh.sqlite");let store=new SqliteDshCalendarStore(db);
  const mutation=store.scheduleMission({tenantId:"tenant-a",serverId:"guild-a",member,missionName:"Raid Night",missionDescription:"Community raid train",missionDate:"2026-09-01",missionTime:"19:30",now:"2026-08-26T12:00:00Z"});
  assert.equal(mutation.event.eventDateTime,"2026-09-01T19:30:00.000Z");assert.equal(mutation.points.eventType,"admin_calendar_event");
  const updated=store.updateEvent("tenant-a","guild-a",mutation.event.id,{eventName:"Raid Night II",eventTime:"20:00"},"2026-08-26T13:00:00Z");assert.equal(updated.eventName,"Raid Night II");assert.equal(updated.eventDateTime,"2026-09-01T20:00:00.000Z");
  store.close();store=new SqliteDshCalendarStore(db);assert.equal(store.list("tenant-a","guild-a",{from:"2026-09-01",to:"2026-09-01"})[0].eventName,"Raid Night II");assert.equal(store.deleteEvent("tenant-a","guild-a",mutation.event.id),true);assert.equal(store.list("tenant-a","guild-a").length,0);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("DSH calendar Discord projection is bounded and truthful when empty",()=>{
  const empty=renderDshCalendarDiscordSummary([],{from:"2026-09-01",to:"2026-09-30"});assert.equal(empty.eventCount,0);assert.match(empty.description,/No scheduled/);
});


test("calendar projection sorts and bounds long community schedules", () => {
  const events = Array.from({length: 80}, (_, i) => ({ dayKey: "2026-09-20", eventDateTime: "2026-09-20T12:00:00Z", eventName: "M".repeat(120), username: "U".repeat(80) }));
  events.unshift({ dayKey: "2026-08-30", eventDateTime: "2026-08-30T12:00:00Z", eventName: "Outside month", username: "Captain" });
  const result = renderDshCalendarDiscordSummary(events, { from: "2026-09-01", to: "2026-09-30" });
  assert.ok(result.description.length < 4000);
  assert.equal(result.eventCount, 80);
  assert.match(result.description, /more scheduled items/);
  assert.doesNotMatch(result.description, /Outside month/);
});

test("chat and voice calendar actions share the workspace calendar before Discord setup", async () => {
  const { DshSuiteActionOperations } = await import("../apps/discord-stream-hub/dist/suite-action-operations.js");
  const calendar = new SqliteDshCalendarStore(":memory:");
  try {
    const operations = new DshSuiteActionOperations({ config: { tenants: [] }, calendar });
    const today = new Date().toISOString().slice(0, 10);
    const request = { tenantId: "tenant-a", actorUserId: "user-a", action: "dsh.calendar.captain.create", args: { selectedDate: today } };
    const created = await operations.createCalendarEntry(request);
    assert.equal(created.event.serverId, "workspace");
    const result = await operations.readCalendar({ ...request, args: {} }, true);
    assert.equal(result.events[0].id, created.event.id);
    assert.equal((await operations.readCalendar({ ...request, tenantId: "tenant-b", args: {} }, false)).events.length, 0);
    const moved = calendar.updateEvent("tenant-a", "workspace", created.event.id, { eventDate: "2026-10-02" });
    assert.match(moved.eventName, /Oct 2/);
  } finally { calendar.close(); }
});


test("calendar publishing preserves tracked messages after transient failures", async () => {
  const { DshSuiteActionOperations } = await import("../apps/discord-stream-hub/dist/suite-action-operations.js");
  const { SqliteDshDiscordMessageStore, DshDiscordError } = await import("../apps/discord-stream-hub/dist/discord-live-publisher.js");
  const calendar = new SqliteDshCalendarStore(":memory:"), messages = new SqliteDshDiscordMessageStore(":memory:");
  const guildId = "123456789012345678", channelId = "234567890123456789";
  try {
    messages.put({ tenantId: "tenant-a", kind: "calendar", key: guildId, channelId, messageId: "345678901234567890", updatedAt: new Date().toISOString() });
    let error = new DshDiscordError(503, {}), creates = 0;
    const operations = new DshSuiteActionOperations({ config: { tenants: [{ tenantId: "tenant-a", discordGuildIds: [guildId] }] }, calendar, messages, discord: { async editMessage(){throw error}, async createMessage(){creates++;return "456789012345678901"} } });
    const request = { tenantId: "tenant-a", actorUserId: "user-a", action: "dsh.calendar.deploy", args: { guildId, channelId } };
    await assert.rejects(operations.deployCalendar(request), /503/);
    assert.equal(creates, 0);
    assert.equal(messages.get("tenant-a", "calendar", guildId).messageId, "345678901234567890");
    error = new DshDiscordError(404, {});
    await operations.deployCalendar(request);
    assert.equal(creates, 1);
    assert.equal(messages.get("tenant-a", "calendar", guildId).messageId, "456789012345678901");
  } finally { calendar.close(); messages.close(); }
});
