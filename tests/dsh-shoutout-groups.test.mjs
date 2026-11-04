import assert from "node:assert/strict";
import test from "node:test";
import { buildDshShoutoutGroupSummary, canonicalDshShoutoutGroup, dshShoutoutGroupSlug, listDshShoutoutGroupMembers, matchesDshShoutoutGroup, normalizeDshShoutoutGroup, resolveDshShoutoutTargets } from "../apps/discord-stream-hub/dist/index.js";

const members=[
  {userId:"1",username:"alpha",group:0,isLive:true},
  {userId:"2",username:"beta",group:"Community - Everyone Else",isLive:false},
  {userId:"3",username:"gamma",group:"Raid_Train",isLive:true},
  {userId:"4",username:"delta",group:"partners",isLive:true},
  {userId:"5",username:"epsilon",group:"Honored Guest",isLive:false},
];

test("DSH shoutout groups preserve donor legacy aliases and canonical labels",()=>{
  assert.equal(normalizeDshShoutoutGroup(0),"vip");assert.equal(normalizeDshShoutoutGroup(1),"community");assert.equal(normalizeDshShoutoutGroup("mountaineer"),"community");assert.equal(normalizeDshShoutoutGroup("train crew"),"raid train");assert.equal(canonicalDshShoutoutGroup("partner tier"),"Partners");assert.equal(dshShoutoutGroupSlug("Honored Guest"),"honored-guests");assert.equal(matchesDshShoutoutGroup("raid-pile","Pile"),true);
});

test("DSH group membership and summaries remain deterministic",()=>{
  assert.deepEqual(listDshShoutoutGroupMembers(members,"VIP").map((member)=>member.username),["alpha"]);const summary=buildDshShoutoutGroupSummary(members);assert.equal(summary.find((row)=>row.group==="vip").memberCount,1);assert.equal(summary.find((row)=>row.group==="raid train").liveCount,1);assert.equal(summary.find((row)=>row.group==="crew").memberCount,0);
});

test("DSH shoutout routing can target a group or only its live members",()=>{
  assert.deepEqual(resolveDshShoutoutTargets(members,"Community").map((target)=>target.username),["beta"]);assert.deepEqual(resolveDshShoutoutTargets(members,"Raid Train",{liveOnly:true}).map((target)=>target.username),["gamma"]);assert.deepEqual(resolveDshShoutoutTargets(members,"Honored Guests",{liveOnly:true}),[]);assert.throws(()=>resolveDshShoutoutTargets(members,"unknown"),/Unknown/);
});
