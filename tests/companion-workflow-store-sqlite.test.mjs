import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompanionWorkflowClaimCoordinator, SqliteCompanionWorkflowStore } from "../apps/companion/dist/index.js";

function job(id="job-1",status="approved"){return{id,workflowId:"test.echo",title:"Echo",source:"relay",payload:{message:"hello"},status,createdAt:"2026-08-26T12:00:00.000Z",updatedAt:"2026-08-26T12:00:00.000Z"};}

test("Companion workflow store survives restart",()=>{
  const dir=mkdtempSync(join(tmpdir(),"companion-workflow-")),db=join(dir,"companion.sqlite");let store=new SqliteCompanionWorkflowStore(db);store.put(job());store.close();store=new SqliteCompanionWorkflowStore(db);assert.equal(store.list()[0].id,"job-1");assert.equal(store.get("job-1").payload.message,"hello");store.close();rmSync(dir,{recursive:true,force:true});
});

test("Companion workflow claims are exclusive until lease expiry",()=>{
  const dir=mkdtempSync(join(tmpdir(),"companion-claim-")),store=new SqliteCompanionWorkflowStore(join(dir,"companion.sqlite"));store.put(job());const first=store.claim("job-1","runtime-a",{now:"2026-08-26T12:00:00Z",leaseMs:60000});assert.equal(first.claimantId,"runtime-a");assert.throws(()=>store.claim("job-1","runtime-b",{now:"2026-08-26T12:00:30Z"}),/already claimed/);const second=store.claim("job-1","runtime-b",{now:"2026-08-26T12:01:01Z"});assert.equal(second.claimantId,"runtime-b");store.close();rmSync(dir,{recursive:true,force:true});
});

test("Companion claim coordinator heartbeats and releases its own lease",()=>{
  const dir=mkdtempSync(join(tmpdir(),"companion-coordinate-")),store=new SqliteCompanionWorkflowStore(join(dir,"companion.sqlite"));store.put(job());let now="2026-08-26T12:00:00Z";const coordinator=new CompanionWorkflowClaimCoordinator(store,"runtime-a",{leaseMs:60000,now:()=>now});coordinator.claim("job-1");now="2026-08-26T12:00:30Z";const renewed=coordinator.heartbeat("job-1");assert.equal(renewed.leaseUntil,"2026-08-26T12:01:30.000Z");assert.equal(coordinator.release("job-1"),true);assert.equal(store.claimStatus("job-1",now),null);store.close();rmSync(dir,{recursive:true,force:true});
});

test("Companion refuses claims for jobs that still require review",()=>{
  const dir=mkdtempSync(join(tmpdir(),"companion-review-")),store=new SqliteCompanionWorkflowStore(join(dir,"companion.sqlite"));store.put(job("job-review","awaiting_review"));assert.throws(()=>store.claim("job-review","runtime-a"),/not claimable/);store.close();rmSync(dir,{recursive:true,force:true});
});
