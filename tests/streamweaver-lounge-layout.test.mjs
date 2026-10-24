import assert from "node:assert/strict";
import test from "node:test";
import { setLoungeMediaLayoutStorage, voteLoungeMediaLayout, overrideLoungeMediaLayout, getLoungeMediaLayout, prepareStellaLoungeReply, beginLoungeCommandMenu, consumeLoungeCommandMenuChoice } from "../apps/streamweaver/dist/index.js";

test("lounge media layout switches after enough votes and respects locks", async () => {
  let saved = null;
  setLoungeMediaLayoutStorage({ read: async () => saved, write: async (v) => { saved = structuredClone(v); } });
  assert.equal((await getLoungeMediaLayout()).mode, "stream");
  for (const voter of ["a", "b", "c"]) await voteLoungeMediaLayout("media", voter);
  assert.equal((await getLoungeMediaLayout()).mode, "media");
  await overrideLoungeMediaLayout("stream", "mod");
  const locked = await voteLoungeMediaLayout("media", "d");
  assert.equal(locked.accepted, false);
});

test("stella lounge replies route links to broadcaster and wrap readouts", () => {
  assert.equal(prepareStellaLoungeReply("see https://x.y", "bot").as, "broadcaster");
  assert.match(prepareStellaLoungeReply("You have 50 points", "bot").message, /\(You have 50 points\)/);
});

test("command menu numeric choice resolves once", () => {
  const ctx = { platform: "twitch", username: "u", isMod: false };
  assert.ok(beginLoungeCommandMenu(ctx));
  assert.ok(Array.isArray(consumeLoungeCommandMenuChoice("1", ctx)));
  assert.equal(consumeLoungeCommandMenuChoice("1", ctx), null);
});
