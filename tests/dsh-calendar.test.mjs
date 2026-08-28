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
