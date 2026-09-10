import test from "node:test";
import assert from "node:assert/strict";
import { discoverHumanReferencesInText, humanizeTextWithReferences, normalizeHumanReferenceInputs } from "../packages/contracts/dist/human-reference.js";
import { HumanReferenceService } from "../apps/spmt-service/dist/human-reference-api.js";

test("human reference discovery requires semantic context and pairs event references with channel", () => {
  const refs = discoverHumanReferencesInText('Discord serverId=123456789012345678 channel 223456789012345678 messageId:323456789012345678 user 423456789012345678 total 523456789012345678');
  assert.equal(refs.length, 4);
  assert.equal(refs.find((ref) => ref.kind === "message")?.channelId, "223456789012345678");
  assert.equal(refs.find((ref) => ref.kind === "user")?.channelId, "223456789012345678");
  assert.equal(refs.find((ref) => ref.kind === "message")?.guildId, "123456789012345678");
  assert.equal(refs.some((ref) => ref.id === "523456789012345678"), false);
});

test("humanized logs replace only resolved opaque ids without changing canonical reference records", () => {
  const text = 'channelId=223456789012345678 messageId=323456789012345678 userId=423456789012345678';
  const refs = [
    { schemaVersion:1, provider:"discord", kind:"channel", id:"223456789012345678", label:"#general", secondary:"SpaceMountain", resolved:true },
    { schemaVersion:1, provider:"discord", kind:"message", id:"323456789012345678", channelId:"223456789012345678", label:'Message “hello”', resolved:true },
    { schemaVersion:1, provider:"discord", kind:"user", id:"423456789012345678", label:"Discord user", resolved:false },
  ];
  assert.equal(humanizeTextWithReferences(text, refs), 'channelId=#general (SpaceMountain) messageId=Message “hello” userId=423456789012345678');
  assert.equal(refs[0].id, "223456789012345678");
});

test("Discord remote resolution is tenant-scoped and does not perform global user lookups", async () => {
  const listed = [], fetched = [];
  const credentials = {
    list(tenantId) { listed.push(tenantId); return [{ provider:"discord", providerUserId:"bot", state:"ready", metadata:{authorizationScheme:"Bot"} }]; },
    async resolve(input) { assert.equal(input.tenantId, "tenant-a"); return { accessToken:"secret", metadata:{authorizationScheme:"Bot"} }; },
  };
  const fetchImpl = async (url) => { fetched.push(String(url)); if (String(url).endsWith('/channels/223456789012345678')) return new Response(JSON.stringify({id:"223456789012345678",name:"general",guild_id:"123456789012345678"}),{status:200}); if (String(url).endsWith('/guilds/123456789012345678')) return new Response(JSON.stringify({id:"123456789012345678",name:"SpaceMountain"}),{status:200}); return new Response('{}',{status:404}); };
  const service = new HumanReferenceService({ credentials, fetchImpl });
  const [channel] = await service.resolveMany("tenant-a", normalizeHumanReferenceInputs([{provider:"discord",kind:"channel",id:"223456789012345678"}]));
  assert.equal(channel.label, "#general");
  assert.equal(channel.secondary, "SpaceMountain");
  assert.deepEqual(listed, ["tenant-a"]);
  const [user] = await service.resolveMany("tenant-a", [{provider:"discord",kind:"user",id:"423456789012345678"}]);
  assert.equal(user.resolved, false);
  assert.equal(fetched.some((url) => url.includes('/users/423456789012345678')), false);
});

test("Discord user references inherit accessible channel context and resolve inside that server", async () => {
  const fetched = [];
  const credentials = {
    list() { return [{ provider:"discord", providerUserId:"bot", state:"ready", metadata:{authorizationScheme:"Bot"} }]; },
    async resolve() { return { accessToken:"secret", metadata:{authorizationScheme:"Bot"} }; },
  };
  const fetchImpl = async (url) => {
    const value=String(url); fetched.push(value);
    if(value.endsWith('/channels/223456789012345678'))return new Response(JSON.stringify({id:"223456789012345678",name:"general",guild_id:"123456789012345678"}),{status:200});
    if(value.endsWith('/guilds/123456789012345678/members/423456789012345678'))return new Response(JSON.stringify({nick:"SaltyBear",user:{id:"423456789012345678",username:"saltybear27276"}}),{status:200});
    if(value.endsWith('/guilds/123456789012345678'))return new Response(JSON.stringify({id:"123456789012345678",name:"SpaceMountain"}),{status:200});
    return new Response('{}',{status:404});
  };
  const service = new HumanReferenceService({ credentials, fetchImpl });
  const [user] = await service.resolveMany("tenant-a", [{provider:"discord",kind:"user",id:"423456789012345678",channelId:"223456789012345678"}]);
  assert.equal(user.label,"SaltyBear");
  assert.equal(user.secondary,"SpaceMountain");
  assert.equal(user.guildId,"123456789012345678");
  assert.equal(fetched.some((url)=>url.includes('/users/423456789012345678')),false);
});
