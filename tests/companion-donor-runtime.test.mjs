import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompanionDiagnosticsStore, CompanionWorkflowJobs, MemoryCompanionWorkflowStore, redactCompanionText } from "../apps/companion/dist/index.js";

test("Companion diagnostics redact provider secrets and retain a bounded Fly snapshot",()=>{
 const dir=mkdtempSync(join(tmpdir(),"companion-diag-"));
 const store=new CompanionDiagnosticsStore({rootPath:dir,maxSnapshots:2,maxSnapshotBytes:10_000,now:()=>"2026-08-25T03:30:00.000Z"});
 store.log("authorization: Bearer super-secret-token-123456",new Error("password=hunter2"));
 const written=store.writeSnapshot({snapshotId:"snap-1",capturedAt:"2026-08-25T03:29:00.000Z",states:{token:"abc",healthy:true},logs:["https://x.test/?access_token=secret123",{authorization:"Bearer hidden-hidden-hidden"}]});
 const body=readFileSync(written.path,"utf8");
 assert.doesNotMatch(body,/secret123|hidden-hidden|"abc"/);
 assert.match(body,/\[REDACTED\]/);
 assert.equal(store.snapshot().latest.logCount,2);
 assert.equal(redactCompanionText("Bearer abcdefghijklmnop"),"Bearer [REDACTED]");
 rmSync(dir,{recursive:true,force:true});
});

test("Companion harmless relay workflow runs without local side effects",async()=>{
 const media={has:()=>false,writeJson(){throw new Error("must not write");}};const executor={playObsMedia:async()=>{throw new Error("must not play");}};
 const jobs=new CompanionWorkflowJobs(new MemoryCompanionWorkflowStore(),media,executor,{now:()=>"2026-08-25T03:30:00.000Z",idFactory:()=>"job-echo"});
 const result=await jobs.run("test.echo",{message:"hello"});
 assert.equal(result.status,"completed");assert.deepEqual(result.result,{echoed:"hello",touchedLocalState:false});
});

test("Companion jingle playback requires local review and approved media",async()=>{
 const played=[];const media={has:(name)=>name==="sting.mp3",writeJson(){}};const executor={playObsMedia:async(input)=>{played.push(input);return{played:true};}};
 const jobs=new CompanionWorkflowJobs(new MemoryCompanionWorkflowStore(),media,executor,{now:()=>"2026-08-25T03:30:00.000Z",idFactory:()=>"job-jingle"});
 const pending=await jobs.run("audio.jingle.play",{mediaName:"sting.mp3",obsInputName:"Jingle",title:"Sting"});assert.equal(pending.status,"awaiting_review");assert.equal(played.length,0);
 const done=await jobs.review(pending.id,true);assert.equal(done.status,"completed");assert.equal(played.length,1);assert.equal(played[0].mediaName,"sting.mp3");
});

test("Companion song brief writes only an engine-neutral manifest and waits for rendered output",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"companion-workflow-"));const files=new Map();const media={has:(name)=>files.has(name),writeJson:(name,value)=>files.set(name,value)};const executor={playObsMedia:async()=>({})};
 const jobs=new CompanionWorkflowJobs(new MemoryCompanionWorkflowStore(),media,executor,{now:()=>"2026-08-25T03:30:00.000Z",idFactory:()=>"job-song"});
 const pending=await jobs.run("song.render.request",{title:"Launch Song",brief:"Make it cosmic",engine:"manual",outputName:"launch.wav"});assert.equal(pending.status,"awaiting_review");
 const waiting=await jobs.review(pending.id,true);assert.equal(waiting.status,"waiting_for_renderer");assert.equal(files.has("creative-job-job-song.json"),true);assert.equal(files.get("creative-job-job-song.json").outputName,"launch.wav");
 files.set("launch.wav",Buffer.from("rendered"));const snapshot=jobs.snapshot();assert.equal(snapshot[0].status,"completed");assert.equal(snapshot[0].result.rendered,true);
 rmSync(dir,{recursive:true,force:true});
});

test("Companion workflow payloads reject path traversal and unknown workflows",async()=>{
 const media={has:()=>true,writeJson(){}};const executor={playObsMedia:async()=>({})};const jobs=new CompanionWorkflowJobs(new MemoryCompanionWorkflowStore(),media,executor);
 const pending=jobs.createReviewRequest("audio.jingle.play",{mediaName:"../../sting.mp3",obsInputName:"Jingle"});assert.equal(pending.payload.mediaName,"sting.mp3");
 assert.throws(()=>jobs.createReviewRequest("shell.exec",{command:"rm -rf /"}),/not allowlisted/);
});
