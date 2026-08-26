import assert from "node:assert/strict";
import test from "node:test";
import { buildDshApplicationModal, buildDshInquiryMessage, buildDshPublicApplicationEmbed, normalizeDshApplicationAnswers, parseDshApplicationType } from "../apps/discord-stream-hub/dist/index.js";

test("DSH participation starts with inquiry for moderation partnership and development",()=>{
  const embed=buildDshPublicApplicationEmbed("guild-1");
  assert.match(embed.embeds[0].description,/Start with an inquiry/);
  assert.deepEqual(embed.components[0].components.map((button)=>button.label),["Inquire about Moderation","Inquire about Partnership","Inquire about Development"]);
  assert.equal(parseDshApplicationType("modship"),"mod");assert.equal(parseDshApplicationType("partnership"),"partner");assert.equal(parseDshApplicationType("sdk"),"dev");
});

test("DSH inquiry DM explains responsibilities perks terms before application",()=>{
  const message=buildDshInquiryMessage("dev","guild-1","https://spmt.live/","SpaceMountain");
  assert.match(message.embeds[0].title,/Development Inquiry/);assert.equal(message.embeds[0].fields[0].name,"Responsibilities");assert.equal(message.embeds[0].fields[1].name,"Perks");
  assert.match(message.components[1].components[0].url,/DEVELOPER_SDK_COMMUNITY_TERMS/);
  assert.equal(message.components[0].components[0].custom_id,"application_start:dev:guild-1");
});

test("DSH application modal preserves five bounded questions and validates all answers",()=>{
  const modal=buildDshApplicationModal("mod","guild-1");assert.equal(modal.components.length,5);assert.equal(modal.custom_id,"application_submit:mod:guild-1");
  const answers=Object.fromEntries(modal.components.map((row)=>[row.components[0].custom_id,"This is a sufficiently detailed answer for review."]));
  assert.equal(Object.keys(normalizeDshApplicationAnswers("mod",answers)).length,5);
  assert.throws(()=>normalizeDshApplicationAnswers("mod",{...answers,experience:"short"}),/10 through 1000/);
});
